import { describe, it, expect, beforeEach } from "vitest";
import { adminAdjust } from "../src/admin";
import { ensureWallet } from "../src/wallet";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("adminAdjust", () => {
  beforeEach(resetBillingTables);

  it("positive delta writes ADJUST_ADD; balance += delta", async () => {
    const target = await prismaTest.user.create({ data: { isMinor: false } });
    const ops = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, target.id);
    const r = await adminAdjust(prismaTest, {
      targetUserId: target.id,
      delta: 50,
      reasonCode: "FAULT_RECOVERY",
      reasonDetail: "compensation for failed tutor call on 2026-05-21",
      opsUserId: ops.id,
    });
    expect(r.balanceAfter).toBe(50);
    const w = await prismaTest.wallet.findUnique({
      where: { userId: target.id },
    });
    expect(w?.balance).toBe(50);
    const entry = await prismaTest.creditLedger.findUnique({
      where: { id: r.ledgerId },
    });
    expect(entry?.kind).toBe("ADJUST_ADD");
    expect(entry?.delta).toBe(50);
    expect(entry?.createdByUserId).toBe(ops.id);
    expect((entry?.metadata as { reasonCode?: string })?.reasonCode).toBe(
      "FAULT_RECOVERY",
    );
  });

  it("negative delta writes ADJUST_SUB; respects predicate-on-update for non-negative end balance", async () => {
    const target = await prismaTest.user.create({ data: { isMinor: false } });
    const ops = await prismaTest.user.create({ data: { isMinor: false } });
    const w = await ensureWallet(prismaTest, target.id);
    await prismaTest.wallet.update({
      where: { id: w.id },
      data: { balance: 100 },
    });
    const r = await adminAdjust(prismaTest, {
      targetUserId: target.id,
      delta: -30,
      reasonCode: "FRAUD_CLAWBACK",
      reasonDetail: "fraud clawback for txn investigated 2026-05-21",
      opsUserId: ops.id,
    });
    expect(r.balanceAfter).toBe(70);
    const entry = await prismaTest.creditLedger.findUnique({
      where: { id: r.ledgerId },
    });
    expect(entry?.kind).toBe("ADJUST_SUB");
    expect(entry?.delta).toBe(-30);
  });

  it("rejects delta=0 (validated at procedure layer; helper still throws for safety)", async () => {
    const target = await prismaTest.user.create({ data: { isMinor: false } });
    const ops = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, target.id);
    await expect(
      adminAdjust(prismaTest, {
        targetUserId: target.id,
        delta: 0,
        reasonCode: "OTHER",
        reasonDetail: "should not be allowed at all",
        opsUserId: ops.id,
      }),
    ).rejects.toThrow(/delta must be non-zero/);
  });
});
