import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import Redis from "ioredis";
import { putRegisterPayload, peekRegisterPayload, markRegisterUsed, abortRegister } from "../src/register-payload.js";
import { AuthError } from "../src/errors.js";

const URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const redis = new Redis(URL);

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

const PAYLOAD = { provider: "PHONE" as const, providerScope: "GLOBAL", providerUserId: "13800001234" };

describe("register-payload", () => {
  it("put → peek 返 payload", async () => {
    const nonce = await putRegisterPayload(redis, PAYLOAD);
    const got = await peekRegisterPayload(redis, nonce);
    expect(got).toEqual(PAYLOAD);
  });
  it("不存在 nonce → REGISTER_TOKEN_MISSING", async () => {
    await expect(peekRegisterPayload(redis, "nope")).rejects.toMatchObject({ reason: "REGISTER_TOKEN_MISSING" });
  });
  it("markUsed 后 peek → REGISTER_TOKEN_MISSING", async () => {
    const nonce = await putRegisterPayload(redis, PAYLOAD);
    await markRegisterUsed(redis, nonce, PAYLOAD);
    await expect(peekRegisterPayload(redis, nonce)).rejects.toBeInstanceOf(AuthError);
  });
  it("abortRegister 等价于 markUsed", async () => {
    const nonce = await putRegisterPayload(redis, PAYLOAD);
    await abortRegister(redis, nonce, PAYLOAD);
    await expect(peekRegisterPayload(redis, nonce)).rejects.toBeInstanceOf(AuthError);
  });
});
