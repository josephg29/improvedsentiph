import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BuildNode } from "../../src/components/canvas/BuildNode";
import type { GraphNode } from "../../src/app/canvas/types";

const baseNode: GraphNode = {
  id: "b:run-1",
  type: "build",
  x: 200,
  y: 200,
  vx: 0,
  vy: 0,
  pinned: false,
  radius: 10,
  agentId: "run-1",
  label: "Add user auth flow",
  color: "#1e59a3",
  runId: "run-1",
  runStatus: "pending",
};

const noop = () => {};

describe("BuildNode", () => {
  it("renders PENDING status label by default", () => {
    const { container } = render(
      <svg>
        <BuildNode node={baseNode} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("PENDING");
  });

  it("renders BUILDING status while building", () => {
    const node: GraphNode = { ...baseNode, runStatus: "building", color: "#1e59a3" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("BUILDING");
  });

  it("renders PASSED label when run passed", () => {
    const node: GraphNode = { ...baseNode, runStatus: "passed", color: "#25a244" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("PASSED");
  });

  it("renders FAILED label when run failed", () => {
    const node: GraphNode = { ...baseNode, runStatus: "failed", color: "#880f1e" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("FAILED");
  });

  it("renders APPROVE and REJECT buttons when awaiting approval", () => {
    const node: GraphNode = { ...baseNode, runStatus: "awaiting_approval", color: "#b87000" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("APPROVE");
    expect(container.textContent).toContain("REJECT");
  });

  it("calls onApprove with runId when APPROVE is clicked", () => {
    const onApprove = vi.fn();
    const node: GraphNode = { ...baseNode, runStatus: "awaiting_approval" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={onApprove} onReject={noop} onCancel={noop} />
      </svg>,
    );
    const groups = container.querySelectorAll(".canvas-build-action");
    const approveGroup = Array.from(groups).find((g) => g.textContent?.includes("APPROVE"));
    if (approveGroup) {
      fireEvent.click(approveGroup);
    }
    expect(onApprove).toHaveBeenCalledWith("run-1");
  });

  it("calls onReject with runId when REJECT is clicked", () => {
    const onReject = vi.fn();
    const node: GraphNode = { ...baseNode, runStatus: "awaiting_approval" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={onReject} onCancel={noop} />
      </svg>,
    );
    const groups = container.querySelectorAll(".canvas-build-action");
    const rejectGroup = Array.from(groups).find((g) => g.textContent?.includes("REJECT"));
    if (rejectGroup) {
      fireEvent.click(rejectGroup);
    }
    expect(onReject).toHaveBeenCalledWith("run-1");
  });

  it("renders CANCEL button when building", () => {
    const node: GraphNode = { ...baseNode, runStatus: "building" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.textContent).toContain("CANCEL");
  });

  it("calls onCancel with runId when CANCEL is clicked", () => {
    const onCancel = vi.fn();
    const node: GraphNode = { ...baseNode, runStatus: "building" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={onCancel} />
      </svg>,
    );
    const cancelGroup = container.querySelector(".canvas-build-action");
    if (cancelGroup) {
      fireEvent.click(cancelGroup);
    }
    expect(onCancel).toHaveBeenCalledWith("run-1");
  });

  it("does not render action buttons for terminal statuses", () => {
    const node: GraphNode = { ...baseNode, runStatus: "passed" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.querySelector(".canvas-build-action")).toBeNull();
  });

  it("renders task label truncated to 26 chars", () => {
    const node: GraphNode = { ...baseNode, label: "A very long task description that should be truncated" };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    // label is in a .canvas-node-label text element — check it's within length
    const labelEl = container.querySelector(".canvas-node-label");
    expect(labelEl?.textContent?.length).toBeLessThanOrEqual(26);
  });

  it("renders pipeline strip when pipelineStages are provided", () => {
    const node: GraphNode = {
      ...baseNode,
      runStatus: "checking",
      pipelineStages: [
        { stageId: "build-0", role: "build", label: "BUILD", state: "passed", index: 0 },
        { stageId: "check-0", role: "check", label: "CHK", state: "running", index: 0 },
      ],
    };
    const { container } = render(
      <svg>
        <BuildNode node={node} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.querySelector(".pipeline-strip")).toBeTruthy();
  });

  it("does not render pipeline strip when no pipelineStages provided", () => {
    const { container } = render(
      <svg>
        <BuildNode node={baseNode} isSelected={false} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    expect(container.querySelector(".pipeline-strip")).toBeNull();
  });

  it("renders a selected highlight rect when isSelected", () => {
    const { container } = render(
      <svg>
        <BuildNode node={baseNode} isSelected={true} onPointerDown={noop} onClick={noop} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    // First rect should be the selection highlight (white fill)
    const rects = container.querySelectorAll("rect");
    const whiteFillRect = Array.from(rects).find((r) => r.getAttribute("fill") === "#ffffff");
    expect(whiteFillRect).toBeTruthy();
  });

  it("calls onClick with node id when clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <svg>
        <BuildNode node={baseNode} isSelected={false} onPointerDown={noop} onClick={onClick} onApprove={noop} onReject={noop} onCancel={noop} />
      </svg>,
    );
    const group = container.querySelector(".canvas-node--build");
    if (group) fireEvent.click(group);
    expect(onClick).toHaveBeenCalledWith("b:run-1");
  });
});
