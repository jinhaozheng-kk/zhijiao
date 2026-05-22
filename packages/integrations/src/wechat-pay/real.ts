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

/**
 * V3 API skeleton. Not activated until ICP + 商户号 + APIv3 密钥 + 商户证书 all available.
 * Plan 3 ships contract only; activation lives in a separate plan.
 */
export class RealWechatPayAdapter implements WechatPayAdapter {
  constructor(private readonly opts: RealOpts) {}

  async unifiedOrder(_req: UnifiedOrderRequest): Promise<UnifiedOrderResult> {
    throw new Error(
      "RealWechatPayAdapter.unifiedOrder not implemented — set WECHAT_PAY_USE_MOCK=true or implement V3 API activation",
    );
  }

  async signalOrderReady(
    _outTradeNo: string,
    _amountCents: number,
  ): Promise<void> {
    // Real path: webhook is sent by WeChat; business side no-op.
  }

  async verifyNotify(
    _headers: NotifyHeaders,
    _rawBody: string,
  ): Promise<VerifyResult> {
    throw new Error(
      "RealWechatPayAdapter.verifyNotify not implemented — set WECHAT_PAY_USE_MOCK=true or implement V3 API activation",
    );
  }
}
