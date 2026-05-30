import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { scanClaudeUsageChart } from "./claudeSessionScanner";
import {
  invalidateUsageCache as invalidateUsageCacheDefault,
  readClaudeCliUsageSnapshot as readClaudeCliUsageSnapshotDefault,
  readClaudeOauthUsageSnapshot as readClaudeOauthUsageSnapshotDefault,
  readClaudeUsageSnapshot as readClaudeUsageSnapshotDefault,
} from "./claudeUsage";
import { readCodexUsageSnapshot as readCodexUsageSnapshotDefault } from "./codexUsage";
import { createApiRequestHandler } from "./createApiServer/requestHandler";
import type { CreateApiServerOptions } from "./createApiServer/types";
import { createUpgradeHandler } from "./createApiServer/upgradeHandler";
import { readGithubRepoSummary as readGithubRepoSummaryDefault } from "./githubRepoSummary";
import { createPipelineRuntime } from "./pipeline/pipelineRuntime";
import { createTerminalRuntime } from "./terminalRuntime";

export const createApiServer = ({
  workspaceCwd,
  projectStateDir,
  webDistDir,
  apiBaseUrl,
  gitClient,
  readClaudeUsageSnapshot,
  readClaudeOauthUsageSnapshot,
  readClaudeCliUsageSnapshot,
  readCodexUsageSnapshot = readCodexUsageSnapshotDefault,
  readGithubRepoSummary,
  scanUsageHeatmap,
  invalidateClaudeUsageCache = invalidateUsageCacheDefault,
  allowRemoteAccess = false,
}: CreateApiServerOptions = {}) => {
  const resolvedWorkspaceCwd = workspaceCwd ?? process.cwd();
  // State lives in ~/.sentiph/projects/<name>/ when provided, else falls back to <project>/.sentiph/
  const resolvedStateDir = projectStateDir ?? join(resolvedWorkspaceCwd, ".sentiph");
  let resolvedApiBaseUrl = apiBaseUrl ?? "http://127.0.0.1:8787";
  const getApiBaseUrl = () => resolvedApiBaseUrl;
  const getApiPort = () => {
    try {
      return String(new URL(resolvedApiBaseUrl).port || 80);
    } catch {
      return "8787";
    }
  };
  const readClaudeUsageSnapshotWithDefault =
    readClaudeUsageSnapshot ??
    (() =>
      readClaudeUsageSnapshotDefault({
        projectStateDir: resolvedStateDir,
        backgroundRefreshOnly: true,
      }));
  const readClaudeOauthUsageSnapshotWithDefault =
    readClaudeOauthUsageSnapshot ??
    (() =>
      readClaudeOauthUsageSnapshotDefault({
        projectStateDir: resolvedStateDir,
      }));
  const readClaudeCliUsageSnapshotWithDefault =
    readClaudeCliUsageSnapshot ??
    (() =>
      readClaudeCliUsageSnapshotDefault({
        projectStateDir: resolvedStateDir,
      }));
  const readGithubRepoSummaryWithDefault =
    readGithubRepoSummary ??
    (() =>
      readGithubRepoSummaryDefault({
        cwd: resolvedWorkspaceCwd,
      }));

  const runtimeOptions: Parameters<typeof createTerminalRuntime>[0] = {
    workspaceCwd: resolvedWorkspaceCwd,
    projectStateDir: resolvedStateDir,
    getApiBaseUrl,
  };
  if (gitClient) {
    runtimeOptions.gitClient = gitClient;
  }

  const runtime = createTerminalRuntime(runtimeOptions);

  const pipelineRuntime = createPipelineRuntime({
    workspaceCwd: resolvedWorkspaceCwd,
    projectStateDir: resolvedStateDir,
    broadcast: (event) => runtime.broadcastEvent(event),
  });

  const scanUsageHeatmapWithDefault =
    scanUsageHeatmap ??
    ((scope: "all" | "project") => scanClaudeUsageChart(scope, resolvedWorkspaceCwd));

  const requestHandler = createApiRequestHandler({
    runtime,
    pipelineRuntime,
    workspaceCwd: resolvedWorkspaceCwd,
    projectStateDir: resolvedStateDir,
    webDistDir,
    getApiBaseUrl,
    getApiPort,
    readClaudeUsageSnapshot: readClaudeUsageSnapshotWithDefault,
    readClaudeOauthUsageSnapshot: readClaudeOauthUsageSnapshotWithDefault,
    readClaudeCliUsageSnapshot: readClaudeCliUsageSnapshotWithDefault,
    readCodexUsageSnapshot,
    readGithubRepoSummary: readGithubRepoSummaryWithDefault,
    scanUsageHeatmap: scanUsageHeatmapWithDefault,
    invalidateClaudeUsageCache,
    allowRemoteAccess,
  });

  const server = createServer(requestHandler);

  server.on(
    "upgrade",
    createUpgradeHandler({
      runtime,
      allowRemoteAccess,
    }),
  );

  return {
    server,
    async start(port = 8787, host = "127.0.0.1") {
      await new Promise<void>((resolveStart, rejectStart) => {
        server.listen(port, host, () => resolveStart());
        server.once("error", rejectStart);
      });

      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      resolvedApiBaseUrl = `http://${host}:${resolvedPort}`;

      return { host, port: resolvedPort };
    },
    async stop() {
      await pipelineRuntime.close();
      await runtime.close();
      await new Promise<void>((resolveStop, rejectStop) => {
        server.close((error) => {
          if (error) {
            rejectStop(error);
            return;
          }
          resolveStop();
        });
        server.closeAllConnections();
      });
    },
  };
};
