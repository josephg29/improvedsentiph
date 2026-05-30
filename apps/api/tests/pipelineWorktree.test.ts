import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Run, RunStatus } from "@sentiph/core";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkerRun, WorkerSpec } from "../src/pipeline/headlessWorker";
import { createPipelineRuntime } from "../src/pipeline/pipelineRuntime";
import type { WorktreeProvider } from "../src/pipeline/worktreeProvider";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sentiph-pipeline-worktree-test-"));
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
    return { ok: true, result: { summary: "b", filesTouched: ["a.ts"], done: true } };
  }
  if (spec.stage.role === "fix") {
    return { ok: true, result: { summary: "f", resolved: [], done: true } };
  }
  return { ok: true, result: { verdict: "pass", issues: [] } };
};

const failingBuildWorker = async (): Promise<WorkerRun> => ({ ok: false, error: "boom" });

const recordingProvider = () => {
  const acquired: string[] = [];
  const released: Array<{ runId: string; status: RunStatus }> = [];
  const provider: WorktreeProvider = {
    async acquire(run: Run) {
      acquired.push(run.runId);
      return { cwd: `/wt/${run.runId}`, branch: `sentiph/${run.runId}` };
    },
    async release(run: Run, status: RunStatus) {
      released.push({ runId: run.runId, status });
    },
  };
  return { provider, acquired, released };
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
  throw new Error(`Run ${runId} never finished.`);
};

describe("pipeline runtime worktree integration", () => {
  it("acquires a workspace, surfaces the branch, and releases on success", async () => {
    const stateDir = tempDir();
    const { provider, acquired, released } = recordingProvider();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      worktreeProvider: provider,
      runWorker: passingWorker,
    });

    const run = runtime.startRun("add a feature");
    const finished = await waitForTerminal(runtime, run.runId);

    expect(finished.status).toBe("passed");
    expect(finished.workspaceBranch).toBe(`sentiph/${run.runId}`);
    expect(acquired).toEqual([run.runId]);
    expect(released).toEqual([{ runId: run.runId, status: "passed" }]);
    await runtime.close();
  });

  it("releases the workspace with the failed status when the run fails", async () => {
    const stateDir = tempDir();
    const { provider, released } = recordingProvider();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      worktreeProvider: provider,
      runWorker: failingBuildWorker,
    });

    const run = runtime.startRun("break it");
    await waitForTerminal(runtime, run.runId);
    expect(released).toEqual([{ runId: run.runId, status: "failed" }]);
    await runtime.close();
  });
});
