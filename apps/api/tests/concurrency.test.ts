import { describe, expect, it } from "vitest";

import { createLimiter } from "../src/pipeline/concurrency";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createLimiter", () => {
  it("never exceeds the configured concurrency", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      active -= 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => limit(task)));
    expect(maxActive).toBe(2);
  });

  it("serializes when the cap is 1", async () => {
    const limit = createLimiter(1);
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      active -= 1;
    };
    await Promise.all(Array.from({ length: 4 }, () => limit(task)));
    expect(maxActive).toBe(1);
  });

  it("runs every task and returns each result", async () => {
    const limit = createLimiter(3);
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(async () => n * 2)));
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("propagates task rejections and keeps draining the queue", async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(async () => "ok")).resolves.toBe("ok");
  });
});
