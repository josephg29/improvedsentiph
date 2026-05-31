import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { logVerbose } from "../logging";
import { parseClaudeTranscript } from "./claudeTranscript";
import { storeClaudeTranscriptTurns } from "./conversations";
import { broadcastMessage } from "./protocol";
import type { PersistedTerminal, TerminalSession } from "./types";

// The top-level orchestrator is always shown as "sentiph" rather than echoing
// its first prompt.
const ROOT_AGENT_NAME = "sentiph";
const MAX_SHORT_NAME_LENGTH = 14;

// Filler words skipped when picking the first meaningful word of a task prompt.
const NAME_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "for",
  "in",
  "on",
  "into",
  "with",
  "this",
  "that",
  "my",
  "our",
  "your",
  "please",
  "can",
  "could",
  "would",
  "is",
  "i",
  "we",
  "you",
  "help",
  "let",
  "lets",
  "then",
  "from",
  "by",
  "at",
  "make",
]);

// Short, human-friendly worker names derived from the first meaningful word of
// the task prompt (e.g. "research the auth flow" → "research"). Collisions get a
// numeric suffix ("research", "research2"), so canvas labels stay readable
// instead of repeating the whole prompt.
const deriveShortAgentName = (prompt: string, existingNames: Set<string>): string => {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const base =
    words.find((word) => word.length >= 3 && !NAME_STOPWORDS.has(word)) ?? words[0] ?? "agent";
  const root = base.slice(0, MAX_SHORT_NAME_LENGTH);

  let candidate = root;
  let suffix = 2;
  while (existingNames.has(candidate)) {
    candidate = `${root}${suffix}`;
    suffix += 1;
  }
  return candidate;
};

