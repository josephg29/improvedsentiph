import { describe, expect, it } from "vitest";

import { checkersPassed, converge, nextAction } from "../src/application/pipelineRouting";
import type { IssueFinding, Recipe, Run, WorkerOutcome } from "../src/domain/pipeline";

const STANDARD: Recipe = {
  id: "standard",
  title: "Standard",
  maxFixCycles: 1,
  stages: [
    {
      id: "build",
      role: "build",
      systemPrompt: "build",
      model: "sonnet",
      effort: "medium",
      toolPolicy: "full",
      outputSchema: {},
    },
    {
      id: "check",
      role: "check",
      systemPrompt: "check",
      model: "sonnet",
      effort: "medium",
      fanout: 2,
      toolPolicy: "read-only",
      outputSchema: {},
    },
    {
      id: "fix",
      role: "fix",
      systemPrompt: "fix",
      model: "sonnet",
      effort: "medium",
      toolPolicy: "full",
      outputSchema: {},
    },
  ],
};

const outcome = (
  stageId: string,
  index: number,
  ok: boolean,
  result: unknown,
  extra: Partial<WorkerOutcome> = {},
): WorkerOutcome => ({
  stageId,
  index,
  ok,
  result,
  startedAt: "2026-05-29T00:00:00.000Z",
  endedAt: "2026-05-29T00:00:01.000Z",
  ...extra,
});

const buildOk = (summary = "built it", filesTouched: string[] = ["a.ts"]) =>
  outcome("build", 0, true, { summary, filesTouched, done: true });
const buildFail = () => outcome("build", 0, false, undefined, { error: "boom" });

const checkPass = (index: number, issues: IssueFinding[] = []) =>
  outcome("check", index, true, { verdict: "pass", issues });
const checkNeedsFix = (index: number, issues: IssueFinding[]) =>
  outcome("check", index, true, { verdict: "needs_fix", issues });
const checkFailed = (index: number) =>
  outcome("check", index, false, undefined, { error: "checker crashed" });

const fixOk = (summary = "fixed it") =>
  outcome("fix", 0, true, { summary, resolved: ["A"], unresolved: [], done: true });
const fixFail = () => outcome("fix", 0, false, undefined, { error: "fixer crashed" });

const HIGH: IssueFinding = { severity: "high", location: "a.ts:1", problem: "A" };
const LOW: IssueFinding = { severity: "low", location: "a.ts:2", problem: "nit" };

const makeRun = (outcomes: WorkerOutcome[], overrides: Partial<Run> = {}): Run => ({
  runId: "run-1",
  recipeId: "standard",
  task: "do the thing",
  status: "building",
  outcomes,
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
  ...overrides,
});

describe("nextAction trajectories", () => {
  it("runs build first when nothing has happened", () => {
    expect(nextAction(STANDARD, makeRun([]))).toEqual({ kind: "run_stage", stageId: "build" });
  });

  it("fails the run when the builder fails", () => {
    const action = nextAction(STANDARD, makeRun([buildFail()]));
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("failed");
    }
  });

  it("runs the check stage after a clean build", () => {
    expect(nextAction(STANDARD, makeRun([buildOk()]))).toEqual({
      kind: "run_stage",
      stageId: "check",
    });
  });

  it("passes when every checker passes on the first try", () => {
    const run = makeRun([buildOk(), checkPass(0), checkPass(1)]);
    const action = nextAction(STANDARD, run);
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("passed");
    }
  });

  it("routes to fix when any single checker needs a fix", () => {
    const run = makeRun([buildOk(), checkNeedsFix(0, [HIGH]), checkPass(1)]);
    expect(nextAction(STANDARD, run)).toEqual({ kind: "run_stage", stageId: "fix" });
  });

  it("routes to fix when a checker reports pass but flags a high-severity issue", () => {
    const run = makeRun([buildOk(), checkPass(0, [HIGH]), checkPass(1, [HIGH])]);
    expect(nextAction(STANDARD, run)).toEqual({ kind: "run_stage", stageId: "fix" });
  });

  it("treats a failed checker as needs-fix", () => {
    const run = makeRun([buildOk(), checkFailed(0), checkPass(1)]);
    expect(nextAction(STANDARD, run)).toEqual({ kind: "run_stage", stageId: "fix" });
  });

  it("re-checks after a successful fix", () => {
    const run = makeRun([buildOk(), checkNeedsFix(0, [HIGH]), checkNeedsFix(1, [HIGH]), fixOk()]);
    expect(nextAction(STANDARD, run)).toEqual({ kind: "run_stage", stageId: "check" });
  });

  it("fails the run when the fixer fails", () => {
    const run = makeRun([buildOk(), checkNeedsFix(0, [HIGH]), checkNeedsFix(1, [HIGH]), fixFail()]);
    const action = nextAction(STANDARD, run);
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("failed");
    }
  });

  it("passes when the re-check passes after a fix", () => {
    const run = makeRun([
      buildOk(),
      checkNeedsFix(0, [HIGH]),
      checkNeedsFix(1, [HIGH]),
      fixOk(),
      checkPass(0),
      checkPass(1),
    ]);
    const action = nextAction(STANDARD, run);
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("passed");
    }
  });

  it("terminates the bounded fix loop as completed_with_issues when the re-check still fails", () => {
    const run = makeRun([
      buildOk(),
      checkNeedsFix(0, [HIGH]),
      checkNeedsFix(1, [HIGH]),
      fixOk(),
      checkNeedsFix(0, [HIGH]),
      checkNeedsFix(1, [HIGH]),
    ]);
    const action = nextAction(STANDARD, run);
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("completed_with_issues");
    }
  });
});

