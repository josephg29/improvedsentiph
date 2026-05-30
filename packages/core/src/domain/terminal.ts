import type { AgentRuntimeState } from "./agentRuntime";

export type AgentState = "live" | "idle" | "queued" | "blocked" | "stopped" | "exited" | "stale";
export type TerminalLifecycleState = "registered" | "running" | "stopped" | "exited" | "stale";
export type AgentWorkspaceMode = "shared" | "worktree";
export type AgentModel = "opus" | "sonnet" | "haiku";
export type AgentEffort = "low" | "medium" | "high";

export type TerminalSnapshot = {
  terminalId: string;
  label: string;
  state: AgentState;
  agentId: string;
  agentName?: string;
  workspaceMode?: AgentWorkspaceMode;
  model?: AgentModel;
  effort?: AgentEffort;
  color?: string;
  isGroupLeader?: boolean;
  createdAt: string;
  hasUserPrompt?: boolean;
  parentTerminalId?: string;
  agentRuntimeState?: AgentRuntimeState;
  lifecycleState?: TerminalLifecycleState;
  lifecycleReason?: string;
  lifecycleUpdatedAt?: string;
  processId?: number;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  exitSignal?: number | string;
};
