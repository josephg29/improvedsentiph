/**
 * Pipeline domain model.
 *
 * Pure types only — no `fs`, no `child_process`, no transport details. A pipeline
 * is *data* (a {@link Recipe}); the deterministic conductor walks it and the
 * non-deterministic headless workers fill in the {@link WorkerOutcome}s. Routing
 * decisions are computed from these types by `application/pipelineRouting.ts`.
 */

export type StageRole = "build" | "check" | "fix";

export type StageId = string; // e.g. "build", "check", "fix"

export interface RecipeStage {
  id: StageId;
  role: StageRole;
  /** Appended to the worker via `--append-system-prompt`. The "what you are / what to report". */
  systemPrompt: string;
  model: "opus" | "sonnet" | "haiku";
  effort: "low" | "medium" | "high";
  /** How many copies run in parallel for this stage (checkers = 2). Default 1. */
  fanout?: number;
  /** Tools the worker may use. Builders/fixers: full. Checkers: read-only. */
  toolPolicy: "full" | "read-only";
  /** JSON Schema the worker MUST return. Validated before routing trusts it. */
  outputSchema: object;
}

export interface Recipe {
  id: string; // "standard"
  title: string;
  stages: RecipeStage[]; // build, check, fix
  maxFixCycles: number; // v1 = 1
}

export type RunStatus =
  | "pending"
  | "building"
  | "checking"
  | "fixing"
  | "passed"
  | "completed_with_issues"
  | "failed"
  | "cancelled";

export type IssueSeverity = "low" | "medium" | "high";

export interface IssueFinding {
  severity: IssueSeverity;
  location: string; // file:line or area
  problem: string;
  suggestion?: string;
}

export type CheckerVerdict =
  | { verdict: "pass"; issues: [] }
  | { verdict: "needs_fix"; issues: IssueFinding[] };

export interface WorkerOutcome {
  stageId: StageId;
  index: number; // which copy (for fanout)
  ok: boolean; // process exited 0 AND json parsed AND schema-valid
  result?: unknown; // schema-validated payload (BuilderResult | CheckerVerdict | FixerResult)
  error?: string; // set when ok === false
  startedAt: string;
  endedAt: string;
  costUsd?: number; // from the claude json envelope, if present
}

export interface Run {
  runId: string;
  recipeId: string;
  task: string; // the user's request
  status: RunStatus;
  workspaceBranch?: string; // sentiph/run-<id>, for the user to merge
  outcomes: WorkerOutcome[]; // append-only log of every worker result
  createdAt: string;
  updatedAt: string;
  result?: RunResult; // set on terminal status
}

export interface RunResult {
  status: RunStatus;
  taskSummary: string;
  filesTouched: string[];
  issuesFound: IssueFinding[];
  issuesFixed: IssueFinding[];
  issuesRemaining: IssueFinding[];
  workspaceBranch?: string;
}
