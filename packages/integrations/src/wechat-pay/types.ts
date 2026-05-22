export interface UnifiedOrderRequest {
  outTradeNo: string;
  amountCents: number;
  description: string;
}

export interface UnifiedOrderResult {
  prepayId: string;
  qrCode?: string;
  h5Url?: string;
}

export interface NotifyHeaders {
  signature: string | null;
  timestamp: string | null;
  nonce: string | null;
  serial: string | null;
}

export type VerifyResult =
  | {
      ok: true;
      outTradeNo: string;
      transactionId: string;
      tradeState: string;
      amountCents: number;
      appId: string;
      mchId: string;
      successTime: string;
    }
  | { ok: false; reason: "SIG_INVALID" | "CERT_NOT_FOUND" | "PARSE_FAILED" };

export type NotifyMode = "sync" | "async-delayed" | "manual";

export interface WechatPayAdapter {
  unifiedOrder(req: UnifiedOrderRequest): Promise<UnifiedOrderResult>;
  verifyNotify(headers: NotifyHeaders, rawBody: string): Promise<VerifyResult>;
  /**
   * Called by topupCreate after TopupOrder.status has been persisted to PENDING.
   * Must not reject — implementations swallow internal errors and log.
   * Mock: fires the local webhook per notifyMode. Real: no-op (WeChat sends the webhook).
   */
  signalOrderReady(outTradeNo: string, amountCents: number): Promise<void>;
}
