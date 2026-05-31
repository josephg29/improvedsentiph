import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Maximize,
  Pause,
  Play,
  RefreshCw,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";
import type { GraphNode, PipelineStageNode } from "../app/canvas/types";
import { useAgentRuntimeStates } from "../app/hooks/useAgentRuntimeStates";
import { type BuildRunInput, HUB_ID, useCanvasGraphData } from "../app/hooks/useCanvasGraphData";
import { useCanvasTransform } from "../app/hooks/useCanvasTransform";
import { useForceSimulation } from "../app/hooks/useForceSimulation";
import type { PendingDeleteTerminal } from "../app/hooks/useTerminalMutations";
import { usePipelineRuns } from "../app/pipelines/usePipelineRuns";
import {
  type TerminalRuntimeStateStore,
  createTerminalRuntimeStateStore,
} from "../app/terminalRuntimeStateStore";
import type { TerminalView } from "../app/types";
import type { Run, RunStatus } from "@sentiph/core";
import { DeleteAgentDialog } from "./DeleteAgentDialog";
import { BuildNode } from "./canvas/BuildNode";
import { CanvasTerminalColumn } from "./canvas/CanvasTerminalColumn";
import { type CreateTerminalOptions, CreateTerminalDialog } from "./canvas/CreateTerminalDialog";
import { DeleteAllTerminalsDialog } from "./canvas/DeleteAllTerminalsDialog";
import { HubNode } from "./canvas/HubNode";
import { SessionNode } from "./canvas/SessionNode";

type ContextMenuState =
  | { kind: "canvas"; x: number; y: number }
  | {
      kind: "active-session";
      x: number;
      y: number;
      nodeId: string;
      sessionId: string;
      label: string;
      workspaceMode?: string;
    };

type CreateTerminalDialogState = {
  open: boolean;
};

type CanvasPrimaryViewProps = {
  columns: TerminalView;
  runtimeStateStore?: TerminalRuntimeStateStore;
  isUiStateHydrated?: boolean;
  canvasOpenTerminalIds?: string[];
  canvasTerminalsPanelWidth?: number | null;
  recentlyCreatedTerminal?: TerminalView[number] | null;
  onCanvasOpenTerminalIdsChange?: (ids: string[]) => void;
  onCanvasTerminalsPanelWidthChange?: (width: number | null) => void;
  onCreateTerminal?: () => Promise<string | undefined> | undefined;
  onCreateWorktreeTerminal?: () => Promise<string | undefined> | undefined;
  onCreateTerminalWithOptions?: (opts: CreateTerminalOptions) => Promise<string | undefined>;
  onCloseActiveSession?: (terminalId: string, terminalName: string, workspaceMode?: string) => void;
  onDeleteActiveSession?: (
    terminalId: string,
    terminalName: string,
    workspaceMode?: string,
  ) => void;
  pendingDeleteTerminal?: PendingDeleteTerminal | null;
  isDeletingTerminalId?: string | null;
  onCancelDelete?: () => void;
  onConfirmDelete?: () => void;
  onTerminalRenamed?: ((terminalId: string, agentName: string) => void) | undefined;
  onTerminalActivity?: ((terminalId: string) => void) | undefined;
  onRefreshColumns?: () => Promise<void> | void;
};

const derivePipelineStages = (run: Run): PipelineStageNode[] => {
  const stages: PipelineStageNode[] = [];
  const { outcomes, status } = run;

  // Group outcomes by role in order of first appearance.
  const seen = new Map<string, { role: string; count: number }>();
  for (const o of outcomes) {
    const key = `${o.stageId}-${o.index}`;
    if (!seen.has(key)) {
      seen.set(key, { role: o.stageId, count: o.index });
    }
  }

  const addStage = (stageId: string, role: "build" | "check" | "fix", index: number, state: PipelineStageNode["state"]) => {
    stages.push({ stageId: `${stageId}-${index}`, role, label: roleLabel(role, index), state, index });
  };

  const roleLabel = (role: "build" | "check" | "fix", index: number): string => {
    if (role === "build") return "BUILD";
    if (role === "check") return `CHK${index > 0 ? ` ${index + 1}` : ""}`;
    return `FIX${index > 0 ? ` ${index + 1}` : ""}`;
  };

  const outcomeStateFor = (stageId: string, index: number): PipelineStageNode["state"] => {
    const match = outcomes.find((o) => o.stageId === stageId && o.index === index);
    if (!match) return "pending";
    return match.ok ? "passed" : "failed";
  };

  // Determine the running role from status.
  const runningRole: "build" | "check" | "fix" | null =
    status === "building" ? "build"
    : status === "checking" ? "check"
    : status === "fixing" ? "fix"
    : null;

  // Build stages: build first.
  const buildOutcome = outcomes.find((o) => o.stageId === "build");
  const buildState: PipelineStageNode["state"] =
    buildOutcome ? (buildOutcome.ok ? "passed" : "failed")
    : runningRole === "build" ? "running"
    : "pending";
  addStage("build", "build", 0, buildState);

  // Check and fix rounds from outcomes.
  const checkOutcomes = outcomes.filter((o) => o.stageId === "check");
  const fixOutcomes = outcomes.filter((o) => o.stageId === "fix");
  const maxCheckIndex = checkOutcomes.length > 0 ? Math.max(...checkOutcomes.map((o) => o.index)) : -1;
  const maxFixIndex = fixOutcomes.length > 0 ? Math.max(...fixOutcomes.map((o) => o.index)) : -1;

  // Render check stages from outcomes, then current running check if applicable.
  for (let i = 0; i <= maxCheckIndex; i++) {
    addStage("check", "check", i, outcomeStateFor("check", i));
  }
  if (runningRole === "check") {
    addStage("check", "check", maxCheckIndex + 1, "running");
  }

  // Fix stages.
  for (let i = 0; i <= maxFixIndex; i++) {
    addStage("fix", "fix", i, outcomeStateFor("fix", i));
  }
  if (runningRole === "fix") {
    addStage("fix", "fix", maxFixIndex + 1, "running");
  }

  return stages;
};

