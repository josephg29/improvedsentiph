import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunStatus } from "@sentiph/core";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkerRun, WorkerSpec } from "../src/pipeline/headlessWorker";
import { createPipelineRuntime } from "../src/pipeline/pipelineRuntime";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sentiph-pipeline-approval-test-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const passingWorker = async (spec: WorkerSpec): Promise<WorkerRun> => {
  if (spec.stage.role === "build") {
    return { ok: true, result: { summary: "built", filesTouched: ["a.ts"], done: true } };
  }
  if (spec.stage.role === "fix") {
    return { ok: true, result: { summary: "fixed", resolved: [], done: true } };
  }
  return { ok: true, result: { verdict: "pass", issues: [] } };
};

const waitForStatus = (
  runtime: ReturnType<typeof createPipelineRuntime>,
  runId: string,
  predicate: (status: RunStatus) => boolean,
) =>
  new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const tick = () => {
      const run = runtime.getRun(runId);
      if (run && predicate(run.status)) {
        resolve();
        return;
      }
      attempts += 1;
      if (attempts > 300) {
        reject(new Error(`Run ${runId} never reached the expected status.`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });

const isTerminal = (status: RunStatus) =>
  status === "passed" ||
  status === "failed" ||
  status === "cancelled" ||
  status === "completed_with_issues";

describe("createPipelineRuntime — human approval gate", () => {
  it("pauses the careful recipe at the gate, then passes on approval", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: passingWorker,
    });

    const run = runtime.startRun("ship it", "careful");
    await waitForStatus(runtime, run.runId, (status) => status === "awaiting_approval");
    expect(runtime.approveRun(run.runId)).toBe(true);
    await waitForStatus(runtime, run.runId, isTerminal);
    expect(runtime.getRun(run.runId)?.status).toBe("passed");
    await runtime.close();
  });

  it("completes with issues when the operator rejects", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: passingWorker,
    });

    const run = runtime.startRun("ship it", "careful");
    await waitForStatus(runtime, run.runId, (status) => status === "awaiting_approval");
    expect(runtime.rejectRun(run.runId)).toBe(true);
    await waitForStatus(runtime, run.runId, isTerminal);
    expect(runtime.getRun(run.runId)?.status).toBe("completed_with_issues");
    await runtime.close();
  });

  it("returns false when approving a run that is not awaiting approval", () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({ workspaceCwd: stateDir, projectStateDir: stateDir });
    expect(runtime.approveRun("run-1")).toBe(false);
    expect(runtime.rejectRun("run-1")).toBe(false);
  });

  it("cancels a run that is parked at the gate and releases its workspace", async () => {
    const stateDir = tempDir();
    const released: Array<{ runId: string; status: RunStatus }> = [];
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: passingWorker,
      worktreeProvider: {
        async acquire(target) {
          return { cwd: `/wt/${target.runId}`, branch: `sentiph/${target.runId}` };
        },
        async release(target, status) {
          released.push({ runId: target.runId, status });
        },
      },
    });

    const run = runtime.startRun("ship it", "careful");
    await waitForStatus(runtime, run.runId, (status) => status === "awaiting_approval");
    expect(runtime.cancelRun(run.runId)).toBe(true);
    await waitForStatus(runtime, run.runId, isTerminal);
    expect(runtime.getRun(run.runId)?.status).toBe("cancelled");
    expect(released).toEqual([{ runId: run.runId, status: "cancelled" }]);
    await runtime.close();
  });
});
