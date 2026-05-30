/**
 * Pipeline runtime — the facade the HTTP routes talk to.
 *
 * Mirrors the terminal runtime's shape: hydrate persisted state on construction
 * (reconciling interrupted runs), then expose start/list/get/cancel. Each run is
 * driven by the conductor fire-and-forget; every transition is persisted and
 * broadcast (reusing the terminal-event WebSocket channel) so the UI can watch.
 */

import type { Run, RunResult, RunStatus } from "@sentiph/core";

import { RuntimeInputError } from "../terminalRuntime";
import { toErrorMessage } from "../terminalRuntime/systemClients";
import { runPipeline } from "./conductor";
import { DEFAULT_WORKER_TIMEOUT_MS, RUN_ID_PREFIX } from "./constants";
import type { WorkerRun, WorkerSpec } from "./headlessWorker";
import { runHeadlessWorker } from "./headlessWorker";
import { DEFAULT_RECIPE_ID, getRecipe } from "./recipes";
import { createRunStorePersistence, loadRunStore } from "./runStore";
import { createWorkerStageRunner } from "./workerStageRunner";
import { type WorktreeProvider, createSharedWorkspaceProvider } from "./worktreeProvider";

export interface CreatePipelineRuntimeOptions {
  workspaceCwd: string;
  projectStateDir: string;
  /** Push run events over the (shared) terminal-event WebSocket channel. */
  broadcast?: (event: Record<string, unknown>) => void;
  worktreeProvider?: WorktreeProvider;
  /** Injectable worker runner — defaults to the real headless worker. */
  runWorker?: (spec: WorkerSpec) => Promise<WorkerRun>;
  /** Shared concurrency limiter across all in-flight workers (M4). */
  limit?: <T>(task: () => Promise<T>) => Promise<T>;
  now?: () => string;
  workerTimeoutMs?: number;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  task: string;
  recipeId: string;
  createdAt: string;
  updatedAt: string;
}

export type PipelineRuntime = ReturnType<typeof createPipelineRuntime>;

const toSummary = (run: Run): RunSummary => ({
  runId: run.runId,
  status: run.status,
  task: run.task,
  recipeId: run.recipeId,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

const failedResult = (run: Run): RunResult => ({
  status: "failed",
  taskSummary: run.task,
  filesTouched: [],
  issuesFound: [],
  issuesFixed: [],
  issuesRemaining: [],
  ...(run.workspaceBranch !== undefined ? { workspaceBranch: run.workspaceBranch } : {}),
});

export const createPipelineRuntime = (options: CreatePipelineRuntimeOptions) => {
  const now = options.now ?? (() => new Date().toISOString());
  const broadcast = options.broadcast ?? (() => {});
  const worktreeProvider =
    options.worktreeProvider ?? createSharedWorkspaceProvider(options.workspaceCwd);
  const runWorker = options.runWorker ?? runHeadlessWorker;
  const workerTimeoutMs = options.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  const stateDir = options.projectStateDir;

  const loaded = loadRunStore(stateDir, now());
  const runs = loaded.runs;
  const controllers = new Map<string, AbortController>();
  const persistence = createRunStorePersistence(stateDir);

  // Persist runs reconciled to failed (api_restart) back to disk.
  for (const runId of loaded.reconciledRunIds) {
    const reconciled = runs.get(runId);
    if (reconciled) {
      persistence.persistRun(reconciled);
    }
  }

  const broadcastRun = (run: Run) => broadcast({ type: "run-updated", run });

  const commit = (run: Run) => {
    runs.set(run.runId, run);
    persistence.persistRun(run);
    broadcastRun(run);
  };

  const allocateRunId = () => {
    let candidate = 1;
    while (runs.has(`${RUN_ID_PREFIX}${candidate}`)) {
      candidate += 1;
    }
    return `${RUN_ID_PREFIX}${candidate}`;
  };

  const executeRun = async (initialRun: Run, signal: AbortSignal) => {
    const recipe = getRecipe(initialRun.recipeId);
    if (!recipe) {
      commit({
        ...initialRun,
        status: "failed",
        failureReason: `unknown_recipe: ${initialRun.recipeId}`,
        updatedAt: now(),
        result: failedResult(initialRun),
      });
      controllers.delete(initialRun.runId);
      return;
    }

    let current = initialRun;
    try {
      let lease: Awaited<ReturnType<WorktreeProvider["acquire"]>>;
      try {
        lease = await worktreeProvider.acquire(initialRun);
      } catch (error) {
        current = {
          ...current,
          status: "failed",
          failureReason: `workspace_error: ${toErrorMessage(error)}`,
          updatedAt: now(),
          result: failedResult(current),
        };
        commit(current);
        return;
      }

      if (lease.branch !== undefined) {
        current = { ...current, workspaceBranch: lease.branch, updatedAt: now() };
        commit(current);
      }

      const stageRunner = createWorkerStageRunner({
        recipe,
        cwd: lease.cwd,
        timeoutMs: workerTimeoutMs,
        runWorker,
        now,
        ...(options.limit ? { limit: options.limit } : {}),
      });

      try {
        current = await runPipeline(recipe, current, stageRunner, {
          onUpdate: (next) => {
            current = next;
            commit(next);
          },
          now,
          signal,
        });
      } catch (error) {
        current = {
          ...current,
          status: "failed",
          failureReason: toErrorMessage(error),
          updatedAt: now(),
          result: failedResult(current),
        };
        commit(current);
      }

      try {
        await worktreeProvider.release(current, current.status);
      } catch (error) {
        console.warn(`[pipeline] Failed to release workspace for ${current.runId}:`, error);
      }
    } finally {
      controllers.delete(initialRun.runId);
    }
  };

  return {
    startRun(task: string, recipeId: string = DEFAULT_RECIPE_ID): Run {
      const recipe = getRecipe(recipeId);
      if (!recipe) {
        throw new RuntimeInputError(`Unknown recipe "${recipeId}".`);
      }

      const runId = allocateRunId();
      const timestamp = now();
      const run: Run = {
        runId,
        recipeId: recipe.id,
        task,
        status: "pending",
        outcomes: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      runs.set(runId, run);
      const controller = new AbortController();
      controllers.set(runId, controller);
      persistence.persistRun(run);
      persistence.persistIndex([...runs.keys()]);
      broadcastRun(run);

      void executeRun(run, controller.signal);
      return run;
    },

    listRuns(): RunSummary[] {
      return [...runs.values()]
        .map(toSummary)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    getRun(runId: string): Run | null {
      return runs.get(runId) ?? null;
    },

    cancelRun(runId: string): boolean {
      const controller = controllers.get(runId);
      if (!controller) {
        return false;
      }
      controller.abort();
      return true;
    },

    async close() {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      await persistence.close();
    },
  };
};
