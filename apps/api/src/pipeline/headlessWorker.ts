/**
 * The headless worker — Claude's official non-interactive front door.
 *
 * Uses `node:child_process` `spawn` (NOT node-pty: a headless worker needs no
 * terminal). One worker = one `claude -p … --json-schema …` process that does a
 * single job and exits. **Completion is the process exit** — never a regex over
 * screen text. The single JSON envelope on stdout is parsed, the structured
 * payload pulled, and re-validated against the stage's schema before anyone is
 * allowed to trust it. An unparseable / schema-invalid / non-zero / timed-out /
 * aborted worker yields `ok: false` and never leaks a bad result downstream.
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";

import type { RecipeStage } from "@sentiph/core";

import { toErrorMessage } from "../terminalRuntime/systemClients";
import { validateAgainstSchema } from "./schemaValidation";

export interface WorkerSpec {
  prompt: string; // the task / stage instruction
  stage: RecipeStage; // model, effort, systemPrompt, toolPolicy, outputSchema
  cwd: string; // the run's worktree path
  timeoutMs: number;
  signal: AbortSignal; // for cancellation
}

export interface WorkerRun {
  ok: boolean;
  result?: unknown; // parsed + schema-validated
  error?: string;
  costUsd?: number;
}

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface HeadlessWorkerDeps {
  /** Binary to invoke. Tests point this at a stub script. */
  claudeBinaryPath?: string;
  /** Injectable spawn for tests. */
  spawn?: SpawnFn;
  /** Grace period between SIGTERM and SIGKILL when killing a worker. */
  killGraceMs?: number;
}

const FULL_TOOLS = "Read,Grep,Glob,Edit,Write,Bash";
const READ_ONLY_TOOLS = "Read,Grep,Glob";
const DEFAULT_KILL_GRACE_MS = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Build the `claude` argv for a stage. Pure — unit-tested for both tool policies. */
export const buildWorkerArgs = (spec: WorkerSpec): string[] => {
  const { stage } = spec;
  const args = [
    "-p",
    spec.prompt,
    "--append-system-prompt",
    stage.systemPrompt,
    "--model",
    stage.model,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(stage.outputSchema),
    "--effort",
    stage.effort,
  ];

  if (stage.toolPolicy === "full") {
    // Builders/fixers write the worktree.
    args.push("--permission-mode", "acceptEdits", "--allowedTools", FULL_TOOLS);
  } else {
    // Checkers inspect but never mutate the work they judge — a real boundary.
    args.push("--permission-mode", "plan", "--allowedTools", READ_ONLY_TOOLS);
  }

  return args;
};

const readCostUsd = (envelope: Record<string, unknown>): number | undefined => {
  const raw = envelope.total_cost_usd ?? envelope.cost_usd;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
};

const withCost = (run: WorkerRun, costUsd: number | undefined): WorkerRun =>
  costUsd === undefined ? run : { ...run, costUsd };

const readEnvelopeError = (envelope: Record<string, unknown>): string => {
  if (typeof envelope.error === "string" && envelope.error.length > 0) {
    return envelope.error;
  }
  if (typeof envelope.result === "string" && envelope.result.length > 0) {
    return envelope.result;
  }
  return "Worker reported an error.";
};

/**
 * Parse the `claude -p --output-format json` envelope and re-validate the
 * structured payload. With `--json-schema`, the payload lands in
 * `structured_output` (verified against claude 2.1.158; `result` is empty).
 * Falls back to parsing `result` as JSON for robustness across versions.
 */
export const parseWorkerEnvelope = (stdout: string, outputSchema: object): WorkerRun => {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "Worker stdout was not valid JSON." };
  }

  if (!isRecord(envelope)) {
    return { ok: false, error: "Worker envelope was not a JSON object." };
  }

  const costUsd = readCostUsd(envelope);

  if (envelope.is_error === true) {
    return withCost({ ok: false, error: readEnvelopeError(envelope) }, costUsd);
  }

  let payload: unknown;
  if (envelope.structured_output !== undefined && envelope.structured_output !== null) {
    payload = envelope.structured_output;
  } else if (typeof envelope.result === "string" && envelope.result.trim().length > 0) {
    try {
      payload = JSON.parse(envelope.result);
    } catch {
      return withCost(
        { ok: false, error: "Worker returned no structured_output and result was not JSON." },
        costUsd,
      );
    }
  } else {
    return withCost(
      { ok: false, error: "Worker envelope contained no structured_output." },
      costUsd,
    );
  }

  const validation = validateAgainstSchema(payload, outputSchema);
  if (!validation.valid) {
    return withCost(
      { ok: false, error: `Schema validation failed: ${validation.errors.join("; ")}` },
      costUsd,
    );
  }

  return withCost({ ok: true, result: payload }, costUsd);
};

export const runHeadlessWorker = (
  spec: WorkerSpec,
  deps: HeadlessWorkerDeps = {},
): Promise<WorkerRun> => {
  const binary = deps.claudeBinaryPath ?? "claude";
  const spawnFn = deps.spawn ?? nodeSpawn;
  const killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  if (spec.signal.aborted) {
    return Promise.resolve({ ok: false, error: "Worker aborted before start." });
  }

  return new Promise<WorkerRun>((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let sigkillTimer: ReturnType<typeof setTimeout> | null = null;
    let stdout = "";
    let stderr = "";

    const child = spawnFn(binary, buildWorkerArgs(spec), {
      cwd: spec.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const killChild = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be gone — nothing to do.
      }
      sigkillTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may already be gone — nothing to do.
        }
      }, killGraceMs);
      sigkillTimer.unref?.();
    };

    const onAbort = () => {
      aborted = true;
      killChild();
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, spec.timeoutMs);
    timeoutTimer.unref?.();

    spec.signal.addEventListener("abort", onAbort, { once: true });

    const settle = (run: WorkerRun) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (sigkillTimer) {
        clearTimeout(sigkillTimer);
      }
      spec.signal.removeEventListener("abort", onAbort);
      resolve(run);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      settle({ ok: false, error: `Failed to spawn worker: ${toErrorMessage(error)}` });
    });

    // Completion = the process exits. No screen scraping.
    child.on("close", (code, signal) => {
      if (timedOut) {
        settle({ ok: false, error: `Worker timed out after ${spec.timeoutMs}ms.` });
        return;
      }
      if (aborted) {
        settle({ ok: false, error: "Worker aborted." });
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim();
        const suffix = signal ? ` (signal ${signal})` : "";
        settle({
          ok: false,
          error: detail || `Worker exited with code ${code ?? "null"}${suffix}.`,
        });
        return;
      }
      settle(parseWorkerEnvelope(stdout, spec.stage.outputSchema));
    });
  });
};
