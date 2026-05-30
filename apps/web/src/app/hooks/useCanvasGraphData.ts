import { useRef } from "react";

import type { GraphEdge, GraphNode } from "../canvas/types";
import type { TerminalView } from "../types";
import type { AgentRuntimeStateInfo } from "./useAgentRuntimeStates";

const ACTIVE_SESSION_RADIUS = 12;
const HUB_RADIUS = 52;

export const HUB_ID = "__hub__";
const HUB_NODE_ID = `a:${HUB_ID}`;

const getAccentPrimary = (): string =>
  (typeof document !== "undefined"
    ? getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim()
    : "") || "#111";

// Stable per-agent colors so each session circle reads as its own node.
const AGENT_COLORS = [
  "#1e59a3",
  "#25a244",
  "#b87000",
  "#880f1e",
  "#6d28d9",
  "#0e7490",
  "#be185d",
  "#4d7c0f",
];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const agentColor = (id: string): string =>
  AGENT_COLORS[hashString(id) % AGENT_COLORS.length] as string;

type UseCanvasGraphDataOptions = {
  columns: TerminalView;
  enabled?: boolean;
  agentRuntimeStates?: Map<string, AgentRuntimeStateInfo>;
  runs?: BuildRunInput[];
};

type UseCanvasGraphDataResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  refresh: () => Promise<void>;
};

export type BuildRunInput = {
  runId: string;
  status: import("@sentiph/core").RunStatus;
  task: string;
  parentTerminalId?: string;
};

const BUILD_NODE_RADIUS = 10;

const buildActiveSessionNodeId = (terminalId: string) => `a:${terminalId}`;
const buildRunNodeId = (runId: string) => `b:${runId}`;

const runStatusColor = (status: BuildRunInput["status"]): string => {
  switch (status) {
    case "passed":
      return "#25a244";
    case "failed":
      return "#880f1e";
    case "completed_with_issues":
    case "awaiting_approval":
      return "#b87000";
    case "building":
    case "checking":
    case "fixing":
      return "#1e59a3";
    default:
      return "#9ca3af";
  }
};

// Builds the canvas graph: a single always-present "hub" node with one
// color-coded circle per active agent/session. Swarm children link to their
// spawning agent; every other agent links straight to the hub.
export const useCanvasGraphData = ({
  columns,
  agentRuntimeStates,
  runs,
}: UseCanvasGraphDataOptions): UseCanvasGraphDataResult => {
  const prevNodesRef = useRef<Map<string, GraphNode>>(new Map());
  const prevNodes = prevNodesRef.current;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const currentNodesById = new Map<string, GraphNode>();

  // Hub — synthetic always-present root node every agent connects to.
  const prevHub = prevNodes.get(HUB_NODE_ID);
  const hubNode: GraphNode = {
    id: HUB_NODE_ID,
    type: "hub",
    x: prevHub?.x ?? 0,
    y: prevHub?.y ?? 0,
    vx: prevHub?.vx ?? 0,
    vy: prevHub?.vy ?? 0,
    pinned: prevHub?.pinned ?? false,
    radius: HUB_RADIUS,
    agentId: HUB_ID,
    label: "sentiph",
    color: getAccentPrimary(),
  };
  nodes.push(hubNode);
  currentNodesById.set(HUB_NODE_ID, hubNode);

  for (const terminal of columns) {
    const sessionNodeId = buildActiveSessionNodeId(terminal.terminalId);
    const parentNodeId = terminal.parentTerminalId
      ? buildActiveSessionNodeId(terminal.parentTerminalId)
      : HUB_NODE_ID;
    const parentNode = currentNodesById.get(parentNodeId) ?? hubNode;
    const prev = prevNodes.get(sessionNodeId);
    const jitter = () => (Math.random() - 0.5) * 60;
    const runtimeInfo = agentRuntimeStates?.get(terminal.terminalId);

    const sessionNode: GraphNode = {
      id: sessionNodeId,
      type: "active-session",
      x: prev?.x ?? parentNode.x + jitter(),
      y: prev?.y ?? parentNode.y + jitter(),
      vx: prev?.vx ?? 0,
      vy: prev?.vy ?? 0,
      pinned: prev?.pinned ?? false,
      radius: terminal.isGroupLeader ? ACTIVE_SESSION_RADIUS + 5 : ACTIVE_SESSION_RADIUS,
      agentId: terminal.agentId,
      label: terminal.agentName || terminal.terminalId,
      color: terminal.color || agentColor(terminal.terminalId),
      sessionId: terminal.terminalId,
      agentState: terminal.state,
      hasUserPrompt: terminal.hasUserPrompt ?? false,
      ...(terminal.workspaceMode ? { workspaceMode: terminal.workspaceMode } : {}),
      ...(terminal.parentTerminalId ? { parentTerminalId: terminal.parentTerminalId } : {}),
      ...(runtimeInfo ? { agentRuntimeState: runtimeInfo.state } : {}),
      ...(runtimeInfo?.toolName ? { waitingToolName: runtimeInfo.toolName } : {}),
    };
    nodes.push(sessionNode);
    currentNodesById.set(sessionNodeId, sessionNode);
    edges.push({ source: parentNodeId, target: sessionNodeId });
  }

  // Pipeline builds: a worker run (build → check → fix) under its orchestrator.
  for (const run of runs ?? []) {
    const runNodeId = buildRunNodeId(run.runId);
    const parentNodeId = run.parentTerminalId
      ? buildActiveSessionNodeId(run.parentTerminalId)
      : HUB_NODE_ID;
    const parentNode = currentNodesById.get(parentNodeId) ?? hubNode;
    const prev = prevNodes.get(runNodeId);
    const jitter = () => (Math.random() - 0.5) * 60;
    const buildNode: GraphNode = {
      id: runNodeId,
      type: "build",
      x: prev?.x ?? parentNode.x + jitter(),
      y: prev?.y ?? parentNode.y + jitter(),
      vx: prev?.vx ?? 0,
      vy: prev?.vy ?? 0,
      pinned: prev?.pinned ?? false,
      radius: BUILD_NODE_RADIUS,
      agentId: run.runId,
      label: run.task,
      color: runStatusColor(run.status),
      runId: run.runId,
      runStatus: run.status,
      ...(run.parentTerminalId ? { parentTerminalId: run.parentTerminalId } : {}),
    };
    nodes.push(buildNode);
    currentNodesById.set(runNodeId, buildNode);
    edges.push({ source: parentNodeId, target: runNodeId });
  }

  const nextMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    nextMap.set(node.id, node);
  }
  prevNodesRef.current = nextMap;

  return { nodes, edges, refresh: async () => {} };
};