export const createHookProcessor = (deps: {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  transcriptDirectoryPath: string;
  getApiBaseUrl: () => string;
  persistRegistry: () => void;
  deliverChannelMessages: (terminalId: string) => number;
  releaseSessionKeepAlive: (terminalId: string) => boolean;
  onStateChange?: (
    terminalId: string,
    state: TerminalSession["agentState"],
    toolName?: string,
  ) => void;
}) => {
  const {
    terminals,
    sessions,
    transcriptDirectoryPath,
    getApiBaseUrl,
    persistRegistry,
    deliverChannelMessages,
    releaseSessionKeepAlive,
    onStateChange,
  } = deps;

  const parseSettingsObject = (fileContents: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(fileContents) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const mergeHookEntries = (
    existingValue: unknown,
    eventName: string,
    nextEntries: unknown[],
  ): Record<string, unknown> => {
    const nextHooks =
      existingValue && typeof existingValue === "object" && !Array.isArray(existingValue)
        ? { ...(existingValue as Record<string, unknown>) }
        : {};
    const existingEntries = Array.isArray(nextHooks[eventName])
      ? [...(nextHooks[eventName] as unknown[])]
      : [];
    const mergedEntries = [...existingEntries];

    for (const nextEntry of nextEntries) {
      const serializedNextEntry = JSON.stringify(nextEntry);
      const alreadyPresent = existingEntries.some(
        (existingEntry) => JSON.stringify(existingEntry) === serializedNextEntry,
      );
      if (!alreadyPresent) {
        mergedEntries.push(nextEntry);
      }
    }

    nextHooks[eventName] = mergedEntries;
    return nextHooks;
  };

  const installHooksInDirectory = (targetCwd: string) => {
    const targetClaudeDir = join(targetCwd, ".claude");
    const targetSettingsPath = join(targetClaudeDir, "settings.json");
    const apiBaseUrl = getApiBaseUrl();

    const hooksConfig = {
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/session-start?sentiph_session=$SENTIPH_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/user-prompt-submit?sentiph_session=$SENTIPH_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 5,
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/hooks/pre-tool-use`,
                headers: { "X-Sentiph-Session": "$SENTIPH_SESSION_ID" },
                allowedEnvVars: ["SENTIPH_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Notification: [
          {
            matcher: "*",
            hooks: [
              {
                type: "http",
                url: `${apiBaseUrl}/api/hooks/notification`,
                headers: { "X-Sentiph-Session": "$SENTIPH_SESSION_ID" },
                allowedEnvVars: ["SENTIPH_SESSION_ID"],
                timeout: 5,
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `curl -s -X POST "${apiBaseUrl}/api/hooks/stop?sentiph_session=$SENTIPH_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`,
                timeout: 15,
              },
            ],
          },
        ],
      },
    };

    try {
      mkdirSync(targetClaudeDir, { recursive: true });
      const existingSettings = existsSync(targetSettingsPath)
        ? parseSettingsObject(readFileSync(targetSettingsPath, "utf8"))
        : null;
      const mergedSettings =
        existingSettings && typeof existingSettings === "object" ? { ...existingSettings } : {};

      let mergedHooks =
        mergedSettings.hooks &&
        typeof mergedSettings.hooks === "object" &&
        !Array.isArray(mergedSettings.hooks)
          ? { ...(mergedSettings.hooks as Record<string, unknown>) }
          : {};

      for (const [eventName, eventEntries] of Object.entries(hooksConfig.hooks)) {
        mergedHooks = mergeHookEntries(mergedHooks, eventName, eventEntries);
      }

      mergedSettings.hooks = mergedHooks;
      writeFileSync(targetSettingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, "utf8");
    } catch {
      // Best-effort
    }
  };

  const handleHook = (
    hookName: string,
    payload: unknown,
    sentiphSessionId?: string,
  ): { ok: boolean } => {
    logVerbose(`[Hook] Received hook: ${hookName} sentiphSession=${sentiphSessionId ?? "(none)"}`);

    if (!payload || typeof payload !== "object") {
      return { ok: true };
    }

    const hookPayloadRecord = payload as Record<string, unknown>;

    if (hookName === "notification") {
      if (!sentiphSessionId) {
        return { ok: true };
      }
      const session = sessions.get(sentiphSessionId);
      if (!session) {
        logVerbose(`[Hook] notification: no session for ${sentiphSessionId}, skipping.`);
        return { ok: true };
      }

      const notificationType =
        typeof hookPayloadRecord.notification_type === "string"
          ? hookPayloadRecord.notification_type
          : null;

      logVerbose(`[Hook] notification: type=${notificationType} session=${sentiphSessionId}`);

      if (notificationType === "permission_prompt") {
        session.agentState = "waiting_for_permission";
        session.stateTracker.forceState("waiting_for_permission");
        onStateChange?.(sentiphSessionId, "waiting_for_permission", session.lastToolName);
        broadcastMessage(session, {
          type: "state",
          state: "waiting_for_permission",
          ...(session.lastToolName ? { toolName: session.lastToolName } : {}),
        });
      } else if (notificationType === "idle_prompt") {
        session.agentState = "idle";
        session.stateTracker.forceState("idle");
        onStateChange?.(sentiphSessionId, "idle");
        broadcastMessage(session, { type: "state", state: "idle" });

        // Deliver any queued channel messages now that the agent is idle.
        deliverChannelMessages(sentiphSessionId);
      }

      return { ok: true };
    }

    if (hookName === "pre-tool-use") {
      if (!sentiphSessionId) {
        return { ok: true };
      }
      const session = sessions.get(sentiphSessionId);
      if (!session) {
        return { ok: true };
      }

      const toolName =
        typeof hookPayloadRecord.tool_name === "string" ? hookPayloadRecord.tool_name : null;

      logVerbose(`[Hook] pre-tool-use: tool=${toolName} session=${sentiphSessionId}`);

      if (toolName) {
        session.lastToolName = toolName;
      }

      if (toolName === "AskUserQuestion") {
        session.agentState = "waiting_for_user";
        session.stateTracker.forceState("waiting_for_user");
        onStateChange?.(sentiphSessionId, "waiting_for_user");
        broadcastMessage(session, { type: "state", state: "waiting_for_user" });
      }

      return { ok: true };
    }

    if (hookName === "user-prompt-submit") {
      if (!sentiphSessionId) {
        return { ok: true };
      }

      const terminal = terminals.get(sentiphSessionId);
      if (!terminal) {
        return { ok: true };
      }

      // Update last-active timestamp (determines active/inactive on the canvas).
      terminal.lastActiveAt = new Date().toISOString();

      // The user submitted a prompt, so the agent is about to start processing.
      // Transition state out of waiting/idle to processing immediately.
      const activitySession = sessions.get(terminal.terminalId);
      if (activitySession) {
        activitySession.agentState = "processing";
        activitySession.lastToolName = undefined;
        activitySession.stateTracker.forceState("processing");
        onStateChange?.(terminal.terminalId, "processing");
        broadcastMessage(activitySession, { type: "state", state: "processing" });
        broadcastMessage(activitySession, { type: "activity" });
      }

      // Auto-name the terminal on its first prompt while it still has a default
      // name: the top-level orchestrator becomes "sentiph"; every spawned worker
      // gets a short slug from its task (research, research2, parser, builder…).
      if (terminal.nameOrigin === "generated") {
        const prompt =
          typeof hookPayloadRecord.prompt === "string" ? hookPayloadRecord.prompt.trim() : "";
        const renameContext = terminal.autoRenamePromptContext?.trim() || prompt;
        if (renameContext.length > 0) {
          const isTopLevel = !terminal.parentTerminalId;
          const sentiphExists = [...terminals.values()].some(
            (other) =>
              other.terminalId !== terminal.terminalId && other.agentName === ROOT_AGENT_NAME,
          );
          let derived: string;
          if (isTopLevel && !sentiphExists) {
            derived = ROOT_AGENT_NAME;
          } else {
            const existingNames = new Set(
              [...terminals.values()]
                .filter((other) => other.terminalId !== terminal.terminalId)
                .map((other) => other.agentName),
            );
            derived = deriveShortAgentName(renameContext, existingNames);
          }
          terminal.agentName = derived;
          terminal.nameOrigin = "prompt";
          terminal.autoRenamePromptContext = undefined;
          logVerbose(`[Hook] Auto-named terminal ${terminal.terminalId} → "${derived}"`);

          const session = sessions.get(terminal.terminalId);
          if (session) {
            broadcastMessage(session, { type: "rename", agentName: derived });
          }
        }
      }

      persistRegistry();
      return { ok: true };
    }

    if (hookName !== "stop") {
      return { ok: true };
    }

    const hookPayload = payload as Record<string, unknown>;
    const transcriptPath =
      typeof hookPayload.transcript_path === "string" ? hookPayload.transcript_path : null;
    const hookCwd = typeof hookPayload.cwd === "string" ? hookPayload.cwd : null;

    logVerbose(`[Hook] Stop hook: transcriptPath=${transcriptPath}, hookCwd=${hookCwd}`);

    if (!transcriptPath || !hookCwd) {
      logVerbose("[Hook] Missing transcriptPath or hookCwd, skipping.");
      return { ok: true };
    }

    let matchedSessionId: string | null = null;

    if (sentiphSessionId && sessions.has(sentiphSessionId)) {
      matchedSessionId = sentiphSessionId;
      logVerbose(`[Hook] Matched session by sentiph_session param: ${matchedSessionId}`);
    } else if (sentiphSessionId) {
      logVerbose(
        `[Hook] sentiph_session=${sentiphSessionId} not found in active sessions, skipping.`,
      );
      return { ok: true };
    } else {
      logVerbose("[Hook] No sentiph_session param — ignoring hook from external Claude session.");
      return { ok: true };
    }

    logVerbose(`[Hook] Matched session: ${matchedSessionId}, parsing transcript...`);
    const turns = parseClaudeTranscript(transcriptPath);
    logVerbose(`[Hook] Parsed ${turns?.length ?? 0} turns from transcript.`);

    const lastAssistantMessage =
      typeof hookPayload.last_assistant_message === "string"
        ? hookPayload.last_assistant_message.trim()
        : null;

    if (lastAssistantMessage && lastAssistantMessage.length > 0) {
      const effectiveTurns = turns ?? [];
      const lastTurn = effectiveTurns.length > 0 ? effectiveTurns[effectiveTurns.length - 1] : null;

      if (!lastTurn || lastTurn.role !== "assistant" || lastTurn.content !== lastAssistantMessage) {
        const now = new Date().toISOString();
        effectiveTurns.push({
          turnId: `turn-${effectiveTurns.length + 1}`,
          role: "assistant",
          content: lastAssistantMessage,
          startedAt: now,
          endedAt: now,
        });
        logVerbose("[Hook] Appended last_assistant_message as final turn.");
      }

      if (effectiveTurns.length > 0) {
        storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, effectiveTurns);
        logVerbose(`[Hook] Stored ${effectiveTurns.length} turns for session ${matchedSessionId}.`);
      }
    } else if (turns && turns.length > 0) {
      storeClaudeTranscriptTurns(transcriptDirectoryPath, matchedSessionId, turns);
      logVerbose(`[Hook] Stored ${turns.length} turns for session ${matchedSessionId}.`);
    }

    // Deliver any queued channel messages now that the agent is idle.
    if (matchedSessionId) {
      const deliveredMessageCount = deliverChannelMessages(matchedSessionId);
      if (deliveredMessageCount === 0) {
        releaseSessionKeepAlive(matchedSessionId);
      }
    }

    return { ok: true };
  };

  return { handleHook, installHooksInDirectory };
};
