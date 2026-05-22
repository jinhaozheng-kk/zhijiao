import { describe, it, expect, beforeEach } from "vitest";
import {
  chargeForAction,
  compensate,
  shouldCompensate,
  CompensationAlreadyAppliedError,
} from "../src/ledger";
import { prismaTest, resetBillingTables, makeUserWithBalance } from "../src/test-utils";

describe("compensate", () => {
  beforeEach(resetBillingTables);

  it("refunds + writes COMPENSATION entry with comp:<id> idemKey", async () => {
    const { user, wallet } = await makeUserWithBalance(5);
    const debit = await chargeForAction(prismaTest, {
      walletId: wallet.id, kind: "TUTOR_ASK", cost: 1,
      idemKey: `debit:tutor_ask:${user.id}:req-c1`, createdByUserId: user.id,
    });
    if (debit.kind !== "OK") throw new Error("setup failed");
    const r = await compensate(prismaTest, {
      originalLedgerId: debit.ledgerId, walletId: wallet.id, cost: 1, kind: "TUTOR_ASK", reason: "AdapterError",
    });
    expect(r.balanceAfter).toBe(5);
    const w2 = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w2?.balance).toBe(5);
    const comp = await prismaTest.creditLedger.findUnique({
      where: { idemKey: `comp:${debit.ledgerId}` },
    });
    expect(comp?.delta).toBe(1);
    expect(comp?.kind).toBe("COMPENSATION");
    expect(comp?.refId).toBe(debit.ledgerId);
  });

  it("concurrent compensate: second throws CompensationAlreadyAppliedError; only one COMPENSATION ledger entry", async () => {
    const { user, wallet } = await makeUserWithBalance(5);
    const debit = await chargeForAction(prismaTest, {
      walletId: wallet.id, kind: "TUTOR_ASK", cost: 1,
      idemKey: `debit:tutor_ask:${user.id}:race-comp`, createdByUserId: user.id,
    });
    if (debit.kind !== "OK") throw new Error("setup failed");
    // First compensate succeeds
    const r1 = await compensate(prismaTest, {
      originalLedgerId: debit.ledgerId, walletId: wallet.id, cost: 1,
      kind: "TUTOR_ASK", reason: "test",
    });
    expect(r1.balanceAfter).toBe(5);
    // Second compensate with same originalLedgerId should throw
    await expect(
      compensate(prismaTest, {
        originalLedgerId: debit.ledgerId, walletId: wallet.id, cost: 1,
        kind: "TUTOR_ASK", reason: "test-retry",
      }),
    ).rejects.toBeInstanceOf(CompensationAlreadyAppliedError);
    // Balance should not have been refunded a second time
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(5);
    const comps = await prismaTest.creditLedger.count({
      where: { walletId: wallet.id, kind: "COMPENSATION" },
    });
    expect(comps).toBe(1);
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
