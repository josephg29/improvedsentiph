import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECIPE_ID,
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
    expect(listRecipes().map((recipe) => recipe.id)).toEqual(["standard"]);
  });
});
