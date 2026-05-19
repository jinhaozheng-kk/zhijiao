import { describe, it, expect } from "vitest";
import { RealWechatH5Adapter } from "../src/wechat/h5-oauth/real.js";
import { NotConfiguredError } from "../src/sms/types.js";

describe("RealWechatH5Adapter", () => {
  it("缺 appId/secret/redirectUri → NotConfiguredError", () => {
    expect(() => new RealWechatH5Adapter({ appId: "", secret: "x", redirectUri: "x" })).toThrow(NotConfiguredError);
  });
  it("buildAuthorizeUrl 组装出微信 OAuth URL", () => {
    const a = new RealWechatH5Adapter({ appId: "wx1", secret: "s", redirectUri: "https://x.cn/auth/wechat/callback" });
    const u = a.buildAuthorizeUrl({ state: "abc", scope: "snsapi_userinfo" });
    expect(u).toContain("open.weixin.qq.com/connect/oauth2/authorize");
    expect(u).toContain("appid=wx1");
    expect(u).toContain("state=abc");
    expect(u).toContain("#wechat_redirect");
  });
  it("exchangeCodeForUser 当前主动失败", async () => {
    const a = new RealWechatH5Adapter({ appId: "wx1", secret: "s", redirectUri: "https://x.cn/auth/wechat/callback" });
    await expect(a.exchangeCodeForUser("c")).rejects.toThrow(/not implemented/);
  });
});
