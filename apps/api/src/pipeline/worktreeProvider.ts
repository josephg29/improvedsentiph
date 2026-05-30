/**
 * Workspace isolation for runs. A provider hands a run the working directory its
 * workers run in and reclaims it when the run ends.
 *
 * v1 (M2) uses the shared workspace. Per-run git worktrees (each run on its own
 * `sentiph/run-<id>` branch, left for the operator to merge on success and
 * cleaned up on cancel/fail) are added in M4 via a GitClient-backed provider.
 */

import type { Run, RunStatus } from "@sentiph/core";

export interface WorkspaceLease {
  cwd: string;
  branch?: string;
}

export interface WorktreeProvider {
  acquire(run: Run): Promise<WorkspaceLease>;
  release(run: Run, status: RunStatus): Promise<void>;
}

/** No isolation: every run shares the operator's workspace. */
export const createSharedWorkspaceProvider = (workspaceCwd: string): WorktreeProvider => ({
  async acquire() {
    return { cwd: workspaceCwd };
  },
  async release() {
    // Nothing to reclaim — the workspace is shared and long-lived.
  },
});
