import { describe, expect, it } from "vitest";

import { retainActiveTerminalEntries, retainActiveTerminalIds } from "../src/app/terminalState";

describe("terminalState helpers", () => {
  it("retains active terminal ids and preserves reference when unchanged", () => {
    const currentTerminalIds = ["agent-1", "agent-2"];
    const activeTerminalIds = new Set(["agent-1", "agent-2", "agent-3"]);

    const nextTerminalIds = retainActiveTerminalIds(currentTerminalIds, activeTerminalIds);

    expect(nextTerminalIds).toBe(currentTerminalIds);
  });

  it("filters removed terminal ids", () => {
    const currentTerminalIds = ["agent-1", "agent-2"];
    const activeTerminalIds = new Set(["agent-2"]);

    const nextTerminalIds = retainActiveTerminalIds(currentTerminalIds, activeTerminalIds);

    expect(nextTerminalIds).toEqual(["agent-2"]);
  });

  it("retains active terminal state entries and preserves reference when unchanged", () => {
    const currentState = {
      "agent-1": "idle",
      "agent-2": "processing",
    };
    const activeTerminalIds = new Set(["agent-1", "agent-2"]);

    const nextState = retainActiveTerminalEntries(currentState, activeTerminalIds);

    expect(nextState).toBe(currentState);
  });

  it("filters removed terminal state entries", () => {
    const currentState = {
      "agent-1": "idle",
      "agent-2": "processing",
    };
    const activeTerminalIds = new Set(["agent-2"]);

    const nextState = retainActiveTerminalEntries(currentState, activeTerminalIds);

    expect(nextState).toEqual({
      "agent-2": "processing",
    });
  });
});
