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

  async exchangeCodeForUser(code: string): Promise<WechatH5UserInfo> {
    // ── Step 1: 用 code 换 access_token ─────────────────────────────────────
    const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    tokenUrl.searchParams.set("appid", this.cfg.appId);
    tokenUrl.searchParams.set("secret", this.cfg.secret);
    tokenUrl.searchParams.set("code", code);
    tokenUrl.searchParams.set("grant_type", "authorization_code");

    const tokenRes = await fetch(tokenUrl.toString());
    // WeChat 有时返回 text/plain，用 text() 再手动解析更稳妥
    const tokenJson = JSON.parse(await tokenRes.text()) as Record<string, unknown>;

    if (typeof tokenJson["errcode"] === "number" && tokenJson["errcode"] !== 0) {
      throw new Error(
        `WeChat token exchange failed: errcode=${String(tokenJson["errcode"])} errmsg=${String(tokenJson["errmsg"] ?? "")}`,
      );
    }

    const accessToken = tokenJson["access_token"] as string;
    const openid = tokenJson["openid"] as string;
    const scope = typeof tokenJson["scope"] === "string" ? tokenJson["scope"] : "";
    const tokenUnionid = typeof tokenJson["unionid"] === "string" ? tokenJson["unionid"] : undefined;

    // ── Step 2: snsapi_userinfo 时额外拉 profile ─────────────────────────────
    const scopes = scope.split(",").map((s) => s.trim());
    if (scopes.includes("snsapi_userinfo")) {
      const infoUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
      infoUrl.searchParams.set("access_token", accessToken);
      infoUrl.searchParams.set("openid", openid);
      infoUrl.searchParams.set("lang", "zh_CN");

      const infoRes = await fetch(infoUrl.toString());
      const infoJson = JSON.parse(await infoRes.text()) as Record<string, unknown>;

      if (typeof infoJson["errcode"] === "number" && infoJson["errcode"] !== 0) {
        throw new Error(
          `WeChat userinfo fetch failed: errcode=${String(infoJson["errcode"])} errmsg=${String(infoJson["errmsg"] ?? "")}`,
        );
      }

      const infoUnionid =
        typeof infoJson["unionid"] === "string" ? infoJson["unionid"] : undefined;
      const nickname =
        typeof infoJson["nickname"] === "string" ? infoJson["nickname"] : undefined;
      const avatarUrl =
        typeof infoJson["headimgurl"] === "string" ? infoJson["headimgurl"] : undefined;

      const result: WechatH5UserInfo = { openid };
      const unionid = tokenUnionid ?? infoUnionid;
      if (unionid) result.unionid = unionid;
      if (nickname) result.nickname = nickname;
      if (avatarUrl) result.avatarUrl = avatarUrl;
      return result;
    }

    // ── snsapi_base: 只返 openid + (可选) unionid ────────────────────────────
    const result: WechatH5UserInfo = { openid };
    if (tokenUnionid) result.unionid = tokenUnionid;
    return result;
  }
}
