/**
 * Per-run git worktree isolation (spec §11).
 *
 * Reuses the existing GitClient worktree ops directly (not the terminal-coupled
 * worktreeManager, which resolves cwds via the terminal registry). Each run gets
 * its own worktree at `.sentiph/worktrees/<runId>` on branch `sentiph/<runId>`
 * created from HEAD. All stages of a run share it (builder writes, checkers read,
 * fixer writes).
 *
 * On success the run's work is committed and the branch is left for the operator
 * to review/merge (no auto-PR/merge in v1). On cancel/fail the worktree and
 * branch are removed, best-effort.
 */

import { join } from "node:path";

import type { GitClient } from "../terminalRuntime";
import { toErrorMessage } from "../terminalRuntime/systemClients";
import { RUN_WORKTREE_RELATIVE_PATH, runBranchName } from "./constants";
import type { WorktreeProvider } from "./worktreeProvider";

export interface GitWorktreeProviderDeps {
  gitClient: GitClient;
  workspaceCwd: string;
  baseRef?: string;
}

export const createGitWorktreeProvider = (deps: GitWorktreeProviderDeps): WorktreeProvider => {
  const baseRef = deps.baseRef ?? "HEAD";
  const worktreePathFor = (runId: string) =>
    join(deps.workspaceCwd, RUN_WORKTREE_RELATIVE_PATH, runId);

  return {
    async acquire(run) {
      const path = worktreePathFor(run.runId);
      const branch = runBranchName(run.runId);
      deps.gitClient.addWorktree({
        cwd: deps.workspaceCwd,
        path,
        branchName: branch,
        baseRef,
      });
      return { cwd: path, branch };
    },

    async release(run, status) {
      const path = worktreePathFor(run.runId);
      const branch = runBranchName(run.runId);

      if (status === "passed" || status === "completed_with_issues") {
        // Commit the run's work so the branch is reviewable/mergeable, then leave it.
        try {
          deps.gitClient.commitAll({ cwd: path, message: `pipeline(${run.runId}): ${run.task}` });
        } catch (error) {
          // "No local changes to commit" or a commit failure — leave the worktree as-is.
          console.warn(
            `[pipeline] No commit for ${run.runId} (${toErrorMessage(error)}); leaving worktree.`,
          );
        }
        return;
      }

      // failed / cancelled: best-effort cleanup of the worktree and its branch.
      try {
        deps.gitClient.removeWorktree({ cwd: deps.workspaceCwd, path });
      } catch (error) {
        console.warn(`[pipeline] Failed to remove worktree ${path}:`, toErrorMessage(error));
      }
      try {
        deps.gitClient.removeBranch({ cwd: deps.workspaceCwd, branchName: branch });
      } catch (error) {
        console.warn(`[pipeline] Failed to remove branch ${branch}:`, toErrorMessage(error));
      }
    },
  };
};
