import { describe, it, expect } from "vitest";
import { MockWechatH5Adapter } from "../src/wechat/h5-oauth/mock.js";

describe("MockWechatH5Adapter", () => {
  it("buildAuthorizeUrl 含 state、指向 /auth/wechat/callback", () => {
    const a = new MockWechatH5Adapter();
    const url = a.buildAuthorizeUrl({ state: "s1", scope: "snsapi_userinfo" });
    expect(url).toContain("/auth/wechat/callback");
    expect(url).toContain("state=s1");
  });
  it("exchangeCodeForUser 按 code 前缀分支", async () => {
    const a = new MockWechatH5Adapter();
    await expect(a.exchangeCodeForUser("mock-fail")).rejects.toThrow();
    const existing = await a.exchangeCodeForUser("mock-existing-1");
    expect(existing.openid).toBe("mock-openid-existing");
    const fresh = await a.exchangeCodeForUser("mock-new-12345");
    expect(fresh.openid).toBe("mock-openid-12345");
  });
});
