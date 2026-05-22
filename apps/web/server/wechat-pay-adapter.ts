import "server-only";
import {
  buildWechatPayAdapter,
  type WechatPayAdapter,
} from "@zhijiao/integrations";
import { env } from "./env.js";

// Module-singleton. Real V3 adapter (when activated) holds RSA key state +
// platform cert provider; rebuilding per-request would be wasteful. Mock
// adapter is cheap but we still want a single instance so test fixtures
// can replace it and observe a stable target.
//
// notifyMode defaults to async-delayed in dev so a topup auto-credits a
// few hundred ms after order creation (good UX). Tests force "manual"
// so they capture and inject the webhook themselves.
let _adapter: WechatPayAdapter | null = null;

export function getWechatPayAdapter(): WechatPayAdapter {
  if (_adapter) return _adapter;
  const useMock = env.WECHAT_PAY_USE_MOCK === "true";
  const notifyUrl = `${env.NEXT_PUBLIC_APP_URL}/api/wechat-pay/notify`;
  _adapter = buildWechatPayAdapter({
    useMock,
    notifyUrl,
    mockSecret: env.MOCK_WECHAT_PAY_SECRET,
    // env validator (Task 6 review) already guarantees APPID/MCHID are
    // present in mock mode too — these `?? ""` would only trip during
    // build-phase placeholder evaluation which never runs unifiedOrder.
    appId: env.WECHAT_PAY_APPID ?? "",
    mchId: env.WECHAT_PAY_MCHID ?? "",
    apiV3Key: env.WECHAT_PAY_API_V3_KEY,
    privateKey: env.WECHAT_PAY_PRIVATE_KEY,
    certSerial: env.WECHAT_PAY_CERT_SERIAL,
    pubKeyFile: env.WECHAT_PAY_PUB_KEY_FILE,
    notifyHost: env.WECHAT_PAY_NOTIFY_HOST,
    notifyMode:
      process.env.NODE_ENV === "test" ? "manual" : "async-delayed",
  });
  return _adapter;
}

// Test-only: drop the cached adapter so a new vitest file can re-build
// with its own notifyMode or substitute adapter. NOT exported from any
// barrel; callers import directly from this module.
export function _resetWechatPayAdapterForTests(): void {
  _adapter = null;
}
