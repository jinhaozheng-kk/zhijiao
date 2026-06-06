import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AliyunSmsAdapter } from "../src/sms/aliyun.js";
import { NotConfiguredError } from "../src/sms/types.js";

// ---------------------------------------------------------------------------
// Helper: recompute the expected Aliyun RPC v1 signature from a param map.
// Mirrors the exact same algorithm in aliyun.ts so we can cross-check.
// ---------------------------------------------------------------------------
function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/gi, "~");
}

function computeExpectedSignature(
  params: Record<string, string>,
  accessKeySecret: string
): string {
  const sorted = Object.keys(params).sort();
  const canonical = sorted
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
    .join("&");
  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonical)}`;
  return createHmac("sha1", `${accessKeySecret}&`)
    .update(stringToSign)
    .digest("base64");
}

// Frozen test fixtures
const FIXED_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FIXED_TIMESTAMP = "2026-06-06T12:00:00Z";
const FIXED_DATE = new Date("2026-06-06T12:00:00.000Z");

const cfg = {
  accessKeyId: "testKeyId",
  accessKeySecret: "testKeySecret",
  signName: "智教平台",
  templateCode: "SMS_123456789",
};

function makeOkResponse() {
  return new Response(
    JSON.stringify({ Code: "OK", Message: "OK", RequestId: "req-1", BizId: "biz-1" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function makeErrorResponse(code: string, message: string) {
  return new Response(
    JSON.stringify({ Code: code, Message: message, RequestId: "req-err" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("AliyunSmsAdapter", () => {
  // -------------------------------------------------------------------------
  // Existing tests — constructor validation
  // -------------------------------------------------------------------------
  it("缺 key 抛 NotConfiguredError", () => {
    expect(
      () =>
        new AliyunSmsAdapter({
          accessKeyId: "",
          accessKeySecret: "x",
          signName: "x",
          templateCode: "x",
        })
    ).toThrow(NotConfiguredError);
  });

  it("所有字段缺失均抛 NotConfiguredError", () => {
    expect(
      () =>
        new AliyunSmsAdapter({
          accessKeyId: "a",
          accessKeySecret: "",
          signName: "x",
          templateCode: "x",
        })
    ).toThrow(NotConfiguredError);
    expect(
      () =>
        new AliyunSmsAdapter({
          accessKeyId: "a",
          accessKeySecret: "b",
          signName: "",
          templateCode: "x",
        })
    ).toThrow(NotConfiguredError);
    expect(
      () =>
        new AliyunSmsAdapter({
          accessKeyId: "a",
          accessKeySecret: "b",
          signName: "c",
          templateCode: "",
        })
    ).toThrow(NotConfiguredError);
  });

  // -------------------------------------------------------------------------
  // send() — network-stubbed tests
  // -------------------------------------------------------------------------
  describe("send()", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Freeze randomUUID and Date so signatures are deterministic
      vi.spyOn(crypto, "randomUUID").mockReturnValue(FIXED_UUID);
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_DATE);

      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("向 dysmsapi.aliyuncs.com 发送 GET，包含必需查询参数", async () => {
      fetchMock.mockResolvedValueOnce(makeOkResponse());

      const adapter = new AliyunSmsAdapter(cfg);
      await adapter.send("13800138000", "123456");

      expect(fetchMock).toHaveBeenCalledOnce();
      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toMatch(/^https:\/\/dysmsapi\.aliyuncs\.com\/\?/);

      // Decode for readable assertions
      const query = new URL(calledUrl).searchParams;
      expect(query.get("Action")).toBe("SendSms");
      expect(query.get("PhoneNumbers")).toBe("13800138000");
      expect(query.get("SignName")).toBe(cfg.signName);
      expect(query.get("TemplateCode")).toBe(cfg.templateCode);
      expect(query.get("Signature")).toBeTruthy();
      expect(query.get("SignatureNonce")).toBeTruthy();
      // TemplateParam must encode the code variable
      const templateParam = query.get("TemplateParam");
      expect(templateParam).not.toBeNull();
      expect(JSON.parse(templateParam!)).toEqual({ code: "123456" });
    });

    it("签名正确：与独立重算的 HMAC-SHA1 完全一致", async () => {
      fetchMock.mockResolvedValueOnce(makeOkResponse());

      const adapter = new AliyunSmsAdapter(cfg);
      await adapter.send("13800138000", "654321");

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      const query = new URL(calledUrl).searchParams;

      // Reconstruct the exact param set used for signing (all params EXCEPT Signature)
      const paramsForSign: Record<string, string> = {};
      for (const [k, v] of query.entries()) {
        if (k !== "Signature") {
          paramsForSign[k] = v;
        }
      }

      const expectedSig = computeExpectedSignature(paramsForSign, cfg.accessKeySecret);
      expect(query.get("Signature")).toBe(expectedSig);
    });

    it("签名在冻结参数下可预先计算（端到端锁定规范化）", async () => {
      fetchMock.mockResolvedValueOnce(makeOkResponse());

      const adapter = new AliyunSmsAdapter(cfg);
      await adapter.send("13900139000", "999888");

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      const query = new URL(calledUrl).searchParams;

      // With frozen UUID + frozen Date, build the full expected param map
      const expectedParams: Record<string, string> = {
        Action: "SendSms",
        Version: "2017-05-25",
        Format: "JSON",
        AccessKeyId: cfg.accessKeyId,
        SignatureMethod: "HMAC-SHA1",
        SignatureVersion: "1.0",
        SignatureNonce: FIXED_UUID,
        Timestamp: FIXED_TIMESTAMP,
        PhoneNumbers: "13900139000",
        SignName: cfg.signName,
        TemplateCode: cfg.templateCode,
        TemplateParam: JSON.stringify({ code: "999888" }),
      };

      const precomputedSig = computeExpectedSignature(expectedParams, cfg.accessKeySecret);

      // Assert the actual signature matches the fully pre-computed one
      expect(query.get("Signature")).toBe(precomputedSig);
      // Also assert nonce and timestamp were frozen as expected
      expect(query.get("SignatureNonce")).toBe(FIXED_UUID);
      expect(query.get("Timestamp")).toBe(FIXED_TIMESTAMP);
    });

    it("阿里云返回非 OK Code 时 send() 抛出含 Code 的错误", async () => {
      fetchMock.mockResolvedValueOnce(
        makeErrorResponse("isv.MOBILE_NUMBER_ILLEGAL", "手机号格式错误")
      );

      const adapter = new AliyunSmsAdapter(cfg);
      await expect(adapter.send("invalid_phone", "123456")).rejects.toThrow(
        /isv\.MOBILE_NUMBER_ILLEGAL/
      );
    });

    it("阿里云返回非 OK Code 时错误消息包含 Message 字段", async () => {
      fetchMock.mockResolvedValueOnce(
        makeErrorResponse("isv.MOBILE_NUMBER_ILLEGAL", "手机号格式错误")
      );

      const adapter = new AliyunSmsAdapter(cfg);
      await expect(adapter.send("invalid_phone", "123456")).rejects.toThrow(
        /手机号格式错误/
      );
    });

    it("阿里云返回 {Code:\"OK\"} 时 send() 正常 resolve（无返回值）", async () => {
      fetchMock.mockResolvedValueOnce(makeOkResponse());

      const adapter = new AliyunSmsAdapter(cfg);
      await expect(adapter.send("13800138000", "123456")).resolves.toBeUndefined();
    });

    it("Timestamp 格式为 ISO 8601 UTC 不含毫秒（YYYY-MM-DDTHH:mm:ssZ）", async () => {
      fetchMock.mockResolvedValueOnce(makeOkResponse());

      const adapter = new AliyunSmsAdapter(cfg);
      await adapter.send("13800138000", "111111");

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      const query = new URL(calledUrl).searchParams;
      const ts = query.get("Timestamp")!;
      // Must match YYYY-MM-DDTHH:mm:ssZ — no milliseconds
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });
});
