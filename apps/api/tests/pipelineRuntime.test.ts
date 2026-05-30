import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunStatus } from "@sentiph/core";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkerRun, WorkerSpec } from "../src/pipeline/headlessWorker";
import { createPipelineRuntime } from "../src/pipeline/pipelineRuntime";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sentiph-pipeline-runtime-test-"));
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
    return {
      ok: true,
      result: { summary: "built", filesTouched: ["a.ts"], done: true },
      costUsd: 0.1,
    };
  }
  if (spec.stage.role === "fix") {
    return { ok: true, result: { summary: "fixed", resolved: [], done: true } };
  }
  return { ok: true, result: { verdict: "pass", issues: [] } };
};

const failingBuildWorker = async (): Promise<WorkerRun> => ({ ok: false, error: "build exploded" });

const hangingWorker = (spec: WorkerSpec): Promise<WorkerRun> =>
  new Promise((resolve) => {
    spec.signal.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }), {
      once: true,
    });
  });

const waitForStatus = async (
  runtime: ReturnType<typeof createPipelineRuntime>,
  runId: string,
  predicate: (status: RunStatus) => boolean,
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = runtime.getRun(runId);
    if (run && predicate(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} never reached the expected status.`);
};

const isTerminal = (status: RunStatus) =>
  status === "passed" ||
  status === "failed" ||
  status === "cancelled" ||
  status === "completed_with_issues";

describe("createPipelineRuntime", () => {
  it("runs a task end-to-end, persists it, and makes it observable", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: passingWorker,
    });

    const run = runtime.startRun("add a feature");
    expect(run.status).toBe("pending");
    expect(runtime.listRuns().map((summary) => summary.runId)).toContain(run.runId);

    const finished = await waitForStatus(runtime, run.runId, (status) => status === "passed");
    expect(finished.result?.status).toBe("passed");
    expect(finished.result?.filesTouched).toEqual(["a.ts"]);
    await runtime.close();

    // A fresh runtime over the same state hydrates the finished run unchanged.
    const reloaded = createPipelineRuntime({ workspaceCwd: stateDir, projectStateDir: stateDir });
    expect(reloaded.getRun(run.runId)?.status).toBe("passed");
    await reloaded.close();
  });

  it("rejects an unknown recipe", () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({ workspaceCwd: stateDir, projectStateDir: stateDir });
    expect(() => runtime.startRun("x", "nope")).toThrow();
  });

  it("fails a run when the builder fails", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: failingBuildWorker,
    });
    const run = runtime.startRun("break it");
    const finished = await waitForStatus(runtime, run.runId, isTerminal);
    expect(finished.status).toBe("failed");
    await runtime.close();
  });

  it("cancels an in-flight run", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: hangingWorker,
    });
    const run = runtime.startRun("long task");
    await waitForStatus(runtime, run.runId, (status) => status === "building");
    expect(runtime.cancelRun(run.runId)).toBe(true);
    const finished = await waitForStatus(runtime, run.runId, isTerminal);
    expect(finished.status).toBe("cancelled");
    await runtime.close();
  });

  it("returns null for an unknown run and false when cancelling it", () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({ workspaceCwd: stateDir, projectStateDir: stateDir });
    expect(runtime.getRun("run-999")).toBeNull();
    expect(runtime.cancelRun("run-999")).toBe(false);
  });

  it("does not cancel a run that has already finished", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: passingWorker,
    });
    const run = runtime.startRun("quick");
    await waitForStatus(runtime, run.runId, (status) => status === "passed");
    expect(runtime.cancelRun(run.runId)).toBe(false);
    await runtime.close();
  });

  it("persists a cancelled run across close instead of losing it to api_restart", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: hangingWorker,
    });
    const run = runtime.startRun("long task");
    await waitForStatus(runtime, run.runId, (status) => status === "building");
    runtime.cancelRun(run.runId);
    // close() must let the interrupted run commit "cancelled" before the final flush.
    await runtime.close();

    const reloaded = createPipelineRuntime({ workspaceCwd: stateDir, projectStateDir: stateDir });
    expect(reloaded.getRun(run.runId)?.status).toBe("cancelled");
    await reloaded.close();
  });
});
