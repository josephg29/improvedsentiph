import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { logVerbose } from "../logging";
import type { ChannelMessage, PersistedTerminal, TerminalSession } from "./types";

const CHANNELS_SUBDIR = "channels";

const parseChannelMessage = (line: string): ChannelMessage | null => {
  try {
    return JSON.parse(line) as ChannelMessage;
  } catch {
    return null;
  }
};

const loadChannelQueue = (channelsDir: string, terminalId: string): ChannelMessage[] => {
  const filePath = join(channelsDir, `${terminalId}.jsonl`);
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(parseChannelMessage)
      .filter((m): m is ChannelMessage => m !== null);
  } catch {
    return [];
  }
};

const persistChannelQueue = (channelsDir: string, terminalId: string, queue: ChannelMessage[]) => {
  try {
    const filePath = join(channelsDir, `${terminalId}.jsonl`);
    writeFileSync(filePath, queue.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  } catch {
    // Best-effort persistence — don't let write errors break delivery.
  }
};

export const createChannelMessaging = (deps: {
  terminals: Map<string, PersistedTerminal>;
  sessions: Map<string, TerminalSession>;
  writeInput: (terminalId: string, data: string) => boolean;
  stateDir?: string;
}) => {
  const { terminals, sessions, writeInput, stateDir } = deps;
  const channelsDir = stateDir ? join(stateDir, "state", CHANNELS_SUBDIR) : null;
  if (channelsDir) {
    mkdirSync(channelsDir, { recursive: true });
  }

  // Restore queues from disk for all known terminals.
  const channelQueues = new Map<string, ChannelMessage[]>();
  if (channelsDir) {
    for (const terminalId of terminals.keys()) {
      const stored = loadChannelQueue(channelsDir, terminalId);
      if (stored.length > 0) {
        channelQueues.set(terminalId, stored);
      }
    }
  }

  let channelMessageCounter = (() => {
    let max = 0;
    for (const queue of channelQueues.values()) {
      for (const m of queue) {
        const n = Number(m.messageId.replace("msg-", ""));
        if (n > max) max = n;
      }
    }
    return max;
  })();

  const deliverChannelMessages = (terminalId: string): number => {
    const queue = channelQueues.get(terminalId);
    if (!queue || queue.length === 0) {
      return 0;
    }

    const session = sessions.get(terminalId);
    if (!session) {
      return 0;
    }

    const undelivered = queue.filter((m) => !m.delivered);
    if (undelivered.length === 0) {
      return 0;
    }

    // Compose all pending messages into a single prompt injection.
    const lines = undelivered.map(
      (m) => `[Channel message from ${m.fromTerminalId}]: ${m.content}`,
    );
    const prompt = `${lines.join("\n")}\r`;

    logVerbose(`[Channel] Delivering ${undelivered.length} message(s) to ${terminalId}`);

    for (const m of undelivered) {
      m.delivered = true;
    }

    if (channelsDir) {
      persistChannelQueue(channelsDir, terminalId, queue);
    }

    writeInput(terminalId, prompt);
    return undelivered.length;
  };

  return {
    sendChannelMessage(
      toTerminalId: string,
      fromTerminalId: string,
      content: string,
    ): ChannelMessage | null {
      if (!terminals.has(toTerminalId)) {
        return null;
      }

      channelMessageCounter += 1;
      const message: ChannelMessage = {
        messageId: `msg-${channelMessageCounter}`,
        fromTerminalId,
        toTerminalId,
        content,
        timestamp: new Date().toISOString(),
        delivered: false,
      };

      const queue = channelQueues.get(toTerminalId) ?? [];
      queue.push(message);
      channelQueues.set(toTerminalId, queue);

      if (channelsDir) {
        try {
          appendFileSync(
            join(channelsDir, `${toTerminalId}.jsonl`),
            `${JSON.stringify(message)}\n`,
            "utf8",
          );
        } catch {
          // Best-effort.
        }
      }

      logVerbose(
        `[Channel] Queued message ${message.messageId} from=${fromTerminalId} to=${toTerminalId}`,
      );

      // If the target session is idle, deliver immediately.
      const targetSession = sessions.get(toTerminalId);
      if (targetSession && targetSession.agentState === "idle") {
        deliverChannelMessages(toTerminalId);
      }

      return message;
    },

    listChannelMessages(terminalId: string): ChannelMessage[] {
      return channelQueues.get(terminalId) ?? [];
    },

    deliverChannelMessages,
  };
};