describe("checkersPassed gate", () => {
  it("is false with no check outcomes", () => {
    expect(checkersPassed([], "check")).toBe(false);
  });

  it("is true when the latest round is all clean passes", () => {
    expect(checkersPassed([checkPass(0), checkPass(1)], "check")).toBe(true);
  });

  it("is false when a checker needs a fix", () => {
    expect(checkersPassed([checkPass(0), checkNeedsFix(1, [HIGH])], "check")).toBe(false);
  });

  it("is false when a passing checker still flags a high-severity issue", () => {
    expect(checkersPassed([checkPass(0), checkPass(1, [HIGH])], "check")).toBe(false);
  });

  it("is true when passing checkers only flag low-severity issues", () => {
    expect(checkersPassed([checkPass(0, [LOW]), checkPass(1, [LOW])], "check")).toBe(true);
  });

  it("is false when a checker process failed", () => {
    expect(checkersPassed([checkFailed(0), checkPass(1)], "check")).toBe(false);
  });

  it("evaluates only the latest round, ignoring an earlier failing round", () => {
    const outcomes = [
      checkNeedsFix(0, [HIGH]),
      checkNeedsFix(1, [HIGH]),
      fixOk(),
      checkPass(0),
      checkPass(1),
    ];
    expect(checkersPassed(outcomes, "check")).toBe(true);
  });
});

describe("converge", () => {
  it("summarizes a pass-first-try run", () => {
    const run = makeRun([buildOk("did the work", ["a.ts", "b.ts"]), checkPass(0), checkPass(1)]);
    const result = converge(STANDARD, run);
    expect(result.status).toBe("passed");
    expect(result.taskSummary).toBe("did the work");
    expect(result.filesTouched).toEqual(["a.ts", "b.ts"]);
    expect(result.issuesFound).toEqual([]);
    expect(result.issuesFixed).toEqual([]);
    expect(result.issuesRemaining).toEqual([]);
  });

  it("keeps below-threshold issues visible on a pass-first-try run", () => {
    const run = makeRun([buildOk(), checkPass(0, [LOW]), checkPass(1, [LOW])]);
    const result = converge(STANDARD, run);
    expect(result.status).toBe("passed");
    expect(result.issuesFound).toEqual([LOW]);
    expect(result.issuesFixed).toEqual([]);
    expect(result.issuesRemaining).toEqual([LOW]);
  });

  it("reports fixed issues on a fix-then-pass run and prefers the fixer summary", () => {
    const run = makeRun([
      buildOk(),
      checkNeedsFix(0, [HIGH]),
      checkNeedsFix(1, [HIGH]),
      fixOk("resolved the high issue"),
      checkPass(0),
      checkPass(1),
    ]);
    const result = converge(STANDARD, run);
    expect(result.status).toBe("passed");
    expect(result.taskSummary).toBe("resolved the high issue");
    expect(result.issuesFound).toEqual([HIGH]);
    expect(result.issuesFixed).toEqual([HIGH]);
    expect(result.issuesRemaining).toEqual([]);
  });

  it("separates fixed from remaining when a new issue appears after the fix", () => {
    const NEW: IssueFinding = { severity: "high", location: "c.ts:9", problem: "B" };
    const run = makeRun([
      buildOk(),
      checkNeedsFix(0, [HIGH]),
      checkNeedsFix(1, [HIGH]),
      fixOk(),
      checkNeedsFix(0, [NEW]),
      checkNeedsFix(1, [NEW]),
    ]);
    const result = converge(STANDARD, run);
    expect(result.status).toBe("completed_with_issues");
    expect(result.issuesFound).toEqual([HIGH]);
    expect(result.issuesFixed).toEqual([HIGH]);
    expect(result.issuesRemaining).toEqual([NEW]);
  });

  it("falls back to the task text and empty issues when the builder fails", () => {
    const run = makeRun([buildFail()], { task: "ship the feature" });
    const result = converge(STANDARD, run);
    expect(result.status).toBe("failed");
    expect(result.taskSummary).toBe("ship the feature");
    expect(result.filesTouched).toEqual([]);
    expect(result.issuesFound).toEqual([]);
    expect(result.issuesRemaining).toEqual([]);
  });

  it("passes through the workspace branch", () => {
    const run = makeRun([buildOk(), checkPass(0), checkPass(1)], {
      workspaceBranch: "sentiph/run-1",
    });
    expect(converge(STANDARD, run).workspaceBranch).toBe("sentiph/run-1");
  });
});

