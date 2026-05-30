import type { RecipeStage, Run } from "@sentiph/core";
import { describe, expect, it } from "vitest";

import type { WorkerRun, WorkerSpec } from "../src/pipeline/headlessWorker";
import { STANDARD_RECIPE } from "../src/pipeline/recipes";
import { createWorkerStageRunner } from "../src/pipeline/workerStageRunner";

const stageByRole = (role: "build" | "check" | "fix"): RecipeStage => {
  const found = STANDARD_RECIPE.stages.find((stage) => stage.role === role);
  if (!found) {
    throw new Error(`missing ${role} stage`);
  }
  return found;
};

const baseRun = (): Run => ({
  runId: "run-1",
  recipeId: "standard",
  task: "do the thing",
  status: "checking",
  outcomes: [],
  createdAt: "t",
  updatedAt: "t",
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createWorkerStageRunner", () => {
  it("runs the stage fanout in parallel and maps results to outcomes", async () => {
    let active = 0;
    let maxActive = 0;
    const seen: WorkerSpec[] = [];
    const runWorker = async (spec: WorkerSpec): Promise<WorkerRun> => {
      seen.push(spec);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      active -= 1;
      return { ok: true, result: { verdict: "pass", issues: [] }, costUsd: 0.05 };
    };

    const runStage = createWorkerStageRunner({
      recipe: STANDARD_RECIPE,
      cwd: "/tmp/run-1",
      timeoutMs: 1000,
      runWorker,
      now: () => "t",
    });

    const outcomes = await runStage(stageByRole("check"), baseRun(), new AbortController().signal);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((outcome) => outcome.index)).toEqual([0, 1]);
    expect(outcomes.every((outcome) => outcome.stageId === "check")).toBe(true);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes[0]?.costUsd).toBe(0.05);
    expect(maxActive).toBe(2); // both checkers in flight at once
    expect(seen[0]?.cwd).toBe("/tmp/run-1");
    expect(seen[0]?.timeoutMs).toBe(1000);
    expect(seen[0]?.prompt).toContain("Inspect");
  });

  it("serializes workers through an injected concurrency limiter", async () => {
    let active = 0;
    let maxActive = 0;
    let chain: Promise<unknown> = Promise.resolve();
    const limit = <T>(task: () => Promise<T>): Promise<T> => {
      const result = chain.then(task);
      chain = result.catch(() => {});
      return result;
    };
    const runWorker = async (): Promise<WorkerRun> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      active -= 1;
      return { ok: true, result: { verdict: "pass", issues: [] } };
    };

    const runStage = createWorkerStageRunner({
      recipe: STANDARD_RECIPE,
      cwd: "/tmp/run-1",
      timeoutMs: 1000,
      runWorker,
      limit,
      now: () => "t",
    });

    await runStage(stageByRole("check"), baseRun(), new AbortController().signal);
    expect(maxActive).toBe(1); // the limiter allowed only one at a time
  });

  it("records a failed worker as a non-ok outcome with its error", async () => {
    const runWorker = async (): Promise<WorkerRun> => ({ ok: false, error: "worker crashed" });
    const runStage = createWorkerStageRunner({
      recipe: STANDARD_RECIPE,
      cwd: "/tmp/run-1",
      timeoutMs: 1000,
      runWorker,
      now: () => "t",
    });
    const outcomes = await runStage(stageByRole("build"), baseRun(), new AbortController().signal);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.error).toBe("worker crashed");
  });
});
