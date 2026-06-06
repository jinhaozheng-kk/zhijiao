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
      sigOk = createVerify("RSA-SHA256")
        .update(message)
        .verify(publicKey, headers.signature, "base64");
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
