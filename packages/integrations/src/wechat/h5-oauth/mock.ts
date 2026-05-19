import type { WechatH5Adapter, WechatH5UserInfo } from "./types.js";

/**
 * Mock 策略（不引入真微信）：
 *  - buildAuthorizeUrl 返回一个本地化的 URL，指向 /auth/wechat/callback?code=<mock-...>&state=<...>
 *  - exchangeCodeForUser 按 code 前缀决定返回什么 openid：
 *      "mock-new-..."      → 全新 openid
 *      "mock-existing-..." → 固定 openid mock-openid-existing（测试需先 seed AuthIdentity）
 *      "mock-fail"         → 抛错（模拟微信失败）
 */
export class MockWechatH5Adapter implements WechatH5Adapter {
  constructor(public readonly appId: string = "wx-mock-app") {}

  buildAuthorizeUrl(opts: { state: string; scope: "snsapi_base" | "snsapi_userinfo" }): string {
    // 测试时浏览器跳本地回调即可；E2E 用 Playwright route 拦截真跳转。
    const code = `mock-new-${Date.now()}`;
    return `/auth/wechat/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(opts.state)}`;
  }

  async exchangeCodeForUser(code: string): Promise<WechatH5UserInfo> {
    if (code === "mock-fail") throw new Error("mock wechat exchange failed");
    if (code.startsWith("mock-existing-")) {
      return { openid: "mock-openid-existing", nickname: "mock 用户", avatarUrl: "" };
    }
    // mock-new-<ts>
    const openid = `mock-openid-${code.replace("mock-new-", "")}`;
    return { openid, unionid: undefined, nickname: "新用户", avatarUrl: "" };
  }
}
