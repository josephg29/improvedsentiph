import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WellCircle } from "../src/components/canvas/WellCircle";

describe("WellCircle", () => {
  it("renders a recessed well with a gradient fill", () => {
    const { container } = render(
      <svg>
        <title>canvas</title>
        <WellCircle radius={20} />
      </svg>,
    );

    const gradient = container.querySelector("radialGradient");
    expect(gradient).not.toBeNull();

    const id = gradient?.getAttribute("id") ?? "";
    expect(id.length).toBeGreaterThan(0);

    const filledCircle = Array.from(container.querySelectorAll("circle")).find((circle) =>
      circle.getAttribute("fill")?.startsWith("url(#"),
    );
    expect(filledCircle?.getAttribute("fill")).toBe(`url(#${id})`);
  });

  it("gives each instance a unique gradient id so multiple wells do not collide", () => {
    // Both HubNode and SessionNode render a WellCircle, so a populated canvas
    // mounts several at once. A hardcoded gradient id would produce duplicate
    // DOM ids, and url(#id) would resolve every well to the first definition.
    const { container } = render(
      <svg>
        <title>canvas</title>
        <WellCircle radius={20} />
        <WellCircle radius={20} isActive />
        <WellCircle radius={20} pulse />
      </svg>,
    );

    const ids = Array.from(container.querySelectorAll("radialGradient")).map((gradient) =>
      gradient.getAttribute("id"),
    );
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => Boolean(id))).toBe(true);
    expect(new Set(ids).size).toBe(3);

    // Every gradient-filled circle must point at an id that actually exists.
    const referencedIds = Array.from(container.querySelectorAll("circle"))
      .map((circle) => circle.getAttribute("fill"))
      .filter((fill): fill is string => Boolean(fill?.startsWith("url(#")))
      .map((fill) => fill.slice(5, -1));
    for (const referencedId of referencedIds) {
      expect(ids).toContain(referencedId);
    }
  });
});
