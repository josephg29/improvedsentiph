import type { IssueFinding, Run, WorkerOutcome } from "@sentiph/core";
import { describe, expect, it } from "vitest";

import {
  type RunStageFn,
  collectOutstandingIssues,
  renderStagePrompt,
  runPipeline,
  statusForStage,
} from "../src/pipeline/conductor";
import { CAREFUL_RECIPE, LARGE_RECIPE, STANDARD_RECIPE } from "../src/pipeline/recipes";

const HIGH: IssueFinding = { severity: "high", location: "a.ts:1", problem: "null deref" };

const outcome = (stageId: string, index: number, ok: boolean, result: unknown): WorkerOutcome => ({
  stageId,
  index,
  ok,
  result,
  startedAt: "t",
  endedAt: "t",
});

const buildOk = () => [
  outcome("build", 0, true, { summary: "b", filesTouched: ["a.ts"], done: true }),
];
const buildFail = () => [outcome("build", 0, false, undefined)];
const checkPass = () => [
  outcome("check", 0, true, { verdict: "pass", issues: [] }),
  outcome("check", 1, true, { verdict: "pass", issues: [] }),
];
const checkNeedsFix = () => [
  outcome("check", 0, true, { verdict: "needs_fix", issues: [HIGH] }),
  outcome("check", 1, true, { verdict: "needs_fix", issues: [HIGH] }),
];
const fixOk = () => [
  outcome("fix", 0, true, { summary: "f", resolved: ["null deref"], done: true }),
];

const baseRun = (overrides: Partial<Run> = {}): Run => ({
  runId: "run-1",
  recipeId: "standard",
  task: "add a feature",
  status: "pending",
  outcomes: [],
  createdAt: "t0",
  updatedAt: "t0",
  ...overrides,
});

interface ScriptedQueues {
  build?: WorkerOutcome[][];
  check?: WorkerOutcome[][];
  fix?: WorkerOutcome[][];
}

const scriptedRunner = (
  queues: ScriptedQueues,
  onCall?: (stageRole: string) => void,
): { fn: RunStageFn; order: string[] } => {
  const cursor: Record<string, number> = { build: 0, check: 0, fix: 0 };
  const order: string[] = [];
  const fn: RunStageFn = async (stage) => {
    order.push(stage.id);
    onCall?.(stage.role);
    const role = stage.role as "build" | "check" | "fix";
    const queue = queues[role] ?? [];
    const outcomes = queue[cursor[role] ?? 0] ?? [];
    cursor[role] = (cursor[role] ?? 0) + 1;
    return outcomes;
  };
  return { fn, order };
};

const hooks = (signal: AbortSignal, updates: Run[]) => ({
  onUpdate: (run: Run) => updates.push(run),
  now: () => "t1",
  signal,
});

const stageByRole = (role: "build" | "check" | "fix") => {
  const found = STANDARD_RECIPE.stages.find((stage) => stage.role === role);
  if (!found) {
    throw new Error(`missing ${role} stage`);
  }
  return found;
};

describe("statusForStage", () => {
  it("maps roles to in-progress statuses", () => {
    expect(STANDARD_RECIPE.stages.map(statusForStage)).toEqual(["building", "checking", "fixing"]);
  });

  it("maps plan and integrate roles for the large recipe", () => {
    expect(LARGE_RECIPE.stages.map(statusForStage)).toEqual([
      "planning",
      "building",
      "integrating",
      "checking",
      "fixing",
    ]);
  });
});

