import { NotConfiguredError } from "../../sms/types.js";
import type { WechatH5Adapter, WechatH5UserInfo } from "./types.js";

export interface RealWechatH5Config {
  appId: string;
  secret: string;
  redirectUri: string; // 完整 https URL
}

export class RealWechatH5Adapter implements WechatH5Adapter {
  constructor(private cfg: RealWechatH5Config) {
    for (const k of ["appId","secret","redirectUri"] as const) {
      if (!cfg[k]) throw new NotConfiguredError(`RealWechatH5Adapter.${k}`);
    }
  }
  get appId() { return this.cfg.appId; }

  buildAuthorizeUrl(opts: { state: string; scope: "snsapi_base" | "snsapi_userinfo" }): string {
    const u = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    u.searchParams.set("appid", this.cfg.appId);
    u.searchParams.set("redirect_uri", this.cfg.redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", opts.scope);
    u.searchParams.set("state", opts.state);
    return u.toString() + "#wechat_redirect";
  }

  async exchangeCodeForUser(_code: string): Promise<WechatH5UserInfo> {
    // 真接（access_token + userinfo）留下个 plan 落地；此处主动失败，避免误以为生效。
    throw new Error("RealWechatH5Adapter.exchangeCodeForUser not implemented yet — set WECHAT_OAUTH_USE_MOCK=true");
  }
}
