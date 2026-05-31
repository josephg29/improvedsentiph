import type { RunStatus } from "@sentiph/core";

import type { GraphNode, PipelineStageNode } from "../../app/canvas/types";

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

// Stage colors.
const STAGE_COLOR: Record<PipelineStageNode["state"], string> = {
  pending: "#374151",
  running: "#1e59a3",
  passed: "#25a244",
  failed: "#880f1e",
};

const STAGE_GLYPH: Record<PipelineStageNode["role"], string> = {
  build: "B",
  check: "✓",
  fix: "F",
  approval: "?",
};

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

// Renders one stage node in the mini pipeline strip.
const StageNode = ({
  stage,
  cx,
  cy,
  r,
}: {
  stage: PipelineStageNode;
  cx: number;
  cy: number;
  r: number;
}) => {
  const fill = STAGE_COLOR[stage.state];
  const isRunning = stage.state === "running";
  return (
    <g>
      {isRunning && (
        <circle
          cx={cx}
          cy={cy}
          r={r + 3}
          fill={fill}
          opacity={0.22}
          className="pipeline-stage-pulse"
        />
      )}
      <circle cx={cx} cy={cy} r={r} fill={fill} opacity={stage.state === "pending" ? 0.4 : 1} />
      <text
        x={cx}
        y={cy + 3.2}
        textAnchor="middle"
        fontSize={5.5}
        fill="#fafafa"
        fontWeight={600}
        letterSpacing="0.01em"
      >
        {STAGE_GLYPH[stage.role]}
      </text>
      {/* Label below node */}
      <text
        x={cx}
        y={cy + r + 6}
        textAnchor="middle"
        fontSize={4.8}
        fill={stage.state === "pending" ? "#6b7280" : "#d1d5db"}
        letterSpacing="0.03em"
      >
        {stage.label.length > 6 ? stage.label.slice(0, 5) + "…" : stage.label}
      </text>
    </g>
  );
};

// Animated particles that flow along the edge between the previous stage and
// the currently running stage.
const FlowParticles = ({
  x1,
  y1,
  x2,
  y2,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}) => {
  const path = `M ${x1} ${y1} L ${x2} ${y2}`;
  return (
    <>
      {[0, 1, 2].map((i) => (
        <circle key={i} r={1.6} fill={color} opacity={0.85 - i * 0.2}>
          <animateMotion path={path} dur="1.1s" begin={`${i * 0.37}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </>
  );
};

// Renders the full pipeline strip: nodes connected by lines, with active flow.
const PipelineStrip = ({
  stages,
  y,
  runColor,
}: {
  stages: PipelineStageNode[];
  y: number;
  runColor: string;
}) => {
  if (stages.length === 0) return null;

  const NODE_R = 6;
  const SPACING = 20;
  const totalWidth = (stages.length - 1) * SPACING;
  const startX = -totalWidth / 2;

  const positions = stages.map((_, i) => ({
    cx: startX + i * SPACING,
    cy: y,
  }));

  return (
    <g className="pipeline-strip">
      {/* Connecting lines */}
      {positions.slice(0, -1).map((pos, i) => {
        const next = positions[i + 1]!;
        const isActive = stages[i + 1]?.state === "running";
        return (
          <line
            key={`line-${i}`}
            x1={pos.cx + NODE_R}
            y1={pos.cy}
            x2={next.cx - NODE_R}
            y2={next.cy}
            stroke={isActive ? stages[i + 1]!.state === "running" ? STAGE_COLOR.running : "#374151" : "#374151"}
            strokeWidth={1}
            strokeOpacity={0.5}
            strokeDasharray={isActive ? undefined : "2 2"}
          />
        );
      })}

      {/* Flow particles on the edge leading into the running node */}
      {positions.slice(0, -1).map((pos, i) => {
        const next = positions[i + 1]!;
        const nextStage = stages[i + 1];
        if (nextStage?.state !== "running") return null;
        return (
          <FlowParticles
            key={`flow-${i}`}
            x1={pos.cx + NODE_R}
            y1={pos.cy}
            x2={next.cx - NODE_R}
            y2={next.cy}
            color={runColor}
          />
        );
      })}

      {/* Stage nodes */}
      {stages.map((stage, i) => (
        <StageNode key={stage.stageId} stage={stage} cx={positions[i]!.cx} cy={positions[i]!.cy} r={NODE_R} />
      ))}
    </g>
  );
};

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
  const stages = node.pipelineStages ?? [];
  const hasStages = stages.length > 0;

  // Y offset for inline actions (depends on whether pipeline strip is shown).
  const actionsY = hasStages ? r + 52 : r + 28;
  const labelY = hasStages ? r + (isAwaiting || isActive ? 66 : 50) : r + 44;

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
      {/* build glyph */}
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

      {/* Pipeline strip — the ant farm */}
      {hasStages && (
        <PipelineStrip stages={stages} y={r + 30} runColor={node.color} />
      )}

      {/* inline actions */}
      {isAwaiting ? (
        <g transform={`translate(0, ${actionsY})`}>
          <ActionButton
            x={-17}
            label="APPROVE"
            fill="#25a244"
            onActivate={() => onApprove(runId)}
          />
          <ActionButton x={17} label="REJECT" fill="#880f1e" onActivate={() => onReject(runId)} />
        </g>
      ) : isActive ? (
        <g transform={`translate(0, ${actionsY})`}>
          <ActionButton x={0} label="CANCEL" fill="#880f1e" onActivate={() => onCancel(runId)} />
        </g>
      ) : null}

      {/* task label */}
      <text
        y={labelY}
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