describe("runPipeline trajectories", () => {
  it("passes on the first try (build → check)", async () => {
    const updates: Run[] = [];
    const { fn, order } = scriptedRunner({ build: [buildOk()], check: [checkPass()] });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(new AbortController().signal, updates),
    );
    expect(order).toEqual(["build", "check"]);
    expect(final.status).toBe("passed");
    expect(final.result?.status).toBe("passed");
    expect(updates.map((run) => run.status)).toContain("building");
    expect(updates.map((run) => run.status)).toContain("checking");
  });

  it("fixes then passes (build → check → fix → check)", async () => {
    const updates: Run[] = [];
    const { fn, order } = scriptedRunner({
      build: [buildOk()],
      check: [checkNeedsFix(), checkPass()],
      fix: [fixOk()],
    });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(new AbortController().signal, updates),
    );
    expect(order).toEqual(["build", "check", "fix", "check"]);
    expect(final.status).toBe("passed");
    expect(final.result?.issuesFixed).toEqual([HIGH]);
  });

  it("completes with issues when the bounded fix loop is exhausted", async () => {
    const updates: Run[] = [];
    const { fn, order } = scriptedRunner({
      build: [buildOk()],
      check: [checkNeedsFix(), checkNeedsFix()],
      fix: [fixOk()],
    });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(new AbortController().signal, updates),
    );
    expect(order).toEqual(["build", "check", "fix", "check"]);
    expect(final.status).toBe("completed_with_issues");
    expect(final.result?.issuesRemaining).toEqual([HIGH]);
  });

  it("fails the run when the builder fails", async () => {
    const updates: Run[] = [];
    const { fn } = scriptedRunner({ build: [buildFail()] });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(new AbortController().signal, updates),
    );
    expect(final.status).toBe("failed");
  });

  it("records the failing worker's error as the run failureReason", async () => {
    const failWithError: WorkerOutcome = {
      stageId: "build",
      index: 0,
      ok: false,
      error: "build exploded",
      startedAt: "t",
      endedAt: "t",
    };
    const { fn } = scriptedRunner({ build: [[failWithError]] });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(new AbortController().signal, []),
    );
    expect(final.status).toBe("failed");
    expect(final.failureReason).toBe("build exploded");
  });

  it("fails fast when a stage produces no outcomes (guards an infinite loop)", async () => {
    const { fn } = scriptedRunner({ build: [[]] });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(new AbortController().signal, []),
    );
    expect(final.status).toBe("failed");
    expect(final.failureReason).toContain("stage_produced_no_outcomes");
  });

  it("cancels immediately when the signal is already aborted", async () => {
    const updates: Run[] = [];
    const { fn, order } = scriptedRunner({ build: [buildOk()] });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(AbortSignal.abort(), updates),
    );
    expect(order).toEqual([]);
    expect(final.status).toBe("cancelled");
  });

  it("cancels mid-run when the signal aborts between stages", async () => {
    const updates: Run[] = [];
    const controller = new AbortController();
    const { fn, order } = scriptedRunner({ build: [buildOk()], check: [checkPass()] }, (role) => {
      if (role === "build") {
        controller.abort();
      }
    });
    const final = await runPipeline(
      STANDARD_RECIPE,
      baseRun(),
      fn,
      hooks(controller.signal, updates),
    );
    expect(order).toEqual(["build"]);
    expect(final.status).toBe("cancelled");
  });
});

const largeStageByRole = (role: "plan" | "build" | "integrate" | "check" | "fix") => {
  const found = LARGE_RECIPE.stages.find((stage) => stage.role === role);
  if (!found) {
    throw new Error(`missing ${role} stage`);
  }
  return found;
};

const planOutcome = (subtasks: Array<{ index: number; description: string; fileDomain: string }>) =>
  outcome("plan", 0, true, { summary: "Decomposed into 3 subtasks", subtasks });

const SUBTASKS = [
  { index: 0, description: "Build game loop", fileDomain: "src/game/loop/**" },
  { index: 1, description: "Build rendering", fileDomain: "src/game/render/**" },
  { index: 2, description: "Build input", fileDomain: "src/game/input/**" },
];

