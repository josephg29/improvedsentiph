import {
  type AgentWorkspaceMode,
  RuntimeInputError,
  type TerminalAgentProvider,
  type TerminalNameOrigin,
} from "../terminalRuntime";
import type { ApiRouteHandler } from "./routeHelpers";
import {
  readJsonBodyOrWriteError,
  writeJson,
  writeMethodNotAllowed,
  writeNoContent,
} from "./routeHelpers";
import {
  parseTerminalAgentProvider,
  parseTerminalName,
  parseTerminalNameOrigin,
  parseTerminalWorkspaceMode,
} from "./terminalParsers";

export const handleTerminalSnapshotsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/terminal-snapshots") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const payload = runtime.listTerminalSnapshots();
  writeJson(response, 200, payload, corsOrigin);
  return true;
};

export const handleTerminalsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/terminals") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const nameResult = parseTerminalName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  const workspaceModeResult = parseTerminalWorkspaceMode(bodyReadResult.payload);
  if (workspaceModeResult.error) {
    writeJson(response, 400, { error: workspaceModeResult.error }, corsOrigin);
    return true;
  }

  const agentProviderResult = parseTerminalAgentProvider(bodyReadResult.payload);
  if (agentProviderResult.error) {
    writeJson(response, 400, { error: agentProviderResult.error }, corsOrigin);
    return true;
  }

  const nameOriginResult = parseTerminalNameOrigin(bodyReadResult.payload);
  if (nameOriginResult.error) {
    writeJson(response, 400, { error: nameOriginResult.error }, corsOrigin);
    return true;
  }

  try {
    const createTerminalInput: {
      terminalId?: string;
      agentId?: string;
      worktreeId?: string;
      agentName?: string;
      workspaceMode: AgentWorkspaceMode;
      agentProvider?: TerminalAgentProvider;
      model?: "opus" | "sonnet" | "haiku";
      effort?: "low" | "medium" | "high";
      color?: string;
      isGroupLeader?: boolean;
      nameOrigin?: TerminalNameOrigin;
      initialPrompt?: string;
      initialInputDraft?: string;
      autoRenamePromptContext?: string;
      parentTerminalId?: string;
    } = {
      workspaceMode: workspaceModeResult.workspaceMode,
    };
    if (nameResult.name !== undefined) {
      createTerminalInput.agentName = nameResult.name;
    }
    if (agentProviderResult.agentProvider !== undefined) {
      createTerminalInput.agentProvider = agentProviderResult.agentProvider;
    }
    if (nameOriginResult.nameOrigin !== undefined) {
      createTerminalInput.nameOrigin = nameOriginResult.nameOrigin;
    }
    const bodyPayload = bodyReadResult.payload as Record<string, unknown> | null;
    if (
      bodyPayload &&
      typeof bodyPayload.terminalId === "string" &&
      bodyPayload.terminalId.trim().length > 0
    ) {
      createTerminalInput.terminalId = bodyPayload.terminalId.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.agentId === "string" &&
      bodyPayload.agentId.trim().length > 0
    ) {
      createTerminalInput.agentId = bodyPayload.agentId.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.parentTerminalId === "string" &&
      bodyPayload.parentTerminalId.trim().length > 0
    ) {
      createTerminalInput.parentTerminalId = bodyPayload.parentTerminalId.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.autoRenamePromptContext === "string" &&
      bodyPayload.autoRenamePromptContext.trim().length > 0
    ) {
      createTerminalInput.autoRenamePromptContext = bodyPayload.autoRenamePromptContext.trim();
    }
    if (
      bodyPayload &&
      typeof bodyPayload.worktreeId === "string" &&
      bodyPayload.worktreeId.trim().length > 0
    ) {
      createTerminalInput.worktreeId = bodyPayload.worktreeId.trim();
    }

    // Orchestrator-chosen child settings (model/effort/color/group-leader).
    if (
      bodyPayload &&
      (bodyPayload.model === "opus" ||
        bodyPayload.model === "sonnet" ||
        bodyPayload.model === "haiku")
    ) {
      createTerminalInput.model = bodyPayload.model;
    }
    if (
      bodyPayload &&
      (bodyPayload.effort === "low" ||
        bodyPayload.effort === "medium" ||
        bodyPayload.effort === "high")
    ) {
      createTerminalInput.effort = bodyPayload.effort;
    }
    if (
      bodyPayload &&
      typeof bodyPayload.color === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(bodyPayload.color)
    ) {
      createTerminalInput.color = bodyPayload.color;
    }
    if (bodyPayload && bodyPayload.isGroupLeader === true) {
      createTerminalInput.isGroupLeader = true;
    }

    // Optional raw initial prompt to seed the agent.
    if (
      bodyPayload &&
      typeof bodyPayload.initialPrompt === "string" &&
      bodyPayload.initialPrompt.trim().length > 0
    ) {
      createTerminalInput.initialPrompt = bodyPayload.initialPrompt.trim();
    }

    const snapshot = runtime.createTerminal(createTerminalInput);
    const payload: Record<string, unknown> = { ...snapshot };
    if (createTerminalInput.initialPrompt) {
      payload.initialPrompt = createTerminalInput.initialPrompt;
    }
    writeJson(response, 201, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }

    throw error;
  }
};

