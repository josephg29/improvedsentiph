import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECIPE_ID,
  LARGE_RECIPE,
  STANDARD_RECIPE,
  getRecipe,
  listRecipes,
} from "../src/pipeline/recipes";

describe("standard recipe", () => {
  it("is the default recipe", () => {
    expect(DEFAULT_RECIPE_ID).toBe("standard");
    expect(getRecipe("standard")).toBe(STANDARD_RECIPE);
  });

  it("has build → check → fix in order", () => {
    expect(STANDARD_RECIPE.stages.map((stage) => stage.role)).toEqual(["build", "check", "fix"]);
  });

  it("runs two read-only checkers and full-tool build/fix", () => {
    const byRole = (role: string) => STANDARD_RECIPE.stages.find((stage) => stage.role === role);
    expect(byRole("check")?.fanout).toBe(2);
    expect(byRole("check")?.toolPolicy).toBe("read-only");
    expect(byRole("build")?.toolPolicy).toBe("full");
    expect(byRole("fix")?.toolPolicy).toBe("full");
  });

  it("bounds the fix loop to a single cycle", () => {
    expect(STANDARD_RECIPE.maxFixCycles).toBe(1);
  });

  it("gives every stage an output schema and a system prompt", () => {
    for (const stage of STANDARD_RECIPE.stages) {
      expect(typeof stage.outputSchema).toBe("object");
      expect(stage.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it("returns undefined for an unknown recipe and lists the known ones", () => {
    expect(getRecipe("nope")).toBeUndefined();
    expect(listRecipes().map((recipe) => recipe.id)).toEqual([
      "standard",
      "quick",
      "careful",
      "large",
    ]);
  });

  it("quick skips the fix loop", () => {
    const quick = getRecipe("quick");
    expect(quick?.maxFixCycles).toBe(0);
    expect(quick?.stages.map((stage) => stage.role)).toEqual(["build", "check"]);
  });

  it("careful adds three checkers and a human approval gate", () => {
    const careful = getRecipe("careful");
    expect(careful?.stages.map((stage) => stage.role)).toEqual([
      "build",
      "check",
      "fix",
      "approval",
    ]);
    expect(careful?.stages.find((stage) => stage.role === "check")?.fanout).toBe(3);
  });

  it("large has plan → build×3 → integrate → check×3 → fix", () => {
    expect(LARGE_RECIPE.stages.map((stage) => stage.role)).toEqual([
      "plan",
      "build",
      "integrate",
      "check",
      "fix",
    ]);
    expect(LARGE_RECIPE.stages.find((s) => s.role === "build")?.fanout).toBe(3);
    expect(LARGE_RECIPE.stages.find((s) => s.role === "check")?.fanout).toBe(3);
    expect(LARGE_RECIPE.stages.find((s) => s.role === "plan")?.model).toBe("opus");
    expect(LARGE_RECIPE.stages.find((s) => s.role === "integrate")?.model).toBe("opus");
    expect(LARGE_RECIPE.stages.find((s) => s.role === "plan")?.toolPolicy).toBe("read-only");
    expect(LARGE_RECIPE.stages.find((s) => s.role === "integrate")?.toolPolicy).toBe("full");
  });
});
