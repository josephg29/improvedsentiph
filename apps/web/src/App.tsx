import { type TerminalSnapshot, buildTerminalList, isAgentRuntimeState } from "@sentiph/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { useBackendLivenessPolling } from "./app/hooks/useBackendLivenessPolling";
import { HUB_ID } from "./app/hooks/useCanvasGraphData";
import { useClaudeUsagePolling } from "./app/hooks/useClaudeUsagePolling";
import { useConsoleKeyboardShortcuts } from "./app/hooks/useConsoleKeyboardShortcuts";
import { useGitHubPrimaryViewModel } from "./app/hooks/useGitHubPrimaryViewModel";
import { useGithubSummaryPolling } from "./app/hooks/useGithubSummaryPolling";
import { useInitialColumnsHydration } from "./app/hooks/useInitialColumnsHydration";
import { usePersistedUiState } from "./app/hooks/usePersistedUiState";
import { useTerminalCompletionNotification } from "./app/hooks/useTerminalCompletionNotification";
import { useTerminalMutations } from "./app/hooks/useTerminalMutations";
import { useTerminalStateReconciliation } from "./app/hooks/useTerminalStateReconciliation";
import { useUsageHeatmapPolling } from "./app/hooks/useUsageHeatmapPolling";
import {
  createTerminalRuntimeStateStore,
  getTerminalRuntimeStateInfo,
  stripTerminalRuntimeState,
  stripTerminalRuntimeStates,
} from "./app/terminalRuntimeStateStore";
import type { TerminalView } from "./app/types";
import { ConsolePrimaryNav } from "./components/ConsolePrimaryNav";
import { PrimaryViewRouter } from "./components/PrimaryViewRouter";
import { RuntimeStatusStrip } from "./components/RuntimeStatusStrip";
import { TelemetryTickerTape } from "./components/TelemetryTickerTape";
import { HttpTerminalSnapshotReader } from "./runtime/HttpTerminalSnapshotReader";
import {
  buildTerminalEventsSocketUrl,
  buildTerminalSnapshotsUrl,
} from "./runtime/runtimeEndpoints";

