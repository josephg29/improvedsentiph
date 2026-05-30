import { describe, expect, it } from "vitest";

import {
  SENTIPH_SYSTEM_PROMPT,
  assertSentiphSystemPromptIsShellSafe,
} from "../src/sentiphSystemPrompt";

describe("sentiph system prompt", () => {
  it("is shell-safe (no $, backtick, double-quote, or backslash)", () => {
    // It is cat-substituted inside bash double quotes at bootstrap, so any of
    // these characters would break the launch command.
    expect(SENTIPH_SYSTEM_PROMPT).not.toMatch(/[$`"\\]/);
    expect(() => assertSentiphSystemPromptIsShellSafe(SENTIPH_SYSTEM_PROMPT)).not.toThrow();
  });

  it("throws on an unsafe prompt", () => {
    expect(() => assertSentiphSystemPromptIsShellSafe('has a "quote"')).toThrow();
    expect(() => assertSentiphSystemPromptIsShellSafe("has a $dollar")).toThrow();
  });

  it("describes the build-vs-worker routing", () => {
    expect(SENTIPH_SYSTEM_PROMPT).toContain("build(task)");
    expect(SENTIPH_SYSTEM_PROMPT).toContain("spawn_terminal");
    expect(SENTIPH_SYSTEM_PROMPT.toLowerCase()).toContain("changes code");
  });
});
