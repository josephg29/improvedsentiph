import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionNode } from "../../src/components/canvas/SessionNode";
import type { GraphNode } from "../../src/app/canvas/types";

const baseNode: GraphNode = {
  id: "a:t1",
  type: "active-session",
  x: 100,
  y: 100,
  vx: 0,
  vy: 0,
  pinned: false,
  radius: 12,
  agentId: "t1",
  label: "My Agent",
  color: "#1e59a3",
  hasUserPrompt: true,
  agentState: "live",
};

const noop = () => {};

describe("SessionNode", () => {
  it("renders the agent label", () => {
    const { container } = render(
      <svg>
        <SessionNode node={baseNode} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.querySelector("text")).toBeTruthy();
    expect(container.textContent).toContain("My Agent");
  });

  it("renders a worktree ring when workspaceMode is worktree", () => {
    const node: GraphNode = { ...baseNode, workspaceMode: "worktree" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    const ring = container.querySelector(".canvas-node-ring--worktree");
    expect(ring).toBeTruthy();
  });

  it("does not render worktree ring for shared workspace", () => {
    const node: GraphNode = { ...baseNode, workspaceMode: "shared" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.querySelector(".canvas-node-ring--worktree")).toBeNull();
  });

  it("renders swarm worker rings when parentTerminalId is set", () => {
    const node: GraphNode = { ...baseNode, parentTerminalId: "t0" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.querySelector(".canvas-node-ring--swarm")).toBeTruthy();
    expect(container.querySelector(".canvas-node-ring--swarm-outer")).toBeTruthy();
  });

  it("renders stale pill for stale agents", () => {
    const node: GraphNode = { ...baseNode, agentState: "stale" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("STALE");
  });

  it("renders exited pill for exited agents", () => {
    const node: GraphNode = { ...baseNode, agentState: "exited" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("EXITED");
  });

  it("renders stopped pill for stopped agents", () => {
    const node: GraphNode = { ...baseNode, agentState: "stopped" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("STOPPED");
  });

  it("renders permission tool name in pill when waiting for permission", () => {
    const node: GraphNode = {
      ...baseNode,
      agentRuntimeState: "waiting_for_permission",
      waitingToolName: "Bash",
    };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("Bash");
  });

  it("renders WAITING pill when waiting for user", () => {
    const node: GraphNode = { ...baseNode, agentRuntimeState: "waiting_for_user" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("WAITING");
  });

  it("renders a focus glow when selected", () => {
    const { container } = render(
      <svg>
        <SessionNode node={baseNode} isSelected={true} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.querySelector(".canvas-node-focus-glow")).toBeTruthy();
  });

  it("applies active class when agent has user prompt", () => {
    const { container } = render(
      <svg>
        <SessionNode node={{ ...baseNode, hasUserPrompt: true }} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.querySelector(".canvas-node--active")).toBeTruthy();
  });

  it("applies inactive class when agent has no user prompt", () => {
    const { container } = render(
      <svg>
        <SessionNode node={{ ...baseNode, hasUserPrompt: false }} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    expect(container.querySelector(".canvas-node--inactive")).toBeTruthy();
  });

  it("splits long labels at a space near the midpoint", () => {
    const node: GraphNode = { ...baseNode, label: "Refactoring the authentication module" };
    const { container } = render(
      <svg>
        <SessionNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} />
      </svg>,
    );
    // Two tspan elements expected for the split label
    expect(container.querySelectorAll("tspan").length).toBeGreaterThanOrEqual(2);
  });
});
