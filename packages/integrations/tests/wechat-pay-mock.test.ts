import { describe, it, expect } from "vitest";
import { MockWechatPayAdapter } from "../src/wechat-pay/mock.js";

const mkAdapter = (
  notifyMode: "sync" | "async-delayed" | "manual" = "manual",
) =>
  new MockWechatPayAdapter({
    notifyUrl: "http://localhost:0/never",
    mockSecret: "test-mock-secret-min-16-bytes-ok",
    appId: "wxapp_test",
    mchId: "1900000001",
    notifyMode,
  });

describe("MockWechatPayAdapter", () => {
  it("unifiedOrder returns prepayId, does NOT fire notify", async () => {
    const fires: string[] = [];
    const adapter = new MockWechatPayAdapter({
      notifyUrl: "http://example.invalid/notify",
      mockSecret: "test-mock-secret-min-16-bytes-ok",
      appId: "wxapp_test",
      mchId: "1900000001",
      notifyMode: "sync",
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fires.push(String(input));
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      const r = await adapter.unifiedOrder({
        outTradeNo: "zj_t_unified_1",
        amountCents: 100,
        description: "test",
      });
      expect(r.prepayId).toMatch(/^mock_prepay_/);
      expect(fires).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("signalOrderReady(notifyMode=sync) fires once to notifyUrl", async () => {
    const fires: { url: string; body: unknown; headers: Headers }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fires.push({
        url: String(input),
        body: init?.body,
        headers: new Headers(init?.headers),
      });
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const adapter = new MockWechatPayAdapter({
      notifyUrl: "http://localhost:0/notify-target",
      mockSecret: "test-mock-secret-min-16-bytes-ok",
      appId: "wxapp_test",
      mchId: "1900000001",
      notifyMode: "sync",
    });
    try {
      await adapter.signalOrderReady("zj_t_signal_1", 100);
      expect(fires).toHaveLength(1);
      const fire = fires[0]!;
      expect(fire.url).toBe("http://localhost:0/notify-target");
      expect(fire.headers.get("Wechatpay-Serial")).toBe("MOCK_CERT_SERIAL");
      expect(fire.headers.get("Wechatpay-Signature")).toBeTruthy();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("signalOrderReady(notifyMode=manual) does NOT fire", async () => {
    const fires: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fires.push(String(input));
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const adapter = mkAdapter("manual");
    try {
      await adapter.signalOrderReady("zj_t_manual_1", 100);
      expect(fires).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("verifyNotify roundtrip: a body signed by fireMockNotify verifies ok", async () => {
    const captured: { headers: Headers; body: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      captured.push({
        headers: new Headers(init?.headers),
        body: String(init?.body),
      });
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const adapter = mkAdapter("manual");
    try {
      await adapter.fireMockNotify("zj_t_verify_1", 100);
    } finally {
      globalThis.fetch = realFetch;
    }
    const { headers, body } = captured[0]!;
    const v = await adapter.verifyNotify(
      {
        signature: headers.get("Wechatpay-Signature"),
        timestamp: headers.get("Wechatpay-Timestamp"),
        nonce: headers.get("Wechatpay-Nonce"),
        serial: headers.get("Wechatpay-Serial"),
      },
      body,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.outTradeNo).toBe("zj_t_verify_1");
    expect(v.amountCents).toBe(100);
    expect(v.tradeState).toBe("SUCCESS");
  });

  it("verifyNotify SIG_INVALID when signature tampered", async () => {
    const adapter = mkAdapter("manual");
    const v = await adapter.verifyNotify(
      {
        signature: "deadbeef",
        timestamp: "0",
        nonce: "n",
        serial: "MOCK_CERT_SERIAL",
      },
      "{}",
    );
    expect(v).toEqual({ ok: false, reason: "SIG_INVALID" });
  });

  it("verifyNotify CERT_NOT_FOUND when wrong serial", async () => {
    const adapter = mkAdapter("manual");
    const v = await adapter.verifyNotify(
      {
        signature: "x",
        timestamp: "0",
        nonce: "n",
        serial: "UNKNOWN_SERIAL",
      },
      "{}",
    );
    expect(v).toEqual({ ok: false, reason: "CERT_NOT_FOUND" });
  });

  it("verifyNotify PARSE_FAILED when sig matches but body not parseable", async () => {
    const adapter = mkAdapter("manual");
    const body = "not json";
    const crypto = await import("node:crypto");
    const sig = crypto
      .createHmac("sha256", "test-mock-secret-min-16-bytes-ok")
      .update(body)
      .digest("hex");
    const v = await adapter.verifyNotify(
      {
        signature: sig,
        timestamp: "0",
        nonce: "n",
        serial: "MOCK_CERT_SERIAL",
      },
      body,
    );
    expect(v).toEqual({ ok: false, reason: "PARSE_FAILED" });
  });
});
