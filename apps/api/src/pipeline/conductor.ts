/**
 * The conductor — thin wiring that holds no decision logic itself.
 *
 * It asks the pure router (`nextAction`) what to do next, runs the chosen stage
 * as one or more headless workers, appends their outcomes, and persists/streams
 * after every step. Control flow lives in `packages/core`, not here. The worker
 * runner and clock are injected so the loop is exercised against scripted stage
 * results without spawning anything (spec §15).
 */

import {
  type IssueFinding,
  type PlanResult,
  type Recipe,
  type RecipeStage,
  type Run,
  type RunStatus,
  type WorkerOutcome,
  converge,
  nextAction,
  outstandingCheckIssues,
} from "@sentiph/core";

export type RunStageFn = (
  stage: RecipeStage,
  run: Run,
  signal: AbortSignal,
) => Promise<WorkerOutcome[]>;

export interface PipelineHooks {
  /** Persist + broadcast the latest run state after every transition. */
  onUpdate: (run: Run) => void;
  now: () => string;
  signal: AbortSignal;
  /** Block at a human-approval gate until the operator approves or rejects. */
  awaitApproval?: (stageId: string, run: Run) => Promise<"approved" | "rejected">;
}

export const statusForStage = (stage: RecipeStage): RunStatus => {
  switch (stage.role) {
    case "plan":
      return "planning";
    case "build":
      return "building";
    case "integrate":
      return "integrating";
    case "fix":
      return "fixing";
    default:
      return "checking";
  }
};

/**
 * Issues from the most recent check round — what a fix must address. Delegates
 * to the core router so the prompt and the gate read issues identically.
 */
export const collectOutstandingIssues = (run: Run, checkStageId: string): IssueFinding[] =>
  outstandingCheckIssues(run, checkStageId);

const formatIssues = (issues: IssueFinding[]): string =>
  issues
    .map((issue) => {
      const head = `- [${issue.severity}] ${issue.location}: ${issue.problem}`;
      return issue.suggestion ? `${head} (suggestion: ${issue.suggestion})` : head;
    })
    .join("\n");

/** Build the worker prompt for a stage. Pure. `index` selects the subtask for parallel builders. */
export const renderStagePrompt = (
  recipe: Recipe,
  stage: RecipeStage,
  run: Run,
  index = 0,
): string => {
  if (stage.role === "plan") {
    return run.task;
  }
  if (stage.role === "build") {
    const planStage = recipe.stages.find((s) => s.role === "plan");
    if (planStage) {
      const planOutcome = run.outcomes.find((o) => o.stageId === planStage.id && o.ok);
      const plan = planOutcome?.result as PlanResult | undefined;
      const subtask = plan?.subtasks?.[index];
      if (plan && subtask) {
        return (
          `Full task: ${run.task}\n\n` +
          `Overall plan: ${plan.summary}\n\n` +
          `Your assigned subtask (index ${index}):\n` +
          `Description: ${subtask.description}\n` +
          `File domain (work ONLY within this domain): ${subtask.fileDomain}\n\n` +
          `Implement ONLY your assigned subtask. Do not modify files outside your file domain.`
        );
      }
    }
    return run.task;
  }
  if (stage.role === "integrate") {
    const buildStage = recipe.stages.find((s) => s.role === "build");
    const builderSummaries = buildStage
      ? run.outcomes
          .filter((o) => o.stageId === buildStage.id && o.ok)
          .map((o, i) => {
            const r = o.result as { filesTouched?: string[]; summary?: string } | undefined;
            return `Builder ${i}: touched ${r?.filesTouched?.join(", ") ?? "unknown"} — ${r?.summary ?? ""}`;
          })
          .join("\n")
      : "(no builder summaries available)";
    return (
      `Original task: ${run.task}\n\n` +
      `Builder outputs to integrate:\n${builderSummaries}\n\n` +
      `Resolve any conflicts, wire the pieces together, and ensure the full implementation is coherent.`
    );
  }
  if (stage.role === "check") {
    return `Inspect the change made for the following task and return your verdict.\n\nTask:\n${run.task}`;
  }
  const checkStage = recipe.stages.find((candidate) => candidate.role === "check");
  const issues = checkStage ? collectOutstandingIssues(run, checkStage.id) : [];
  const issueText = issues.length > 0 ? formatIssues(issues) : "(no specific issues were recorded)";
  return `Resolve the issues found while reviewing the following task.\n\nTask:\n${run.task}\n\nIssues to fix:\n${issueText}`;
};

/**
 * Drive a run to a terminal status. Deterministic given the same `runStage`
 * results — the router decides every branch; the conductor only executes.
 */
export const runPipeline = async (
  recipe: Recipe,
  initialRun: Run,
  runStage: RunStageFn,
  hooks: PipelineHooks,
): Promise<Run> => {
  let run = initialRun;

  const update = (next: Run) => {
    run = next;
    hooks.onUpdate(run);
  };

  const finishCancelled = (): Run => {
    const base = converge(recipe, run);
    update({
      ...run,
      status: "cancelled",
      failureReason: "cancelled",
      result: { ...base, status: "cancelled" },
      updatedAt: hooks.now(),
    });
    return run;
  };

  if (hooks.signal.aborted) {
    return finishCancelled();
  }

  while (true) {
    const action = nextAction(recipe, run);
    if (action.kind === "done") {
      const failingOutcome = run.outcomes.find((outcome) => !outcome.ok);
      update({
        ...run,
        status: action.result.status,
        result: action.result,
        updatedAt: hooks.now(),
        ...(action.result.status === "failed" && failingOutcome?.error
          ? { failureReason: failingOutcome.error }
          : {}),
      });
      return run;
    }

    if (action.kind === "await_approval") {
      update({ ...run, status: "awaiting_approval", updatedAt: hooks.now() });
      const decision = hooks.awaitApproval
        ? await hooks.awaitApproval(action.stageId, run)
        : "rejected";
      if (hooks.signal.aborted) {
        return finishCancelled();
      }
      const approvalOutcome: WorkerOutcome = {
        stageId: action.stageId,
        index: 0,
        ok: decision === "approved",
        startedAt: hooks.now(),
        endedAt: hooks.now(),
        ...(decision === "rejected" ? { error: "rejected by operator" } : {}),
      };
      update({ ...run, outcomes: [...run.outcomes, approvalOutcome], updatedAt: hooks.now() });
      continue;
    }

    const stage = recipe.stages.find((candidate) => candidate.id === action.stageId);
    if (!stage) {
      // Defensive: the router only ever returns recipe stage ids.
      throw new Error(`Router requested unknown stage "${action.stageId}".`);
    }

    update({ ...run, status: statusForStage(stage), updatedAt: hooks.now() });

    const outcomes = await runStage(stage, run, hooks.signal);

    if (hooks.signal.aborted) {
      run = { ...run, outcomes: [...run.outcomes, ...outcomes] };
      return finishCancelled();
    }

    if (outcomes.length === 0) {
      // A stage that produces no outcomes would never advance the router — fail
      // rather than spin (guards fanout:0 or a misbehaving stage runner).
      const base = converge(recipe, run);
      update({
        ...run,
        status: "failed",
        failureReason: `stage_produced_no_outcomes: ${stage.id}`,
        result: { ...base, status: "failed" },
        updatedAt: hooks.now(),
      });
      return run;
    }

    update({ ...run, outcomes: [...run.outcomes, ...outcomes], updatedAt: hooks.now() });
  }
};
