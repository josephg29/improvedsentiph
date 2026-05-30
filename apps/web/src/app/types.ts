import type { GitHubCommitPoint, buildTerminalList } from "@sentiph/core";

export type TerminalView = Awaited<ReturnType<typeof buildTerminalList>>;

export type {
  CodexUsageSnapshot,
  ClaudeUsageSnapshot,
  GitHubCommitPoint,
  GitHubRecentCommit,
  GitHubRepoSummarySnapshot,
  TerminalAgentProvider,
  AgentGitStatusSnapshot,
  AgentPullRequestSnapshot,
} from "@sentiph/core";

export type { PersistedUiState as FrontendUiStateSnapshot } from "@sentiph/core";
export type { AgentWorkspaceMode as TerminalWorkspaceMode } from "@sentiph/core";

export type GitHubCommitSparkPoint = GitHubCommitPoint & {
  x: number;
  y: number;
};
