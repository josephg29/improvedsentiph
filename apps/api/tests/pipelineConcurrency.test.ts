import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunStatus } from "@sentiph/core";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkerRun, WorkerSpec } from "../src/pipeline/headlessWorker";
import { createPipelineRuntime } from "../src/pipeline/pipelineRuntime";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sentiph-pipeline-concurrency-test-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const isTerminal = (status: RunStatus) =>
  status === "passed" ||
  status === "failed" ||
  status === "cancelled" ||
  status === "completed_with_issues";

const waitForTerminal = async (
  runtime: ReturnType<typeof createPipelineRuntime>,
  runId: string,
) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = runtime.getRun(runId);
    if (run && isTerminal(run.status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} never finished.`);
};

describe("pipeline runtime shared concurrency cap", () => {
  it("never exceeds the shared worker cap across multiple runs", async () => {
    const stateDir = tempDir();
    let active = 0;
    let peak = 0;
    const runWorker = async (spec: WorkerSpec): Promise<WorkerRun> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      if (spec.stage.role === "build") {
        return { ok: true, result: { summary: "b", filesTouched: [], done: true } };
      }
      return { ok: true, result: { verdict: "pass", issues: [] } };
    };

    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker,
      maxConcurrentWorkers: 2,
    });

    const runA = runtime.startRun("task A");
    const runB = runtime.startRun("task B");
    await Promise.all([waitForTerminal(runtime, runA.runId), waitForTerminal(runtime, runB.runId)]);

    expect(peak).toBeLessThanOrEqual(2);
    expect(runtime.getRun(runA.runId)?.status).toBe("passed");
    expect(runtime.getRun(runB.runId)?.status).toBe("passed");
    await runtime.close();
  });
});