const CLICK_THRESHOLD = 5;
const GRAPH_MIN_WIDTH = 300;
const TERMINAL_MIN_WIDTH = 370;
const ACTIVE_SESSION_RADIUS = 12;
const HUB_NODE_ID = `a:${HUB_ID}`;
const buildActiveSessionNodeId = (terminalId: string) => `a:${terminalId}`;

const buildCanvasEdgePath = (
  source: GraphNode,
  target: GraphNode,
  edgeIndex: number,
  edgeCount: number,
): string => {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return "";

  const shortenSourceBy = source.radius + 6;
  const shortenTargetBy = target.radius + 6;
  const startRatio = Math.min(1, shortenSourceBy / dist);
  const endRatio = Math.max(0, (dist - shortenTargetBy) / dist);
  const sx = source.x + dx * startRatio;
  const sy = source.y + dy * startRatio;
  const tx = source.x + dx * endRatio;
  const ty = source.y + dy * endRatio;

  const curvature = edgeCount <= 1 ? 0.18 : (edgeIndex / (edgeCount - 1) - 0.5) * 1.2;
  const offsetRatio = edgeCount <= 1 ? 0.16 : 0.18;
  const baseOffset = Math.max(16, Math.min(32, dist * offsetRatio));
  const offsetX = (-dy / dist) * curvature * baseOffset;
  const offsetY = (dx / dist) * curvature * baseOffset;
  const cpx = (sx + tx) / 2 + offsetX;
  const cpy = (sy + ty) / 2 + offsetY;

  return `M ${sx} ${sy} Q ${cpx} ${cpy} ${tx} ${ty}`;
};

const isEdgeActivityVisible = (target: GraphNode): boolean =>
  target.type === "active-session" &&
  target.hasUserPrompt !== false &&
  target.agentRuntimeState !== undefined &&
  target.agentRuntimeState !== "idle";

const renderEdgeActivityDots = (path: string, color: string, keyPrefix: string) =>
  [0, 1, 2].flatMap((index) => [
    <circle
      key={`${keyPrefix}-trail-${index}`}
      className="canvas-edge-activity-dot canvas-edge-activity-dot--trail"
      r={4.6}
      fill={color}
      opacity={Math.max(0.14, 0.28 - index * 0.04)}
    >
      <animateMotion
        path={path}
        begin={`${index * 0.62}s`}
        dur="1.9s"
        repeatCount="indefinite"
        rotate="auto"
      />
      <animate
        attributeName="r"
        values="3.8;5.2;3.8"
        dur="1.9s"
        begin={`${index * 0.62}s`}
        repeatCount="indefinite"
      />
    </circle>,
    <circle
      key={`${keyPrefix}-dot-${index}`}
      className="canvas-edge-activity-dot"
      r={3.2}
      fill="#fff4cc"
      stroke={color}
      strokeWidth={1.2}
      opacity={Math.max(0.7, 1 - index * 0.08)}
    >
      <animateMotion
        path={path}
        begin={`${index * 0.62}s`}
        dur="1.9s"
        repeatCount="indefinite"
        rotate="auto"
      />
      <animate
        attributeName="r"
        values="2.8;3.8;2.8"
        dur="1.9s"
        begin={`${index * 0.62}s`}
        repeatCount="indefinite"
      />
    </circle>,
  ]);

