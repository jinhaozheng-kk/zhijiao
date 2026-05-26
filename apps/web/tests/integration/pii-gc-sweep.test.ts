import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { sweepPii } from "@/server/lib/pii-governance";

const NOW = new Date("2026-05-26T00:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedUser() {
  return prisma.user.create({ data: { name: "u", persona: "STUDENT", isMinor: false } });
}

describe("sweepPii", () => {
  it("short bucket deletes stale OTP requests and stale revoked/expired sessions", async () => {
    const user = await seedUser();
    await prisma.otpRequest.createMany({
      data: [
        { phone: "old-consumed", purpose: "LOGIN", codeHash: "h1", expiresAt: daysAgo(40), consumedAt: daysAgo(31) },
        { phone: "recent-consumed", purpose: "LOGIN", codeHash: "h2", expiresAt: daysAgo(40), consumedAt: daysAgo(29) },
        { phone: "old-expired", purpose: "LOGIN", codeHash: "h3", expiresAt: daysAgo(40), expiredAt: daysAgo(31) },
      ],
    });
    await prisma.session.createMany({
      data: [
        { userId: user.id, refreshTokenHash: "revoked-old", expiresAt: daysAgo(1), revokedAt: daysAgo(31), revokedReason: "USER_LOGOUT" },
        { userId: user.id, refreshTokenHash: "expired-old", expiresAt: daysAgo(31) },
        { userId: user.id, refreshTokenHash: "active", expiresAt: daysAgo(-1) },
      ],
    });

    const result = await sweepPii(prisma, {
      bucket: "short",
      shortDays: 30,
      mediumDays: 90,
      orphanDays: 180,
      now: NOW,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });
    expect(result.map((r) => [r.table, r.affected])).toEqual([
      ["otp_requests", 2],
      ["sessions", 2],
    ]);
    await expect(prisma.otpRequest.findMany({ orderBy: { phone: "asc" }, select: { phone: true } })).resolves.toEqual([
      { phone: "recent-consumed" },
    ]);
    await expect(prisma.session.findMany({ select: { refreshTokenHash: true } })).resolves.toEqual([
      { refreshTokenHash: "active" },
    ]);
    await expect(prisma.opsActionLog.count({ where: { kind: "GC_SWEEP_SHORT" } })).resolves.toBe(1);
  });

  it("medium bucket scrubs stale WechatPayEvent.rawBody and TopupOrder ip/userAgent", async () => {
    const user = await seedUser();
    await prisma.wechatPayEvent.createMany({
      data: [
        { outTradeNo: "old-raw", rawBody: "rawBody-secret", createdAt: daysAgo(91) },
        { outTradeNo: "recent-raw", rawBody: "recent-secret", createdAt: daysAgo(89) },
      ],
    });
    await prisma.topupOrder.createMany({
      data: [
        {
          userId: user.id,
          amountCents: 100,
          credits: 10,
          status: "PAID",
          outTradeNo: "old-paid",
          transactionId: "tx-old",
          paidAt: daysAgo(91),
          expiredAt: daysAgo(90),
          ipCreated: "1.1.1.1",
          userAgent: "ua",
          updatedAt: daysAgo(91),
        },
        {
          userId: user.id,
          amountCents: 100,
          credits: 10,
          status: "PAID",
          outTradeNo: "recent-paid",
          transactionId: "tx-recent",
          paidAt: daysAgo(1),
          expiredAt: daysAgo(1),
          ipCreated: "2.2.2.2",
          userAgent: "recent ua",
          updatedAt: daysAgo(89),
        },
      ],
    });

    const first = await sweepPii(prisma, {
      bucket: "medium",
      shortDays: 30,
      mediumDays: 90,
      orphanDays: 180,
      now: NOW,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });
    expect(first.map((r) => [r.table, r.affected])).toEqual([
      ["wechat_pay_events", 1],
      ["topup_orders", 1],
    ]);
    const oldRaw = await prisma.wechatPayEvent.findFirstOrThrow({ where: { outTradeNo: "old-raw" } });
    expect(oldRaw.rawBody).toBeNull();
    const oldTopup = await prisma.topupOrder.findUniqueOrThrow({ where: { outTradeNo: "old-paid" } });
    expect(oldTopup.ipCreated).toBeNull();
    expect(oldTopup.userAgent).toBeNull();

    const second = await sweepPii(prisma, {
      bucket: "medium",
      shortDays: 30,
      mediumDays: 90,
      orphanDays: 180,
      now: NOW,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });
    expect(second.every((r) => r.affected === 0)).toBe(true);
  });

  it("orphan bucket deletes only old expired unpaid topups without ledger references", async () => {
    const user = await seedUser();
    const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
    await prisma.topupOrder.createMany({
      data: [
        { id: "orphan-old", userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "orphan-old", expiredAt: daysAgo(181), createdAt: daysAgo(181) },
        { id: "referenced-old", userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "referenced-old", expiredAt: daysAgo(181), createdAt: daysAgo(181) },
        { id: "recent-old", userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "recent-old", expiredAt: daysAgo(10), createdAt: daysAgo(10) },
        { id: "paid-old", userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "paid-old", paidAt: daysAgo(181), expiredAt: daysAgo(181), createdAt: daysAgo(181) },
      ],
    });
    await prisma.creditLedger.create({
      data: {
        walletId: wallet.id,
        kind: "TOPUP",
        delta: 10,
        balanceAfter: 10,
        idemKey: "ledger-ref",
        refTable: "topup_orders",
        refId: "referenced-old",
      },
    });

    const result = await sweepPii(prisma, {
      bucket: "orphan",
      shortDays: 30,
      mediumDays: 90,
      orphanDays: 180,
      now: NOW,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });
    expect(result).toEqual([
      expect.objectContaining({ table: "topup_orders_orphan", affected: 1 }),
    ]);
    await expect(prisma.topupOrder.findMany({ orderBy: { id: "asc" }, select: { id: true } })).resolves.toEqual([
      { id: "paid-old" },
      { id: "recent-old" },
      { id: "referenced-old" },
    ]);
  });

  it("dryRun returns counts without changing rows or writing OpsActionLog", async () => {
    const user = await seedUser();
    await prisma.otpRequest.create({
      data: { phone: "old", purpose: "LOGIN", codeHash: "h", expiresAt: daysAgo(40), expiredAt: daysAgo(31) },
    });
    await prisma.wechatPayEvent.create({
      data: { outTradeNo: "old-raw", rawBody: "rawBody-secret", createdAt: daysAgo(91) },
    });
    await prisma.topupOrder.create({
      data: { id: "orphan-old", userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "orphan-old", expiredAt: daysAgo(181), createdAt: daysAgo(181) },
    });

    const result = await sweepPii(prisma, {
      bucket: "all",
      shortDays: 30,
      mediumDays: 90,
      orphanDays: 180,
      now: NOW,
      dryRun: true,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });
    expect(result.filter((r) => r.affected > 0).map((r) => r.table)).toEqual([
      "otp_requests",
      "wechat_pay_events",
      "topup_orders_orphan",
    ]);
    await expect(prisma.otpRequest.count()).resolves.toBe(1);
    await expect(prisma.wechatPayEvent.findFirst()).resolves.toMatchObject({ rawBody: "rawBody-secret" });
    await expect(prisma.topupOrder.count()).resolves.toBe(1);
    await expect(prisma.opsActionLog.count()).resolves.toBe(0);
  });
});
