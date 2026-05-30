import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePipelineRuns } from "../src/app/pipelines/usePipelineRuns";
import { MockWebSocket, jsonResponse, resetAppTestHarness } from "./test-utils/appTestHarness";

const HookProbe = () => {
  const { runs, selectedRun } = usePipelineRuns();
  return (
    <output aria-label="runs">
      {JSON.stringify({
        runs: runs.map((run) => ({ id: run.runId, status: run.status })),
        selected: selectedRun?.runId ?? null,
      })}
    </output>
  );
};

const summary = (runId: string, status = "passed", updatedAt = "2026-05-29T00:00:00.000Z") => ({
  runId,
  status,
  task: "do it",
  recipeId: "standard",
  createdAt: updatedAt,
  updatedAt,
});

const probeText = () => screen.getByLabelText("runs").textContent ?? "";

const firstSocket = () => {
  const socket = MockWebSocket.instances[0];
  if (!socket) {
    throw new Error("no socket opened");
  }
  return socket;
};

afterEach(() => {
  resetAppTestHarness();
});

describe("usePipelineRuns", () => {
  it("loads the initial run list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([summary("run-1"), summary("run-2")])),
    );
    render(<HookProbe />);
    await waitFor(() => expect(probeText()).toContain("run-1"));
    expect(probeText()).toContain("run-2");
  });

  it("applies a run-updated frame from the socket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    render(<HookProbe />);
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    act(() => {
      firstSocket().emit(
        "message",
        JSON.stringify({
          type: "run-updated",
          run: { ...summary("run-9", "building"), outcomes: [] },
        }),
      );
    });

    await waitFor(() => expect(probeText()).toContain("run-9"));
    expect(probeText()).toContain("building");
  });

  it("ignores unrelated and non-JSON socket frames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    render(<HookProbe />);
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    act(() => {
      firstSocket().emit("message", JSON.stringify({ type: "terminal-updated" }));
      firstSocket().emit("message", "not json");
    });

    expect(probeText()).toContain('"runs":[]');
  });

  it("closes the socket on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    const { unmount } = render(<HookProbe />);
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const socket = firstSocket();
    unmount();
    expect(socket.close).toHaveBeenCalled();
  });
});
