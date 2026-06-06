# WeChat Pay V3 Native Real Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `RealWechatPayAdapter.unifiedOrder` (WeChat Pay V3 Native 扫码) and `verifyNotify` (platform-cert RSA-SHA256 verify + APIv3-key AES-256-GCM decrypt) offline, turning the current `NOT_IMPLEMENTED` stub into a working, unit-tested adapter.

**Architecture:** Single-file implementation in `packages/integrations/src/wechat-pay/real.ts` plus one new offline test file. Interface (`types.ts`), wiring (`build.ts`), and consumers (`wallet.ts`, notify route) are unchanged. Mock stays the default; this path runs only when `WECHAT_PAY_USE_MOCK=false`. Replay defense is delegated to the existing billing idempotency (`applyWechatPayNotify`). No new runtime dependencies — Node `node:crypto` + global `fetch` only.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), Node `node:crypto` (`createSign`/`createVerify`/`createCipheriv`/`createDecipheriv`/`X509Certificate`/`generateKeyPairSync`/`randomBytes`), Vitest, pnpm + Turborepo. Windows PowerShell host.

Design source of truth: `docs/superpowers/specs/2026-06-06-wechat-pay-v3-native-real-adapter-design.md`.

---

## File Structure

- **Modify:** `packages/integrations/src/wechat-pay/real.ts` — implement `unifiedOrder` + `verifyNotify`, add private `buildAuthorization` / `notifyUrl` helpers. Imports change from type-only to also pulling `node:crypto` functions. `signalOrderReady` stays as the existing no-op.
- **Create:** `packages/integrations/tests/wechat-pay-real.test.ts` — offline tests with self-generated merchant/platform keypairs, an inline self-signed platform cert for the cert-extraction path, and a `buildNotify` helper that produces real-shaped signed + AES-GCM-encrypted callbacks.
- **Modify (Task 3 only):** `docs/ops/public-launch-blockers.md` — flip the WeChat Pay rows/lines from "still not implemented" to "implemented offline, pending live smoke".

Do NOT touch `types.ts`, `build.ts`, `mock.ts`, `platform-cert-provider.ts`, `apps/web/server/routers/wallet.ts`, or `apps/web/app/api/wechat-pay/notify/route.ts`.

---

## Key correctness notes (read before coding)

- **`resource.nonce` is a 12-character ASCII string**, used directly as the AES-GCM IV bytes (`Buffer.from(nonce, "utf8")` → 12 bytes). The test's `buildNotify` MUST generate a 12-ASCII-char nonce and encrypt with `Buffer.from(nonce12, "utf8")` as IV, mirroring the adapter exactly. Do NOT use `randomBytes(12)` (binary) for the resource nonce — non-UTF8 bytes break the round-trip.
- **The header nonce (`Wechatpay-Nonce`) and `resource.nonce` are independent.** The adapter uses `headers.nonce` only in the signature verification message and `resource.nonce` only as the decrypt IV. Keep them separate in tests.
- **`apiV3Key` is 32 ASCII chars** → `Buffer.from(apiV3Key, "utf8")` is the 32-byte AES-256 key.
- **`nonce_str` for request signing must be ≤ 32 chars** → use `randomBytes(16).toString("hex")` (32 hex chars), never hyphenated `randomUUID()` (36 chars).
- **AES-GCM ciphertext layout:** WeChat base64-encodes `ciphertext || authTag` (auth tag = last 16 bytes).

---

## Task 1: `unifiedOrder` (Native) + request signing

**Files:**
- Create: `packages/integrations/tests/wechat-pay-real.test.ts`
- Modify: `packages/integrations/src/wechat-pay/real.ts`

- [ ] **Step 1: Write the failing tests + shared fixtures**

Create `packages/integrations/tests/wechat-pay-real.test.ts` with the shared fixtures and the `unifiedOrder` tests:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCipheriv,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { RealWechatPayAdapter } from "../src/wechat-pay/real.js";
import type { PlatformCertProvider } from "../src/wechat-pay/platform-cert-provider.js";

