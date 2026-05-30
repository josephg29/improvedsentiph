export const RUN_ID_PREFIX = "run-";
export const RUN_WORKTREE_RELATIVE_PATH = ".sentiph/worktrees";

/** Branch left for the operator to review/merge on success (spec §11). */
export const runBranchName = (runId: string) => `sentiph/${runId}`;

/** Per-worker timeout (spec §14, default 10 min). */
export const DEFAULT_WORKER_TIMEOUT_MS = 10 * 60 * 1000;

/** Shared cap across all in-flight headless workers (spec §9), separate from the PTY pool. */
export const PIPELINE_MAX_CONCURRENT_WORKERS = 8;
