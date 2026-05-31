import type { PointerEvent } from "react";

import type { GraphNode } from "../../app/canvas/types";
import { WellCircle } from "./WellCircle";

// The hub renders as a small neutral-grey dot that the agent wells fan out from.
const HUB_CORE_COLOR = "#8a9098";

type HubNodeProps = {
  node: GraphNode;
  connectedNodes: GraphNode[];
  isSelected: boolean;
  selectedNodeId: string | null;
  selectedNodeColor: string | null;
  onPointerDown: (e: PointerEvent, nodeId: string) => void;
  onClick: (nodeId: string) => void;
};

const buildEdgePath = (
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  targetRadius: number,
): string => {
  const dx = tx - cx;
  const dy = ty - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return "";

  const shortenBy = targetRadius + 2;
  const endRatio = Math.max(0, (dist - shortenBy) / dist);
  const etx = cx + dx * endRatio;
  const ety = cy + dy * endRatio;

  const curvature = 0.3;
  const baseOffset = Math.max(35, dist * 0.3);
  const offsetX = (-dy / dist) * curvature * baseOffset;
  const offsetY = (dx / dist) * curvature * baseOffset;
  const cpx = (cx + etx) / 2 + offsetX;
  const cpy = (cy + ety) / 2 + offsetY;

  return `M ${cx} ${cy} Q ${cpx} ${cpy} ${etx} ${ety}`;
};

const isEdgeActivityVisible = (target: GraphNode): boolean =>
  target.type === "active-session" &&
  target.hasUserPrompt !== false &&
  target.agentRuntimeState !== undefined &&
  target.agentRuntimeState !== "idle";

const renderEdgeActivityDots = (path: string, color: string, keyPrefix: string) =>
  [0, 1, 2].flatMap((index) => [
    <circle
      key={`${keyPrefix}-trail-${index}`}
      className="canvas-edge-activity-dot canvas-edge-activity-dot--trail"
      r={4.6}
      fill={color}
      opacity={Math.max(0.14, 0.28 - index * 0.04)}
    >
      <animateMotion
        path={path}
        begin={`${index * 0.62}s`}
        dur="1.9s"
        repeatCount="indefinite"
        rotate="auto"
      />
      <animate
        attributeName="r"
        values="3.8;5.2;3.8"
        dur="1.9s"
        begin={`${index * 0.62}s`}
        repeatCount="indefinite"
      />
    </circle>,
    <circle
      key={`${keyPrefix}-dot-${index}`}
      className="canvas-edge-activity-dot"
      r={3.2}
      fill="#fff4cc"
      stroke={color}
      strokeWidth={1.2}
      opacity={Math.max(0.7, 1 - index * 0.08)}
    >
      <animateMotion
        path={path}
        begin={`${index * 0.62}s`}
        dur="1.9s"
        repeatCount="indefinite"
        rotate="auto"
      />
      <animate
        attributeName="r"
        values="2.8;3.8;2.8"
        dur="1.9s"
        begin={`${index * 0.62}s`}
        repeatCount="indefinite"
      />
    </circle>,
  ]);

// The always-present root node. Rendered as a single color-coded circle (no
// mascot) with its outgoing edges to the agent nodes it spawned.
export const HubNode = ({
  node,
  connectedNodes,
  isSelected,
  selectedNodeId,
  selectedNodeColor,
  onPointerDown,
  onClick,
}: HubNodeProps) => {
  const color = node.color;

  return (
    <g
      className={`canvas-node canvas-node--hub${isSelected ? " canvas-node--selected" : ""}`}
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
      style={{ cursor: "grab" }}
    >
      {/* Invisible hit area — kept comfortably grabbable even as the dot shrinks */}
      <circle r={Math.max(node.radius + 6, 16)} fill="transparent" />

      {/* Edges to connected agent nodes */}
      {connectedNodes.map((target) => {
        const active = isSelected || target.id === selectedNodeId;
        const path = buildEdgePath(0, 0, target.x - node.x, target.y - node.y, target.radius);
        return (
          <g key={target.id}>
            <path
              className="canvas-edge"
              d={path}
              fill="none"
              stroke={active ? (selectedNodeColor ?? color) : "#C0C0C0"}
              strokeWidth={active ? 2 : 1.5}
              strokeOpacity={1}
            />
            {isEdgeActivityVisible(target)
              ? renderEdgeActivityDots(
                  path,
                  active ? (selectedNodeColor ?? color) : color,
                  target.id,
                )
              : null}
          </g>
        );
      })}

      {isSelected && (
        <circle className="canvas-node-focus-glow" r={node.radius + 10} fill="#ffffff" />
      )}

      {/* Small grey "well" dot */}
      <WellCircle radius={node.radius} coreColor={HUB_CORE_COLOR} />

      <text
        y={node.radius + 16}
        textAnchor="middle"
        className="canvas-node-label canvas-node-label--always"
        fill="#3a3a3a"
      >
        <tspan x="0" dy="0">
          {node.label}
        </tspan>
      </text>
    </g>
  );
};
