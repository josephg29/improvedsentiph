import type { Run, WorkerOutcome } from "@sentiph/core";
import { describe, expect, it } from "vitest";

import { stageProgress } from "../src/app/pipelines/stageProgress";

const outcome = (stageId: string, index: number, ok: boolean, result: unknown): WorkerOutcome => ({
  stageId,
  index,
  ok,
  result,
  startedAt: "t",
  endedAt: "t",
});

const run = (overrides: Partial<Run>): Run => ({
  runId: "run-1",
  recipeId: "standard",
  task: "x",
  status: "pending",
  outcomes: [],
  createdAt: "t",
  updatedAt: "t",
  ...overrides,
});

const stateByRole = (r: Run) =>
  Object.fromEntries(stageProgress(r).map((stage) => [stage.role, stage.state]));

describe("stageProgress", () => {
  it("marks the active stage from the run status", () => {
    expect(stateByRole(run({ status: "building" })).build).toBe("active");
    expect(stateByRole(run({ status: "checking" })).check).toBe("active");
    expect(stateByRole(run({ status: "fixing" })).fix).toBe("active");
  });

  it("shows a clean build → check pass as done", () => {
    const r = run({
      status: "passed",
      outcomes: [
        outcome("build", 0, true, { summary: "b", filesTouched: [], done: true }),
        outcome("check", 0, true, { verdict: "pass", issues: [] }),
        outcome("check", 1, true, { verdict: "pass", issues: [] }),
      ],
    });
    const states = stateByRole(r);
    expect(states.build).toBe("done");
    expect(states.check).toBe("done");
    expect(states.fix).toBe("pending");
  });

  it("flags the check stage as issues when the latest round failed the gate", () => {
    const r = run({
      status: "fixing",
      outcomes: [
        outcome("build", 0, true, { summary: "b", filesTouched: [], done: true }),
        outcome("check", 0, true, {
          verdict: "needs_fix",
          issues: [{ severity: "high", location: "a", problem: "b" }],
        }),
        outcome("check", 1, true, { verdict: "pass", issues: [] }),
      ],
    });
    expect(stateByRole(r).check).toBe("issues");
    expect(stateByRole(r).fix).toBe("active");
  });

  it("marks build failed when a builder outcome failed", () => {
    const r = run({ status: "failed", outcomes: [outcome("build", 0, false, undefined)] });
    expect(stateByRole(r).build).toBe("failed");
  });
});
