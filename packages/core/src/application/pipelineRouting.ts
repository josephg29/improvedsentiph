/**
 * Pure pipeline routing — the deterministic conductor's brain.
 *
 * No side effects, no spawning, no I/O. Given a {@link Recipe} (data) and a
 * {@link Run} (the append-only log of everything that has happened), decide the
 * next move. Same inputs → same output, always. This is the file that makes the
 * orchestration honest: control flow is code, not an LLM remembering steps.
 *
 * The run state is reconstructed entirely from `run.outcomes` by counting
 * maximal contiguous *rounds* of each stage. Counting rounds (rather than raw
 * outcome counts) keeps the logic correct regardless of a stage's fanout.
 */

import type {
  IssueFinding,
  IssueSeverity,
  Recipe,
  Run,
  RunResult,
  RunStatus,
  StageId,
  StageRole,
  WorkerOutcome,
} from "../domain/pipeline";

export type NextAction =
  | { kind: "run_stage"; stageId: StageId }
  | { kind: "done"; result: RunResult };

type TerminalStatus = "passed" | "completed_with_issues" | "failed";

type Classification =
  | { kind: "run_stage"; stageId: StageId }
  | { kind: "done"; status: TerminalStatus };

const stageByRole = (recipe: Recipe, role: StageRole) =>
  recipe.stages.find((stage) => stage.role === role);

const requireStageByRole = (recipe: Recipe, role: StageRole) => {
  const stage = stageByRole(recipe, role);
  if (!stage) {
    throw new Error(`Recipe "${recipe.id}" is missing a required "${role}" stage.`);
  }
  return stage;
};

const outcomesForStage = (outcomes: WorkerOutcome[], stageId: StageId) =>
  outcomes.filter((outcome) => outcome.stageId === stageId);

const anyFailed = (outcomes: WorkerOutcome[]) => outcomes.some((outcome) => !outcome.ok);

/** Number of maximal contiguous groups of `stageId` in the ordered log. */
const countStageRounds = (outcomes: WorkerOutcome[], stageId: StageId): number => {
  let rounds = 0;
  let inGroup = false;
  for (const outcome of outcomes) {
    if (outcome.stageId === stageId) {
      if (!inGroup) {
        rounds += 1;
        inGroup = true;
      }
    } else {
      inGroup = false;
    }
  }
  return rounds;
};

/** The trailing contiguous group of `stageId` outcomes — the most recent round. */
const latestStageRound = (outcomes: WorkerOutcome[], stageId: StageId): WorkerOutcome[] => {
  const round: WorkerOutcome[] = [];
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    const outcome = outcomes[index];
    if (!outcome) {
      continue;
    }
    if (outcome.stageId === stageId) {
      round.unshift(outcome);
    } else if (round.length > 0) {
      break;
    }
  }
  return round;
};

