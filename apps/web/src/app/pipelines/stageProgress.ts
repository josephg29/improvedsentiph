import { type Run, checkersPassed } from "@sentiph/core";

/**
 * Per-stage progress for rendering a recipe's stages as nodes. Pure and derived
 * from the run's status + append-only outcome log, so the UI stays in lock-step
 * with the server's own gate (it reuses core's `checkersPassed`). The stage
 * sequence follows the run's recipe — quick omits the fix stage; careful adds the
 * human approval gate.
 */

export type StageRole = "build" | "check" | "fix" | "approval" | "plan" | "integrate";
export type StageState = "pending" | "active" | "done" | "failed" | "issues";

export interface StageProgress {
  role: StageRole;
  label: string;
  state: StageState;
}

const STANDARD_ROLES: StageRole[] = ["build", "check", "fix"];

const RECIPE_STAGES: Record<string, StageRole[]> = {
  standard: STANDARD_ROLES,
  quick: ["build", "check"],
  careful: ["build", "check", "fix", "approval"],
  large: ["plan", "build", "integrate", "check", "fix"],
};

const outcomesFor = (run: Run, stageId: string) =>
  run.outcomes.filter((outcome) => outcome.stageId === stageId);

const planState = (run: Run): StageState => {
  if (run.status === "planning") {
    return "active";
  }
  const outcomes = outcomesFor(run, "plan");
  if (outcomes.length === 0) {
    return "pending";
  }
  return outcomes.some((outcome) => !outcome.ok) ? "failed" : "done";
};

const integrateState = (run: Run): StageState => {
  if (run.status === "integrating") {
    return "active";
  }
  const outcomes = outcomesFor(run, "integrate");
  if (outcomes.length === 0) {
    return "pending";
  }
  return outcomes.some((outcome) => !outcome.ok) ? "failed" : "done";
};

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

const approvalState = (run: Run): StageState => {
  if (run.status === "awaiting_approval") {
    return "active";
  }
  const outcomes = outcomesFor(run, "approval");
  if (outcomes.length === 0) {
    return "pending";
  }
  return outcomes.some((outcome) => !outcome.ok) ? "failed" : "done";
};

const labelFor = (role: StageRole): string => {
  switch (role) {
    case "plan":
      return "Plan";
    case "build":
      return "Build";
    case "integrate":
      return "Integrate";
    case "check":
      return "Check";
    case "fix":
      return "Fix";
    case "approval":
      return "Approve";
  }
};

const stateFor = (role: StageRole, run: Run): StageState => {
  switch (role) {
    case "plan":
      return planState(run);
    case "build":
      return buildState(run);
    case "integrate":
      return integrateState(run);
    case "check":
      return checkState(run);
    case "fix":
      return fixState(run);
    case "approval":
      return approvalState(run);
  }
};

export const stageProgress = (run: Run): StageProgress[] => {
  const roles = RECIPE_STAGES[run.recipeId] ?? STANDARD_ROLES;
  return roles.map((role) => ({ role, label: labelFor(role), state: stateFor(role, run) }));
};
