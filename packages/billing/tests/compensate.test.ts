import { describe, it, expect, beforeEach } from "vitest";
import { ensureWallet } from "../src/wallet";
import { chargeForAction, compensate, shouldCompensate } from "../src/ledger";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("compensate", () => {
  beforeEach(resetBillingTables);

  it("refunds + writes COMPENSATION entry with comp:<id> idemKey", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const w = await ensureWallet(prismaTest, u.id);
    await prismaTest.wallet.update({ where: { id: w.id }, data: { balance: 5 } });
    await prismaTest.creditLedger.create({
      data: { walletId: w.id, kind: "TOPUP", delta: 5, balanceAfter: 5, idemKey: `topup:boot:${u.id}` },
    });
    const debit = await chargeForAction(prismaTest, {
      walletId: w.id, kind: "TUTOR_ASK", cost: 1,
      idemKey: `debit:tutor_ask:${u.id}:req-c1`, createdByUserId: u.id,
    });
    if (debit.kind !== "OK") throw new Error("setup failed");
    const r = await compensate(prismaTest, {
      originalLedgerId: debit.ledgerId, walletId: w.id, cost: 1, kind: "TUTOR_ASK", reason: "AdapterError",
    });
    expect(r.balanceAfter).toBe(5);
    const w2 = await prismaTest.wallet.findUnique({ where: { id: w.id } });
    expect(w2?.balance).toBe(5);
    const comp = await prismaTest.creditLedger.findUnique({
      where: { idemKey: `comp:${debit.ledgerId}` },
    });
    expect(comp?.delta).toBe(1);
    expect(comp?.kind).toBe("COMPENSATION");
    expect(comp?.refId).toBe(debit.ledgerId);
  });
});

describe("shouldCompensate whitelist", () => {
  it("ComplianceRejectedError → false", () => {
    class ComplianceRejectedError extends Error {
      constructor() { super("compliance"); this.name = "ComplianceRejectedError"; }
    }
    expect(shouldCompensate(new ComplianceRejectedError())).toBe(false);
  });
  it("generic Error → true (fail-open compensation default)", () => {
    expect(shouldCompensate(new Error("unknown"))).toBe(true);
  });
});
