import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RecipeStage } from "@sentiph/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type WorkerSpec,
  buildWorkerArgs,
  parseWorkerEnvelope,
  runHeadlessWorker,
} from "../src/pipeline/headlessWorker";

const SCHEMA = {
  type: "object",
  required: ["status"],
  properties: { status: { type: "string" } },
};

const stage = (overrides: Partial<RecipeStage> = {}): RecipeStage => ({
  id: "build",
  role: "build",
  systemPrompt: "sys",
  model: "sonnet",
  effort: "medium",
  toolPolicy: "full",
  outputSchema: SCHEMA,
  ...overrides,
});

// Stub `claude` binaries. Each ignores the claude argv and emits a known
// envelope, mirroring how the suite fakes node-pty / injects a FakeGitClient.
const STUBS: Record<string, string> = {
  valid: `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { status: "ok" }, total_cost_usd: 0.42 }));
process.exit(0);
`,
  exit1: `#!/usr/bin/env node
process.stderr.write("worker blew up");
process.exit(1);
`,
  malformed: `#!/usr/bin/env node
process.stdout.write("this is not json");
process.exit(0);
`,
  schemaInvalid: `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { nope: "x" }, total_cost_usd: 0.1 }));
process.exit(0);
`,
  slow: `#!/usr/bin/env node
setTimeout(() => { process.stdout.write(JSON.stringify({ structured_output: { status: "ok" } })); process.exit(0); }, 5000);
`,
};

let stubDir: string;
const stubPath = (name: string) => join(stubDir, name);

const makeSpec = (overrides: Partial<WorkerSpec> = {}): WorkerSpec => ({
  prompt: "do it",
  stage: stage(),
  cwd: stubDir,
  timeoutMs: 10_000,
  signal: new AbortController().signal,
  ...overrides,
});

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "sentiph-headless-worker-test-"));
  for (const [name, body] of Object.entries(STUBS)) {
    const path = stubPath(name);
    writeFileSync(path, body, "utf8");
    chmodSync(path, 0o755);
  }
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe("buildWorkerArgs", () => {
  it("uses acceptEdits and full tools for a full-policy stage", () => {
    const args = buildWorkerArgs(makeSpec({ stage: stage({ toolPolicy: "full" }) }));
    expect(args).toContain("-p");
    expect(args).toContain("do it");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--effort");
    expect(args).toContain("medium");
    expect(args).toContain("--json-schema");
    expect(args).toContain(JSON.stringify(SCHEMA));
    const permIndex = args.indexOf("--permission-mode");
    expect(args[permIndex + 1]).toBe("acceptEdits");
    const toolsIndex = args.indexOf("--allowedTools");
    expect(args[toolsIndex + 1]).toBe("Read,Grep,Glob,Edit,Write,Bash");
  });

  it("uses plan mode and read-only tools for a read-only stage", () => {
    const args = buildWorkerArgs(makeSpec({ stage: stage({ toolPolicy: "read-only" }) }));
    const permIndex = args.indexOf("--permission-mode");
    expect(args[permIndex + 1]).toBe("plan");
    const toolsIndex = args.indexOf("--allowedTools");
    expect(args[toolsIndex + 1]).toBe("Read,Grep,Glob");
    expect(args).not.toContain("Read,Grep,Glob,Edit,Write,Bash");
  });
});

