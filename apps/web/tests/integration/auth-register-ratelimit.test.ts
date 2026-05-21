import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";

// env (incl. REDIS_URL, ACCESS_JWT_SECRET, OTP_PEPPER, mocks) is set in
// apps/web/tests/setup.ts (Task 1). RULE_REGISTER_IP is defined in
// packages/auth/src/ratelimit/rules.ts with capacity=5, failMode=open.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const createCaller = appRouter.createCaller;

function makeCtx(ip: string) {
  const resHeaders = new Headers();
  return {
    db: prisma,
    redis,
    auth: null,
    authError: "NO_SESSION" as const,
    ip,
    ua: "v",
    resHeaders,
    cookies: {},
  };
}

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

describe("auth.register RULE_REGISTER_IP (G1)", () => {
  it("同 IP 第 1..5 次未限频（fall through 到 REGISTER_TOKEN_MISSING）；第 6 次抛 REGISTER_TOO_FREQUENT", async () => {
    const ip = "9.9.9.9";

    // 限频闸门在 nonce 校验之前；前 5 次未触发限频 → fall through 到 nonce missing
    for (let i = 0; i < 5; i++) {
      await expect(
        createCaller(makeCtx(ip)).auth.register({ persona: "STUDENT", gradeLevel: "G8" }),
      ).rejects.toMatchObject({ cause: { reason: "REGISTER_TOKEN_MISSING" } });
    }

    // 第 6 次：桶空了 → 429 REGISTER_TOO_FREQUENT（顺序证明：限频闸门确实先于 nonce 校验）
    await expect(
      createCaller(makeCtx(ip)).auth.register({ persona: "STUDENT", gradeLevel: "G8" }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      cause: { reason: "REGISTER_TOO_FREQUENT" },
    });
  });

  it("限频按 IP 维度分桶（不同 IP 互不影响）", async () => {
    // 用尽 IP_A 的 5 个 token
    const ipA = "10.10.10.10";
    for (let i = 0; i < 6; i++) {
      try {
        await createCaller(makeCtx(ipA)).auth.register({ persona: "STUDENT", gradeLevel: "G8" });
      } catch { /* expected */ }
    }

    // IP_B 第一次：桶满，应 fall through 到 REGISTER_TOKEN_MISSING（不是 REGISTER_TOO_FREQUENT）
    await expect(
      createCaller(makeCtx("11.11.11.11")).auth.register({ persona: "STUDENT", gradeLevel: "G8" }),
    ).rejects.toMatchObject({ cause: { reason: "REGISTER_TOKEN_MISSING" } });
  });
});
