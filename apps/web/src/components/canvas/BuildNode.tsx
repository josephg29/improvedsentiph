import type { RunStatus } from "@sentiph/core";

import type { GraphNode } from "../../app/canvas/types";

const STATUS_LABEL: Record<RunStatus, string> = {
  pending: "PENDING",
  building: "BUILDING",
  checking: "CHECKING",
  fixing: "FIXING",
  awaiting_approval: "APPROVE?",
  passed: "PASSED",
  completed_with_issues: "ISSUES",
  failed: "FAILED",
  cancelled: "CANCELLED",
};

const ACTIVE = new Set<RunStatus>(["pending", "building", "checking", "fixing"]);
const RUNNING = new Set<RunStatus>(["building", "checking", "fixing"]);

const truncate = (label: string, max: number) =>
  label.length <= max ? label : `${label.slice(0, max - 1)}…`;

interface BuildNodeProps {
  node: GraphNode;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onClick: (nodeId: string) => void;
  onApprove: (runId: string) => void;
  onReject: (runId: string) => void;
  onCancel: (runId: string) => void;
}

const ActionButton = ({
  x,
  label,
  fill,
  onActivate,
}: {
  x: number;
  label: string;
  fill: string;
  onActivate: () => void;
}) => (
  <g
    className="canvas-build-action"
    transform={`translate(${x}, 0)`}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation();
      onActivate();
    }}
    onKeyDown={(e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      onActivate();
    }}
    style={{ cursor: "pointer" }}
  >
    <rect x={-15} y={-7} width={30} height={14} rx={4} fill={fill} />
    <text textAnchor="middle" y={3} fontSize={7.5} fill="#fafafa" letterSpacing="0.05em">
      {label}
    </text>
  </g>
);

export const BuildNode = ({
  node,
  isSelected,
  onPointerDown,
  onClick,
  onApprove,
  onReject,
  onCancel,
}: BuildNodeProps) => {
  const status = node.runStatus ?? "pending";
  const r = node.radius;
  const runId = node.runId ?? "";
  const isRunning = RUNNING.has(status);
  const isAwaiting = status === "awaiting_approval";
  const isActive = ACTIVE.has(status);

  return (
    <g
      className={`canvas-node canvas-node--build${isSelected ? " canvas-node--selected" : ""}`}
      data-node-id={node.id}
      transform={`translate(${node.x}, ${node.y})`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onPointerDown(e, node.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick(node.id);
      }}
      style={{ cursor: "pointer" }}
    >
      {isSelected && (
        <rect
          x={-r - 5}
          y={-r - 5}
          width={(r + 5) * 2}
          height={(r + 5) * 2}
          rx={5}
          fill="#ffffff"
        />
      )}
      <rect
        className={`canvas-build-core${isRunning ? " canvas-build-core--pulse" : ""}`}
        x={-r}
        y={-r}
        width={r * 2}
        height={r * 2}
        rx={4}
        fill={node.color}
      />
      {/* tiny build glyph: a checkmark-ish mark */}
      <path
        d={`M ${-r * 0.45} 0 L ${-r * 0.1} ${r * 0.4} L ${r * 0.5} ${-r * 0.4}`}
        fill="none"
        stroke="#fafafa"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* status pill */}
      <g transform={`translate(0, ${r + 9})`}>
        <rect x={-26} y={-7} width={52} height={14} rx={7} fill={node.color} />
        <text textAnchor="middle" y={3} fontSize={7.5} fill="#fafafa" letterSpacing="0.06em">
          {STATUS_LABEL[status]}
        </text>
      </g>

      {/* inline actions */}
      {isAwaiting ? (
        <g transform={`translate(0, ${r + 28})`}>
          <ActionButton
            x={-17}
            label="APPROVE"
            fill="#25a244"
            onActivate={() => onApprove(runId)}
          />
          <ActionButton x={17} label="REJECT" fill="#880f1e" onActivate={() => onReject(runId)} />
        </g>
      ) : isActive ? (
        <g transform={`translate(0, ${r + 28})`}>
          <ActionButton x={0} label="CANCEL" fill="#880f1e" onActivate={() => onCancel(runId)} />
        </g>
      ) : null}

      {/* task label */}
      <text
        y={r + 44}
        textAnchor="middle"
        className="canvas-node-label"
        fill="var(--accent-primary)"
        fontSize={9}
      >
        {truncate(node.label, 26)}
      </text>
    </g>
  );
};
