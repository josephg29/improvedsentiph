// Sentiph orchestration MCP server (stdio). Spawned by an orchestrator Claude
// Code session via `claude --mcp-config`. It gives the orchestrator tools to
// delegate work: `build` routes code changes through the deterministic pipeline
// (build -> check -> fix) as a worker run; `spawn_terminal` spawns a plain child
// Claude for read-only / exploratory work. Everything is driven over the local
// HTTP API; this process inherits SENTIPH_API_ORIGIN and SENTIPH_SESSION_ID
// (its own terminal id, used as the parent of everything it spawns) from the PTY.

const apiOrigin = process.env.SENTIPH_API_ORIGIN ?? "http://127.0.0.1:8787";
const parentTerminalId = process.env.SENTIPH_SESSION_ID ?? null;
const MAX_PROMPT_LENGTH = 8192;

const isRunId = (id: string) => id.startsWith("run-");

const stripAnsi = (text: string): string =>
  text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal control sequences
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping OSC sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping single-char escapes
    .replace(/\x1b[@-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping remaining control chars
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: "build",
    description:
      "Delegate a CODE-CHANGE task (feature, bug fix, refactor, tests, migration) to the deterministic pipeline: a worker builds it, independent reviewers check it, and a fixer corrects it before the result returns. Runs in its own worker and worktree (not your session). Returns a runId immediately; you stay clean and read the checked result later with get_terminal_output. Prefer this over spawn_terminal for anything that changes code.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Natural-language description of the code change to build and verify.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "spawn_terminal",
    description:
      "Spawn a plain child Claude Code agent for READ-ONLY / exploratory work where there is no code artifact to check (research, looking something up, summarizing logs, a quick throwaway script). Full toolset: Bash, Read, Write, Edit, Grep, Glob, WebFetch. Phrase the prompt as a natural-language task. Pick model and effort to fit the task (cheap haiku/low for mechanical work; sonnet/medium for normal work; opus/high only when it earns it). For code changes, use build instead.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Natural-language task for the child agent." },
        name: { type: "string", description: "Short display name shown on the canvas." },
        model: {
          enum: ["opus", "sonnet", "haiku"],
          description:
            "Model for the child. haiku = cheap/fast/mechanical; sonnet = default coding; opus = deep reasoning.",
        },
        effort: {
          enum: ["low", "medium", "high"],
          description:
            "How much planning the task rewards. low = mechanical; medium = typical; high = ambiguous/complex (slower).",
        },
        color: { type: "string", description: "Hex color (#rrggbb) for the node on the canvas." },
        group_leader: {
          type: "boolean",
          description:
            "Spawn as a group leader: it gets these same orchestration tools so it can run its own sub-batch of workers. Use when you need more than 9 total workers.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "list_terminals",
    description:
      "List your children -- both plain workers and build runs -- with their current state. Call this first, and before concluding whether work succeeded.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "send_prompt",
    description:
      "Send a follow-up task to an existing IDLE plain worker (preserves its context). Same prompting rules as spawn_terminal. Does not apply to build runs.",
    inputSchema: {
      type: "object",
      properties: {
        terminal_id: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["terminal_id", "prompt"],
    },
  },
  {
    name: "get_terminal_output",
    description:
      "Read a plain worker's rendered output, OR a build run's status and checked result. Read it once the worker is idle / the build has finished.",
    inputSchema: {
      type: "object",
      properties: { terminal_id: { type: "string" } },
      required: ["terminal_id"],
    },
  },
  {
    name: "close_terminal",
    description: "Close a plain worker (force=true kills it), or cancel a build run.",
    inputSchema: {
      type: "object",
      properties: {
        terminal_id: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["terminal_id"],
    },
  },
];

const getJson = async (path: string): Promise<unknown> => {
  const res = await fetch(`${apiOrigin}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status} for ${path}`);
  }
  return res.json();
};

const listChildren = async (): Promise<string> => {
  const [snapshots, runs] = await Promise.all([
    getJson("/api/terminal-snapshots") as Promise<Array<Record<string, unknown>>>,
    getJson("/api/runs").catch(() => []) as Promise<Array<Record<string, unknown>>>,
  ]);

  const childTerminals = snapshots.filter((s) => s.parentTerminalId === parentTerminalId);
  const childRuns = runs.filter((r) => r.parentTerminalId === parentTerminalId);

  if (childTerminals.length === 0 && childRuns.length === 0) {
    return "No workers yet. Use build for code changes or spawn_terminal for read-only work.";
  }

  const lines: string[] = [];
  for (const s of childTerminals) {
    const state = (s.agentRuntimeState as string) ?? (s.lifecycleState as string) ?? "unknown";
    lines.push(`- ${s.terminalId} (worker: ${s.agentName ?? s.terminalId}): ${state}`);
  }
  for (const r of childRuns) {
    lines.push(`- ${r.runId} (build: ${r.task}): ${r.status}`);
  }
  return `Workers:\n${lines.join("\n")}`;
};

const formatRun = (run: Record<string, unknown>): string => {
  const result = run.result as Record<string, unknown> | undefined;
  const parts = [`Build ${run.runId}: ${run.status}`];
  if (run.workspaceBranch) {
    parts.push(`branch ${run.workspaceBranch}`);
  }
  if (result) {
    if (result.taskSummary) {
      parts.push(`\n${result.taskSummary}`);
    }
    const files = result.filesTouched as string[] | undefined;
    if (files && files.length > 0) {
      parts.push(`\nFiles: ${files.join(", ")}`);
    }
    const remaining = result.issuesRemaining as unknown[] | undefined;
    if (remaining && remaining.length > 0) {
      parts.push(`\nRemaining issues: ${JSON.stringify(remaining)}`);
    }
  }
  if (run.failureReason) {
    parts.push(`\nReason: ${run.failureReason}`);
  }
  return parts.join(" ");
};

const handleToolCall = async (name: string, args: Record<string, unknown>): Promise<string> => {
  if (name === "list_terminals") {
    return listChildren();
  }

  if (name === "build") {
    const task = String(args.task ?? "").trim();
    if (!task) {
      throw new Error("task is required");
    }
    if (task.length > MAX_PROMPT_LENGTH) {
      throw new Error(`task exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`);
    }
    const res = await fetch(`${apiOrigin}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, ...(parentTerminalId ? { parentTerminalId } : {}) }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.error ?? `API error ${res.status}`));
    }
    return `Started build ${data.runId}. Use get_terminal_output("${data.runId}") to read the checked result when it finishes, and list_terminals to watch its status.`;
  }

  if (name === "spawn_terminal") {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) {
      throw new Error("prompt is required");
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`);
    }
    const body: Record<string, unknown> = { workspaceMode: "shared", initialPrompt: prompt };
    if (parentTerminalId) {
      body.parentTerminalId = parentTerminalId;
    }
    if (typeof args.name === "string" && args.name.trim()) {
      body.name = args.name.trim();
    }
    if (args.model === "opus" || args.model === "sonnet" || args.model === "haiku") {
      body.model = args.model;
    }
    if (args.effort === "low" || args.effort === "medium" || args.effort === "high") {
      body.effort = args.effort;
    }
    if (typeof args.color === "string" && /^#[0-9a-fA-F]{6}$/.test(args.color)) {
      body.color = args.color;
    }
    if (args.group_leader === true) {
      body.isGroupLeader = true;
    }
    const res = await fetch(`${apiOrigin}/api/terminals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.error ?? `API error ${res.status}`));
    }
    return `Spawned worker "${data.terminalId}". Use get_terminal_output("${data.terminalId}") when it is idle.`;
  }

  if (name === "send_prompt") {
    const terminalId = String(args.terminal_id ?? "").trim();
    const prompt = String(args.prompt ?? "").trim();
    if (!terminalId) {
      throw new Error("terminal_id is required");
    }
    if (!prompt) {
      throw new Error("prompt is required");
    }
    if (isRunId(terminalId)) {
      return "send_prompt does not apply to build runs. Use list_terminals to watch the build, or get_terminal_output to read its result.";
    }
    const data = `\x1b[200~${prompt}\x1b[201~\r`;
    const res = await fetch(`${apiOrigin}/api/terminals/${encodeURIComponent(terminalId)}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (res.status === 404) {
      return `Worker "${terminalId}" not found or not active.`;
    }
    if (!res.ok) {
      const errData = (await res.json()) as Record<string, unknown>;
      throw new Error(String(errData.error ?? `API error ${res.status}`));
    }
    return `Sent prompt to worker "${terminalId}".`;
  }

  if (name === "get_terminal_output") {
    const terminalId = String(args.terminal_id ?? "").trim();
    if (!terminalId) {
      throw new Error("terminal_id is required");
    }
    if (isRunId(terminalId)) {
      const res = await fetch(`${apiOrigin}/api/runs/${encodeURIComponent(terminalId)}`);
      if (res.status === 404) {
        return "Build not found.";
      }
      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }
      return formatRun((await res.json()) as Record<string, unknown>);
    }
    const [scrollbackRes, snapshots] = await Promise.all([
      fetch(`${apiOrigin}/api/terminals/${encodeURIComponent(terminalId)}/scrollback`),
      getJson("/api/terminal-snapshots").catch(() => []) as Promise<Array<Record<string, unknown>>>,
    ]);
    if (scrollbackRes.status === 404) {
      return "Worker not found or has no output yet.";
    }
    if (!scrollbackRes.ok) {
      throw new Error(`API error ${scrollbackRes.status}`);
    }
    const { scrollback } = (await scrollbackRes.json()) as { scrollback: string };
    const snapshot = snapshots.find((s) => s.terminalId === terminalId);
    const state = (snapshot?.agentRuntimeState as string) ?? "unknown";
    const cleaned = stripAnsi(scrollback);
    return `[state: ${state}]\n${cleaned}`;
  }

  if (name === "close_terminal") {
    const terminalId = String(args.terminal_id ?? "").trim();
    if (!terminalId) {
      throw new Error("terminal_id is required");
    }
    if (isRunId(terminalId)) {
      await fetch(`${apiOrigin}/api/runs/${encodeURIComponent(terminalId)}/cancel`, {
        method: "POST",
      });
      return `Cancelled build "${terminalId}".`;
    }
    const force = args.force === true;
    const action = force ? "kill" : "stop";
    await fetch(`${apiOrigin}/api/terminals/${encodeURIComponent(terminalId)}/${action}`, {
      method: "POST",
    });
    return `Worker "${terminalId}" ${force ? "killed" : "stopped"}.`;
  }

  throw new Error(`Unknown tool: ${name}`);
};

// ── JSON-RPC stdio loop ─────────────────────────────────────────────────────
const send = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const handleMessage = async (raw: string): Promise<void> => {
  let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const { id, method, params } = msg;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "sentiph", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOL_DEFINITIONS } });
    return;
  }

  if (method === "tools/call") {
    const toolName = String(params?.name ?? "");
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    try {
      const text = await handleToolCall(toolName, args);
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `Error: ${message}` }], isError: true },
      });
    }
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line.length > 0) {
      void handleMessage(line);
    }
    newlineIndex = buffer.indexOf("\n");
  }
});
