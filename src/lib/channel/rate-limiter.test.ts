import { describe, expect, it } from "vitest";

import { SlidingWindowRateLimiter } from "./rate-limiter";

describe("SlidingWindowRateLimiter", () => {
  it("allows up to maxHits in the configured window", () => {
    const limiter = new SlidingWindowRateLimiter({
      maxHits: 2,
      windowMs: 60_000,
    });

    const now = new Date("2026-02-13T10:00:00.000Z");

    expect(limiter.allow("user-1", now)).toBe(true);
    expect(limiter.allow("user-1", now)).toBe(true);
    expect(limiter.allow("user-1", now)).toBe(false);
  });

  it("resets capacity when the window passes", () => {
    const limiter = new SlidingWindowRateLimiter({
      maxHits: 1,
      windowMs: 1_000,
    });

    expect(limiter.allow("user-2", new Date("2026-02-13T10:00:00.000Z"))).toBe(true);
    expect(limiter.allow("user-2", new Date("2026-02-13T10:00:00.500Z"))).toBe(false);
    expect(limiter.allow("user-2", new Date("2026-02-13T10:00:01.500Z"))).toBe(true);
  });
});
