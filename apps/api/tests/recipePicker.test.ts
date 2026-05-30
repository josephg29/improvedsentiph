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

  it("picks large for open-ended build tasks", () => {
    expect(pickRecipe("Build me a game where you are homeless")).toBe("large");
    expect(pickRecipe("Build a full e-commerce platform")).toBe("large");
    expect(pickRecipe("Create a complete dashboard from scratch")).toBe("large");
    expect(pickRecipe("Implement a full stack blog application")).toBe("large");
  });

  it("careful beats large when both signals are present", () => {
    expect(pickRecipe("Build a complete authentication system from scratch")).toBe("careful");
    expect(pickRecipe("Build a full payment processing module")).toBe("careful");
  });

  it("is case-insensitive", () => {
    expect(pickRecipe("ADD AUTHENTICATION")).toBe("careful");
  });

  it("is deterministic", () => {
    const task = "Refactor the security middleware";
    expect(pickRecipe(task)).toBe(pickRecipe(task));
  });

  it("prefers careful when a task has both careful and quick signals", () => {
    expect(pickRecipe("Fix a typo in the auth login screen")).toBe("careful");
  });

  it("only treats short tasks as quick at the length boundary", () => {
    const word = "typo";
    const short = `${word} ${"x".repeat(80 - word.length - 1)}`; // 80 chars
    const long = `${word} ${"x".repeat(80 - word.length)}`; // 81 chars
    expect(short.length).toBe(80);
    expect(long.length).toBe(81);
    expect(pickRecipe(short)).toBe("quick");
    expect(pickRecipe(long)).toBe("standard");
  });
});
