import { join } from "node:path";

import type { Run } from "@sentiph/core";
import { describe, expect, it, vi } from "vitest";

import { createGitWorktreeProvider } from "../src/pipeline/gitWorktreeProvider";
import type { GitClient } from "../src/terminalRuntime";

const makeFakeGitClient = (): GitClient => ({
  assertAvailable: vi.fn(),
  isRepository: vi.fn(() => true),
  addWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  removeBranch: vi.fn(),
  readWorktreeStatus: vi.fn(),
  commitAll: vi.fn(),
  pushCurrentBranch: vi.fn(),
  syncWithBase: vi.fn(),
  readCurrentBranchPullRequest: vi.fn(() => null),
  createPullRequest: vi.fn(() => null),
  mergeCurrentBranchPullRequest: vi.fn(),
});

const run = (runId: string): Run => ({
  runId,
  recipeId: "standard",
  task: "do the thing",
  status: "building",
  outcomes: [],
  createdAt: "t",
  updatedAt: "t",
});

const worktreePath = (runId: string) => join("/repo", ".sentiph/worktrees", runId);

describe("createGitWorktreeProvider", () => {
  it("creates a per-run worktree on its own branch from HEAD", async () => {
    const git = makeFakeGitClient();
    const provider = createGitWorktreeProvider({ gitClient: git, workspaceCwd: "/repo" });
    const lease = await provider.acquire(run("run-3"));

    expect(git.addWorktree).toHaveBeenCalledWith({
      cwd: "/repo",
      path: worktreePath("run-3"),
      branchName: "sentiph/run-3",
      baseRef: "HEAD",
    });
    expect(lease).toEqual({ cwd: worktreePath("run-3"), branch: "sentiph/run-3" });
  });

  it("commits the work and leaves the branch on success", async () => {
    const git = makeFakeGitClient();
    const provider = createGitWorktreeProvider({ gitClient: git, workspaceCwd: "/repo" });
    await provider.release(run("run-3"), "passed");

    expect(git.commitAll).toHaveBeenCalledWith({
      cwd: worktreePath("run-3"),
      message: "pipeline(run-3): do the thing",
    });
    expect(git.removeWorktree).not.toHaveBeenCalled();
    expect(git.removeBranch).not.toHaveBeenCalled();
  });

  it("also commits and leaves the branch when completed with issues", async () => {
    const git = makeFakeGitClient();
    const provider = createGitWorktreeProvider({ gitClient: git, workspaceCwd: "/repo" });
    await provider.release(run("run-4"), "completed_with_issues");
    expect(git.commitAll).toHaveBeenCalledTimes(1);
    expect(git.removeWorktree).not.toHaveBeenCalled();
  });

  it("removes the worktree and branch on failure", async () => {
    const git = makeFakeGitClient();
    const provider = createGitWorktreeProvider({ gitClient: git, workspaceCwd: "/repo" });
    await provider.release(run("run-5"), "failed");

    expect(git.commitAll).not.toHaveBeenCalled();
    expect(git.removeWorktree).toHaveBeenCalledWith({ cwd: "/repo", path: worktreePath("run-5") });
    expect(git.removeBranch).toHaveBeenCalledWith({ cwd: "/repo", branchName: "sentiph/run-5" });
  });

  it("removes the worktree and branch on cancellation", async () => {
    const git = makeFakeGitClient();
    const provider = createGitWorktreeProvider({ gitClient: git, workspaceCwd: "/repo" });
    await provider.release(run("run-6"), "cancelled");
    expect(git.removeWorktree).toHaveBeenCalledTimes(1);
    expect(git.removeBranch).toHaveBeenCalledTimes(1);
  });

  it("swallows a commit failure (e.g. nothing to commit) without throwing", async () => {
    const git = makeFakeGitClient();
    vi.mocked(git.commitAll).mockImplementation(() => {
      throw new Error("No local changes to commit.");
    });
    const provider = createGitWorktreeProvider({ gitClient: git, workspaceCwd: "/repo" });
    await expect(provider.release(run("run-7"), "passed")).resolves.toBeUndefined();
  });
});
