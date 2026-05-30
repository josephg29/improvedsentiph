import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Run } from "@sentiph/core";
import { afterEach, describe, expect, it } from "vitest";

import { createRunStorePersistence, loadRunStore } from "../src/pipeline/runStore";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sentiph-run-store-test-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  runId: "run-1",
  recipeId: "standard",
  task: "do the thing",
  status: "passed",
  outcomes: [],
  createdAt: "2026-05-29T00:00:00.000Z",
  updatedAt: "2026-05-29T00:00:00.000Z",
  ...overrides,
});

describe("runStore persistence", () => {
  it("persists a run and its index, then loads it back", async () => {
    const stateDir = tempDir();
    const persistence = createRunStorePersistence(stateDir);
    const run = makeRun({ status: "passed" });
    persistence.persistRun(run);
    persistence.persistIndex([run.runId]);
    await persistence.flush();

    expect(existsSync(join(stateDir, "state", "runs", "run-1.json"))).toBe(true);
    expect(existsSync(join(stateDir, "state", "runs", "index.json"))).toBe(true);

    const loaded = loadRunStore(stateDir, "2026-05-29T01:00:00.000Z");
    expect(loaded.runs.size).toBe(1);
    expect(loaded.runs.get("run-1")?.status).toBe("passed");
    expect(loaded.reconciledRunIds).toEqual([]);
  });

  it("reconciles a non-terminal run to failed (api_restart) on load", async () => {
    const stateDir = tempDir();
    const persistence = createRunStorePersistence(stateDir);
    const run = makeRun({ runId: "run-7", status: "building" });
    persistence.persistRun(run);
    persistence.persistIndex([run.runId]);
    await persistence.flush();

    const loaded = loadRunStore(stateDir, "2026-05-29T02:00:00.000Z");
    const reconciled = loaded.runs.get("run-7");
    expect(reconciled?.status).toBe("failed");
    expect(reconciled?.failureReason).toBe("api_restart");
    expect(reconciled?.result?.status).toBe("failed");
    expect(loaded.reconciledRunIds).toEqual(["run-7"]);
  });

  it("reconciles a run parked at the approval gate instead of dropping it", async () => {
    const stateDir = tempDir();
    const persistence = createRunStorePersistence(stateDir);
    const run = makeRun({ runId: "run-8", status: "awaiting_approval" });
    persistence.persistRun(run);
    persistence.persistIndex([run.runId]);
    await persistence.flush();

    const loaded = loadRunStore(stateDir, "2026-05-29T03:00:00.000Z");
    expect(loaded.runs.get("run-8")?.status).toBe("failed");
    expect(loaded.runs.get("run-8")?.failureReason).toBe("api_restart");
    expect(loaded.reconciledRunIds).toEqual(["run-8"]);
  });

  it("returns an empty store when nothing is persisted", () => {
    const loaded = loadRunStore(tempDir(), "2026-05-29T00:00:00.000Z");
    expect(loaded.runs.size).toBe(0);
  });

  it("skips a run id listed in the index but missing on disk", async () => {
    const stateDir = tempDir();
    const persistence = createRunStorePersistence(stateDir);
    persistence.persistIndex(["run-1", "run-2"]);
    persistence.persistRun(makeRun({ runId: "run-1" }));
    await persistence.flush();

    const loaded = loadRunStore(stateDir, "2026-05-29T00:00:00.000Z");
    expect([...loaded.runs.keys()]).toEqual(["run-1"]);
  });

  it("writes a versioned document", async () => {
    const stateDir = tempDir();
    const persistence = createRunStorePersistence(stateDir);
    persistence.persistRun(makeRun());
    await persistence.flush();
    const raw = JSON.parse(readFileSync(join(stateDir, "state", "runs", "run-1.json"), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.run.runId).toBe("run-1");
  });

  it("debounces the write so it lands after the window without an explicit flush", async () => {
    const stateDir = tempDir();
    const persistence = createRunStorePersistence(stateDir);
    persistence.persistRun(makeRun({ runId: "run-9" }));
    const path = join(stateDir, "state", "runs", "run-9.json");
    expect(existsSync(path)).toBe(false); // debounced — nothing written yet
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(existsSync(path)).toBe(true);
    await persistence.close();
  });

  it("does not rewrite identical content", async () => {
    const stateDir = tempDir();
    const persistence = createRunStorePersistence(stateDir);
    const run = makeRun({ runId: "run-1" });
    persistence.persistRun(run);
    await persistence.flush();
    const path = join(stateDir, "state", "runs", "run-1.json");
    const firstMtime = statSync(path).mtimeMs;

    persistence.persistRun(run); // identical → deduped, no second write
    await persistence.flush();
    expect(statSync(path).mtimeMs).toBe(firstMtime);
    await persistence.close();
  });
});
