import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunStatus } from "@sentiph/core";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkerRun, WorkerSpec } from "../src/pipeline/headlessWorker";
import { createPipelineRuntime } from "../src/pipeline/pipelineRuntime";

// End-to-end "real verify → fix → converge" proof through facade + store +
// conductor + router, driven by scripted (non-spawning) workers.

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sentiph-pipeline-trajectory-test-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const HIGH = { severity: "high", location: "a.ts:1", problem: "null deref" };

const buildResult: WorkerRun = {
  ok: true,
  result: { summary: "built", filesTouched: ["a.ts"], done: true },
};
const fixResult: WorkerRun = {
  ok: true,
  result: { summary: "fixed", resolved: ["null deref"], done: true },
};

/** First check round reports needs_fix; every later round behaves as `afterFix`. */
const makeCheckPhasedWorker = (afterFix: WorkerRun) => {
  let checkCopies = 0;
  return async (spec: WorkerSpec): Promise<WorkerRun> => {
    if (spec.stage.role === "build") {
      return buildResult;
    }
    if (spec.stage.role === "fix") {
      return fixResult;
    }
    checkCopies += 1;
    const isFirstRound = checkCopies <= (spec.stage.fanout ?? 1);
    if (isFirstRound) {
      return { ok: true, result: { verdict: "needs_fix", issues: [HIGH] } };
    }
    return afterFix;
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
  throw new Error(`Run ${runId} never finished.`);
};

describe("pipeline fix trajectories (end-to-end)", () => {
  it("verifies, fixes, re-checks, and passes", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: makeCheckPhasedWorker({ ok: true, result: { verdict: "pass", issues: [] } }),
    });
    const run = runtime.startRun("add a feature");
    const finished = await waitForTerminal(runtime, run.runId);
    expect(finished.status).toBe("passed");
    expect(finished.result?.issuesFound).toEqual([HIGH]);
    expect(finished.result?.issuesFixed).toEqual([HIGH]);
    expect(finished.result?.issuesRemaining).toEqual([]);
    // build, check×2, fix, check×2 = 6 worker outcomes.
    expect(finished.outcomes).toHaveLength(6);
    await runtime.close();
  });

  it("stops at completed_with_issues when the bounded fix loop is exhausted", async () => {
    const stateDir = tempDir();
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: makeCheckPhasedWorker({
        ok: true,
        result: { verdict: "needs_fix", issues: [HIGH] },
      }),
    });
    const run = runtime.startRun("add a feature");
    const finished = await waitForTerminal(runtime, run.runId);
    expect(finished.status).toBe("completed_with_issues");
    expect(finished.result?.issuesRemaining).toEqual([HIGH]);
    // Bounded: build, check×2, fix, check×2 — no second fix.
    expect(finished.outcomes).toHaveLength(6);
    await runtime.close();
  });

  it("fails when a checker process fails and the fix cannot recover it", async () => {
    const stateDir = tempDir();
    let fixCalls = 0;
    const runtime = createPipelineRuntime({
      workspaceCwd: stateDir,
      projectStateDir: stateDir,
      runWorker: async (spec: WorkerSpec): Promise<WorkerRun> => {
        if (spec.stage.role === "build") {
          return buildResult;
        }
        if (spec.stage.role === "fix") {
          fixCalls += 1;
          return { ok: false, error: "fixer crashed" };
        }
        return { ok: false, error: "checker crashed" };
      },
    });
    const run = runtime.startRun("add a feature");
    const finished = await waitForTerminal(runtime, run.runId);
    // Failed checker → routes to fix; fix fails → hard failure.
    expect(finished.status).toBe("failed");
    expect(fixCalls).toBe(1);
    await runtime.close();
  });
});