describe("renderStagePrompt", () => {
  it("uses the task verbatim for the builder", () => {
    expect(renderStagePrompt(STANDARD_RECIPE, stageByRole("build"), baseRun())).toBe(
      "add a feature",
    );
  });

  it("asks the checker to inspect the task", () => {
    const prompt = renderStagePrompt(STANDARD_RECIPE, stageByRole("check"), baseRun());
    expect(prompt).toContain("Inspect");
    expect(prompt).toContain("add a feature");
  });

  it("feeds the outstanding issues into the fix prompt", () => {
    const run = baseRun({ outcomes: [...buildOk(), ...checkNeedsFix()] });
    const prompt = renderStagePrompt(STANDARD_RECIPE, stageByRole("fix"), run);
    expect(prompt).toContain("a.ts:1");
    expect(prompt).toContain("null deref");
  });

  it("uses the task verbatim for the planner", () => {
    const run = baseRun({ recipeId: "large" });
    expect(renderStagePrompt(LARGE_RECIPE, largeStageByRole("plan"), run)).toBe("add a feature");
  });

  it("injects the assigned subtask into the large builder prompt by index", () => {
    const run = baseRun({ recipeId: "large", outcomes: [planOutcome(SUBTASKS)] });
    const prompt0 = renderStagePrompt(LARGE_RECIPE, largeStageByRole("build"), run, 0);
    const prompt1 = renderStagePrompt(LARGE_RECIPE, largeStageByRole("build"), run, 1);
    expect(prompt0).toContain("index 0");
    expect(prompt0).toContain("Build game loop");
    expect(prompt0).toContain("src/game/loop/**");
    expect(prompt1).toContain("index 1");
    expect(prompt1).toContain("Build rendering");
    expect(prompt1).not.toContain("Build game loop");
  });

  it("falls back to the task when the plan result is missing", () => {
    const run = baseRun({ recipeId: "large" });
    const prompt = renderStagePrompt(LARGE_RECIPE, largeStageByRole("build"), run, 0);
    expect(prompt).toBe("add a feature");
  });

  it("includes builder summaries in the integrator prompt", () => {
    const buildOutcomes = [
      outcome("build", 0, true, { summary: "built loop", filesTouched: ["src/game/loop/index.ts"], done: true }),
      outcome("build", 1, true, { summary: "built render", filesTouched: ["src/game/render/index.ts"], done: true }),
      outcome("build", 2, true, { summary: "built input", filesTouched: ["src/game/input/index.ts"], done: true }),
    ];
    const run = baseRun({ recipeId: "large", outcomes: [planOutcome(SUBTASKS), ...buildOutcomes] });
    const prompt = renderStagePrompt(LARGE_RECIPE, largeStageByRole("integrate"), run);
    expect(prompt).toContain("add a feature");
    expect(prompt).toContain("built loop");
    expect(prompt).toContain("built render");
  });
});

describe("runPipeline human approval gate", () => {
  it("parks at the gate then passes on approval", async () => {
    const updates: Run[] = [];
    const { fn, order } = scriptedRunner({ build: [buildOk()], check: [checkPass()] });
    const final = await runPipeline(CAREFUL_RECIPE, baseRun({ recipeId: "careful" }), fn, {
      onUpdate: (run) => updates.push(run),
      now: () => "t1",
      signal: new AbortController().signal,
      awaitApproval: async () => "approved",
    });
    expect(order).toEqual(["build", "check"]); // the gate is not a worker stage
    expect(updates.some((run) => run.status === "awaiting_approval")).toBe(true);
    expect(final.status).toBe("passed");
  });

  it("completes with issues when the operator rejects", async () => {
    const { fn } = scriptedRunner({ build: [buildOk()], check: [checkPass()] });
    const final = await runPipeline(CAREFUL_RECIPE, baseRun({ recipeId: "careful" }), fn, {
      onUpdate: () => {},
      now: () => "t1",
      signal: new AbortController().signal,
      awaitApproval: async () => "rejected",
    });
    expect(final.status).toBe("completed_with_issues");
  });
});

describe("collectOutstandingIssues", () => {
  it("returns only the latest check round's issues", () => {
    const run = baseRun({
      outcomes: [
        ...buildOk(),
        ...checkNeedsFix(),
        ...fixOk(),
        outcome("check", 0, true, {
          verdict: "needs_fix",
          issues: [{ severity: "medium", location: "b.ts:2", problem: "x" }],
        }),
        outcome("check", 1, true, { verdict: "pass", issues: [] }),
      ],
    });
    const issues = collectOutstandingIssues(run, "check");
    expect(issues).toEqual([{ severity: "medium", location: "b.ts:2", problem: "x" }]);
  });
});
