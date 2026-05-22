import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { POST } from "@/app/api/wechat-pay/notify/route";
import { _resetWechatPayAdapterForTests } from "@/server/wechat-pay-adapter";

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

describe("/api/wechat-pay/notify — invalid input", () => {
  it("SIG_INVALID: tampered signature → 200, event verifyStatus=SIG_INVALID, no order change", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const order = await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 100,
        credits: 10,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_sig_inv`,
        expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const req = new Request("http://localhost/api/wechat-pay/notify", {
      method: "POST",
      headers: {
        "Wechatpay-Signature": "deadbeef-not-a-real-hmac",
        "Wechatpay-Timestamp": "0",
        "Wechatpay-Nonce": "n",
        "Wechatpay-Serial": "MOCK_CERT_SERIAL",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "x", summary: "y", resource: { ciphertext: "z" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const reloaded = await prisma.topupOrder.findUnique({
      where: { id: order.id },
    });
    expect(reloaded?.status).toBe("PENDING"); // unchanged

    const events = await prisma.wechatPayEvent.findMany({});
    expect(events).toHaveLength(1);
    expect(events[0]!.verifyStatus).toBe("SIG_INVALID");
    expect(events[0]!.handled).toBe(true);
    expect(events[0]!.processedAt).not.toBeNull();
  });

  it("CERT_NOT_FOUND: wrong serial → 200, event verifyStatus=CERT_NOT_FOUND", async () => {
    const req = new Request("http://localhost/api/wechat-pay/notify", {
      method: "POST",
      headers: {
        "Wechatpay-Signature": "anything",
        "Wechatpay-Timestamp": "0",
        "Wechatpay-Nonce": "n",
        "Wechatpay-Serial": "UNKNOWN_CERT_SERIAL",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const events = await prisma.wechatPayEvent.findMany({});
    expect(events).toHaveLength(1);
    expect(events[0]!.verifyStatus).toBe("CERT_NOT_FOUND");
    expect(events[0]!.handled).toBe(true);
  });

  it("missing Wechatpay-Signature header → 200, SIG_INVALID (defensive — Mock requires the header)", async () => {
    const req = new Request("http://localhost/api/wechat-pay/notify", {
      method: "POST",
      headers: {
        "Wechatpay-Timestamp": "0",
        "Wechatpay-Nonce": "n",
        "Wechatpay-Serial": "MOCK_CERT_SERIAL",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const events = await prisma.wechatPayEvent.findMany({});
    expect(events).toHaveLength(1);
    expect(events[0]!.verifyStatus).toBe("SIG_INVALID");
  });
});