export const App = () => {
  const [terminals, setTerminals] = useState<TerminalView>([]);
  const [recentlyCreatedTerminal, setRecentlyCreatedTerminal] = useState<
    TerminalView[number] | null
  >(null);
  const [, setIsLoading] = useState(true);
  const [, setLoadError] = useState<string | null>(null);
  const [hoveredGitHubOverviewPointIndex, setHoveredGitHubOverviewPointIndex] = useState<
    number | null
  >(null);
  const terminalEventsRefreshTimerRef = useRef<number | null>(null);
  const runtimeStateStoreRef = useRef(createTerminalRuntimeStateStore());
  const runtimeStateStore = runtimeStateStoreRef.current;

  const sortTerminalSnapshots = useCallback(
    (snapshots: TerminalView) =>
      [...snapshots].sort((left, right) => {
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }),
    [],
  );

  const {
    activePrimaryNav,
    setActivePrimaryNav,
    applyHydratedUiState,
    isRuntimeStatusStripVisible,
    isMonitorVisible,
    setIsMonitorVisible,
    isBottomTelemetryVisible,
    isUiStateHydrated,
    readUiState,
    setIsRuntimeStatusStripVisible,
    setIsUiStateHydrated,
    setMinimizedTerminalIds,
    setTerminalCompletionSound,
    terminalCompletionSound,
    canvasOpenTerminalIds,
    setCanvasOpenTerminalIds,
    canvasTerminalsPanelWidth,
    setCanvasTerminalsPanelWidth,
  } = usePersistedUiState({ columns: terminals });

  const readColumns = useCallback(
    async (signal?: AbortSignal) => {
      const readerOptions: { endpoint: string; signal?: AbortSignal } = {
        endpoint: buildTerminalSnapshotsUrl(),
      };
      if (signal) {
        readerOptions.signal = signal;
      }
      const reader = new HttpTerminalSnapshotReader(readerOptions);
      const nextColumns = await buildTerminalList(reader);
      runtimeStateStore.syncFromTerminals(nextColumns);
      return stripTerminalRuntimeStates(nextColumns);
    },
    [runtimeStateStore],
  );

  const refreshColumns = useCallback(async () => {
    const nextColumns = await readColumns();
    setTerminals(nextColumns);
    return nextColumns;
  }, [readColumns]);

  const {
    clearPendingDeleteTerminal,
    confirmDeleteTerminal,
    createTerminal,
    isDeletingTerminalId,
    pendingDeleteTerminal,
    requestDeleteTerminal,
  } = useTerminalMutations({
    readColumns: async () => readColumns(),
    setColumns: setTerminals,
    setLoadError,
    setMinimizedTerminalIds,
  });

  useInitialColumnsHydration({
    readColumns,
    readUiState,
    applyHydratedUiState,
    setColumns: setTerminals,
    setLoadError,
    setIsLoading,
    setIsUiStateHydrated,
  });

  useEffect(() => {
    return () => {
      if (terminalEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(terminalEventsRefreshTimerRef.current);
        terminalEventsRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket(buildTerminalEventsSocketUrl());

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as
          | {
              type?: unknown;
              snapshot?: TerminalSnapshot;
              terminalId?: string;
              agentRuntimeState?: string;
              toolName?: string;
            }
          | undefined;
        if (!payload || typeof payload.type !== "string") {
          return;
        }

        if (payload.type === "terminal-created" || payload.type === "terminal-updated") {
          if (!payload.snapshot) {
            return;
          }
          const runtimeState = getTerminalRuntimeStateInfo(payload.snapshot);
          runtimeStateStore.setRuntimeState(payload.snapshot.terminalId, runtimeState);
          const structuralSnapshot = stripTerminalRuntimeState(payload.snapshot);
          if (payload.type === "terminal-created") {
            setRecentlyCreatedTerminal(structuralSnapshot as TerminalView[number]);
          }
          setTerminals((current) =>
            sortTerminalSnapshots([
              ...current.filter(
                (terminal) => terminal.terminalId !== structuralSnapshot.terminalId,
              ),
              structuralSnapshot,
            ]),
          );
          return;
        }

        if (payload.type === "terminal-state-changed") {
          if (!payload.terminalId || !isAgentRuntimeState(payload.agentRuntimeState)) {
            return;
          }
          runtimeStateStore.setRuntimeState(payload.terminalId, {
            state: payload.agentRuntimeState,
            ...(payload.toolName ? { toolName: payload.toolName } : {}),
          });
          return;
        }

        if (payload.type === "terminal-deleted") {
          if (!payload.terminalId) {
            return;
          }
          runtimeStateStore.removeTerminal(payload.terminalId);
          setTerminals((current) =>
            current.filter((terminal) => terminal.terminalId !== payload.terminalId),
          );
          return;
        }

        if (payload.type !== "terminal-list-changed") {
          return;
        }
      } catch {
        return;
      }

      if (terminalEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(terminalEventsRefreshTimerRef.current);
      }
      terminalEventsRefreshTimerRef.current = window.setTimeout(() => {
        terminalEventsRefreshTimerRef.current = null;
        void refreshColumns();
      }, 100);
    });

    return () => {
      if (terminalEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(terminalEventsRefreshTimerRef.current);
        terminalEventsRefreshTimerRef.current = null;
      }
      socket.close();
    };
  }, [refreshColumns, runtimeStateStore, sortTerminalSnapshots]);

  const { claudeUsageSnapshot, isRefreshingClaudeUsage, refreshClaudeUsage } =
    useClaudeUsagePolling();
  useBackendLivenessPolling();
  const { githubRepoSummary, isRefreshingGitHubSummary, refreshGitHubRepoSummary } =
    useGithubSummaryPolling();

  const handleActiveTerminalIdsChange = useCallback(
    (activeTerminalIds: ReadonlySet<string>) => {
      runtimeStateStore.retainTerminalIds(activeTerminalIds);
    },
    [runtimeStateStore],
  );

  useTerminalStateReconciliation({
    columns: terminals,
    setMinimizedTerminalIds,
    onActiveTerminalIdsChange: handleActiveTerminalIdsChange,
  });
  const { playCompletionSoundPreview } = useTerminalCompletionNotification(
    runtimeStateStore,
    terminalCompletionSound,
  );
  const { heatmapData, isLoadingHeatmap, refreshHeatmap } = useUsageHeatmapPolling({
    enabled: isUiStateHydrated && activePrimaryNav === 3,
  });

  useConsoleKeyboardShortcuts({ setActivePrimaryNav });

  const {
    githubCommitCount30d,
    sparklinePoints,
    githubOverviewGraphSeries,
    githubOverviewGraphPolylinePoints,
    githubOverviewHoverLabel,
    githubStatusPill,
    githubRepoLabel,
    githubStarCountLabel,
    githubOpenIssuesLabel,
    githubOpenPrsLabel,
    githubRecentCommits,
  } = useGitHubPrimaryViewModel({
    githubRepoSummary,
    hoveredGitHubOverviewPointIndex,
    setHoveredGitHubOverviewPointIndex,
  });

  const handleTerminalRenamed = useCallback((terminalId: string, agentName: string) => {
    setTerminals((current) =>
      current.map((t) =>
        t.terminalId === terminalId ? { ...t, agentName, label: agentName } : t,
      ),
    );
  }, []);

  const handleTerminalActivity = useCallback((terminalId: string) => {
    setTerminals((current) =>
      current.map((t) => (t.terminalId === terminalId ? { ...t, hasUserPrompt: true } : t)),
    );
  }, []);

  return (
    <div className="page console-shell">
      {isRuntimeStatusStripVisible && (
        <RuntimeStatusStrip
          claudeUsage={claudeUsageSnapshot}
          isRefreshingClaudeUsage={isRefreshingClaudeUsage}
          onRefreshClaudeUsage={refreshClaudeUsage}
          githubSparklinePoints={sparklinePoints}
        />
      )}

      <ConsolePrimaryNav
        activePrimaryNav={activePrimaryNav}
        onPrimaryNavChange={setActivePrimaryNav}
      />

      <section className="console-main-canvas" aria-label="Main content canvas">
        <div className="workspace-shell workspace-shell--full">
          <PrimaryViewRouter
            activePrimaryNav={activePrimaryNav}
            activityPrimaryViewProps={{
              usageChartProps: {
                data: heatmapData,
                isLoading: isLoadingHeatmap,
                onRefresh: refreshHeatmap,
              },
              githubPrimaryViewProps: {
                githubCommitCount30d,
                githubOpenIssuesLabel,
                githubOpenPrsLabel,
                githubRecentCommits,
                githubOverviewGraphPolylinePoints,
                githubOverviewGraphSeries,
                githubOverviewHoverLabel,
                githubRepoLabel,
                githubStarCountLabel,
                githubStatusPill,
                hoveredGitHubOverviewPointIndex,
                isRefreshingGitHubSummary,
                onHoveredGitHubOverviewPointIndexChange: setHoveredGitHubOverviewPointIndex,
                onRefresh: () => {
                  void refreshGitHubRepoSummary();
                },
              },
            }}
            settingsPrimaryViewProps={{
              isRuntimeStatusStripVisible,
              isMonitorVisible,
              onRuntimeStatusStripVisibilityChange: setIsRuntimeStatusStripVisible,
              onMonitorVisibilityChange: setIsMonitorVisible,
              onPreviewTerminalCompletionSound: playCompletionSoundPreview,
              onTerminalCompletionSoundChange: setTerminalCompletionSound,
              terminalCompletionSound,
            }}
            canvasPrimaryViewProps={{
              columns: terminals,
              runtimeStateStore,
              isUiStateHydrated,
              recentlyCreatedTerminal,
              canvasOpenTerminalIds,
              canvasTerminalsPanelWidth,
              onCanvasOpenTerminalIdsChange: setCanvasOpenTerminalIds,
              onCanvasTerminalsPanelWidthChange: setCanvasTerminalsPanelWidth,
              onCreateTerminal: async () => {
                return await createTerminal("shared", undefined, HUB_ID);
              },
              onCreateWorktreeTerminal: async () => {
                return await createTerminal("worktree", undefined, HUB_ID);
              },
              onCreateTerminalWithOptions: async ({ workspaceMode, model, effort }) => {
                return await createTerminal(workspaceMode, undefined, HUB_ID, model, effort);
              },
              onCloseActiveSession: (terminalId, terminalName, workspaceMode) => {
                requestDeleteTerminal(terminalId, terminalName, {
                  workspaceMode: workspaceMode === "worktree" ? "worktree" : "shared",
                  intent: "close-terminal",
                });
              },
              onDeleteActiveSession: (terminalId, terminalName, workspaceMode) => {
                requestDeleteTerminal(terminalId, terminalName, {
                  workspaceMode: workspaceMode === "worktree" ? "worktree" : "shared",
                  intent: "delete-terminal",
                });
              },
              pendingDeleteTerminal,
              isDeletingTerminalId,
              onCancelDelete: clearPendingDeleteTerminal,
              onConfirmDelete: () => {
                void confirmDeleteTerminal();
              },
              onTerminalRenamed: handleTerminalRenamed,
              onTerminalActivity: handleTerminalActivity,
              onRefreshColumns: async () => {
                await refreshColumns();
              },
            }}
          />
        </div>
      </section>

      {isBottomTelemetryVisible && <TelemetryTickerTape />}
    </div>
  );
};