/** The first contiguous group of `stageId` outcomes — the earliest round. */
const firstStageRound = (outcomes: WorkerOutcome[], stageId: StageId): WorkerOutcome[] => {
  const round: WorkerOutcome[] = [];
  for (const outcome of outcomes) {
    if (outcome.stageId === stageId) {
      round.push(outcome);
    } else if (round.length > 0) {
      break;
    }
  }
  return round;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readVerdict = (result: unknown): "pass" | "needs_fix" | null => {
  if (!isRecord(result)) {
    return null;
  }
  if (result.verdict === "pass" || result.verdict === "needs_fix") {
    return result.verdict;
  }
  return null;
};

const isSeverity = (value: unknown): value is IssueSeverity =>
  value === "low" || value === "medium" || value === "high";

const readIssues = (result: unknown): IssueFinding[] => {
  if (!isRecord(result) || !Array.isArray(result.issues)) {
    return [];
  }
  const issues: IssueFinding[] = [];
  for (const raw of result.issues) {
    if (!isRecord(raw)) {
      continue;
    }
    if (!isSeverity(raw.severity) || typeof raw.location !== "string") {
      continue;
    }
    if (typeof raw.problem !== "string") {
      continue;
    }
    const finding: IssueFinding = {
      severity: raw.severity,
      location: raw.location,
      problem: raw.problem,
    };
    if (typeof raw.suggestion === "string") {
      finding.suggestion = raw.suggestion;
    }
    issues.push(finding);
  }
  return issues;
};

const issueKey = (issue: IssueFinding) => `${issue.severity}|${issue.location}|${issue.problem}`;

const dedupeIssues = (issues: IssueFinding[]): IssueFinding[] => {
  const seen = new Set<string>();
  const result: IssueFinding[] = [];
  for (const issue of issues) {
    const key = issueKey(issue);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(issue);
  }
  return result;
};

const collectRoundIssues = (round: WorkerOutcome[]): IssueFinding[] =>
  dedupeIssues(round.flatMap((outcome) => readIssues(outcome.result)));

/**
 * The gate: did the most recent check round pass?
 *
 * Passes iff that round is non-empty and every checker copy exited cleanly,
 * returned `verdict: "pass"`, and flagged no `high`-severity issue. A failed
 * checker (`ok: false`) or any `high` issue blocks the gate (→ route to fix).
 */
export const checkersPassed = (outcomes: WorkerOutcome[], stageId: StageId): boolean => {
  const round = latestStageRound(outcomes, stageId);
  if (round.length === 0) {
    return false;
  }
  for (const outcome of round) {
    if (!outcome.ok) {
      return false;
    }
    if (readVerdict(outcome.result) !== "pass") {
      return false;
    }
    if (readIssues(outcome.result).some((issue) => issue.severity === "high")) {
      return false;
    }
  }
  return true;
};

const classify = (recipe: Recipe, run: Run): Classification => {
  const buildStage = requireStageByRole(recipe, "build");
  const checkStage = requireStageByRole(recipe, "check");
  const fixStage = stageByRole(recipe, "fix");

  const buildOutcomes = outcomesForStage(run.outcomes, buildStage.id);
  if (buildOutcomes.length === 0) {
    return { kind: "run_stage", stageId: buildStage.id };
  }
  if (anyFailed(buildOutcomes)) {
    return { kind: "done", status: "failed" };
  }

  const fixOutcomes = fixStage ? outcomesForStage(run.outcomes, fixStage.id) : [];
  if (anyFailed(fixOutcomes)) {
    // A failed builder/fixer is a hard run failure (spec §14).
    return { kind: "done", status: "failed" };
  }

  const checkRounds = countStageRounds(run.outcomes, checkStage.id);
  const fixRounds = fixStage ? countStageRounds(run.outcomes, fixStage.id) : 0;

  // We owe a check whenever the number of completed check rounds matches the
  // number of fix rounds: the first check after build (0 === 0) and every
  // re-check after a fix (1 === 1, …).
  if (checkRounds === fixRounds) {
    return { kind: "run_stage", stageId: checkStage.id };
  }

  if (checkersPassed(run.outcomes, checkStage.id)) {
    return { kind: "done", status: "passed" };
  }

  if (fixStage && fixRounds < recipe.maxFixCycles) {
    return { kind: "run_stage", stageId: fixStage.id };
  }

  // Out of fix budget (bounded loop) — surface the remaining issues, never loop.
  return { kind: "done", status: "completed_with_issues" };
};

/**
 * Given the recipe and everything that has happened so far, decide the next move.
 * Deterministic. Same inputs → same output, always.
 */
export const nextAction = (recipe: Recipe, run: Run): NextAction => {
  const classification = classify(recipe, run);
  if (classification.kind === "run_stage") {
    return { kind: "run_stage", stageId: classification.stageId };
  }
  return { kind: "done", result: converge(recipe, run) };
};

const readSummary = (result: unknown): string | null => {
  if (isRecord(result) && typeof result.summary === "string" && result.summary.length > 0) {
    return result.summary;
  }
  return null;
};

const readFilesTouched = (result: unknown): string[] => {
  if (!isRecord(result) || !Array.isArray(result.filesTouched)) {
    return [];
  }
  return result.filesTouched.filter((file): file is string => typeof file === "string");
};

/**
 * Issues from the most recent check round — what a fix stage must still address.
 * Deduped, in first-seen order. Shared so the conductor's fix prompt and the
 * gate read the same issues (no divergent copies).
 */
export const outstandingCheckIssues = (run: Run, checkStageId: StageId): IssueFinding[] =>
  collectRoundIssues(latestStageRound(run.outcomes, checkStageId));

/** Build the final RunResult from the outcome log. */
export const converge = (recipe: Recipe, run: Run): RunResult => {
  const classification = classify(recipe, run);
  const status: RunStatus = classification.kind === "done" ? classification.status : run.status;

  const buildStage = stageByRole(recipe, "build");
  const checkStage = stageByRole(recipe, "check");
  const fixStage = stageByRole(recipe, "fix");

  const buildOutcomes = buildStage ? outcomesForStage(run.outcomes, buildStage.id) : [];
  const fixOutcomes = fixStage ? outcomesForStage(run.outcomes, fixStage.id) : [];

  const lastFixOutcome = fixOutcomes.at(-1);
  const lastBuildOutcome = buildOutcomes.at(-1);
  const taskSummary =
    readSummary(lastFixOutcome?.result) ?? readSummary(lastBuildOutcome?.result) ?? run.task;

  const filesTouched = dedupeStrings(
    run.outcomes.flatMap((outcome) => readFilesTouched(outcome.result)),
  );

  const firstRoundIssues = checkStage
    ? collectRoundIssues(firstStageRound(run.outcomes, checkStage.id))
    : [];
  const latestRoundIssues = checkStage
    ? collectRoundIssues(latestStageRound(run.outcomes, checkStage.id))
    : [];

  const remainingKeys = new Set(latestRoundIssues.map(issueKey));
  const issuesFixed = firstRoundIssues.filter((issue) => !remainingKeys.has(issueKey(issue)));

  const result: RunResult = {
    status,
    taskSummary,
    filesTouched,
    issuesFound: firstRoundIssues,
    issuesFixed,
    issuesRemaining: latestRoundIssues,
  };
  if (run.workspaceBranch !== undefined) {
    result.workspaceBranch = run.workspaceBranch;
  }
  return result;
};

const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};
