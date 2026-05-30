import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { redis } from "@/lib/redis";
import { getCachedJson, ANALYTICS_TTL_SEC } from "@/server/lib/learning-cache";

describe("getCachedJson", () => {
  const key = "analytics:test:cache:1";
  beforeAll(async () => {
    await redis.del(key);
  });
  afterAll(async () => {
    await redis.del(key);
  });

  it("calls loader on miss, caches on hit", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return { n: 42 };
    };
    const first = await getCachedJson(key, ANALYTICS_TTL_SEC, loader);
    const second = await getCachedJson(key, ANALYTICS_TTL_SEC, loader);
    expect(first).toEqual({ n: 42 });
    expect(second).toEqual({ n: 42 });
    expect(calls).toBe(1); // 第二次命中缓存，loader 不再调
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ANALYTICS_TTL_SEC);
  });
});
