/**
 * Recipe registry. Recipes are *data* — declarative stage lists, not prose. The
 * deterministic conductor walks them; the pure router decides routing. v1 ships
 * a single hard-coded "standard" recipe (build → check ×2 → fix → done). A smart
 * picker and a "careful" recipe arrive in M6.
 */

import type { Recipe } from "@sentiph/core";

const BUILD_OUTPUT_SCHEMA = {
  type: "object",
  required: ["summary", "filesTouched", "done"],
  properties: {
    summary: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
    done: { type: "boolean" },
    notes: { type: "string" },
  },
} as const;

const CHECK_OUTPUT_SCHEMA = {
  type: "object",
  required: ["verdict", "issues"],
  properties: {
    verdict: { enum: ["pass", "needs_fix"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "location", "problem"],
        properties: {
          severity: { enum: ["low", "medium", "high"] },
          location: { type: "string" },
          problem: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
} as const;

const FIX_OUTPUT_SCHEMA = {
  type: "object",
  required: ["summary", "resolved", "done"],
  properties: {
    summary: { type: "string" },
    resolved: { type: "array", items: { type: "string" } },
    unresolved: { type: "array", items: { type: "string" } },
    done: { type: "boolean" },
  },
} as const;

export const STANDARD_RECIPE: Recipe = {
  id: "standard",
  title: "Standard (build → check → fix)",
  maxFixCycles: 1,
  stages: [
    {
      id: "build",
      role: "build",
      model: "sonnet",
      effort: "medium",
      toolPolicy: "full",
      systemPrompt:
        "You are the builder in an automated pipeline. Implement the requested task in this " +
        "workspace, making real edits. When finished, report a short summary, the list of files " +
        "you touched, and whether the task is done. Return only the requested JSON.",
      outputSchema: BUILD_OUTPUT_SCHEMA,
    },
    {
      id: "check",
      role: "check",
      model: "sonnet",
      effort: "medium",
      fanout: 2,
      toolPolicy: "read-only",
      systemPrompt:
        "You are an independent reviewer in an automated pipeline. Inspect the change for the " +
        "task without modifying anything. Return a verdict of 'pass' or 'needs_fix' and a list of " +
        "concrete issues (severity, location, problem, optional suggestion). Flag a 'high' " +
        "severity issue only for a real defect. Return only the requested JSON.",
      outputSchema: CHECK_OUTPUT_SCHEMA,
    },
    {
      id: "fix",
      role: "fix",
      model: "sonnet",
      effort: "medium",
      toolPolicy: "full",
      systemPrompt:
        "You are the fixer in an automated pipeline. Resolve the issues raised by the reviewers " +
        "by making real edits in this workspace. When finished, report a short summary, which " +
        "issues you resolved, which remain unresolved, and whether you are done. Return only the " +
        "requested JSON.",
      outputSchema: FIX_OUTPUT_SCHEMA,
    },
  ],
};

export const DEFAULT_RECIPE_ID = STANDARD_RECIPE.id;

const RECIPES: ReadonlyMap<string, Recipe> = new Map([[STANDARD_RECIPE.id, STANDARD_RECIPE]]);

export const getRecipe = (recipeId: string): Recipe | undefined => RECIPES.get(recipeId);

export const listRecipes = (): Recipe[] => [...RECIPES.values()];
