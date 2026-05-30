import type { IssueFinding, Run, WorkerOutcome } from "@sentiph/core";
import { describe, expect, it } from "vitest";

import {
  type RunStageFn,
  collectOutstandingIssues,
  renderStagePrompt,
  runPipeline,
  statusForStage,
} from "../src/pipeline/conductor";
import { STANDARD_RECIPE } from "../src/pipeline/recipes";

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
    const queue = queues[stage.role] ?? [];
    const outcomes = queue[cursor[stage.role] ?? 0] ?? [];
    cursor[stage.role] = (cursor[stage.role] ?? 0) + 1;
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
