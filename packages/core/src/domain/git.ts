import type { AgentWorkspaceMode } from "./terminal";

export type AgentPullRequestStatus = "none" | "open" | "merged" | "closed";

export type AgentGitStatusSnapshot = {
  agentId: string;
  workspaceMode: AgentWorkspaceMode;
  branchName: string;
  upstreamBranchName: string | null;
  isDirty: boolean;
  aheadCount: number;
  behindCount: number;
  insertedLineCount: number;
  deletedLineCount: number;
  hasConflicts: boolean;
  changedFiles: string[];
  defaultBaseBranchName: string | null;
};

export type AgentPullRequestSnapshot = {
  agentId: string;
  workspaceMode: AgentWorkspaceMode;
  status: AgentPullRequestStatus;
  number: number | null;
  url: string | null;
  title: string | null;
  baseRef: string | null;
  headRef: string | null;
  isDraft: boolean | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  mergeStateStatus: string | null;
};
