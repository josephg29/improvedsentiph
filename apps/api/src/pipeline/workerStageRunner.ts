/**
 * Production stage runner: turns a recipe stage into headless workers.
 *
 * Spawns `stage.fanout` copies in parallel (checkers = 2), each a real headless
 * worker, optionally through a shared concurrency limiter (M4). Maps each
 * worker result into an append-only {@link WorkerOutcome}. Injected into the
 * conductor so the loop itself stays free of process concerns.
 */

import type { Recipe, RecipeStage, Run, WorkerOutcome } from "@sentiph/core";

import { toErrorMessage } from "../terminalRuntime/systemClients";
import { type RunStageFn, renderStagePrompt } from "./conductor";
import { type WorkerRun, type WorkerSpec, runHeadlessWorker } from "./headlessWorker";

export interface WorkerStageRunnerDeps {
  recipe: Recipe;
  cwd: string;
  timeoutMs: number;
  /** Injectable worker runner — defaults to the real headless worker. */
  runWorker?: (spec: WorkerSpec) => Promise<WorkerRun>;
  /** Shared concurrency limiter across all in-flight workers (M4). */
  limit?: <T>(task: () => Promise<T>) => Promise<T>;
  now?: () => string;
}

const toOutcome = (
  stage: RecipeStage,
  index: number,
  workerRun: WorkerRun,
  startedAt: string,
  endedAt: string,
): WorkerOutcome => ({
  stageId: stage.id,
  index,
  ok: workerRun.ok,
  startedAt,
  endedAt,
  ...(workerRun.result !== undefined ? { result: workerRun.result } : {}),
  ...(workerRun.error !== undefined ? { error: workerRun.error } : {}),
  ...(workerRun.costUsd !== undefined ? { costUsd: workerRun.costUsd } : {}),
});

export const createWorkerStageRunner = (deps: WorkerStageRunnerDeps): RunStageFn => {
  const runWorker = deps.runWorker ?? runHeadlessWorker;
  const limit = deps.limit ?? (<T>(task: () => Promise<T>) => task());
  const now = deps.now ?? (() => new Date().toISOString());

  return async (stage: RecipeStage, run: Run, signal: AbortSignal): Promise<WorkerOutcome[]> => {
    const fanout = stage.fanout ?? 1;

    return Promise.all(
      Array.from({ length: fanout }, (_unused, index) =>
        limit(async () => {
          const prompt = renderStagePrompt(deps.recipe, stage, run, index);
          const startedAt = now();
          try {
            const workerRun = await runWorker({
              prompt,
              stage,
              cwd: deps.cwd,
              timeoutMs: deps.timeoutMs,
              signal,
            });
            return toOutcome(stage, index, workerRun, startedAt, now());
          } catch (error) {
            // A worker that throws becomes a failed outcome rather than discarding
            // its siblings — the gate routes on it like any other non-ok worker.
            return toOutcome(
              stage,
              index,
              { ok: false, error: toErrorMessage(error) },
              startedAt,
              now(),
            );
          }
        }),
      ),
    );
  };
};