export const CanvasPrimaryView = ({
  columns,
  runtimeStateStore: providedRuntimeStateStore,
  isUiStateHydrated,
  canvasOpenTerminalIds,
  canvasTerminalsPanelWidth: persistedTerminalsPanelWidth,
  recentlyCreatedTerminal,
  onCanvasOpenTerminalIdsChange,
  onCanvasTerminalsPanelWidthChange,
  onCreateTerminal,
  onCreateWorktreeTerminal,
  onCreateTerminalWithOptions,
  onCloseActiveSession,
  onDeleteActiveSession,
  pendingDeleteTerminal,
  isDeletingTerminalId,
  onCancelDelete,
  onConfirmDelete,
  onTerminalRenamed,
  onTerminalActivity,
  onRefreshColumns,
}: CanvasPrimaryViewProps) => {
  const runtimeStateStoreRef = useRef<TerminalRuntimeStateStore | null>(null);
  if (runtimeStateStoreRef.current === null) {
    runtimeStateStoreRef.current = providedRuntimeStateStore ?? createTerminalRuntimeStateStore();
  }
  const runtimeStateStore = providedRuntimeStateStore ?? runtimeStateStoreRef.current;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [createTerminalDialog, setCreateTerminalDialog] = useState<CreateTerminalDialogState | null>(null);
  const [openTerminals, setOpenTerminals] = useState<Map<string, GraphNode>>(new Map());
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [terminalsPanelWidth, setTerminalsPanelWidth] = useState<number | null>(null);
  const [pendingOpenAgentId, setPendingOpenAgentId] = useState<string | null>(null);
  const createTerminalCallbackRef = useRef<((opts: CreateTerminalOptions) => void) | null>(null);

  const openCreateTerminalDialog = useCallback(
    (onCreate: (opts: CreateTerminalOptions) => void) => {
      createTerminalCallbackRef.current = onCreate;
      setCreateTerminalDialog({ open: true });
    },
    [],
  );

  const handleCreateTerminalConfirm = useCallback(
    (opts: CreateTerminalOptions) => {
      setCreateTerminalDialog(null);
      const cb = createTerminalCallbackRef.current;
      createTerminalCallbackRef.current = null;
      cb?.(opts);
    },
    [],
  );

  const handleCreateTerminalCancel = useCallback(() => {
    setCreateTerminalDialog(null);
    createTerminalCallbackRef.current = null;
  }, []);
  const [hideIdleTerminals, setHideIdleTerminals] = useState(false);
  const hasHydratedTerminals = useRef(false);
  const lastHandledCreatedTerminalIdRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const nodeClickedRef = useRef(false);
  const dividerDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const containerRef = useRef<HTMLElement>(null);
  const terminalsPanelRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef(new Map<string, HTMLElement>());
  const lastFocusedPanelIdRef = useRef<string | null>(null);

  const agentRuntimeStates = useAgentRuntimeStates(runtimeStateStore, columns);

  // Pipeline builds the orchestrator has delegated, rendered as worker nodes.
  const { runs, runDetails, approveRun, rejectRun, cancelRun } = usePipelineRuns();
  const buildRunInputs = useMemo<BuildRunInput[]>(
    () =>
      runs.map((run) => {
        const detail: Run | undefined = runDetails[run.runId];
        return {
          runId: run.runId,
          status: run.status,
          task: run.task,
          ...(run.parentTerminalId ? { parentTerminalId: run.parentTerminalId } : {}),
          ...(detail ? { pipelineStages: derivePipelineStages(detail) } : {}),
        };
      }),
    [runs, runDetails],
  );

  const {
    nodes,
    edges,
    refresh: refreshGraphData,
  } = useCanvasGraphData({
    columns,
    agentRuntimeStates,
    runs: buildRunInputs,
  });

  const {
    transform,
    isPanning,
    svgRef,
    handleWheel,
    handlePointerDown: handleCanvasPointerDown,
    handlePointerMove: handleCanvasPointerMove,
    handlePointerUp: handleCanvasPointerUp,
    screenToGraph,
    fitAll,
  } = useCanvasTransform();

  const { simulatedNodes, pinNode, unpinNode, moveNode, reheat } = useForceSimulation({
    nodes,
    edges,
    centerX: 0,
    centerY: 0,
  });

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of simulatedNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [simulatedNodes]);

  const resolveActiveSessionNode = useCallback(
    (terminalId: string): GraphNode | null => {
      const nodeId = buildActiveSessionNodeId(terminalId);
      const existingNode = nodesById.get(nodeId);
      const terminal = columns.find((entry) => entry.terminalId === terminalId);
      if (!terminal) {
        return existingNode?.type === "active-session" ? existingNode : null;
      }

      const parentNodeId = terminal.parentTerminalId
        ? buildActiveSessionNodeId(terminal.parentTerminalId)
        : HUB_NODE_ID;
      const anchorNode =
        existingNode?.type === "active-session"
          ? existingNode
          : (nodesById.get(parentNodeId) ?? nodesById.get(HUB_NODE_ID));

      return {
        id: nodeId,
        type: "active-session",
        x: anchorNode?.x ?? 0,
        y: anchorNode?.y ?? 0,
        vx: 0,
        vy: 0,
        pinned: false,
        radius: ACTIVE_SESSION_RADIUS,
        agentId: terminal.agentId,
        label: terminal.agentName || terminal.label || terminal.terminalId,
        color: anchorNode?.color ?? "#c0c0c0",
        sessionId: terminal.terminalId,
        agentState: terminal.state,
        hasUserPrompt: terminal.hasUserPrompt ?? false,
        ...(terminal.workspaceMode ? { workspaceMode: terminal.workspaceMode } : {}),
        ...(terminal.parentTerminalId ? { parentTerminalId: terminal.parentTerminalId } : {}),
      };
    },
    [columns, nodesById],
  );

  // Hydrate open terminals after a settling delay so all async data (columns,
  // graph nodes, simulation) has time to land before we attempt the lookup.
  const [isHydratingTerminals, setIsHydratingTerminals] = useState(false);

  useEffect(() => {
    if (hasHydratedTerminals.current) return;
    if (!isUiStateHydrated) return;
    if (!canvasOpenTerminalIds || canvasOpenTerminalIds.length === 0) {
      hasHydratedTerminals.current = true;
      return;
    }

    setIsHydratingTerminals(true);
    const timer = window.setTimeout(() => {
      setIsHydratingTerminals(false);
      hasHydratedTerminals.current = true;
    }, 800);

    return () => window.clearTimeout(timer);
  }, [isUiStateHydrated, canvasOpenTerminalIds]);

  const openTerminalCount = openTerminals.size;
  useEffect(() => {
    if (isHydratingTerminals) return;
    if (!hasHydratedTerminals.current) return;
    if (openTerminalCount > 0) return;
    if (!canvasOpenTerminalIds || canvasOpenTerminalIds.length === 0) return;

    const restoredMap = new Map<string, GraphNode>();
    for (const nodeId of canvasOpenTerminalIds) {
      const node = nodesById.get(nodeId);
      if (node && node.type === "active-session") {
        restoredMap.set(nodeId, { ...node });
      }
    }
    if (restoredMap.size > 0) {
      setOpenTerminals(restoredMap);
    }

    if (persistedTerminalsPanelWidth != null && persistedTerminalsPanelWidth > 0) {
      setTerminalsPanelWidth(persistedTerminalsPanelWidth);
    }
  }, [
    isHydratingTerminals,
    openTerminalCount,
    canvasOpenTerminalIds,
    persistedTerminalsPanelWidth,
    nodesById,
  ]);

  // Persist open terminal IDs when they change
  useEffect(() => {
    if (!hasHydratedTerminals.current) return;
    onCanvasOpenTerminalIdsChange?.(Array.from(openTerminals.keys()));
  }, [openTerminals, onCanvasOpenTerminalIdsChange]);

  useEffect(() => {
    setOpenTerminals((current) => {
      let didChange = false;
      const next = new Map<string, GraphNode>();

      for (const [nodeId, node] of current) {
        if (!node.sessionId) {
          next.set(nodeId, node);
          continue;
        }

        const terminal = columns.find((entry) => entry.terminalId === node.sessionId);
        if (!terminal) {
          didChange = true;
          continue;
        }

        const nextLabel = terminal.agentName || terminal.label || terminal.terminalId;
        const nextNode: GraphNode = {
          ...node,
          agentId: terminal.agentId,
          label: nextLabel,
          agentState: terminal.state,
          hasUserPrompt: terminal.hasUserPrompt ?? false,
          ...(terminal.workspaceMode ? { workspaceMode: terminal.workspaceMode } : {}),
          ...(terminal.parentTerminalId ? { parentTerminalId: terminal.parentTerminalId } : {}),
        };

        if (
          node.label !== nextNode.label ||
          node.agentId !== nextNode.agentId ||
          node.agentState !== nextNode.agentState ||
          node.hasUserPrompt !== nextNode.hasUserPrompt ||
          node.workspaceMode !== nextNode.workspaceMode ||
          node.parentTerminalId !== nextNode.parentTerminalId
        ) {
          didChange = true;
          next.set(nodeId, nextNode);
          continue;
        }

        next.set(nodeId, node);
      }

      return didChange ? next : current;
    });
  }, [columns]);

  // Persist terminals panel width only when user has explicitly dragged the divider
  useEffect(() => {
    if (!hasHydratedTerminals.current) return;
    if (terminalsPanelWidth == null) return;
    onCanvasTerminalsPanelWidthChange?.(terminalsPanelWidth);
  }, [terminalsPanelWidth, onCanvasTerminalsPanelWidthChange]);

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      if (e.button !== 0) return;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      setDragNodeId(nodeId);
      pinNode(nodeId);
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    [pinNode, svgRef],
  );

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragNodeId) {
        const graphPos = screenToGraph(e.clientX, e.clientY);
        moveNode(dragNodeId, graphPos.x, graphPos.y);
        return;
      }
      handleCanvasPointerMove(e);
    },
    [dragNodeId, screenToGraph, moveNode, handleCanvasPointerMove],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      const node = nodesById.get(nodeId);
      if (!node) return;

      // The hub IS sentiph: clicking it opens the orchestrator terminal (the
      // top-level, no-parent session). If none exists yet, create one and
      // auto-open it once it lands in the graph.
      if (node.type === "hub") {
        const orchestrator = columns.find((entry) => !entry.parentTerminalId);
        if (orchestrator) {
          const orchestratorNodeId = buildActiveSessionNodeId(orchestrator.terminalId);
          const resolvedNode =
            resolveActiveSessionNode(orchestrator.terminalId) ?? nodesById.get(orchestratorNodeId);
          if (resolvedNode) {
            setSelectedNodeId(orchestratorNodeId);
            setOpenTerminals((prev) => {
              const next = new Map(prev);
              next.set(orchestratorNodeId, { ...resolvedNode });
              return next;
            });
          }
          return;
        }
        openCreateTerminalDialog((opts) => {
          const result = onCreateTerminalWithOptions
            ? onCreateTerminalWithOptions(opts)
            : opts.workspaceMode === "worktree"
              ? onCreateWorktreeTerminal?.()
              : onCreateTerminal?.();
          if (result && typeof result.then === "function") {
            void result.then((agentId) => {
              if (agentId) setPendingOpenAgentId(agentId);
            });
          }
        });
        return;
      }

      if (node.type === "active-session") {
        const resolvedNode = node.sessionId
          ? (resolveActiveSessionNode(node.sessionId) ?? node)
          : node;
        setOpenTerminals((prev) => {
          const next = new Map(prev);
          if (next.has(nodeId)) {
            next.delete(nodeId);
          } else {
            next.set(nodeId, { ...resolvedNode });
          }
          return next;
        });
      }
    },
    [columns, nodesById, onCreateTerminal, resolveActiveSessionNode],
  );

  const setPanelRef = useCallback(
    (nodeId: string) => (element: HTMLElement | null) => {
      if (element) {
        panelRefs.current.set(nodeId, element);
        return;
      }
      panelRefs.current.delete(nodeId);
    },
    [],
  );

  const handleMinimizeTerminal = useCallback((nodeId: string) => {
    setOpenTerminals((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
  }, []);

  const handleCloseTerminal = useCallback(
    (node: GraphNode) => {
      if (!node.sessionId) {
        return;
      }

      const terminal = columns.find((entry) => entry.terminalId === node.sessionId);
      onCloseActiveSession?.(
        node.sessionId,
        terminal?.agentName ?? node.label,
        terminal?.workspaceMode ?? node.workspaceMode,
      );
    },
    [columns, onCloseActiveSession],
  );

  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const panelEl = (e.target as HTMLElement).nextElementSibling as HTMLElement | null;
      const currentWidth = panelEl?.clientWidth ?? terminalsPanelWidth ?? 600;
      dividerDragRef.current = { startX: e.clientX, startWidth: currentWidth };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [terminalsPanelWidth],
  );

  const handleDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag) return;
    const containerWidth = containerRef.current?.clientWidth ?? 1200;
    const delta = drag.startX - e.clientX;
    const newWidth = Math.max(
      TERMINAL_MIN_WIDTH,
      Math.min(containerWidth - GRAPH_MIN_WIDTH - 6, drag.startWidth + delta),
    );
    setTerminalsPanelWidth(newWidth);
  }, []);

  const handleDividerPointerUp = useCallback(() => {
    dividerDragRef.current = null;
  }, []);

  // Convert vertical wheel to horizontal scroll only when hovering terminal headers
  useEffect(() => {
    if (!isHydratingTerminals && openTerminalCount === 0) return;
    const panel = terminalsPanelRef.current;
    if (!panel) return;
    const handler = (e: WheelEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest(".canvas-terminal-column-header")) return;
      if (e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        panel.scrollLeft += e.deltaY;
      }
    };
    panel.addEventListener("wheel", handler, { passive: false });
    return () => panel.removeEventListener("wheel", handler);
  }, [isHydratingTerminals, openTerminalCount]);

  const handleSvgPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragNodeId) {
        const start = dragStartRef.current;
        const dx = start ? e.clientX - start.x : Number.POSITIVE_INFINITY;
        const dy = start ? e.clientY - start.y : Number.POSITIVE_INFINITY;
        const wasClick = Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD;

        unpinNode(dragNodeId);
        reheat();

        if (wasClick) {
          nodeClickedRef.current = true;
          handleNodeClick(dragNodeId);
        }

        setDragNodeId(null);
        dragStartRef.current = null;
        return;
      }
      handleCanvasPointerUp(e);
    },
    [dragNodeId, unpinNode, reheat, handleCanvasPointerUp, handleNodeClick],
  );

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (nodeClickedRef.current) {
      nodeClickedRef.current = false;
      return;
    }
    if (e.target === e.currentTarget) {
      setSelectedNodeId(null);
    }
  }, []);

  const nodesByIdRef = useRef(nodesById);
  nodesByIdRef.current = nodesById;

  // Native contextmenu listener — must be native to reliably preventDefault
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handler = (e: MouseEvent) => {
      let el = e.target as Element | null;
      let nodeId: string | null = null;
      while (el && el !== svg) {
        const id = el.getAttribute("data-node-id");
        if (id) {
          nodeId = id;
          break;
        }
        el = el.parentElement;
      }
      if (!nodeId) {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ kind: "canvas", x: e.clientX, y: e.clientY });
        return;
      }
      const node = nodesByIdRef.current.get(nodeId);
      if (!node) return;

      if (node.type === "active-session" && node.sessionId) {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          kind: "active-session",
          x: e.clientX,
          y: e.clientY,
          nodeId: node.id,
          sessionId: node.sessionId,
          label: node.label,
          ...(node.workspaceMode ? { workspaceMode: node.workspaceMode } : {}),
        });
      }
    };

    svg.addEventListener("contextmenu", handler);
    return () => svg.removeEventListener("contextmenu", handler);
  }, [svgRef]);

  // Auto-open terminal for newly created agent once it appears in the graph
  useEffect(() => {
    if (!pendingOpenAgentId) return;
    const nodeId = buildActiveSessionNodeId(pendingOpenAgentId);
    const node = resolveActiveSessionNode(pendingOpenAgentId);
    if (!node) return;
    setPendingOpenAgentId(null);
    setSelectedNodeId(nodeId);
    setOpenTerminals((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { ...node });
      return next;
    });
  }, [pendingOpenAgentId, resolveActiveSessionNode]);

  useEffect(() => {
    if (!isUiStateHydrated || !recentlyCreatedTerminal) {
      return;
    }
    if (lastHandledCreatedTerminalIdRef.current === recentlyCreatedTerminal.terminalId) {
      return;
    }
    if (!recentlyCreatedTerminal.parentTerminalId) {
      lastHandledCreatedTerminalIdRef.current = recentlyCreatedTerminal.terminalId;
      return;
    }
    if (!openTerminals.has(buildActiveSessionNodeId(recentlyCreatedTerminal.parentTerminalId))) {
      lastHandledCreatedTerminalIdRef.current = recentlyCreatedTerminal.terminalId;
      return;
    }

    const nodeId = buildActiveSessionNodeId(recentlyCreatedTerminal.terminalId);
    const node = resolveActiveSessionNode(recentlyCreatedTerminal.terminalId);
    if (!node) {
      return;
    }

    lastHandledCreatedTerminalIdRef.current = recentlyCreatedTerminal.terminalId;
    setSelectedNodeId(nodeId);
    setOpenTerminals((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { ...node });
      return next;
    });
  }, [isUiStateHydrated, openTerminals, recentlyCreatedTerminal, resolveActiveSessionNode]);

  useEffect(() => {
    if (!selectedNodeId) {
      lastFocusedPanelIdRef.current = null;
      return;
    }
    if (!openTerminals.has(selectedNodeId)) {
      if (lastFocusedPanelIdRef.current === selectedNodeId) {
        lastFocusedPanelIdRef.current = null;
      }
      return;
    }
    if (lastFocusedPanelIdRef.current === selectedNodeId) {
      return;
    }

    const panel = panelRefs.current.get(selectedNodeId);
    if (!panel) {
      return;
    }

    lastFocusedPanelIdRef.current = selectedNodeId;
    const rafId = window.requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      panel.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [selectedNodeId, openTerminals]);

  const hubNodes = simulatedNodes.filter((n) => n.type === "hub");
  const sessionNodes = simulatedNodes.filter((n) => {
    if (n.type !== "active-session") return false;
    if (hideIdleTerminals && (n.agentState === "idle" || n.hasUserPrompt === false)) return false;
    return true;
  });
  const buildNodes = simulatedNodes.filter((n) => n.type === "build");
  const buildEdges = edges
    .map((edge) => {
      const target = nodesById.get(edge.target);
      const source = nodesById.get(edge.source);
      if (!source || !target || target.type !== "build") {
        return null;
      }
      return { source, target };
    })
    .filter((edge): edge is { source: GraphNode; target: GraphNode } => edge !== null);

  const handleFitView = useCallback(() => {
    fitAll(simulatedNodes);
  }, [fitAll, simulatedNodes]);

  const handleRefresh = useCallback(() => {
    if (onRefreshColumns) {
      const result = onRefreshColumns();
      if (result && typeof result.then === "function") {
        void result.finally(() => {
          refreshGraphData();
        });
        return;
      }
    }
    refreshGraphData();
  }, [onRefreshColumns, refreshGraphData]);

  const waitingNodes = simulatedNodes.filter(
    (n) =>
      n.type === "active-session" &&
      (n.agentRuntimeState === "waiting_for_permission" ||
        n.agentRuntimeState === "waiting_for_user"),
  );

  const sessionEdges = edges
    .map((edge) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      if (!source || !target) {
        return null;
      }
      if (source.type !== "active-session" || target.type !== "active-session") {
        return null;
      }
      if (
        hideIdleTerminals &&
        (source.agentState === "idle" ||
          source.hasUserPrompt === false ||
          target.agentState === "idle" ||
          target.hasUserPrompt === false)
      ) {
        return null;
      }
      return { source, target };
    })
    .filter((edge): edge is { source: GraphNode; target: GraphNode } => edge !== null);

  const sessionEdgesBySource = new Map<string, { source: GraphNode; target: GraphNode }[]>();
  for (const edge of sessionEdges) {
    const group = sessionEdgesBySource.get(edge.source.id);
    if (group) {
      group.push(edge);
    } else {
      sessionEdgesBySource.set(edge.source.id, [edge]);
    }
  }

  const hasPanels = isHydratingTerminals || openTerminals.size > 0;
  const terminalLayoutVersion = useMemo(() => {
    const openIds = Array.from(openTerminals.keys()).join("|");
    return `${openIds}::${terminalsPanelWidth ?? "auto"}`;
  }, [openTerminals, terminalsPanelWidth]);

  return (
    <section ref={containerRef} className="canvas-view" aria-label="Canvas graph view">
      <div className={`canvas-graph-panel${hasPanels ? " canvas-graph-panel--split" : ""}`}>
        <svg
          aria-label="Canvas graph"
          ref={svgRef}
          className={`canvas-svg${isPanning || dragNodeId ? " canvas-svg--panning" : ""}`}
          onWheel={handleWheel}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onClick={handleSvgClick}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setContextMenu(null);
              setSelectedNodeId(null);
              return;
            }
            if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
              e.preventDefault();
              setSelectedNodeId(null);
            }
          }}
        >
          <title>Canvas graph</title>
          <g
            transform={`translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scale})`}
          >
            {Array.from(sessionEdgesBySource.entries()).flatMap(([sourceId, group]) =>
              group.map(({ source, target }, index) => {
                const active = selectedNodeId === source.id || selectedNodeId === target.id;
                const selectedColor = selectedNodeId
                  ? (nodesById.get(selectedNodeId)?.color ?? null)
                  : null;
                const path = buildCanvasEdgePath(source, target, index, group.length);

                return (
                  <g key={`${sourceId}->${target.id}`}>
                    <path
                      className="canvas-edge"
                      d={path}
                      fill="none"
                      stroke={active ? (selectedColor ?? source.color) : "#C0C0C0"}
                      strokeWidth={active ? 2 : 1.5}
                      strokeOpacity={1}
                    />
                    {isEdgeActivityVisible(target)
                      ? renderEdgeActivityDots(
                          path,
                          active ? (selectedColor ?? source.color) : source.color,
                          `${sourceId}->${target.id}`,
                        )
                      : null}
                  </g>
                );
              }),
            )}

            {/* Render the hub node (with its edges) first */}
            {hubNodes.map((node) => {
              const connected = edges
                .filter((e) => e.source === node.id)
                .map((e) => nodesById.get(e.target))
                .filter((n): n is GraphNode => {
                  if (!n) return false;
                  if (hideIdleTerminals && (n.agentState === "idle" || n.hasUserPrompt === false))
                    return false;
                  return true;
                });

              const selectedColor = selectedNodeId
                ? (nodesById.get(selectedNodeId)?.color ?? null)
                : null;

              return (
                <HubNode
                  key={node.id}
                  node={node}
                  connectedNodes={connected}
                  isSelected={selectedNodeId === node.id}
                  selectedNodeId={selectedNodeId}
                  selectedNodeColor={selectedColor}
                  onPointerDown={handleNodePointerDown}
                  onClick={handleNodeClick}
                />
              );
            })}

            {/* Render session nodes on top */}
            {sessionNodes.map((node) => (
              <SessionNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onPointerDown={handleNodePointerDown}
                onClick={handleNodeClick}
              />
            ))}

            {/* Build edges (orchestrator → its pipeline builds) */}
            {buildEdges.map(({ source, target }) => (
              <line
                key={`${source.id}->${target.id}`}
                className="canvas-build-edge"
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={target.color}
                strokeWidth={1.4}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
              />
            ))}

            {/* Build nodes (pipeline runs as the orchestrator's workers) */}
            {buildNodes.map((node) => (
              <BuildNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onPointerDown={handleNodePointerDown}
                onClick={handleNodeClick}
                onApprove={(runId) => void approveRun(runId)}
                onReject={(runId) => void rejectRun(runId)}
                onCancel={(runId) => void cancelRun(runId)}
              />
            ))}
          </g>
        </svg>

        {/* Canvas toolbar — top-left action buttons */}
        <div className="canvas-toolbar" role="toolbar" aria-label="Canvas actions">
          <button
            type="button"
            className="canvas-toolbar-btn"
            onClick={() =>
              openCreateTerminalDialog((opts) => {
                const result = onCreateTerminalWithOptions
                  ? onCreateTerminalWithOptions(opts)
                  : opts.workspaceMode === "worktree"
                    ? onCreateWorktreeTerminal?.()
                    : onCreateTerminal?.();
                if (result && typeof result.then === "function") {
                  void result.then((agentId) => {
                    if (agentId) setPendingOpenAgentId(agentId);
                  });
                }
              })
            }
          >
            <span className="canvas-toolbar-icon">
              <TerminalIcon size={14} />
            </span>
            <span className="canvas-toolbar-label">New Agent</span>
          </button>
          <div className="canvas-toolbar-separator" />
          <button type="button" className="canvas-toolbar-btn" onClick={handleFitView}>
            <span className="canvas-toolbar-icon">
              <Maximize size={14} />
            </span>
            <span className="canvas-toolbar-label">Fit</span>
          </button>
          <button type="button" className="canvas-toolbar-btn" onClick={handleRefresh}>
            <span className="canvas-toolbar-icon">
              <RefreshCw size={14} />
            </span>
            <span className="canvas-toolbar-label">Refresh</span>
          </button>
          <div className="canvas-toolbar-separator" />
          <button
            type="button"
            className={`canvas-toolbar-btn${hideIdleTerminals ? " canvas-toolbar-btn--active" : ""}`}
            onClick={() => setHideIdleTerminals((prev) => !prev)}
          >
            <span className="canvas-toolbar-icon">
              {hideIdleTerminals ? <Play size={14} /> : <Pause size={14} />}
            </span>
            <span className="canvas-toolbar-label">
              {hideIdleTerminals ? "Show Idle" : "Hide Idle"}
            </span>
          </button>
          <div className="canvas-toolbar-separator" />
          <button
            type="button"
            className="canvas-toolbar-btn canvas-toolbar-btn--danger"
            onClick={() => setIsDeleteAllDialogOpen(true)}
          >
            <span className="canvas-toolbar-icon">
              <Trash2 size={14} />
            </span>
            <span className="canvas-toolbar-label">Delete All</span>
          </button>
        </div>

        {/* Waiting notifications — compact bars below the toolbar */}
        {waitingNodes.length > 0 && (
          <div className="canvas-waiting-list">
            {waitingNodes.map((node) => {
              const nameRaw = node.label;
              const name = nameRaw.length > 20 ? `${nameRaw.slice(0, 20)}…` : nameRaw;
              const prefix =
                node.agentRuntimeState === "waiting_for_permission"
                  ? `${node.waitingToolName ?? "Permission"}: `
                  : "Waiting: ";
              return (
                <button
                  key={node.id}
                  type="button"
                  className="canvas-waiting-bar"
                  onClick={() => handleNodeClick(node.id)}
                >
                  <span className="canvas-waiting-bar-name">
                    <span className="canvas-waiting-bar-prefix">{prefix}</span>
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {hasPanels && (
        <>
          <div
            className="canvas-panel-divider"
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
          />
          <div
            ref={terminalsPanelRef}
            className="canvas-terminals-panel"
            style={
              terminalsPanelWidth != null ? { flex: `0 0 ${terminalsPanelWidth}px` } : undefined
            }
          >
            {isHydratingTerminals && openTerminals.size === 0 && (
              <div className="canvas-terminal-skeleton">
                <div className="canvas-terminal-skeleton__header" />
                <div className="canvas-terminal-skeleton__body">
                  <div className="canvas-terminal-skeleton__line" style={{ width: "60%" }} />
                  <div className="canvas-terminal-skeleton__line" style={{ width: "80%" }} />
                  <div className="canvas-terminal-skeleton__line" style={{ width: "45%" }} />
                </div>
              </div>
            )}
            {Array.from(openTerminals.entries()).map(([nodeId, node]) => (
              <CanvasTerminalColumn
                key={nodeId}
                node={node}
                terminals={columns}
                layoutVersion={terminalLayoutVersion}
                isFocused={selectedNodeId === nodeId}
                panelRef={setPanelRef(nodeId)}
                onMinimize={() => handleMinimizeTerminal(nodeId)}
                onClose={() => handleCloseTerminal(node)}
                onFocus={() => setSelectedNodeId(nodeId)}
                onTerminalRenamed={onTerminalRenamed}
                onTerminalActivity={onTerminalActivity}
              />
            ))}
          </div>
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            aria-label="Close canvas context menu"
            className="canvas-context-menu-backdrop"
            onClick={() => setContextMenu(null)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " " && e.key !== "Escape") return;
              e.preventDefault();
              setContextMenu(null);
            }}
            role="button"
            tabIndex={0}
          />
          <div
            className="canvas-context-menu"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            {contextMenu.kind === "canvas" && (
              <>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => {
                    setContextMenu(null);
                    openCreateTerminalDialog((opts) => {
                      const result = onCreateTerminalWithOptions
                        ? onCreateTerminalWithOptions(opts)
                        : opts.workspaceMode === "worktree"
                          ? onCreateWorktreeTerminal?.()
                          : onCreateTerminal?.();
                      if (result && typeof result.then === "function") {
                        void result.then((agentId) => {
                          if (agentId) setPendingOpenAgentId(agentId);
                        });
                      }
                    });
                  }}
                >
                  <span className="canvas-context-menu-icon">
                    <TerminalIcon size={14} />
                  </span>
                  New Agent
                </button>
              </>
            )}
            {contextMenu.kind === "active-session" && (
              <button
                type="button"
                className="canvas-context-menu-item canvas-context-menu-item--danger"
                onClick={() => {
                  onDeleteActiveSession?.(
                    contextMenu.sessionId,
                    contextMenu.label,
                    contextMenu.workspaceMode,
                  );
                  setContextMenu(null);
                }}
              >
                <span className="canvas-context-menu-icon">
                  <Trash2 size={14} />
                </span>
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {pendingDeleteTerminal && onCancelDelete && onConfirmDelete && (
        <div className="canvas-delete-dialog">
          <DeleteAgentDialog
            pendingDeleteTerminal={pendingDeleteTerminal}
            isDeletingTerminalId={isDeletingTerminalId ?? null}
            onCancel={onCancelDelete}
            onConfirmDelete={onConfirmDelete}
          />
        </div>
      )}

      {isDeleteAllDialogOpen && (
        <div className="canvas-delete-dialog">
          <DeleteAllTerminalsDialog
            columns={columns}
            nodes={nodes}
            onCancel={() => setIsDeleteAllDialogOpen(false)}
            onDeleted={({ hadFailures }) => {
              if (!hadFailures) {
                setIsDeleteAllDialogOpen(false);
              }
              setOpenTerminals(new Map());
              void onRefreshColumns?.();
              refreshGraphData();
            }}
          />
        </div>
      )}

      {createTerminalDialog?.open && (
        <CreateTerminalDialog
          onConfirm={handleCreateTerminalConfirm}
          onCancel={handleCreateTerminalCancel}
        />
      )}
    </section>
  );
};