const TERMINAL_ITEM_PATH_PATTERN = /^\/api\/terminals\/([^/]+)$/;
const TERMINAL_ACTION_PATH_PATTERN = /^\/api\/terminals\/([^/]+)\/(stop|kill)$/;

export const handleTerminalItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const renameMatch = requestUrl.pathname.match(TERMINAL_ITEM_PATH_PATTERN);
  if (!renameMatch) {
    return false;
  }

  if (request.method !== "PATCH" && request.method !== "DELETE") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(renameMatch[1] ?? "");
  if (request.method === "DELETE") {
    try {
      runtime.deleteTerminal(terminalId);
      writeNoContent(response, 204, corsOrigin);
      return true;
    } catch (error) {
      if (error instanceof RuntimeInputError) {
        writeJson(response, 409, { error: error.message }, corsOrigin);
        return true;
      }
      throw error;
    }
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const nameResult = parseTerminalName(bodyReadResult.payload);
  if (nameResult.error) {
    writeJson(response, 400, { error: nameResult.error }, corsOrigin);
    return true;
  }

  if (!nameResult.provided || !nameResult.name) {
    writeJson(response, 400, { error: "Terminal name is required." }, corsOrigin);
    return true;
  }

  const payload = runtime.renameTerminal(terminalId, nameResult.name);
  if (!payload) {
    writeJson(response, 404, { error: "Terminal not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, payload, corsOrigin);
  return true;
};

export const handleTerminalActionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const actionMatch = requestUrl.pathname.match(TERMINAL_ACTION_PATH_PATTERN);
  if (!actionMatch) {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(actionMatch[1] ?? "");
  const action = actionMatch[2];
  const snapshot =
    action === "kill" ? runtime.killTerminal(terminalId) : runtime.stopTerminal(terminalId);
  if (!snapshot) {
    writeJson(response, 404, { error: "Terminal not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, snapshot, corsOrigin);
  return true;
};

const TERMINAL_INPUT_PATH_PATTERN = /^\/api\/terminals\/([^/]+)\/input$/;
const TERMINAL_SCROLLBACK_PATH_PATTERN = /^\/api\/terminals\/([^/]+)\/scrollback$/;

// Used by the orchestration MCP server (send_prompt): feeds input into a child
// terminal's PTY over HTTP.
export const handleTerminalInputRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(TERMINAL_INPUT_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const payload = bodyReadResult.payload as Record<string, unknown> | null;
  const data = payload && typeof payload.data === "string" ? payload.data : null;
  if (data === null) {
    writeJson(response, 400, { error: "A string `data` field is required." }, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(match[1] ?? "");
  if (!runtime.writeInput(terminalId, data)) {
    writeJson(response, 404, { error: "Terminal not found or not active." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, { ok: true }, corsOrigin);
  return true;
};

// Used by the orchestration MCP server (get_terminal_output): reads a child
// terminal's current rendered scrollback.
export const handleTerminalScrollbackRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const match = requestUrl.pathname.match(TERMINAL_SCROLLBACK_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(match[1] ?? "");
  const scrollback = runtime.getScrollback(terminalId);
  if (scrollback === null) {
    writeJson(response, 404, { error: "Terminal not found or has no output yet." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, { scrollback }, corsOrigin);
  return true;
};

export const handleTerminalPruneRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  if (requestUrl.pathname !== "/api/terminals/prune") {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  writeJson(response, 200, { prunedTerminalIds: runtime.pruneTerminals() }, corsOrigin);
  return true;
};
