/**
 * The recipe picker — deterministic, never an LLM.
 *
 * The core principle is "control flow is never decided by an LLM". Choosing how
 * much verification a task warrants is control flow, so the picker is pure,
 * keyword-driven code with exhaustive tests. Risky tasks earn the careful recipe
 * (more checkers + a human gate); trivial ones earn the quick recipe; everything
 * else gets the standard build → check → fix.
 */

import { CAREFUL_RECIPE, DEFAULT_RECIPE_ID, QUICK_RECIPE } from "./recipes";

// Risk signals → the careful recipe (3 checkers + human approval). Safety wins,
// so these are checked first.
const CAREFUL_SIGNALS = [
  "security",
  "auth",
  "authentication",
  "password",
  "secret",
  "token",
  "credential",
  "encryption",
  "payment",
  "billing",
  "migration",
  "production",
  "deploy",
  "delete",
  "drop table",
  "drop database",
];

// Trivial signals → the quick recipe (one checker, no fix loop).
const QUICK_SIGNALS = [
  "typo",
  "rename",
  "comment",
  "docstring",
  "readme",
  "changelog",
  "formatting",
  "whitespace",
  "wording",
];

const containsAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

/** Pick a recipe id for a task. Deterministic: same task → same recipe, always. */
export const pickRecipe = (task: string): string => {
  const normalized = task.toLowerCase();

  if (containsAny(normalized, CAREFUL_SIGNALS)) {
    return CAREFUL_RECIPE.id;
  }

  // Quick only for short, trivial tasks — a long task is rarely trivial.
  if (normalized.length <= 80 && containsAny(normalized, QUICK_SIGNALS)) {
    return QUICK_RECIPE.id;
  }

  return DEFAULT_RECIPE_ID;
};