// --- merchant keypair: adapter signs requests with priv; tests verify with pub
const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const MERCHANT_PRIV = merchant.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const MERCHANT_PUB = merchant.publicKey.export({ type: "spki", format: "pem" }) as string;

// --- platform keypair (public-key mode): tests sign notify with priv; provider returns pub
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PLATFORM_PRIV = platform.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const PLATFORM_PUB = platform.publicKey.export({ type: "spki", format: "pem" }) as string;

const API_V3_KEY = "0123456789abcdef0123456789abcdef"; // 32 bytes
const MERCHANT_SERIAL = "MERCHANT_SERIAL_123";
const PLATFORM_SERIAL = "PLATFORM_SERIAL_456";

// Inline self-signed platform cert + key for the X509 extraction path (cert mode).
const TEST_PLATFORM_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCqO3R4P6evFg4u
HeLy2UFrMXVxRdoHzjriNtVeEKnnbM1beznmNbpAwYCXjhS4O+GOtTHZhEAzLokv
sWPj/3vqdI2snnBkDCxN9lnMKcYpjlr1j4zBIomG5Cj2qZ21U3B6++GbMsaeCR1b
8SWuN9ZpYAiQ1a5Tz50BH5WpQ5MJxGSrM3YxZZ/sC3S3ST6qRSzK1bUMV2WfHDfG
CZiRC1s3+x5JiE/WiNaY0FrzuULm3S8tsT8teQyZCJORTuox/j4BtaWmK6ok6bd6
6tprna5Gx5gqcTfehNOdaUtXpX5BKYt5SdIURboAqlbcx5TRCqrI2mkgMBF23+Mb
G7feUdChAgMBAAECggEAFHWN02/vEstnS+Kapo423w+0Kjd3c021ZP+rGCGPkflR
GwgN1t2pM2QuNMjGM7g6rSCYy6gp4RzcLwe2Vi4b8fstFcx6/IM8BeiwNSnmH5N0
2iN1CrdAaR5dz/tlsWfEUnuYS0NIfLDivuyWF0Ctu79neCS+TWNb3skxfwTYlKk8
B8A5SK8gRdkB3q4bWk+5MDt7n3b6A7v27aeRAPcwlKr6LGOr8q4BRcR+D+jFIRnS
AxEt769ng1wxqH20NJ+zrUnI55oqRETV6JCYroE9qTBu2sGu+hNkRVlaa1PJmmNj
9pOkUFkrzlKgjDlPF3sYDE6QHlUx1oZ47+rS/h3GUwKBgQDi3MhPm4lI3fNxC5ix
eWcFmqa5eKG9aujDU5ELToCtNtlv7ISLQBGn1wCBzRqVVklldBx5KiNU1CqZI+zg
rR9GT+HRMhms9uQgZQj+26mrO+UJ6J90+3PIZV4I1GDl3RXXJW6K7YgRqnhxnCD2
7qQqUzVbXQ2cCwyxpgXJJGHXJwKBgQDAGK1CFbm6IzHQS6n8L9++5DzVSqif4GmE
KGp1B2HbI0GrAPVkJMampaxL/7yo2y/K7l+/LQHbXbdRGnm5fTQcw2EwocxG6YE8
wAdbTqCO6oKb7yZjY2++HfDoju3qVp8XzNttgPMu1EFOOMYZxYhmcfPCWGeqZFK/
XRMbmM829wKBgF5Owca2Nb/g5I6d73/3o+gkfiKkDzia9OAeITG+FKftIT7x57er
jqtjKYbMKLzj/eb6+cs0xTNCb+LxmEteLJ4iHxHD7gCFMhh1Z+PqlQHmCDSyS3dq
AJvR5+FryExGOAoUOXvvep09bIxuBxYf5obhyFCOwlWYElLXXZhcU4AJAoGBALUL
DM+Jtj9NyDbt+MjrPc6lQQgskvwK/qdFh/+/82QauFs4Tg4R8v9AiUAfSGlEGqkB
PE/rVSKwEoNnlm1RKPoq0cCJ3QLAM8NToBtX4U6QioP4Qo/NOZVOlqw3eNcwyEQg
GHX94DO0a9ATBfFoEAOtRfVWaG1Ym/wq9kU+IZ1FAoGBAIDPV9oC0/syL1XpXwdc
pj+UaWd6JbYKjsTpGXomJehOXRjluVadP2F0yTFgCJvENzOs6qf5vH6MVa4csv19
LR/5x+7vE1vmSfDh+AgcwZHSr2Pttwh9AS/jGxb/NHZrMYb217plGqlCDsKYxEjb
QCAYo7l8eUSz5ThyjCevKcXU
-----END PRIVATE KEY-----`;

const TEST_PLATFORM_CERT = `-----BEGIN CERTIFICATE-----
MIIDITCCAgmgAwIBAgIUM7kC6UHw/R426LkAyEwB+x75AWgwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVemhpamlhby10ZXN0LXBsYXRmb3JtMB4XDTI2MDYwNjEx
NDkyN1oXDTM2MDYwMzExNDkyN1owIDEeMBwGA1UEAwwVemhpamlhby10ZXN0LXBs
YXRmb3JtMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqjt0eD+nrxYO
Lh3i8tlBazF1cUXaB8464jbVXhCp52zNW3s55jW6QMGAl44UuDvhjrUx2YRAMy6J
L7Fj4/976nSNrJ5wZAwsTfZZzCnGKY5a9Y+MwSKJhuQo9qmdtVNwevvhmzLGngkd
W/ElrjfWaWAIkNWuU8+dAR+VqUOTCcRkqzN2MWWf7At0t0k+qkUsytW1DFdlnxw3
xgmYkQtbN/seSYhP1ojWmNBa87lC5t0vLbE/LXkMmQiTkU7qMf4+AbWlpiuqJOm3
euraa52uRseYKnE33oTTnWlLV6V+QSmLeUnSFEW6AKpW3MeU0QqqyNppIDARdt/j
Gxu33lHQoQIDAQABo1MwUTAdBgNVHQ4EFgQUKqODJ6RRFZZ++lD/nldP0fmA4acw
HwYDVR0jBBgwFoAUKqODJ6RRFZZ++lD/nldP0fmA4acwDwYDVR0TAQH/BAUwAwEB
/zANBgkqhkiG9w0BAQsFAAOCAQEAcS3DfSHepJxhjMgpALz/EIpAeTyTc+UAYRW0
aeG5DiZ0pGujZJkYVz+jdvoYcY29oxwdhM4rqS0cWq1m9PmgsWdbnBWVvjw1X8v2
lT+U+YgtRPl55Pfq/AieCy+IdmXxNY/qu/n9QOQWA6ZoxK/kvnxQSY7C6a6RDdJR
8ugtWw1LhzwvHwwBaXA1Rbb9rRQCVA1yjB1hRiUlvYHCsSNTQBgbP9slgNPwdc7I
5xcntaKH6qxL7kkMLXgLlilaOMP3JcjRyiRuA1SskmotwyMI9mctbkgiT1p3+p/Q
iyC8Hs7ypiPmpj+03HiFptwXyecmd7QwmurOrOL7A/wAhfqn5g==
-----END CERTIFICATE-----`;

function makeAdapter(certProvider: PlatformCertProvider) {
  return new RealWechatPayAdapter({
    appId: "wxappid",
    mchId: "1900000001",
    apiV3Key: API_V3_KEY,
    privateKey: MERCHANT_PRIV,
    certSerial: MERCHANT_SERIAL,
    notifyHost: "pay.example.cn",
    certProvider,
  });
}

function certProviderReturning(serial: string, pem: string | null): PlatformCertProvider {
  return {
    async getBySerial(s: string) {
      return s === serial ? pem : null;
    },
  };
}

function parseAuth(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)="([^"]*)"/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

// Build a signed + AES-256-GCM-encrypted notify the way real WeChat does.
function buildNotify(opts: {
  plaintext: object;
  apiV3Key?: string;
  platformPrivKey: string;
  serial: string;
  timestamp?: string;
  nonce?: string;
  associatedData?: string;
  rawBodyOverride?: string;
}) {
  const apiV3Key = opts.apiV3Key ?? API_V3_KEY;
  const nonce12 = randomBytes(6).toString("hex"); // 12 ASCII chars -> 12-byte IV
  const aad = opts.associatedData ?? "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce12, "utf8"));
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(opts.plaintext), "utf8")),
    cipher.final(),
  ]);
  const ciphertext = Buffer.concat([enc, cipher.getAuthTag()]).toString("base64");
  const rawBody =
    opts.rawBodyOverride ??
    JSON.stringify({
      id: "evt_1",
      summary: "支付成功",
      resource: { ciphertext, nonce: nonce12, associated_data: aad },
    });
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headerNonce = opts.nonce ?? randomBytes(8).toString("hex");
  const message = `${timestamp}\n${headerNonce}\n${rawBody}\n`;
  const signature = createSign("RSA-SHA256").update(message).sign(opts.platformPrivKey, "base64");
  return {
    headers: { signature, timestamp, nonce: headerNonce, serial: opts.serial },
    rawBody,
  };
}

const SUCCESS_PLAINTEXT = {
  out_trade_no: "zj_t_1",
  trade_state: "SUCCESS",
  amount: { total: 1000 },
  appid: "wxappid",
  mchid: "1900000001",
  transaction_id: "wx_txn_999",
  success_time: "2026-06-06T20:00:00+08:00",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RealWechatPayAdapter.unifiedOrder (Native)", () => {
  it("POSTs to native endpoint with a valid signature and correct body; maps code_url->qrCode, prepayId=outTradeNo", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=abc123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const result = await adapter.unifiedOrder({
      outTradeNo: "zj_t_1",
      amountCents: 1000,
      description: "智教 Credit 充值 10 元",
    });

    expect(result.qrCode).toBe("weixin://wxpay/bizpayurl?pr=abc123");
    expect(result.prepayId).toBe("zj_t_1");

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.mch.weixin.qq.com/v3/pay/transactions/native");
    expect(init.method).toBe("POST");

    const body = init.body as string;
    const bodyObj = JSON.parse(body) as {
      appid: string;
      mchid: string;
      out_trade_no: string;
      notify_url: string;
      amount: { total: number; currency: string };
    };
    expect(bodyObj.appid).toBe("wxappid");
    expect(bodyObj.mchid).toBe("1900000001");
    expect(bodyObj.out_trade_no).toBe("zj_t_1");
    expect(bodyObj.amount).toEqual({ total: 1000, currency: "CNY" });
    expect(bodyObj.notify_url).toBe("https://pay.example.cn/api/wechat-pay/notify");

    const headers = init.headers as Record<string, string>;
    const auth = parseAuth(headers.Authorization!);
    expect(headers.Authorization!.startsWith("WECHATPAY2-SHA256-RSA2048 ")).toBe(true);
    expect(auth.mchid).toBe("1900000001");
    expect(auth.serial_no).toBe(MERCHANT_SERIAL);
    expect(auth.nonce_str).toMatch(/^[0-9a-f]{32}$/);
    expect(auth.timestamp).toMatch(/^\d+$/);
    expect(auth.signature).toBeTruthy();

    // The header signature must verify against the merchant public key.
    const message = `POST\n/v3/pay/transactions/native\n${auth.timestamp}\n${auth.nonce_str}\n${body}\n`;
    const sigOk = createVerify("RSA-SHA256").update(message).verify(MERCHANT_PUB, auth.signature!, "base64");
    expect(sigOk).toBe(true);
  });

  it("throws on non-2xx with code+message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "PARAM_ERROR", message: "amount invalid" }), {
            status: 400,
          }),
      ),
    );
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    await expect(
      adapter.unifiedOrder({ outTradeNo: "zj_t_2", amountCents: 1, description: "x" }),
    ).rejects.toThrow(/PARAM_ERROR/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
pnpm.cmd --filter @zhijiao/integrations test -- tests/wechat-pay-real.test.ts
```

