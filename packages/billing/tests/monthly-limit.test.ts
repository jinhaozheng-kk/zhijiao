import { describe, it, expect, beforeEach } from "vitest";
import {
  sumMonthlyTopupCents,
  startOfMonthInShanghai,
} from "../src/monthly-limit";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("startOfMonthInShanghai", () => {
  it("returns first day of month at 00:00 Asia/Shanghai (UTC offset +08:00)", () => {
    const d = startOfMonthInShanghai(new Date("2026-06-15T03:00:00Z"));
    expect(d.toISOString()).toBe("2026-05-31T16:00:00.000Z");
  });
});

describe("sumMonthlyTopupCents", () => {
  beforeEach(resetBillingTables);

  it("sums unpaid by createdAt + paid by paidAt; ignores EXPIRED/FAILED", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: true } });
    const monthStart = startOfMonthInShanghai(new Date());
    const inMonth = new Date(monthStart.getTime() + 24 * 60 * 60 * 1000);
    const beforeMonth = new Date(monthStart.getTime() - 24 * 60 * 60 * 1000);

    await prismaTest.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 5000,
        credits: 500,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_a`,
        createdAt: inMonth,
        expiredAt: new Date(inMonth.getTime() + 30 * 60 * 1000),
      },
    });
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 10000,
        credits: 1000,
        status: "PAID",
        outTradeNo: `zj_${u.id.slice(0, 8)}_b`,
        createdAt: beforeMonth,
        paidAt: inMonth,
        expiredAt: beforeMonth,
      },
    });
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 100,
        credits: 10,
        status: "EXPIRED",
        outTradeNo: `zj_${u.id.slice(0, 8)}_c`,
        createdAt: inMonth,
        expiredAt: inMonth,
      },
    });
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 100,
        credits: 10,
        status: "FAILED",
        outTradeNo: `zj_${u.id.slice(0, 8)}_d`,
        createdAt: inMonth,
        expiredAt: inMonth,
      },
    });
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 999,
        credits: 99,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_e`,
        createdAt: beforeMonth,
        expiredAt: new Date(beforeMonth.getTime() + 30 * 60 * 1000),
      },
    });
    const sum = await sumMonthlyTopupCents(prismaTest, u.id);
    expect(sum).toBe(5000 + 10000);
  });

  it("cross-month shift: paidAt determines bucket for PAID orders", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: true } });
    const createdAtUtc = new Date("2026-05-31T15:55:00Z");
    const paidAtUtc = new Date("2026-05-31T16:05:00Z");
    const juneNow = new Date("2026-06-10T03:00:00Z");
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 7777,
        credits: 777,
        status: "PAID",
        outTradeNo: `zj_${u.id.slice(0, 8)}_shift`,
        createdAt: createdAtUtc,
        paidAt: paidAtUtc,
        expiredAt: new Date(createdAtUtc.getTime() + 30 * 60 * 1000),
      },
    });
    const juneStart = startOfMonthInShanghai(juneNow);
    expect(paidAtUtc >= juneStart).toBe(true);
    const juneSum = await sumMonthlyTopupCents(prismaTest, u.id, juneNow);
    expect(juneSum).toBe(7777);
  });
});
