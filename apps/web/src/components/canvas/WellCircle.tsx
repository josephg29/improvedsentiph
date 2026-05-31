// Shared "well" node body — a solid dark core sitting inside soft concentric
// grey rings with a faint halo, giving each canvas node the recessed
// black-hole look. Used by both the hub and agent session nodes so the two
// stay visually consistent (CLAUDE.md: extract shared behavior).

type WellCircleProps = {
  radius: number;
  coreColor: string;
  coreOpacity?: number;
  ringColor?: string;
  haloColor?: string;
  coreClassName?: string;
};

const DEFAULT_RING_COLOR = "#b9bdc4";
const DEFAULT_HALO_COLOR = "#aeb2b8";

export const WellCircle = ({
  radius,
  coreColor,
  coreOpacity = 1,
  ringColor = DEFAULT_RING_COLOR,
  haloColor = DEFAULT_HALO_COLOR,
  coreClassName = "",
}: WellCircleProps) => (
  <>
    {/* Soft halo — the recessed "well" shadow behind the core */}
    <circle className="canvas-well-halo" r={radius + 9} fill={haloColor} />

    {/* Concentric grey rings, fading outward */}
    <circle
      className="canvas-well-ring canvas-well-ring--outer"
      r={radius + 6}
      fill="none"
      stroke={ringColor}
    />
    <circle
      className="canvas-well-ring canvas-well-ring--inner"
      r={radius + 3}
      fill="none"
      stroke={ringColor}
    />

    {/* Solid dark core */}
    <circle
      className={`canvas-node-core canvas-well-core${coreClassName ? ` ${coreClassName}` : ""}`}
      r={radius}
      fill={coreColor}
      opacity={coreOpacity}
    />
  </>
);