Expected: FAIL — current `unifiedOrder` throws `"not implemented"`, so both tests fail (the first does not reach assertions, the second throws a non-matching error).

- [ ] **Step 3: Implement `unifiedOrder` + helpers in `real.ts`**

Replace the entire contents of `packages/integrations/src/wechat-pay/real.ts` with:

```ts
import {
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
  X509Certificate,
} from "node:crypto";
import type {
  WechatPayAdapter,
  UnifiedOrderRequest,
  UnifiedOrderResult,
  NotifyHeaders,
  VerifyResult,
} from "./types.js";
import type { PlatformCertProvider } from "./platform-cert-provider.js";

export interface RealOpts {
  appId: string;
  mchId: string;
  apiV3Key: string;
  privateKey: string;
  certSerial: string;
  notifyHost: string;
  certProvider: PlatformCertProvider;
}

const API_BASE = "https://api.mch.weixin.qq.com";
const NATIVE_PATH = "/v3/pay/transactions/native";

/**
 * Real WeChat Pay V3 adapter — Native 扫码 only. Activated when
 * WECHAT_PAY_USE_MOCK=false. Request signing uses the merchant private key
 * (RSA-SHA256); callback verification uses the platform cert/public key
 * (RSA-SHA256) + APIv3-key AES-256-GCM decryption. Replay defense is delegated
 * to billing idempotency. Live smoke pending real merchant credentials.
 */
export class RealWechatPayAdapter implements WechatPayAdapter {
  constructor(private readonly opts: RealOpts) {}

  private buildAuthorization(method: string, urlPath: string, body: string): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex"); // 32 chars, <= WeChat's 32 limit
    const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = createSign("RSA-SHA256").update(message).sign(this.opts.privateKey, "base64");
    return (
      `WECHATPAY2-SHA256-RSA2048 ` +
      `mchid="${this.opts.mchId}",` +
      `nonce_str="${nonce}",` +
      `signature="${signature}",` +
      `timestamp="${timestamp}",` +
      `serial_no="${this.opts.certSerial}"`
    );
  }

  private notifyUrl(): string {
    const host = this.opts.notifyHost;
    const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
    return `${base.replace(/\/$/, "")}/api/wechat-pay/notify`;
  }

  async unifiedOrder(req: UnifiedOrderRequest): Promise<UnifiedOrderResult> {
    const body = JSON.stringify({
      appid: this.opts.appId,
      mchid: this.opts.mchId,
      description: req.description,
      out_trade_no: req.outTradeNo,
      notify_url: this.notifyUrl(),
      amount: { total: req.amountCents, currency: "CNY" },
    });
    const authorization = this.buildAuthorization("POST", NATIVE_PATH, body);

    const res = await fetch(`${API_BASE}${NATIVE_PATH}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "zhijiao-wechatpay/1.0",
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let code = "UNKNOWN";
      let message = errText;
      try {
        const parsed = JSON.parse(errText) as { code?: string; message?: string };
        if (parsed.code) code = parsed.code;
        if (parsed.message) message = parsed.message;
      } catch {
        // keep raw text
      }
      throw new Error(
        `RealWechatPayAdapter.unifiedOrder failed: HTTP ${res.status} code=${code} message=${message}`,
      );
    }

    const data = (await res.json()) as { code_url: string };
    return { prepayId: req.outTradeNo, qrCode: data.code_url };
  }

  async signalOrderReady(_outTradeNo: string, _amountCents: number): Promise<void> {
    // Real path: WeChat sends the webhook; business side no-op.
  }

  async verifyNotify(headers: NotifyHeaders, rawBody: string): Promise<VerifyResult> {
    if (!headers.serial) return { ok: false, reason: "CERT_NOT_FOUND" };
    if (!headers.signature || !headers.timestamp || !headers.nonce) {
      return { ok: false, reason: "SIG_INVALID" };
    }

    const cert = await this.opts.certProvider.getBySerial(headers.serial);
    if (!cert) return { ok: false, reason: "CERT_NOT_FOUND" };

    const message = `${headers.timestamp}\n${headers.nonce}\n${rawBody}\n`;
    const publicKey = cert.includes("BEGIN CERTIFICATE")
      ? new X509Certificate(cert).publicKey
      : cert;
    let sigOk = false;
    try {
      sigOk = createVerify("RSA-SHA256").update(message).verify(publicKey, headers.signature, "base64");
    } catch {
      sigOk = false;
    }
    if (!sigOk) return { ok: false, reason: "SIG_INVALID" };

    try {
      const parsed = JSON.parse(rawBody) as {
        resource: { ciphertext: string; nonce: string; associated_data?: string };
      };
      const { ciphertext, nonce, associated_data } = parsed.resource;
      const key = Buffer.from(this.opts.apiV3Key, "utf8");
      const iv = Buffer.from(nonce, "utf8");
      const aad = Buffer.from(associated_data ?? "", "utf8");
      const buf = Buffer.from(ciphertext, "base64");
      const tag = buf.subarray(buf.length - 16);
      const enc = buf.subarray(0, buf.length - 16);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
      const decoded = JSON.parse(plain) as {
        out_trade_no: string;
        trade_state: string;
        amount: { total: number };
        appid: string;
        mchid: string;
        transaction_id: string;
        success_time: string;
      };
      return {
        ok: true,
        outTradeNo: decoded.out_trade_no,
        transactionId: decoded.transaction_id,
        tradeState: decoded.trade_state,
        amountCents: decoded.amount.total,
        appId: decoded.appid,
        mchId: decoded.mchid,
        successTime: decoded.success_time,
      };
    } catch {
      return { ok: false, reason: "PARSE_FAILED" };
    }
  }
}
```

> Note: the full `verifyNotify` is included now (it is part of the same class and file). Task 2 only adds tests for it — no further `real.ts` edits are required there.

- [ ] **Step 4: Run the `unifiedOrder` tests to verify they pass**

Run:

```powershell
pnpm.cmd --filter @zhijiao/integrations test -- tests/wechat-pay-real.test.ts
```

Expected: the two `unifiedOrder` tests PASS. (No `verifyNotify` tests exist yet.)

- [ ] **Step 5: Commit**

```powershell
git add packages/integrations/src/wechat-pay/real.ts packages/integrations/tests/wechat-pay-real.test.ts
git commit -m "feat(integrations): WeChat Pay V3 Native unifiedOrder (offline)"
```

---

## Task 2: `verifyNotify` tests (RSA verify + AES-GCM decrypt, both key modes)

**Files:**
- Modify: `packages/integrations/tests/wechat-pay-real.test.ts` (append a `describe` block; `real.ts` already implements `verifyNotify` from Task 1).

- [ ] **Step 1: Write the failing tests**

Append this block to `packages/integrations/tests/wechat-pay-real.test.ts` (after the `unifiedOrder` describe):

```ts
describe("RealWechatPayAdapter.verifyNotify", () => {
  it("public-key mode: a valid signed+encrypted notify verifies and maps fields", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      platformPrivKey: PLATFORM_PRIV,
      serial: PLATFORM_SERIAL,
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const v = await adapter.verifyNotify(headers, rawBody);
    expect(v).toEqual({
      ok: true,
      outTradeNo: "zj_t_1",
      transactionId: "wx_txn_999",
      tradeState: "SUCCESS",
      amountCents: 1000,
      appId: "wxappid",
      mchId: "1900000001",
      successTime: "2026-06-06T20:00:00+08:00",
    });
  });

  it("cert mode: provider returns an X.509 cert PEM; publicKey is extracted and verifies", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      platformPrivKey: TEST_PLATFORM_KEY,
      serial: PLATFORM_SERIAL,
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, TEST_PLATFORM_CERT));
    const v = await adapter.verifyNotify(headers, rawBody);
    expect(v.ok).toBe(true);
  });

  it("SIG_INVALID when signature is tampered", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      platformPrivKey: PLATFORM_PRIV,
      serial: PLATFORM_SERIAL,
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const v = await adapter.verifyNotify({ ...headers, signature: "dGFtcGVyZWQ=" }, rawBody);
    expect(v).toEqual({ ok: false, reason: "SIG_INVALID" });
  });

  it("SIG_INVALID when signature header is missing", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      platformPrivKey: PLATFORM_PRIV,
      serial: PLATFORM_SERIAL,
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const v = await adapter.verifyNotify({ ...headers, signature: null }, rawBody);
    expect(v).toEqual({ ok: false, reason: "SIG_INVALID" });
  });

  it("CERT_NOT_FOUND when serial header is missing", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      platformPrivKey: PLATFORM_PRIV,
      serial: PLATFORM_SERIAL,
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const v = await adapter.verifyNotify({ ...headers, serial: null }, rawBody);
    expect(v).toEqual({ ok: false, reason: "CERT_NOT_FOUND" });
  });

  it("CERT_NOT_FOUND when provider has no cert for the serial", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      platformPrivKey: PLATFORM_PRIV,
      serial: "UNKNOWN_SERIAL",
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const v = await adapter.verifyNotify(headers, rawBody);
    expect(v).toEqual({ ok: false, reason: "CERT_NOT_FOUND" });
  });

  it("PARSE_FAILED when apiV3Key is wrong (GCM auth tag fails) though signature is valid", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      apiV3Key: "ffffffffffffffffffffffffffffffff", // wrong 32-byte key
      platformPrivKey: PLATFORM_PRIV,
      serial: PLATFORM_SERIAL,
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const v = await adapter.verifyNotify(headers, rawBody);
    expect(v).toEqual({ ok: false, reason: "PARSE_FAILED" });
  });

  it("PARSE_FAILED when body is valid-signed but not parseable as a notify", async () => {
    const { headers, rawBody } = buildNotify({
      plaintext: SUCCESS_PLAINTEXT,
      platformPrivKey: PLATFORM_PRIV,
      serial: PLATFORM_SERIAL,
      rawBodyOverride: "not-json",
    });
    const adapter = makeAdapter(certProviderReturning(PLATFORM_SERIAL, PLATFORM_PUB));
    const v = await adapter.verifyNotify(headers, rawBody);
    expect(v).toEqual({ ok: false, reason: "PARSE_FAILED" });
  });
});
```

- [ ] **Step 2: Run the full test file to verify the new tests pass**

Run:

```powershell
pnpm.cmd --filter @zhijiao/integrations test -- tests/wechat-pay-real.test.ts
```

Expected: PASS — all `unifiedOrder` (2) + `verifyNotify` (8) tests green.

If the "wrong apiV3Key" test instead errors out of the `try` in a way that does not resolve to `PARSE_FAILED`, confirm the decrypt is inside the `try` block in `real.ts` (it is in Task 1's implementation). The GCM `final()` throws on auth-tag mismatch and is caught → `PARSE_FAILED`.

- [ ] **Step 3: Commit**

```powershell
git add packages/integrations/tests/wechat-pay-real.test.ts
git commit -m "test(integrations): WeChat Pay V3 verifyNotify offline coverage"
```

---

## Task 3: Full verification + doc sync

**Files:**
- Modify: `docs/ops/public-launch-blockers.md`

- [ ] **Step 1: Run the full integrations suite**

Run:

```powershell
pnpm.cmd --filter @zhijiao/integrations test
```

Expected: PASS — existing wechat-pay mock/build tests plus the new `wechat-pay-real.test.ts` (10 tests) all green.

- [ ] **Step 2: Run full typecheck**

Run:

```powershell
pnpm.cmd exec turbo typecheck
```

Expected: 8/8 packages PASS. `real.ts` is typechecked by `@zhijiao/web` under the DOM lib; the `fetch` body here is a `string` (no `Uint8Array`/`BodyInit` issue), so it should compile cleanly. If `X509Certificate(...).publicKey` triggers a `KeyObject` vs `string` union error at `verify(...)`, confirm the `publicKey` variable is typed by inference (do not annotate it) — `crypto.verify` accepts `KeyLike`, which covers both `string` and `KeyObject`.

- [ ] **Step 3: Run the full test sweep (mock-default paths must not regress)**

Run:

```powershell
pnpm.cmd exec turbo test
```

Expected: 8/8 packages PASS. The new real adapter is never exercised by these (mock stays default); this confirms no consumer/type regression.

- [ ] **Step 4: Sync the launch-blockers doc**

In `docs/ops/public-launch-blockers.md`:

Replace the WeChat Pay matrix row:

```markdown
| Real WeChat Pay | External + code | Billing state machine exists; V3 adapter is still not implemented | `WECHAT_PAY_USE_MOCK=false` boots, unified order returns a real prepay result, notify verification credits wallet exactly once. |
```

with:

```markdown
| Real WeChat Pay | External + code | Billing state machine exists; Native `unifiedOrder` + `verifyNotify` implemented offline, pending live smoke | `WECHAT_PAY_USE_MOCK=false` boots, unified order returns a real prepay result, notify verification credits wallet exactly once. |
```

Replace the WeChat Pay "Code status" block:

```markdown
- Billing order, ledger, idempotency, notify state machine, and mock pay path
  are implemented and tested.
