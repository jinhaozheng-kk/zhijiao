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
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(apiV3Key, "utf8"),
    Buffer.from(nonce12, "utf8"),
  );
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
