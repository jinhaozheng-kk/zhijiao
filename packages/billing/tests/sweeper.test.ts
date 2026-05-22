import { describe, it, expect, beforeEach } from "vitest";
import { expireStaleOrders } from "../src/sweeper";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("expireStaleOrders", () => {
  beforeEach(resetBillingTables);

  it("marks CREATED/PENDING with expiredAt<now as EXPIRED; leaves PAID/FAILED alone", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const mkOrder = (
      status: "CREATED" | "PENDING" | "PAID" | "FAILED",
      expiredAt: Date,
      tag: string,
    ) =>
      prismaTest.topupOrder.create({
        data: {
          userId: u.id,
          amountCents: 100,
          credits: 10,
          status,
          outTradeNo: `zj_${u.id.slice(0, 8)}_${tag}`,
          expiredAt,
        },
      });
    await mkOrder("CREATED", past, "c1");
    await mkOrder("PENDING", past, "p1");
    await mkOrder("PENDING", future, "p2");
    await mkOrder("PAID", past, "paid1");
    await mkOrder("FAILED", past, "f1");
    const r = await expireStaleOrders(prismaTest, new Date());
    expect(r.expired).toBe(2);
    const c1 = await prismaTest.topupOrder.findUnique({
      where: { outTradeNo: `zj_${u.id.slice(0, 8)}_c1` },
    });
    expect(c1?.status).toBe("EXPIRED");
    const paid = await prismaTest.topupOrder.findUnique({
      where: { outTradeNo: `zj_${u.id.slice(0, 8)}_paid1` },
    });
    expect(paid?.status).toBe("PAID");
  });
});