- `packages/integrations/src/wechat-pay/real.ts` still throws for
  `unifiedOrder` and `verifyNotify`.
```

with:

```markdown
- Billing order, ledger, idempotency, notify state machine, and mock pay path
  are implemented and tested.
- `packages/integrations/src/wechat-pay/real.ts` `unifiedOrder` (Native 扫码)
  and `verifyNotify` (platform-cert RSA-SHA256 verify + APIv3-key AES-256-GCM
  decrypt) are implemented offline with mock kept default; pending live smoke.
  Replay defense delegated to billing idempotency. JSAPI/H5 and platform-cert
  auto-rotation remain out of scope.
```

Replace the activation-order item 4:

```markdown
4. WeChat Pay V3 unified order and notify verification. **Remaining** — held
   for a dedicated, heavily-reviewed pass (money movement, webhook replay,
   certificate, and idempotency risk).
```

with:

```markdown
4. ~~WeChat Pay V3 unified order and notify verification.~~ Native `unifiedOrder`
   + `verifyNotify` done offline (this pass), pending live smoke. JSAPI/H5 and
   platform-cert auto-rotation remain out of scope.
```

- [ ] **Step 5: Commit**

```powershell
git add docs/ops/public-launch-blockers.md
git commit -m "docs(ops): mark WeChat Pay V3 Native adapter offline-implemented"
```

---

## Self-Review notes (resolved during planning)

- **Spec coverage:** unifiedOrder (Native, signing, mapping, error) → Task 1; verifyNotify (RSA verify both key modes, AES-GCM decrypt, all three failure reasons + missing-header guards) → Task 2; verification + doc sync → Task 3. signalOrderReady stays no-op (unchanged). All spec sections mapped.
- **No interface/build/consumer changes** — confirmed in File Structure red-lines.
- **Type consistency:** `RealOpts` fields match `build.ts`'s constructor call; `VerifyResult` ok/fail shapes match `types.ts` and the mock; `NotifyHeaders` field names (`signature`/`timestamp`/`nonce`/`serial`) match `types.ts`.
- **Crypto round-trip fidelity:** test `buildNotify` encrypts with `Buffer.from(nonce12,"utf8")` IV and ASCII 12-char nonce, mirroring the adapter's `Buffer.from(resource.nonce,"utf8")`; header nonce kept separate from resource nonce.
