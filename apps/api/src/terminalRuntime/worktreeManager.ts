import { existsSync } from "node:fs";
import { join } from "node:path";

import { AGENT_WORKTREE_BRANCH_PREFIX, AGENT_WORKTREE_RELATIVE_PATH } from "./constants";
import { toErrorMessage } from "./systemClients";
import type { GitClient, PersistedTerminal } from "./types";
import { RuntimeInputError } from "./types";

type CreateWorktreeManagerOptions = {
  workspaceCwd: string;
  gitClient: GitClient;
  terminals: Map<string, PersistedTerminal>;
};

type RemoveAgentWorktreeOptions = {
  bestEffort?: boolean;
};

/** Resolve the effective worktree identifier for a terminal. */
const getEffectiveWorktreeId = (terminal: PersistedTerminal): string =>
  terminal.worktreeId ?? terminal.agentId;

/** Find any terminal whose effective worktree identifier matches. */
const findTerminalForWorktree = (
  terminals: Map<string, PersistedTerminal>,
  worktreeIdentifier: string,
): PersistedTerminal | undefined => {
  for (const terminal of terminals.values()) {
    if (getEffectiveWorktreeId(terminal) === worktreeIdentifier) {
      return terminal;
    }
  }
  return undefined;
};

export const createWorktreeManager = ({
  workspaceCwd,
  gitClient,
  terminals,
}: CreateWorktreeManagerOptions) => {
  const getAgentWorktreePath = (agentId: string) =>
    join(workspaceCwd, AGENT_WORKTREE_RELATIVE_PATH, agentId);
  const getAgentBranchName = (agentId: string) =>
    `${AGENT_WORKTREE_BRANCH_PREFIX}${agentId}`;

  const getAgentWorkspaceCwd = (worktreeIdentifier: string) => {
    const terminal = findTerminalForWorktree(terminals, worktreeIdentifier);
    if (!terminal) {
      throw new Error(`No terminal found for worktree: ${worktreeIdentifier}`);
    }

    if (terminal.workspaceMode === "worktree") {
      return getAgentWorktreePath(worktreeIdentifier);
    }

    return workspaceCwd;
  };

  const assertWorktreeCreationSupported = () => {
    gitClient.assertAvailable();
    if (!gitClient.isRepository(workspaceCwd)) {
      throw new RuntimeInputError(
        "Worktree terminals require a git repository at the workspace root.",
      );
    }
  };

  const createAgentWorktree = (agentId: string, baseRef = "HEAD") => {
    assertWorktreeCreationSupported();
    const worktreePath = getAgentWorktreePath(agentId);
    if (existsSync(worktreePath)) {
      throw new RuntimeInputError(`Worktree path already exists: ${worktreePath}`);
    }

    try {
      gitClient.addWorktree({
        cwd: workspaceCwd,
        path: worktreePath,
        branchName: `${AGENT_WORKTREE_BRANCH_PREFIX}${agentId}`,
        baseRef,
      });
    } catch (error) {
      throw new Error(`Unable to create worktree for ${agentId}: ${toErrorMessage(error)}`);
    }
  };

  const hasAgentWorktree = (agentId: string): boolean =>
    existsSync(getAgentWorktreePath(agentId));

  const removeAgentWorktree = (
    agentId: string,
    options: RemoveAgentWorktreeOptions = {},
  ) => {
    const { bestEffort = false } = options;
    const worktreePath = getAgentWorktreePath(agentId);
    const branchName = getAgentBranchName(agentId);

    if (existsSync(worktreePath)) {
      try {
        gitClient.removeWorktree({
          cwd: workspaceCwd,
          path: worktreePath,
        });
      } catch (error) {
        if (bestEffort) {
          return;
        }
        throw new RuntimeInputError(
          `Unable to remove worktree for ${agentId}: ${toErrorMessage(error)}`,
        );
      }
    }

    try {
      gitClient.removeBranch({
        cwd: workspaceCwd,
        branchName,
      });
    } catch (error) {
      if (bestEffort) {
        return;
      }
      throw new RuntimeInputError(
        `Unable to remove branch for ${agentId}: ${toErrorMessage(error)}`,
      );
    }
  };

  return {
    getAgentWorkspaceCwd,
    createAgentWorktree,
    hasAgentWorktree,
    removeAgentWorktree,
  };
};
