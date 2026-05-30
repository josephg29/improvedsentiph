import { type Run, checkersPassed } from "@sentiph/core";

/**
 * Per-stage progress for rendering the build → check → fix flow as nodes.
 * Pure and derived from the run's status + append-only outcome log, so the UI
 * stays in lock-step with the server's own gate (it reuses core's
 * `checkersPassed`). v1 renders the single "standard" recipe's three stages.
 */

export type StageState = "pending" | "active" | "done" | "failed" | "issues";

export interface StageProgress {
  role: "build" | "check" | "fix";
  label: string;
  state: StageState;
}

const outcomesFor = (run: Run, stageId: string) =>
  run.outcomes.filter((outcome) => outcome.stageId === stageId);

const buildState = (run: Run): StageState => {
  if (run.status === "building") {
    return "active";
  }
  const outcomes = outcomesFor(run, "build");
  if (outcomes.length === 0) {
    return run.status === "pending" ? "pending" : "done";
  }
  return outcomes.some((outcome) => !outcome.ok) ? "failed" : "done";
};

const checkState = (run: Run): StageState => {
  if (run.status === "checking") {
    return "active";
  }
  if (outcomesFor(run, "check").length === 0) {
    return "pending";
  }
  return checkersPassed(run.outcomes, "check") ? "done" : "issues";
};

const fixState = (run: Run): StageState => {
  if (run.status === "fixing") {
    return "active";
  }
  const outcomes = outcomesFor(run, "fix");
  if (outcomes.length === 0) {
    return "pending";
  }
  return outcomes.some((outcome) => !outcome.ok) ? "failed" : "done";
};

export const stageProgress = (run: Run): StageProgress[] => [
  { role: "build", label: "Build", state: buildState(run) },
  { role: "check", label: "Check", state: checkState(run) },
  { role: "fix", label: "Fix", state: fixState(run) },
];
