import { MockWechatH5Adapter } from "./mock.js";
import { RealWechatH5Adapter } from "./real.js";
import type { WechatH5Adapter } from "./types.js";

export function buildWechatH5Adapter(env: NodeJS.ProcessEnv): WechatH5Adapter {
  if (env.WECHAT_OAUTH_USE_MOCK === "true" || !env.WECHAT_H5_APPID) {
    return new MockWechatH5Adapter(env.WECHAT_H5_APPID || "wx-mock-app");
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new RealWechatH5Adapter({
    appId: env.WECHAT_H5_APPID,
    secret: env.WECHAT_H5_SECRET ?? "",
    redirectUri: `${appUrl}/auth/wechat/callback`,
  });
}
