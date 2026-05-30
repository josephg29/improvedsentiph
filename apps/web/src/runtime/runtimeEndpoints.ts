type LocationLike = Pick<Location, "host" | "protocol">;

const readRuntimeBaseUrl = (): string | null => {
  const value = import.meta.env.VITE_SENTIPH_API_ORIGIN;
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const withTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`);

const buildAbsoluteUrl = (baseUrl: string, pathname: string) => {
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(normalizedPath, withTrailingSlash(baseUrl)).toString();
};

const localWebSocketUrl = (location: LocationLike, agentId: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/terminals/${agentId}/ws`;
};

const localRuntimeWebSocketUrl = (location: LocationLike, pathname: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${pathname}`;
};

const toWebSocketBase = (runtimeBaseUrl: string): string | null => {
  try {
    const url = new URL(runtimeBaseUrl);
    if (url.protocol === "https:") {
      url.protocol = "wss:";
      return url.toString();
    }
    if (url.protocol === "http:") {
      url.protocol = "ws:";
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
};

export const buildTerminalSnapshotsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/terminal-snapshots";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/terminal-snapshots");
};

export const buildTerminalEventsSocketUrl = (
  runtimeBaseUrl = readRuntimeBaseUrl(),
  location: LocationLike = window.location,
) => {
  if (!runtimeBaseUrl) {
    return localRuntimeWebSocketUrl(location, "/api/terminal-events/ws");
  }

  const websocketBase = toWebSocketBase(runtimeBaseUrl);
  if (!websocketBase) {
    return localRuntimeWebSocketUrl(location, "/api/terminal-events/ws");
  }

  return buildAbsoluteUrl(websocketBase, "/api/terminal-events/ws");
};

export const buildTerminalsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/terminals";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/terminals");
};

export const buildRunsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/runs";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/runs");
};

export const buildRunItemUrl = (runId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/runs/${encodeURIComponent(runId)}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildRunCancelUrl = (runId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/runs/${encodeURIComponent(runId)}/cancel`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildCodexUsageUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/codex/usage";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/codex/usage");
};

export const buildClaudeUsageUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/claude/usage";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/claude/usage");
};

export const buildGithubSummaryUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/github/summary";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/github/summary");
};

export const buildUiStateUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/ui-state";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/ui-state");
};

export const buildWorkspaceSetupUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/setup";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/setup");
};

export const buildWorkspaceSetupStepUrl = (
  stepId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const path = `/api/setup/steps/${encodeURIComponent(stepId)}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildMonitorConfigUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/monitor/config";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/monitor/config");
};

export const buildMonitorFeedUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/monitor/feed";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/monitor/feed");
};

export const buildMonitorRefreshUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/monitor/refresh";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/monitor/refresh");
};

export const buildUsageHeatmapUrl = (
  scope: "all" | "project" = "all",
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const path = `/api/analytics/usage-heatmap?scope=${scope}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildConversationsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/conversations";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/conversations");
};

export const buildConversationSearchUrl = (
  query: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const path = `/api/conversations/search?q=${encodeURIComponent(query)}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildConversationSessionUrl = (
  sessionId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedSessionId = encodeURIComponent(sessionId);
  const path = `/api/conversations/${encodedSessionId}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildConversationExportUrl = (
  sessionId: string,
  format: "json" | "md",
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedSessionId = encodeURIComponent(sessionId);
  const path = `/api/conversations/${encodedSessionId}/export?format=${format}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildAgentRenameUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const encodedAgentId = encodeURIComponent(agentId);
  if (!runtimeBaseUrl) {
    return `/api/agents/${encodedAgentId}`;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, `/api/agents/${encodedAgentId}`);
};

const buildAgentGitActionUrl = (
  agentId: string,
  action: "status" | "commit" | "push" | "sync",
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedAgentId = encodeURIComponent(agentId);
  const path = `/api/agents/${encodedAgentId}/git/${action}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildAgentGitStatusUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildAgentGitActionUrl(agentId, "status", runtimeBaseUrl);

export const buildAgentGitCommitUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildAgentGitActionUrl(agentId, "commit", runtimeBaseUrl);

export const buildAgentGitPushUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildAgentGitActionUrl(agentId, "push", runtimeBaseUrl);

export const buildAgentGitSyncUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) =>
  buildAgentGitActionUrl(agentId, "sync", runtimeBaseUrl);

export const buildAgentGitPullRequestUrl = (
  agentId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedAgentId = encodeURIComponent(agentId);
  const path = `/api/agents/${encodedAgentId}/git/pr`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildAgentGitPullRequestMergeUrl = (
  agentId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedAgentId = encodeURIComponent(agentId);
  const path = `/api/agents/${encodedAgentId}/git/pr/merge`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckAgentsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/deck/agents";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/deck/agents");
};

export const buildDeckSkillsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/deck/skills";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/deck/skills");
};

export const buildDeckAgentUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const encodedAgentId = encodeURIComponent(agentId);
  const path = `/api/deck/agents/${encodedAgentId}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckAgentSkillsUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/deck/agents/${encodeURIComponent(agentId)}/skills`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckVaultFileUrl = (
  agentId: string,
  fileName: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
) => {
  const encodedAgentId = encodeURIComponent(agentId);
  const encodedFileName = encodeURIComponent(fileName);
  const path = `/api/deck/agents/${encodedAgentId}/files/${encodedFileName}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckTodoToggleUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/deck/agents/${encodeURIComponent(agentId)}/todo/toggle`;
  if (!runtimeBaseUrl) return path;
  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckTodoEditUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/deck/agents/${encodeURIComponent(agentId)}/todo/edit`;
  if (!runtimeBaseUrl) return path;
  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckTodoAddUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/deck/agents/${encodeURIComponent(agentId)}/todo`;
  if (!runtimeBaseUrl) return path;
  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckTodoDeleteUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/deck/agents/${encodeURIComponent(agentId)}/todo/delete`;
  if (!runtimeBaseUrl) return path;
  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildDeckTodoSolveUrl = (agentId: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const path = `/api/deck/agents/${encodeURIComponent(agentId)}/todo/solve`;
  if (!runtimeBaseUrl) return path;
  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildPromptsUrl = (runtimeBaseUrl = readRuntimeBaseUrl()) => {
  if (!runtimeBaseUrl) {
    return "/api/prompts";
  }

  return buildAbsoluteUrl(runtimeBaseUrl, "/api/prompts");
};

export const buildPromptItemUrl = (name: string, runtimeBaseUrl = readRuntimeBaseUrl()) => {
  const encodedName = encodeURIComponent(name);
  const path = `/api/prompts/${encodedName}`;
  if (!runtimeBaseUrl) {
    return path;
  }

  return buildAbsoluteUrl(runtimeBaseUrl, path);
};

export const buildTerminalSocketUrl = (
  agentId: string,
  runtimeBaseUrl = readRuntimeBaseUrl(),
  location: LocationLike = window.location,
) => {
  const encodedAgentId = encodeURIComponent(agentId);
  if (!runtimeBaseUrl) {
    return localWebSocketUrl(location, encodedAgentId);
  }

  const webSocketBase = toWebSocketBase(runtimeBaseUrl);
  if (!webSocketBase) {
    return localWebSocketUrl(location, encodedAgentId);
  }

  return buildAbsoluteUrl(webSocketBase, `/api/terminals/${encodedAgentId}/ws`);
};
