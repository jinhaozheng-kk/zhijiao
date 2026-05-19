import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { putWechatState, consumeWechatState } from "../src/wechat-state.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

describe("wechat-state", () => {
  it("put → consume 拿回 payload", async () => {
    const s = await putWechatState(redis, { mode: "login" });
    const got = await consumeWechatState(redis, s);
    expect(got).toEqual({ mode: "login" });
  });
  it("second consume → null（一次性）", async () => {
    const s = await putWechatState(redis, { mode: "bind", userId: "u1" });
    await consumeWechatState(redis, s);
    expect(await consumeWechatState(redis, s)).toBeNull();
  });
  it("不存在 state → null", async () => {
    expect(await consumeWechatState(redis, "nope")).toBeNull();
  });
});
