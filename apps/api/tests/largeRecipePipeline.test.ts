import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunStatus } from "@sentiph/core";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkerRun, WorkerSpec } from "../src/pipeline/headlessWorker";
import { createPipelineRuntime } from "../src/pipeline/pipelineRuntime";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sentiph-large-recipe-test-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const SUBTASKS = [
  { index: 0, description: "Build game loop", fileDomain: "src/game/loop/**" },
  { index: 1, description: "Build rendering", fileDomain: "src/game/render/**" },
  { index: 2, description: "Build input handling", fileDomain: "src/game/input/**" },
];

const planResult: WorkerRun = {
  ok: true,
  result: { summary: "Decomposed into 3 subtasks", subtasks: SUBTASKS },
};

const integrateResult: WorkerRun = {
  ok: true,
  result: { summary: "Integrated all parts", filesTouched: ["src/game/index.ts"], done: true },
};

const makeLargeWorker = (
  checkBehavior: "pass" | "needs_fix" = "pass",
): ((spec: WorkerSpec) => Promise<WorkerRun>) => {
  let checkCalls = 0;
  return async (spec: WorkerSpec): Promise<WorkerRun> => {
    switch (spec.stage.role) {
      case "plan":
        return planResult;
      case "build":
        return {
          ok: true,
          result: {
            summary: `Built subtask ${spec.stage.id}`,
            filesTouched: [`src/game/part${checkCalls}.ts`],
            done: true,
          },
        };
      case "integrate":
        return integrateResult;
      case "check": {
        checkCalls += 1;
        const isFirstRound = checkCalls <= (spec.stage.fanout ?? 1);
        if (checkBehavior === "needs_fix" && isFirstRound) {
          return {
            ok: true,
            result: {
              verdict: "needs_fix",
              issues: [{ severity: "high", location: "src/game/index.ts:1", problem: "missing export" }],
            },
          };
        }
        return { ok: true, result: { verdict: "pass", issues: [] } };
      }
      case "fix":
        return { ok: true, result: { summary: "Fixed missing export", resolved: ["missing export"], done: true } };
      default:
        return { ok: true, result: {} };
    }
  };
};

const waitForTerminal = async (
  runtime: ReturnType<typeof createPipelineRuntime>,
  runId: string,
) => {
  const isTerminal = (status: RunStatus) =>
    status === "passed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "completed_with_issues";
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const run = runtime.getRun(runId);
    if (run && isTerminal(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} never reached a terminal status.`);
};

describe("large recipe pipeline (end-to-end)", () => {
  it("passes on happy path: plan → build×3 → integrate → check×3 → pass", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: makeLargeWorker("pass"),
    });
    // Trigger large recipe by using a large-scope phrase.
    const run = runtime.startRun("Build me a full game where you are homeless in San Francisco");
    const finished = await waitForTerminal(runtime, run.runId);
    expect(finished.status).toBe("passed");
    // plan(1) + build(3) + integrate(1) + check(3) = 8 outcomes on first pass.
    expect(finished.outcomes).toHaveLength(8);
    expect(finished.outcomes[0]?.stageId).toBe("plan");
    expect(finished.outcomes.filter((o) => o.stageId === "build")).toHaveLength(3);
    expect(finished.outcomes.find((o) => o.stageId === "integrate")).toBeDefined();
    await runtime.close();
  });

  it("routes through fix when checkers find issues, then passes", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: makeLargeWorker("needs_fix"),
    });
    const run = runtime.startRun("Build me a full game where you are homeless in San Francisco");
    const finished = await waitForTerminal(runtime, run.runId);
    expect(finished.status).toBe("passed");
    // plan(1) + build(3) + integrate(1) + check(3) + fix(1) + check(3) = 12
    expect(finished.outcomes).toHaveLength(12);
    await runtime.close();
  });

  it("fails immediately if the planner fails", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: async (spec: WorkerSpec): Promise<WorkerRun> => {
        if (spec.stage.role === "plan") {
          return { ok: false, error: "planner crashed" };
        }
        return { ok: true, result: {} };
      },
    });
    const run = runtime.startRun("Build me a full game from scratch");
    const finished = await waitForTerminal(runtime, run.runId);
    expect(finished.status).toBe("failed");
    expect(finished.outcomes).toHaveLength(1);
    await runtime.close();
  });

  it("fails if any builder fails", async () => {
    const stateDir = tempDir();
    let buildCalls = 0;
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: async (spec: WorkerSpec): Promise<WorkerRun> => {
        if (spec.stage.role === "plan") {
          return planResult;
        }
        if (spec.stage.role === "build") {
          buildCalls += 1;
          if (buildCalls === 2) {
            return { ok: false, error: "builder 2 crashed" };
          }
          return { ok: true, result: { summary: "built", filesTouched: [], done: true } };
        }
        return { ok: true, result: {} };
      },
    });
    const run = runtime.startRun("Build me a full game from scratch");
    const finished = await waitForTerminal(runtime, run.runId);
    expect(finished.status).toBe("failed");
    await runtime.close();
  });

  it("fails if the integrator fails", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: async (spec: WorkerSpec): Promise<WorkerRun> => {
        if (spec.stage.role === "plan") {
          return planResult;
        }
        if (spec.stage.role === "build") {
          return { ok: true, result: { summary: "built", filesTouched: [], done: true } };
        }
        if (spec.stage.role === "integrate") {
          return { ok: false, error: "integrator crashed" };
        }
        return { ok: true, result: {} };
      },
    });
    const run = runtime.startRun("Build me a full game from scratch");
    const finished = await waitForTerminal(runtime, run.runId);
    expect(finished.status).toBe("failed");
    await runtime.close();
  });

  it("each parallel builder receives a distinct prompt with its assigned subtask", async () => {
    const stateDir = tempDir();
    const capturedPrompts: string[] = [];
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: async (spec: WorkerSpec): Promise<WorkerRun> => {
        if (spec.stage.role === "plan") {
          return planResult;
        }
        if (spec.stage.role === "build") {
          capturedPrompts.push(spec.prompt);
          return { ok: true, result: { summary: "built", filesTouched: [], done: true } };
        }
        if (spec.stage.role === "integrate") {
          return integrateResult;
        }
        return { ok: true, result: { verdict: "pass", issues: [] } };
      },
    });
    const run = runtime.startRun("Build me a full game from scratch");
    await waitForTerminal(runtime, run.runId);
    expect(capturedPrompts).toHaveLength(3);
    expect(capturedPrompts[0]).toContain("index 0");
    expect(capturedPrompts[1]).toContain("index 1");
    expect(capturedPrompts[2]).toContain("index 2");
    expect(capturedPrompts[0]).toContain("Build game loop");
    expect(capturedPrompts[1]).toContain("Build rendering");
    expect(capturedPrompts[2]).toContain("Build input handling");
    await runtime.close();
  });
});
