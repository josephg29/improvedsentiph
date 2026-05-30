import { describe, expect, it } from "vitest";

import { pickRecipe } from "../src/pipeline/recipePicker";

describe("pickRecipe", () => {
  it("defaults to the standard recipe", () => {
    expect(pickRecipe("Add a new endpoint that returns the user list")).toBe("standard");
  });

  it("picks careful for risky tasks", () => {
    expect(pickRecipe("Refactor the authentication flow")).toBe("careful");
    expect(pickRecipe("Update the payment processing logic")).toBe("careful");
    expect(pickRecipe("Run the database migration on production")).toBe("careful");
    expect(pickRecipe("Rotate the API secret token")).toBe("careful");
  });

  it("picks quick for short, trivial tasks", () => {
    expect(pickRecipe("Fix a typo in the heading")).toBe("quick");
    expect(pickRecipe("Update the README intro")).toBe("quick");
  });

  it("does not treat a long task as trivial even with a trivial word", () => {
    const longTypoTask =
      "Fix a typo in the heading and also rewrite the entire onboarding flow, the billing screen, and the dashboard layout end to end";
    // Contains "billing" → careful wins regardless of length.
    expect(pickRecipe(longTypoTask)).toBe("careful");
  });

  it("is case-insensitive", () => {
    expect(pickRecipe("ADD AUTHENTICATION")).toBe("careful");
  });

  it("is deterministic", () => {
    const task = "Refactor the security middleware";
    expect(pickRecipe(task)).toBe(pickRecipe(task));
  });
});
