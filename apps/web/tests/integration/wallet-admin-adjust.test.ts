import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import type { Role } from "@zhijiao/domain";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string, roles: Role[] = []) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles,
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-ops",
    resHeaders: new Headers(),
    cookies: {},
  };
}

async function seedOpsUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { isMinor: false, persona: "STUDENT" },
  });
  await prisma.userRole.create({ data: { userId: u.id, role: "OPS" } });
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

describe("wallet.walletAdminAdjust", () => {
  it("non-OPS caller: FORBIDDEN with reason PERMISSION_DENIED", async () => {
    const target = await prisma.user.create({ data: { isMinor: false } });
    const random = await prisma.user.create({ data: { isMinor: false } });
    const caller = appRouter.createCaller(makeCtx(random.id, []));
    await expect(
      caller.wallet.walletAdminAdjust({
        targetUserId: target.id,
        delta: 100,
        reasonCode: "FAULT_RECOVERY",
        reasonDetail: "compensation for failed tutor call",
      }),
    ).rejects.toMatchObject({ cause: { reason: "PERMISSION_DENIED" } });
  });

  it("OPS caller +100: balance becomes 100; ADJUST_ADD ledger with reasonCode/Detail/opsUserId metadata", async () => {
    const target = await prisma.user.create({ data: { isMinor: false } });
    const opsId = await seedOpsUser();
    const caller = appRouter.createCaller(makeCtx(opsId, ["OPS"]));
    const r = await caller.wallet.walletAdminAdjust({
      targetUserId: target.id,
      delta: 100,
      reasonCode: "FAULT_RECOVERY",
      reasonDetail: "compensation for failed tutor call on 2026-05-22",
    });
    expect(r.balanceAfter).toBe(100);
    const w = await prisma.wallet.findUnique({
      where: { userId: target.id },
    });
    expect(w?.balance).toBe(100);
    const entry = await prisma.creditLedger.findUnique({
      where: { id: r.ledgerId },
    });
    expect(entry?.kind).toBe("ADJUST_ADD");
    expect(entry?.delta).toBe(100);
    expect(entry?.createdByUserId).toBe(opsId);
    const meta = entry?.metadata as { reasonCode?: string; reasonDetail?: string };
    expect(meta?.reasonCode).toBe("FAULT_RECOVERY");
    expect(meta?.reasonDetail).toMatch(/2026-05-22/);
  });

  it("OPS caller -30 from balance 100: ADJUST_SUB; balance=70", async () => {
    const target = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({
      data: { userId: target.id, balance: 100 },
    });
    await prisma.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: 100,
        balanceAfter: 100,
        idemKey: `topup:bootstrap:${target.id}`,
      },
    });
    const opsId = await seedOpsUser();
    const caller = appRouter.createCaller(makeCtx(opsId, ["OPS"]));
    const r = await caller.wallet.walletAdminAdjust({
      targetUserId: target.id,
      delta: -30,
      reasonCode: "FRAUD_CLAWBACK",
      reasonDetail: "clawback after fraud investigation 2026-05-22",
    });
    expect(r.balanceAfter).toBe(70);
    const w2 = await prisma.wallet.findUnique({ where: { id: w.id } });
    expect(w2?.balance).toBe(70);
  });

  it("delta=0 rejected by zod refine (BAD_REQUEST)", async () => {
    const target = await prisma.user.create({ data: { isMinor: false } });
    const opsId = await seedOpsUser();
    const caller = appRouter.createCaller(makeCtx(opsId, ["OPS"]));
    await expect(
      caller.wallet.walletAdminAdjust({
        targetUserId: target.id,
        delta: 0,
        reasonCode: "OTHER",
        reasonDetail: "should not be allowed (zero)",
      }),
    ).rejects.toThrow();
  });

  it("|delta| > 1_000_000 rejected (BAD_REQUEST)", async () => {
    const target = await prisma.user.create({ data: { isMinor: false } });
    const opsId = await seedOpsUser();
    const caller = appRouter.createCaller(makeCtx(opsId, ["OPS"]));
    await expect(
      caller.wallet.walletAdminAdjust({
        targetUserId: target.id,
        delta: 1_000_001,
        reasonCode: "PROMO",
        reasonDetail: "should not be allowed (over cap)",
      }),
    ).rejects.toThrow();
  });

  it("reasonDetail < 10 chars rejected by zod (audit trail floor)", async () => {
    const target = await prisma.user.create({ data: { isMinor: false } });
    const opsId = await seedOpsUser();
    const caller = appRouter.createCaller(makeCtx(opsId, ["OPS"]));
    await expect(
      caller.wallet.walletAdminAdjust({
        targetUserId: target.id,
        delta: 10,
        reasonCode: "OTHER",
        reasonDetail: "short",
      }),
    ).rejects.toThrow();
  });
});
