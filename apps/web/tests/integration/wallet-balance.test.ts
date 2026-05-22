import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(opts: {
  userId: string;
  isMinor?: boolean;
  ip?: string;
  roles?: import("@zhijiao/domain").Role[];
}) {
  const resHeaders = new Headers();
  return {
    db: prisma,
    redis,
    auth: {
      userId: opts.userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: opts.roles ?? [],
      isMinor: opts.isMinor ?? false,
    },
    authError: null,
    ip: opts.ip ?? "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-balance",
    resHeaders,
    cookies: {},
  };
}

async function seedUser(isMinor = false): Promise<string> {
  const u = await prisma.user.create({
    data: { isMinor, persona: "STUDENT" },
  });
  return u.id;
}

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
});
afterAll(async () => {
  await redis.quit();
});

describe("wallet.balance", () => {
  it("fresh user: balance=0, monthly=null for non-minor", async () => {
    const userId = await seedUser(false);
    const caller = appRouter.createCaller(makeCtx({ userId, isMinor: false }));
    const r = await caller.wallet.balance();
    expect(r.balance).toBe(0);
    expect(r.monthly).toBeNull();
  });

  it("fresh minor user: balance=0, monthly limit + remaining surfaced", async () => {
    const userId = await seedUser(true);
    const caller = appRouter.createCaller(makeCtx({ userId, isMinor: true }));
    const r = await caller.wallet.balance();
    expect(r.balance).toBe(0);
    expect(r.monthly).not.toBeNull();
    expect(r.monthly?.limitYuan).toBe(200);
    expect(r.monthly?.remainingYuan).toBe(200);
    expect(r.monthly?.topupYuan).toBe(0);
  });

  it("with existing topups: balance reflects ledger; minor remainingYuan deducts paid orders", async () => {
    const userId = await seedUser(true);
    const w = await prisma.wallet.create({
      data: { userId, balance: 30 },
    });
    await prisma.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: 30,
        balanceAfter: 30,
        idemKey: `topup:bootstrap:${userId}`,
      },
    });
    // a paid order in the current month → counted by paidAt
    await prisma.topupOrder.create({
      data: {
        userId,
        amountCents: 3000,
        credits: 30,
        status: "PAID",
        outTradeNo: `zj_${userId.slice(0, 8)}_paid1`,
        paidAt: new Date(),
        expiredAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(makeCtx({ userId, isMinor: true }));
    const r = await caller.wallet.balance();
    expect(r.balance).toBe(30);
    expect(r.monthly?.topupYuan).toBe(30);
    expect(r.monthly?.remainingYuan).toBe(170);
  });
});
