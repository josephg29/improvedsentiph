import { describe, expect, it } from "vitest";

import { validateAgainstSchema } from "../src/pipeline/schemaValidation";

const CHECKER_SCHEMA = {
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
};

describe("validateAgainstSchema", () => {
  it("accepts a valid object", () => {
    const result = validateAgainstSchema(
      { name: "x" },
      { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing required property", () => {
    const result = validateAgainstSchema(
      {},
      { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('missing required property "name"');
  });

  it("rejects a property of the wrong type", () => {
    const result = validateAgainstSchema(
      { name: 42 },
      { type: "object", properties: { name: { type: "string" } } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must be of type "string"');
  });

  it("rejects a value outside an enum", () => {
    const result = validateAgainstSchema("maybe", { enum: ["pass", "needs_fix"] });
    expect(result.valid).toBe(false);
  });

  it("accepts a value inside an enum", () => {
    expect(validateAgainstSchema("pass", { enum: ["pass", "needs_fix"] }).valid).toBe(true);
  });

  it("rejects a top-level type mismatch", () => {
    expect(validateAgainstSchema("nope", { type: "object" }).valid).toBe(false);
  });

  it("validates array items recursively", () => {
    const result = validateAgainstSchema(
      { verdict: "needs_fix", issues: [{ severity: "huge", location: "a", problem: "b" }] },
      CHECKER_SCHEMA,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("issues[0].severity"))).toBe(true);
  });

  it("accepts a real passing checker verdict", () => {
    expect(validateAgainstSchema({ verdict: "pass", issues: [] }, CHECKER_SCHEMA).valid).toBe(true);
  });

  it("accepts a real needs_fix checker verdict with issues", () => {
    const value = {
      verdict: "needs_fix",
      issues: [{ severity: "high", location: "a.ts:1", problem: "leak", suggestion: "free it" }],
    };
    expect(validateAgainstSchema(value, CHECKER_SCHEMA).valid).toBe(true);
  });

  it("accepts an unconstrained schema", () => {
    expect(validateAgainstSchema({ anything: true }, {}).valid).toBe(true);
  });
});
