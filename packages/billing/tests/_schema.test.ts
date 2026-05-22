import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL! } },
});

describe("schema sanity", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "users" RESTART IDENTITY CASCADE;',
    );
  });

  it("wallet row roundtrip", async () => {
    const user = await prisma.user.create({
      data: { name: "test", isMinor: false },
    });
    const w = await prisma.wallet.create({
      data: { userId: user.id, balance: 0 },
    });
    expect(w.balance).toBe(0);
    await prisma.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: 10,
        balanceAfter: 10,
        idemKey: "topup:test-1",
      },
    });
    const found = await prisma.creditLedger.findUnique({
      where: { idemKey: "topup:test-1" },
    });
    expect(found?.delta).toBe(10);
  });
});
