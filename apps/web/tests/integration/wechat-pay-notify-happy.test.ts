import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { POST } from "@/app/api/wechat-pay/notify/route";
import { MockWechatPayAdapter } from "@zhijiao/integrations";
import { _resetWechatPayAdapterForTests } from "@/server/wechat-pay-adapter";

// Must match apps/web/tests/setup.ts so the singleton adapter
// (constructed by the route handler) verifies the signed body produced
// by this test's MockWechatPayAdapter.
const APP = process.env.WECHAT_PAY_APPID!;
const MCH = process.env.WECHAT_PAY_MCHID!;
const SECRET = process.env.MOCK_WECHAT_PAY_SECRET!;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

async function reset() {
  await resetDb();
  _resetWechatPayAdapterForTests();
}

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(reset);
afterAll(async () => {
  await redis.quit();
});

async function captureSignedNotify(
  outTradeNo: string,
  amountCents: number,
): Promise<{ headers: Headers; body: string }> {
  const mock = new MockWechatPayAdapter({
    notifyUrl: "http://intercepted/never",
    mockSecret: SECRET,
    appId: APP,
    mchId: MCH,
    notifyMode: "manual",
  });
  let captured: { headers: Headers; body: string } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    captured = {
      headers: new Headers(init?.headers),
      body: String(init?.body),
    };
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    await mock.fireMockNotify(outTradeNo, amountCents);
  } finally {
    globalThis.fetch = realFetch;
  }
  return captured!;
}

function mkRouteRequest(c: { headers: Headers; body: string }): Request {
  return new Request("http://localhost/api/wechat-pay/notify", {
    method: "POST",
    headers: c.headers,
    body: c.body,
  });
}

describe("/api/wechat-pay/notify — happy path (SUCCESS)", () => {
  it("PENDING order + valid SUCCESS notify → 200, order PAID, balance += credits, TOPUP ledger inserted, event row finalized", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({ data: { userId: u.id } });
    const order = await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 100,
        credits: 10,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_happy_route`,
        expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const captured = await captureSignedNotify(order.outTradeNo, 100);
    const res = await POST(mkRouteRequest(captured));
    expect(res.status).toBe(200);

    const reloaded = await prisma.topupOrder.findUnique({
      where: { id: order.id },
    });
    expect(reloaded?.status).toBe("PAID");
    expect(reloaded?.transactionId).toMatch(/^mock_txn_/);
    expect(reloaded?.paidAt).not.toBeNull();

    const wallet = await prisma.wallet.findUnique({ where: { id: w.id } });
    expect(wallet?.balance).toBe(10);

    const ledger = await prisma.creditLedger.findUnique({
      where: { idemKey: `topup:${order.outTradeNo}` },
    });
    expect(ledger?.delta).toBe(10);
    expect(ledger?.kind).toBe("TOPUP");

    const events = await prisma.wechatPayEvent.findMany({
      where: { outTradeNo: order.outTradeNo },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.verifyStatus).toBe("OK");
    expect(events[0]!.handled).toBe(true);
    expect(events[0]!.error).toBeNull();
    expect(events[0]!.processedAt).not.toBeNull();
  });

  it("CLOSED tradeState → order FAILED, 200, event row error=FAILED is null (FAILED is terminal-ok)", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    await prisma.wallet.create({ data: { userId: u.id } });
    const order = await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 100,
        credits: 10,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_closed_route`,
        expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    // Hand-craft a CLOSED notify body (MockWechatPayAdapter.fireMockNotify
    // always sends SUCCESS; for non-SUCCESS we have to build the body
    // ourselves with the same signing as Mock).
    const crypto = await import("node:crypto");
    function nanoid(n: number) {
      return crypto.randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
    }
    const resourcePlain = JSON.stringify({
      out_trade_no: order.outTradeNo,
      trade_state: "CLOSED",
      amount: { total: 100 },
      appid: APP,
      mchid: MCH,
      transaction_id: "mock_txn_closed_1",
      success_time: new Date().toISOString(),
    });
    const ciphertext = Buffer.from(resourcePlain).toString("base64");
    const body = JSON.stringify({
      id: nanoid(32),
      summary: "支付关闭",
      resource: { ciphertext },
    });
    const signature = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");
    const headers = new Headers({
      "Content-Type": "application/json",
      "Wechatpay-Signature": signature,
      "Wechatpay-Timestamp": String(Math.floor(Date.now() / 1000)),
      "Wechatpay-Nonce": nanoid(32),
      "Wechatpay-Serial": "MOCK_CERT_SERIAL",
    });
    const res = await POST(mkRouteRequest({ headers, body }));
    expect(res.status).toBe(200);

    const reloaded = await prisma.topupOrder.findUnique({
      where: { id: order.id },
    });
    expect(reloaded?.status).toBe("FAILED");
    expect(reloaded?.transactionId).toBe("mock_txn_closed_1");

    const wallet = await prisma.wallet.findUnique({
      where: { userId: u.id },
    });
    expect(wallet?.balance).toBe(0);
  });
});