const CAREFUL: Recipe = {
  id: "careful",
  title: "Careful",
  maxFixCycles: 1,
  stages: [
    STANDARD.stages[0] as Recipe["stages"][number], // build
    STANDARD.stages[1] as Recipe["stages"][number], // check (fanout 2)
    STANDARD.stages[2] as Recipe["stages"][number], // fix
    {
      id: "approval",
      role: "approval",
      systemPrompt: "approve",
      model: "sonnet",
      effort: "medium",
      toolPolicy: "read-only",
      outputSchema: {},
    },
  ],
};

const approval = (ok: boolean) => outcome("approval", 0, ok, { approved: ok });

describe("human approval gate", () => {
  it("awaits approval once the work is verified", () => {
    const run = makeRun([buildOk(), checkPass(0), checkPass(1)]);
    expect(nextAction(CAREFUL, run)).toEqual({ kind: "await_approval", stageId: "approval" });
  });

  it("passes after approval", () => {
    const run = makeRun([buildOk(), checkPass(0), checkPass(1), approval(true)]);
    const action = nextAction(CAREFUL, run);
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("passed");
    }
  });

  it("completes with issues when rejected", () => {
    const run = makeRun([buildOk(), checkPass(0), checkPass(1), approval(false)]);
    const action = nextAction(CAREFUL, run);
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("completed_with_issues");
    }
  });

  it("does not reach the gate while the work still needs a fix", () => {
    const run = makeRun([buildOk(), checkNeedsFix(0, [HIGH]), checkNeedsFix(1, [HIGH])]);
    expect(nextAction(CAREFUL, run)).toEqual({ kind: "run_stage", stageId: "fix" });
  });

  it("gates again after a fix re-verifies", () => {
    const run = makeRun([
      buildOk(),
      checkNeedsFix(0, [HIGH]),
      checkNeedsFix(1, [HIGH]),
      fixOk(),
      checkPass(0),
      checkPass(1),
    ]);
    expect(nextAction(CAREFUL, run)).toEqual({ kind: "await_approval", stageId: "approval" });
  });
});

const QUICK: Recipe = {
  id: "quick",
  title: "Quick",
  maxFixCycles: 0,
  stages: [
    STANDARD.stages[0] as Recipe["stages"][number], // build
    STANDARD.stages[1] as Recipe["stages"][number], // check
  ],
};

describe("recipe without a fix stage (quick)", () => {
  it("runs build then check", () => {
    expect(nextAction(QUICK, makeRun([]))).toEqual({ kind: "run_stage", stageId: "build" });
    expect(nextAction(QUICK, makeRun([buildOk()]))).toEqual({
      kind: "run_stage",
      stageId: "check",
    });
  });

  it("passes when the check passes", () => {
    const action = nextAction(QUICK, makeRun([buildOk(), checkPass(0), checkPass(1)]));
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("passed");
    }
  });

  it("completes with issues when there is no fix budget", () => {
    const action = nextAction(
      QUICK,
      makeRun([buildOk(), checkNeedsFix(0, [HIGH]), checkNeedsFix(1, [HIGH])]),
    );
    expect(action.kind).toBe("done");
    if (action.kind === "done") {
      expect(action.result.status).toBe("completed_with_issues");
    }
  });
});
