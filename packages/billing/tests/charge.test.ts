import { describe, it, expect, beforeEach } from "vitest";
import { ensureWallet } from "../src/wallet";
import {
  chargeForAction,
  ActionAlreadyChargedError,
} from "../src/ledger";
import { prismaTest, resetBillingTables } from "../src/test-utils";

async function makeUserWithBalance(initial: number) {
  const u = await prismaTest.user.create({ data: { isMinor: false } });
  const w = await ensureWallet(prismaTest, u.id);
  if (initial > 0) {
    await prismaTest.wallet.update({
      where: { id: w.id },
      data: { balance: initial },
    });
    await prismaTest.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: initial,
        balanceAfter: initial,
        idemKey: `topup:bootstrap:${u.id}`,
      },
    });
  }
  return { user: u, wallet: w };
}

describe("chargeForAction", () => {
  beforeEach(resetBillingTables);

  it("OK path: balance -= cost + DEBIT ledger inserted", async () => {
    const { user, wallet } = await makeUserWithBalance(5);
    const r = await chargeForAction(prismaTest, {
      walletId: wallet.id,
      kind: "TUTOR_ASK",
      cost: 1,
      idemKey: `debit:tutor_ask:${user.id}:req-1`,
      createdByUserId: user.id,
    });
    expect(r.kind).toBe("OK");
    if (r.kind !== "OK") return;
    expect(r.balanceAfter).toBe(4);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(4);
    const ledger = await prismaTest.creditLedger.findUnique({
      where: { idemKey: `debit:tutor_ask:${user.id}:req-1` },
    });
    expect(ledger?.delta).toBe(-1);
    expect(ledger?.balanceAfter).toBe(4);
    expect(ledger?.actionKind).toBe("TUTOR_ASK");
  });

  it("INSUFFICIENT_BALANCE: balance < cost → no debit, no ledger", async () => {
    const { user, wallet } = await makeUserWithBalance(0);
    const r = await chargeForAction(prismaTest, {
      walletId: wallet.id,
      kind: "TUTOR_ASK",
      cost: 1,
      idemKey: `debit:tutor_ask:${user.id}:req-2`,
      createdByUserId: user.id,
    });
    expect(r.kind).toBe("INSUFFICIENT_BALANCE");
    if (r.kind !== "INSUFFICIENT_BALANCE") return;
    expect(r.balance).toBe(0);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(0);
    const count = await prismaTest.creditLedger.count({
      where: { idemKey: `debit:tutor_ask:${user.id}:req-2` },
    });
    expect(count).toBe(0);
  });

  it("idempotency: same idemKey second call throws ActionAlreadyChargedError, no double-debit", async () => {
    const { user, wallet } = await makeUserWithBalance(5);
    const idem = `debit:tutor_ask:${user.id}:req-3`;
    await chargeForAction(prismaTest, {
      walletId: wallet.id,
      kind: "TUTOR_ASK",
      cost: 1,
      idemKey: idem,
      createdByUserId: user.id,
    });
    await expect(
      chargeForAction(prismaTest, {
        walletId: wallet.id,
        kind: "TUTOR_ASK",
        cost: 1,
        idemKey: idem,
        createdByUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(ActionAlreadyChargedError);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(4); // 仍只扣过一次
    const ledgerCount = await prismaTest.creditLedger.count({
      where: { idemKey: idem },
    });
    expect(ledgerCount).toBe(1);
  });

  it("race: two parallel charges with cost=1 on balance=1 → exactly one OK + one INSUFFICIENT", async () => {
    const { user, wallet } = await makeUserWithBalance(1);
    const [r1, r2] = await Promise.all([
      chargeForAction(prismaTest, {
        walletId: wallet.id,
        kind: "TUTOR_ASK",
        cost: 1,
        idemKey: `debit:tutor_ask:${user.id}:req-r1`,
        createdByUserId: user.id,
      }),
      chargeForAction(prismaTest, {
        walletId: wallet.id,
        kind: "TUTOR_ASK",
        cost: 1,
        idemKey: `debit:tutor_ask:${user.id}:req-r2`,
        createdByUserId: user.id,
      }),
    ]);
    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["INSUFFICIENT_BALANCE", "OK"]);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(0);
    const debits = await prismaTest.creditLedger.count({
      where: { walletId: wallet.id, kind: "DEBIT" },
    });
    expect(debits).toBe(1);
  });
});
