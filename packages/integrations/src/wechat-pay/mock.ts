import crypto, { randomBytes } from "node:crypto";
import type {
  WechatPayAdapter,
  UnifiedOrderRequest,
  UnifiedOrderResult,
  NotifyHeaders,
  VerifyResult,
  NotifyMode,
} from "./types.js";

export interface MockOpts {
  notifyUrl: string;
  mockSecret: string;
  appId: string;
  mchId: string;
  notifyMode: NotifyMode;
  delayMs?: number;
}

function nanoid(n: number): string {
  return randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}

export class MockWechatPayAdapter implements WechatPayAdapter {
  constructor(private readonly opts: MockOpts) {}

  async unifiedOrder(_req: UnifiedOrderRequest): Promise<UnifiedOrderResult> {
    const prepayId = `mock_prepay_${nanoid(16)}`;
    return {
      prepayId,
      qrCode: `mock://${prepayId}`,
      h5Url: `mock://${prepayId}`,
    };
  }

  async signalOrderReady(
    outTradeNo: string,
    amountCents: number,
  ): Promise<void> {
    try {
      if (this.opts.notifyMode === "sync") {
        await this.fireMockNotify(outTradeNo, amountCents);
      } else if (this.opts.notifyMode === "async-delayed") {
        const delay = this.opts.delayMs ?? 50;
        setTimeout(() => {
          this.fireMockNotify(outTradeNo, amountCents).catch(() => {
            // swallow per interface contract
          });
        }, delay);
      }
      // manual: no-op
    } catch {
      // swallow per interface contract
    }
  }

  async fireMockNotify(outTradeNo: string, amountCents: number): Promise<void> {
    const resourcePlain = JSON.stringify({
      out_trade_no: outTradeNo,
      trade_state: "SUCCESS",
      amount: { total: amountCents },
      appid: this.opts.appId,
      mchid: this.opts.mchId,
      transaction_id: `mock_txn_${nanoid(16)}`,
      success_time: new Date().toISOString(),
    });
    const ciphertext = Buffer.from(resourcePlain).toString("base64");
    const body = JSON.stringify({
      id: nanoid(32),
      summary: "支付成功",
      resource: { ciphertext },
    });
    const signature = crypto
      .createHmac("sha256", this.opts.mockSecret)
      .update(body)
      .digest("hex");
    await fetch(this.opts.notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Wechatpay-Signature": signature,
        "Wechatpay-Timestamp": String(Math.floor(Date.now() / 1000)),
        "Wechatpay-Nonce": nanoid(32),
        "Wechatpay-Serial": "MOCK_CERT_SERIAL",
      },
      body,
    });
  }

  async verifyNotify(
    headers: NotifyHeaders,
    rawBody: string,
  ): Promise<VerifyResult> {
    if (headers.serial !== "MOCK_CERT_SERIAL") {
      return { ok: false, reason: "CERT_NOT_FOUND" };
    }
    if (!headers.signature) return { ok: false, reason: "SIG_INVALID" };
    const expected = crypto
      .createHmac("sha256", this.opts.mockSecret)
      .update(rawBody)
      .digest("hex");
    if (headers.signature !== expected) {
      return { ok: false, reason: "SIG_INVALID" };
    }
    try {
      const parsed = JSON.parse(rawBody) as {
        resource: { ciphertext: string };
      };
      const decoded = JSON.parse(
        Buffer.from(parsed.resource.ciphertext, "base64").toString("utf8"),
      ) as {
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
