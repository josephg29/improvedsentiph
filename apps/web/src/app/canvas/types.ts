import type { AgentRuntimeState, AgentState, AgentWorkspaceMode, RunStatus } from "@sentiph/core";

export type GraphNode = {
  id: string;
  type: "hub" | "active-session" | "build";
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  radius: number;
  agentId: string;
  label: string;
  color: string;
  sessionId?: string;
  agentState?: AgentState;
  agentRuntimeState?: AgentRuntimeState;
  waitingToolName?: string;
  hasUserPrompt?: boolean;
  workspaceMode?: AgentWorkspaceMode;
  parentTerminalId?: string;
  runId?: string;
  runStatus?: RunStatus;
};

export type GraphEdge = {
  source: string;
  target: string;
};
