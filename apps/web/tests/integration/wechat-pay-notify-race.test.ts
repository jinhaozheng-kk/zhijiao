import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { POST } from "@/app/api/wechat-pay/notify/route";
import { MockWechatPayAdapter } from "@zhijiao/integrations";
import { _resetWechatPayAdapterForTests } from "@/server/wechat-pay-adapter";

const APP = process.env.WECHAT_PAY_APPID!;
const MCH = process.env.WECHAT_PAY_MCHID!;
const SECRET = process.env.MOCK_WECHAT_PAY_SECRET!;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  _resetWechatPayAdapterForTests();
});
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

describe("/api/wechat-pay/notify — concurrent webhook race", () => {
  it("two parallel notifies with identical body → both 200, balance += credits once, single TOPUP ledger, two WechatPayEvent rows", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    await prisma.wallet.create({ data: { userId: u.id } });
    const order = await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 100,
        credits: 10,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_race_route`,
        expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    // Same signed body played twice — the second POST hits the
    // CreditLedger.idemKey UNIQUE inside applyWechatPayNotify, P2002 is
    // re-read, and ALREADY_PAID is returned. Route handler is supposed to
    // 200 both calls (ALREADY_PAID is OK-shaped).
    const captured = await captureSignedNotify(order.outTradeNo, 100);
    const [r1, r2] = await Promise.all([
      POST(mkRouteRequest(captured)),
      POST(mkRouteRequest(captured)),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const wallet = await prisma.wallet.findUnique({ where: { userId: u.id } });
    expect(wallet?.balance).toBe(10); // exactly one credit, not double

    const topupEntries = await prisma.creditLedger.findMany({
      where: { idemKey: `topup:${order.outTradeNo}` },
    });
    expect(topupEntries).toHaveLength(1);

    // Both notifies were independently audited.
    const events = await prisma.wechatPayEvent.findMany({
      where: { outTradeNo: order.outTradeNo },
    });
    expect(events).toHaveLength(2);
    // Both should be marked handled — one as PAID (error=null), one as
    // ALREADY_PAID (error=null because ALREADY_PAID is OK-shaped).
    expect(events.every((e) => e.handled)).toBe(true);
    expect(events.every((e) => e.error === null)).toBe(true);
  });
});
