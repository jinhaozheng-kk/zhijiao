import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { _resetWechatPayAdapterForTests } from "@/server/wechat-pay-adapter";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor: true,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-minor",
    resHeaders: new Headers(),
    cookies: {},
  };
}

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  _resetWechatPayAdapterForTests();
});
afterAll(async () => {
  await redis.quit();
});

describe("wallet.topupCreate minor monthly limit", () => {
  it("isMinor + 190 yuan already PAID this month: 20 yuan attempt is blocked (190+20 > 200)", async () => {
    const u = await prisma.user.create({
      data: { isMinor: true, persona: "STUDENT" },
    });
    // Seed PAID order this month (counts by paidAt) — 19000 cents = 190 yuan.
    await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 19_000,
        credits: 1900,
        status: "PAID",
        outTradeNo: `zj_${u.id.slice(0, 8)}_paid_seed`,
        paidAt: new Date(),
        expiredAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.wallet.topupCreate({ amountCents: 2000 }),
    ).rejects.toMatchObject({
      cause: { reason: "MINOR_MONTHLY_LIMIT_REACHED" },
    });
  });

  it("isMinor + 190 yuan already PAID: 10 yuan attempt is allowed (190+10 = 200)", async () => {
    const u = await prisma.user.create({ data: { isMinor: true } });
    await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 19_000,
        credits: 1900,
        status: "PAID",
        outTradeNo: `zj_${u.id.slice(0, 8)}_paid_seed`,
        paidAt: new Date(),
        expiredAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.wallet.topupCreate({ amountCents: 1000 });
    expect(r.credits).toBe(100);
  });

  it("CREATED+PENDING orders also count toward the cap (sums by createdAt)", async () => {
    const u = await prisma.user.create({ data: { isMinor: true } });
    // 90 yuan PENDING (counts by createdAt — created just now, in month)
    await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 9_000,
        credits: 900,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_pending_seed`,
        expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    // 90 yuan PAID (counts by paidAt)
    await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 9_000,
        credits: 900,
        status: "PAID",
        outTradeNo: `zj_${u.id.slice(0, 8)}_paid_seed`,
        paidAt: new Date(),
        expiredAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    // 90 + 90 + 30 = 210 > 200 → block
    await expect(
      caller.wallet.topupCreate({ amountCents: 3000 }),
    ).rejects.toMatchObject({
      cause: { reason: "MINOR_MONTHLY_LIMIT_REACHED" },
    });
  });

  it("EXPIRED / FAILED orders do NOT count toward the cap", async () => {
    const u = await prisma.user.create({ data: { isMinor: true } });
    // 195 yuan EXPIRED in month: ignored
    await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 19_500,
        credits: 1950,
        status: "EXPIRED",
        outTradeNo: `zj_${u.id.slice(0, 8)}_expired_seed`,
        expiredAt: new Date(),
      },
    });
    // 195 yuan FAILED in month: ignored
    await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 19_500,
        credits: 1950,
        status: "FAILED",
        outTradeNo: `zj_${u.id.slice(0, 8)}_failed_seed`,
        expiredAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    // Cap-respecting attempt should succeed.
    const r = await caller.wallet.topupCreate({ amountCents: 5000 });
    expect(r.credits).toBe(500);
  });
});
