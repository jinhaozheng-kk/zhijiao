import { describe, it, expect } from "vitest";
import { InMemoryRateLimitStore } from "../src/ratelimit/in-memory-store.js";

describe("InMemoryRateLimitStore", () => {
  it("空桶满容；先 capacity 次全过，第 capacity+1 次拒", async () => {
    const s = new InMemoryRateLimitStore();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const d = await s.take("k", 5, 1, 1, now);
      expect(d.allowed).toBe(true);
    }
    const blocked = await s.take("k", 5, 1, 1, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("时间推进按 refillPerSec 回血", async () => {
    const s = new InMemoryRateLimitStore();
    for (let i = 0; i < 5; i++) await s.take("k", 5, 1, 1, 1_000_000);
    const blocked = await s.take("k", 5, 1, 1, 1_000_000);
    expect(blocked.allowed).toBe(false);
    // 1 秒后回 1 token
    const ok = await s.take("k", 5, 1, 1, 1_001_000);
    expect(ok.allowed).toBe(true);
  });

  it("不同 bucket key 独立", async () => {
    const s = new InMemoryRateLimitStore();
    for (let i = 0; i < 5; i++) await s.take("k1", 5, 1, 1, 1_000_000);
    const ok = await s.take("k2", 5, 1, 1, 1_000_000);
    expect(ok.allowed).toBe(true);
  });
});
