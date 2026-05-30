import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { _resetWechatPayAdapterForTests } from "@/server/wechat-pay-adapter";

const realRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(opts: {
  userId: string;
  ip?: string;
  redis?: import("ioredis").default;
}) {
  return {
    db: prisma,
    redis: opts.redis ?? realRedis,
    auth: {
      userId: opts.userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: opts.ip ?? "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-rl",
    resHeaders: new Headers(),
    cookies: {},
  };
}

beforeAll(async () => {
  await realRedis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await realRedis.flushdb();
  _resetWechatPayAdapterForTests();
});
afterAll(async () => {
  await realRedis.quit();
});

describe("wallet.topupCreate rate limiting", () => {
  it("RULE_TOPUP_CREATE_IP cap=5: 6th call from same IP is TOPUP_TOO_FREQUENT", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const caller = appRouter.createCaller(
      makeCtx({ userId: u.id, ip: "5.5.5.5" }),
    );
    for (let i = 0; i < 5; i++) {
      await caller.wallet.topupCreate({ amountCents: 100 });
    }
    await expect(
      caller.wallet.topupCreate({ amountCents: 100 }),
    ).rejects.toMatchObject({ cause: { reason: "TOPUP_TOO_FREQUENT" } });
  });

  it("RULE_TOPUP_CREATE_USER cap=10: 11th call from same user is TOPUP_TOO_FREQUENT", async () => {
    // Mint 10 orders spread across enough IPs to never hit the IP cap.
    const u = await prisma.user.create({ data: { isMinor: false } });
    for (let i = 0; i < 10; i++) {
      const caller = appRouter.createCaller(
        makeCtx({ userId: u.id, ip: `10.0.0.${i + 1}` }),
      );
      await caller.wallet.topupCreate({ amountCents: 100 });
    }
    const caller11 = appRouter.createCaller(
      makeCtx({ userId: u.id, ip: "10.0.0.99" }),
    );
    await expect(
      caller11.wallet.topupCreate({ amountCents: 100 }),
    ).rejects.toMatchObject({ cause: { reason: "TOPUP_TOO_FREQUENT" } });
  });

  it("fail-CLOSE: Redis backend down → INTERNAL_SERVER_ERROR / TOPUP_RATE_LIMIT_UNAVAILABLE; no TopupOrder created", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    // Inject a Redis whose eval (used by RedisRateLimitStore) fails. The
    // Lua eval call inside take() throws → RateLimitBackendDownError →
    // wallet.topupCreate catches and re-throws TOPUP_RATE_LIMIT_UNAVAILABLE.
    const brokenRedis = {
      // Only `eval` is touched by RedisRateLimitStore.take.
      eval: async () => {
        throw new Error("simulated Redis outage");
      },
    } as unknown as import("ioredis").default;
    const caller = appRouter.createCaller(
      makeCtx({ userId: u.id, redis: brokenRedis }),
    );
    await expect(
      caller.wallet.topupCreate({ amountCents: 100 }),
    ).rejects.toMatchObject({
      cause: { reason: "TOPUP_RATE_LIMIT_UNAVAILABLE" },
    });
    const orders = await prisma.topupOrder.count({ where: { userId: u.id } });
    expect(orders).toBe(0);
  });
});
