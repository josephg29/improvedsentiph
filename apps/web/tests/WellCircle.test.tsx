import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WellCircle } from "../src/components/canvas/WellCircle";

// WellCircle is the shared "well" body rendered by both HubNode and SessionNode,
// so its structure (halo + two concentric rings + solid core) is load-bearing
// for the canvas look. These assert the rendered SVG and that the caller's
// colors / opacity / extra class reach the core.
const renderWell = (props: Parameters<typeof WellCircle>[0]) =>
  render(
    <svg>
      <title>canvas</title>
      <WellCircle {...props} />
    </svg>,
  );

describe("WellCircle", () => {
  it("renders a halo, two concentric rings, and a core sized to the radius", () => {
    const { container } = renderWell({ radius: 20, coreColor: "#161616" });

    expect(container.querySelector(".canvas-well-halo")).not.toBeNull();
    expect(container.querySelectorAll(".canvas-well-ring")).toHaveLength(2);

    const core = container.querySelector(".canvas-well-core");
    expect(core).not.toBeNull();
    expect(core?.getAttribute("r")).toBe("20");
  });

  it("applies the caller's core color and opacity", () => {
    const { container } = renderWell({ radius: 16, coreColor: "#f59e0b", coreOpacity: 0.8 });
    const core = container.querySelector(".canvas-well-core");
    expect(core?.getAttribute("fill")).toBe("#f59e0b");
    expect(core?.getAttribute("opacity")).toBe("0.8");
  });

  it("merges an extra core class name when provided", () => {
    const { container } = renderWell({
      radius: 16,
      coreColor: "#161616",
      coreClassName: "canvas-well-core--live",
    });
    expect(
      container.querySelector(".canvas-well-core")?.classList.contains("canvas-well-core--live"),
    ).toBe(true);
  });

  it("uses caller-provided ring and halo colors", () => {
    const { container } = renderWell({
      radius: 16,
      coreColor: "#161616",
      ringColor: "#123456",
      haloColor: "#654321",
    });
    expect(container.querySelector(".canvas-well-halo")?.getAttribute("fill")).toBe("#654321");
    expect(container.querySelector(".canvas-well-ring--outer")?.getAttribute("stroke")).toBe(
      "#123456",
    );
  });
});