describe("parseWorkerEnvelope", () => {
  it("pulls a valid structured_output payload and the cost", () => {
    const stdout = JSON.stringify({
      is_error: false,
      result: "",
      structured_output: { status: "ok" },
      total_cost_usd: 0.42,
    });
    const run = parseWorkerEnvelope(stdout, SCHEMA);
    expect(run.ok).toBe(true);
    expect(run.result).toEqual({ status: "ok" });
    expect(run.costUsd).toBe(0.42);
  });

  it("fails when the envelope reports is_error", () => {
    const stdout = JSON.stringify({ is_error: true, result: "model said no" });
    const run = parseWorkerEnvelope(stdout, SCHEMA);
    expect(run.ok).toBe(false);
    expect(run.error).toContain("model said no");
  });

  it("falls back to parsing the result text as JSON", () => {
    const stdout = JSON.stringify({ is_error: false, result: JSON.stringify({ status: "ok" }) });
    const run = parseWorkerEnvelope(stdout, SCHEMA);
    expect(run.ok).toBe(true);
    expect(run.result).toEqual({ status: "ok" });
  });

  it("fails when there is no structured output at all", () => {
    const run = parseWorkerEnvelope(JSON.stringify({ is_error: false, result: "" }), SCHEMA);
    expect(run.ok).toBe(false);
    expect(run.error).toContain("no structured_output");
  });

  it("fails on malformed stdout", () => {
    const run = parseWorkerEnvelope("not json", SCHEMA);
    expect(run.ok).toBe(false);
    expect(run.error).toContain("not valid JSON");
  });

  it("fails schema-invalid structured output", () => {
    const stdout = JSON.stringify({ is_error: false, structured_output: { wrong: 1 } });
    const run = parseWorkerEnvelope(stdout, SCHEMA);
    expect(run.ok).toBe(false);
    expect(run.error).toContain("Schema validation failed");
  });
});

describe("runHeadlessWorker (stub binary)", () => {
  it("returns a schema-valid result and cost on a clean run", async () => {
    const run = await runHeadlessWorker(makeSpec(), { claudeBinaryPath: stubPath("valid") });
    expect(run.ok).toBe(true);
    expect(run.result).toEqual({ status: "ok" });
    expect(run.costUsd).toBe(0.42);
  });

  it("fails on a non-zero exit and captures stderr", async () => {
    const run = await runHeadlessWorker(makeSpec(), { claudeBinaryPath: stubPath("exit1") });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("worker blew up");
  });

  it("fails on malformed JSON", async () => {
    const run = await runHeadlessWorker(makeSpec(), { claudeBinaryPath: stubPath("malformed") });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("not valid JSON");
  });

  it("fails when the structured output is schema-invalid", async () => {
    const run = await runHeadlessWorker(makeSpec(), {
      claudeBinaryPath: stubPath("schemaInvalid"),
    });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("Schema validation failed");
  });

  it("times out and kills a slow worker", async () => {
    const run = await runHeadlessWorker(makeSpec({ timeoutMs: 300 }), {
      claudeBinaryPath: stubPath("slow"),
      killGraceMs: 100,
    });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("timed out");
  });

  it("aborts an in-flight worker", async () => {
    const controller = new AbortController();
    const promise = runHeadlessWorker(makeSpec({ timeoutMs: 10_000, signal: controller.signal }), {
      claudeBinaryPath: stubPath("slow"),
      killGraceMs: 100,
    });
    setTimeout(() => controller.abort(), 100);
    const run = await promise;
    expect(run.ok).toBe(false);
    expect(run.error).toContain("aborted");
  });

  it("refuses to start when the signal is already aborted", async () => {
    const run = await runHeadlessWorker(makeSpec({ signal: AbortSignal.abort() }), {
      claudeBinaryPath: stubPath("valid"),
    });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("aborted before start");
  });
});

// One real end-to-end proof of the front door. Skipped unless RUN_CLAUDE_SMOKE=1
// (like the real-git tests), because it spends money and needs auth.
const runSmoke = process.env.RUN_CLAUDE_SMOKE === "1";
describe("runHeadlessWorker (real claude)", () => {
  it.skipIf(!runSmoke)(
    "returns a schema-valid result from a real claude -p",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "sentiph-headless-worker-smoke-"));
      try {
        const run = await runHeadlessWorker({
          prompt: "Return a JSON object whose field status is the string ok.",
          stage: stage({
            model: "haiku",
            effort: "low",
            toolPolicy: "read-only",
            systemPrompt: "Return only the requested JSON.",
          }),
          cwd: dir,
          timeoutMs: 120_000,
          signal: new AbortController().signal,
        });
        expect(run.ok).toBe(true);
        expect(run.result).toMatchObject({ status: expect.any(String) });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    130_000,
  );
});
