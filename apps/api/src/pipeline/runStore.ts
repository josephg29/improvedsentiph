/**
 * Run persistence — durable, observable, survives an API restart.
 *
 * Mirrors the terminal `registry.ts` persistence pattern: a versioned document
 * with debounced async writes. One file per run at
 * `.sentiph/state/runs/<runId>.json`, plus an `index.json` that lists the run
 * ids. On load, any run left in a non-terminal status (the API died mid-run) is
 * reconciled to `failed` with reason `api_restart` — v1 does not resume.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Run, RunStatus } from "@sentiph/core";

import { toErrorMessage } from "../terminalRuntime/systemClients";

export const RUN_STORE_VERSION = 1;
const RUN_STORE_PERSIST_DEBOUNCE_MS = 100;

const TERMINAL_STATUSES = new Set<RunStatus>([
  "passed",
  "completed_with_issues",
  "failed",
  "cancelled",
]);

const VALID_STATUSES = new Set<RunStatus>([
  "pending",
  "building",
  "checking",
  "fixing",
  "passed",
  "completed_with_issues",
  "failed",
  "cancelled",
]);

export const isTerminalStatus = (status: RunStatus): boolean => TERMINAL_STATUSES.has(status);

const runsDirectory = (stateDir: string) => join(stateDir, "state", "runs");
const runFilePath = (stateDir: string, runId: string) =>
  join(runsDirectory(stateDir), `${runId}.json`);
const indexFilePath = (stateDir: string) => join(runsDirectory(stateDir), "index.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const serializeRun = (run: Run) =>
  `${JSON.stringify({ version: RUN_STORE_VERSION, run }, null, 2)}\n`;

const serializeIndex = (runIds: string[]) =>
  `${JSON.stringify({ version: RUN_STORE_VERSION, runIds }, null, 2)}\n`;

const parsePersistedRun = (value: unknown): Run | null => {
  if (!isRecord(value) || !isRecord(value.run)) {
    return null;
  }
  const run = value.run;
  if (
    typeof run.runId !== "string" ||
    typeof run.recipeId !== "string" ||
    typeof run.task !== "string" ||
    typeof run.status !== "string" ||
    !VALID_STATUSES.has(run.status as RunStatus) ||
    !Array.isArray(run.outcomes) ||
    typeof run.createdAt !== "string" ||
    typeof run.updatedAt !== "string"
  ) {
    return null;
  }
  // Trust the persisted shape past the structural gate — it is written only by us.
  return run as unknown as Run;
};

const reconcileLoadedRun = (run: Run, now: string): Run => {
  if (isTerminalStatus(run.status)) {
    return run;
  }
  return {
    ...run,
    status: "failed",
    failureReason: "api_restart",
    updatedAt: now,
    result: {
      status: "failed",
      taskSummary: run.task,
      filesTouched: [],
      issuesFound: [],
      issuesFixed: [],
      issuesRemaining: [],
      ...(run.workspaceBranch !== undefined ? { workspaceBranch: run.workspaceBranch } : {}),
    },
  };
};

export interface LoadedRunStore {
  runs: Map<string, Run>;
  reconciledRunIds: string[];
}

const readJsonFile = (path: string): unknown => {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
};

const readRunIndex = (stateDir: string): string[] => {
  const path = indexFilePath(stateDir);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = readJsonFile(path);
    if (isRecord(parsed) && Array.isArray(parsed.runIds)) {
      return parsed.runIds.filter((id): id is string => typeof id === "string");
    }
  } catch (error) {
    console.warn(`[run-store] Failed to read run index (${path}):`, toErrorMessage(error));
  }
  return [];
};

export const loadRunStore = (stateDir: string, now: string): LoadedRunStore => {
  const runs = new Map<string, Run>();
  const reconciledRunIds: string[] = [];

  for (const runId of readRunIndex(stateDir)) {
    const path = runFilePath(stateDir, runId);
    if (!existsSync(path)) {
      continue;
    }
    let run: Run | null = null;
    try {
      run = parsePersistedRun(readJsonFile(path));
    } catch (error) {
      console.warn(`[run-store] Failed to read run (${path}):`, toErrorMessage(error));
      continue;
    }
    if (!run) {
      console.warn(`[run-store] Skipping malformed run file: ${path}`);
      continue;
    }
    const reconciled = reconcileLoadedRun(run, now);
    if (reconciled !== run) {
      reconciledRunIds.push(run.runId);
    }
    runs.set(reconciled.runId, reconciled);
  }

  return { runs, reconciledRunIds };
};

/**
 * Debounced async writer for run files + the index. One drain loop flushes all
 * pending writes; identical content is skipped (mirrors the registry writer).
 */
export const createRunStorePersistence = (stateDir: string) => {
  const pending = new Map<string, string>();
  const lastPersisted = new Map<string, string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let writeLoopPromise: Promise<void> | null = null;

  const runWriteLoop = (): Promise<void> => {
    if (writeLoopPromise) {
      return writeLoopPromise;
    }
    if (pending.size === 0) {
      return Promise.resolve();
    }

    writeLoopPromise = (async () => {
      while (pending.size > 0) {
        const [path, serialized] = pending.entries().next().value as [string, string];
        pending.delete(path);
        try {
          mkdirSync(runsDirectory(stateDir), { recursive: true });
          await writeFile(path, serialized, "utf8");
          lastPersisted.set(path, serialized);
        } catch (error) {
          console.warn(`[run-store] Failed to persist ${path}:`, toErrorMessage(error));
        }
      }
    })().finally(() => {
      writeLoopPromise = null;
      if (pending.size > 0) {
        void runWriteLoop();
      }
    });

    return writeLoopPromise;
  };

  const clearDebounceTimer = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const enqueue = (path: string, serialized: string) => {
    if (pending.get(path) === serialized) {
      return;
    }
    if (!pending.has(path) && writeLoopPromise === null && lastPersisted.get(path) === serialized) {
      return;
    }
    pending.set(path, serialized);
    clearDebounceTimer();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runWriteLoop();
    }, RUN_STORE_PERSIST_DEBOUNCE_MS);
  };

  const flush = async () => {
    clearDebounceTimer();
    await runWriteLoop();
  };

  return {
    persistRun(run: Run) {
      enqueue(runFilePath(stateDir, run.runId), serializeRun(run));
    },
    persistIndex(runIds: string[]) {
      enqueue(indexFilePath(stateDir), serializeIndex(runIds));
    },
    flush,
    async close() {
      await flush();
    },
  };
};
