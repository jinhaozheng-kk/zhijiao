import { describe, it, expect, beforeEach } from "vitest";
import { applyWechatPayNotify, type VerifyOk } from "../src/wechat-notify";
import { ensureWallet } from "../src/wallet";
import { prismaTest, resetBillingTables } from "../src/test-utils";

const APP = "wxapp_test";
const MCH = "1900000001";

async function seedOrder(
  userId: string,
  status: "CREATED" | "PENDING" | "PAID" | "EXPIRED" | "FAILED",
  opts?: { transactionId?: string; amountCents?: number },
) {
  const out = `zj_${userId.slice(0, 8)}_${Math.random().toString(36).slice(2, 14)}`;
  return prismaTest.topupOrder.create({
    data: {
      userId,
      amountCents: opts?.amountCents ?? 100,
      credits: 10,
      status,
      outTradeNo: out,
      transactionId: opts?.transactionId ?? null,
      expiredAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}

function verifyOk(o: {
  outTradeNo: string;
  amountCents?: number;
  tradeState?: string;
  transactionId?: string;
  appId?: string;
  mchId?: string;
}): VerifyOk {
  return {
    ok: true,
    outTradeNo: o.outTradeNo,
    amountCents: o.amountCents ?? 100,
    tradeState: o.tradeState ?? "SUCCESS",
    transactionId:
      o.transactionId ?? `mock_txn_${Math.random().toString(36).slice(2, 18)}`,
    appId: o.appId ?? APP,
    mchId: o.mchId ?? MCH,
    successTime: new Date().toISOString(),
  };
}

describe("applyWechatPayNotify", () => {
  beforeEach(resetBillingTables);

  it("ORDER_NOT_FOUND when outTradeNo unknown", async () => {
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: "zj_unknown" }),
      APP,
      MCH,
    );
    expect(r.kind).toBe("ORDER_NOT_FOUND");
  });

  it("AMOUNT_MISMATCH when verify.amountCents != order.amountCents", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING", { amountCents: 100 });
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, amountCents: 200 }),
      APP,
      MCH,
    );
    expect(r.kind).toBe("AMOUNT_MISMATCH");
  });

  it("APP_OR_MCH_MISMATCH when appId differs", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, appId: "wrong_app" }),
      APP,
      MCH,
    );
    expect(r.kind).toBe("APP_OR_MCH_MISMATCH");
  });

  it("INTERMEDIATE_STATE_NOTPAY / USERPAYING do not change order", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const r1 = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, tradeState: "NOTPAY" }),
      APP,
      MCH,
    );
    expect(r1.kind).toBe("INTERMEDIATE_STATE_NOTPAY");
    const r2 = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, tradeState: "USERPAYING" }),
      APP,
      MCH,
    );
    expect(r2.kind).toBe("INTERMEDIATE_STATE_USERPAYING");
    const reloaded = await prismaTest.topupOrder.findUnique({
      where: { outTradeNo: o.outTradeNo },
    });
    expect(reloaded?.status).toBe("PENDING");
  });

  it("CLOSED/PAYERROR/REVOKED → FAILED + transactionId stored", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({
        outTradeNo: o.outTradeNo,
        tradeState: "CLOSED",
        transactionId: "tx_closed_1",
      }),
      APP,
      MCH,
    );
    expect(r.kind).toBe("FAILED");
    const reloaded = await prismaTest.topupOrder.findUnique({
      where: { outTradeNo: o.outTradeNo },
    });
    expect(reloaded?.status).toBe("FAILED");
    expect(reloaded?.transactionId).toBe("tx_closed_1");
  });

  it("SUCCESS: balance += credits, TOPUP ledger inserted, status PAID, transactionId + paidAt set", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const txn = "tx_success_1";
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, transactionId: txn }),
      APP,
      MCH,
    );
    expect(r.kind).toBe("PAID");
    const reloaded = await prismaTest.topupOrder.findUnique({
      where: { outTradeNo: o.outTradeNo },
    });
    expect(reloaded?.status).toBe("PAID");
    expect(reloaded?.transactionId).toBe(txn);
    expect(reloaded?.paidAt).not.toBeNull();
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
    const ledger = await prismaTest.creditLedger.findUnique({
      where: { idemKey: `topup:${o.outTradeNo}` },
    });
    expect(ledger?.kind).toBe("TOPUP");
    expect(ledger?.delta).toBe(10);
    expect(ledger?.balanceAfter).toBe(10);
  });

  it("PAID replay with same transactionId → ALREADY_PAID (no double-credit)", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const txn = "tx_replay_1";
    await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, transactionId: txn }),
      APP,
      MCH,
    );
    const r2 = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, transactionId: txn }),
      APP,
      MCH,
    );
    expect(r2.kind).toBe("ALREADY_PAID");
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
    const wallets = await prismaTest.wallet.findMany({ where: { userId: u.id } });
    const topups = await prismaTest.creditLedger.count({
      where: { walletId: { in: wallets.map((x) => x.id) }, kind: "TOPUP" },
    });
    expect(topups).toBe(1);
  });

  it("PAID replay with different transactionId → DUPLICATE_TRANSACTION_ID", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_one" }),
      APP,
      MCH,
    );
    const r2 = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_two_different" }),
      APP,
      MCH,
    );
    expect(r2.kind).toBe("DUPLICATE_TRANSACTION_ID");
  });

  it("concurrent webhooks (P2002 idemKey path) → exactly one PAID + one ALREADY_PAID", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const v = verifyOk({
      outTradeNo: o.outTradeNo,
      transactionId: "tx_concurrent_1",
    });
    const [r1, r2] = await Promise.all([
      applyWechatPayNotify(prismaTest, v, APP, MCH),
      applyWechatPayNotify(prismaTest, v, APP, MCH),
    ]);
    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["ALREADY_PAID", "PAID"]);
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
    const topupEntries = await prismaTest.creditLedger.findMany({
      where: { idemKey: `topup:${o.outTradeNo}` },
    });
    expect(topupEntries).toHaveLength(1);
  });

  it("FAILED order + SUCCESS notify → TERMINAL_STATE_CONFLICT; no credit, no PAID transition", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "FAILED", {
      transactionId: "tx_prior_failed",
    });
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_later_success" }),
      APP,
      MCH,
    );
    expect(r.kind).toBe("TERMINAL_STATE_CONFLICT");
    const reloaded = await prismaTest.topupOrder.findUnique({
      where: { outTradeNo: o.outTradeNo },
    });
    expect(reloaded?.status).toBe("FAILED");
    expect(reloaded?.transactionId).toBe("tx_prior_failed");
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(0);
    const topupEntries = await prismaTest.creditLedger.findMany({
      where: { idemKey: `topup:${o.outTradeNo}` },
    });
    expect(topupEntries).toHaveLength(0);
  });

  it("EXPIRED → PAID grace: late webhook still credits", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "EXPIRED");
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_grace" }),
      APP,
      MCH,
    );
    expect(r.kind).toBe("PAID");
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
  });
});
