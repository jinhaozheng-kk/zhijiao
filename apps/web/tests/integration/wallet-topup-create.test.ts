import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { _resetWechatPayAdapterForTests } from "@/server/wechat-pay-adapter";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string, isMinor = false) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-topup",
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

describe("wallet.topupCreate happy path (mock adapter, notifyMode=manual)", () => {
  it("returns orderId/prepayId/qr/h5/credits; order persisted as PENDING with prepayId", async () => {
    const u = await prisma.user.create({
      data: { isMinor: false, persona: "STUDENT" },
    });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.wallet.topupCreate({ amountCents: 100 });
    expect(r.orderId).toBeTruthy();
    expect(r.outTradeNo).toMatch(/^zj_/);
    expect(r.prepayId).toMatch(/^mock_prepay_/);
    expect(r.credits).toBe(10);
    expect(r.expiresAt).toBeInstanceOf(Date);

    const order = await prisma.topupOrder.findUnique({
      where: { id: r.orderId },
    });
    expect(order?.status).toBe("PENDING");
    expect(order?.prepayId).toBe(r.prepayId);
    expect(order?.amountCents).toBe(100);
    expect(order?.credits).toBe(10);
    expect(order?.ipCreated).toBe("127.0.0.1");
  });

  it("100 元 → 1000 credits (env.CREDIT_PER_YUAN=10)", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.wallet.topupCreate({ amountCents: 10_000 });
    expect(r.credits).toBe(1000);
  });

  it("rejects sub-yuan amounts (non-multiple of 100)", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.wallet.topupCreate({ amountCents: 150 }),
    ).rejects.toThrow(/whole-yuan/);
  });

  it("rejects amounts below 1 yuan and above 1000 yuan", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.wallet.topupCreate({ amountCents: 50 }),
    ).rejects.toThrow();
    await expect(
      caller.wallet.topupCreate({ amountCents: 100_001 }),
    ).rejects.toThrow();
  });

  it("topupStatus is scoped by userId (cannot read someone else's order)", async () => {
    const u1 = await prisma.user.create({ data: { isMinor: false } });
    const u2 = await prisma.user.create({ data: { isMinor: false } });
    const c1 = appRouter.createCaller(makeCtx(u1.id));
    const r = await c1.wallet.topupCreate({ amountCents: 100 });

    const c2 = appRouter.createCaller(makeCtx(u2.id));
    await expect(
      c2.wallet.topupStatus({ orderId: r.orderId }),
    ).rejects.toMatchObject({ cause: { reason: "ORDER_NOT_FOUND" } });

    // u1 can still read their own
    const status = await c1.wallet.topupStatus({ orderId: r.orderId });
    expect(status.status).toBe("PENDING");
    expect(status.credits).toBe(10);
  });
});
