// Plan 2 Hardening — Task 2 (C2 + C3): the `buildWechatH5Adapter` factory must
// (a) use WECHAT_OAUTH_USE_MOCK="true" as the ONLY path into MockWechatH5Adapter
//     — no silent fallback when WECHAT_H5_APPID is missing; that is the env
//     validator's job — and
// (b) build the real adapter's callback URL as `${appUrl}/wechat/callback`
//     (the route group `(auth)` does NOT appear in the URL).
import { describe, it, expect } from "vitest";
import { buildWechatH5Adapter } from "../src/wechat/h5-oauth/build.js";
import { MockWechatH5Adapter } from "../src/wechat/h5-oauth/mock.js";
import { RealWechatH5Adapter } from "../src/wechat/h5-oauth/real.js";

describe("buildWechatH5Adapter (Task 2)", () => {
  describe("mock branch — USE_MOCK='true' is the sole entry", () => {
    it("USE_MOCK='true' + no APPID → Mock with sentinel appId 'wx-mock-app'", () => {
      const a = buildWechatH5Adapter({ WECHAT_OAUTH_USE_MOCK: "true" });
      expect(a).toBeInstanceOf(MockWechatH5Adapter);
      expect((a as MockWechatH5Adapter).appId).toBe("wx-mock-app");
    });

    it("USE_MOCK='true' + APPID set → Mock with that APPID", () => {
      const a = buildWechatH5Adapter({
        WECHAT_OAUTH_USE_MOCK: "true",
        WECHAT_H5_APPID: "wx-custom-mock",
      });
      expect(a).toBeInstanceOf(MockWechatH5Adapter);
      expect((a as MockWechatH5Adapter).appId).toBe("wx-custom-mock");
    });
  });

  describe("real branch — fail-close on missing config (no silent mock fallback)", () => {
    const baseReal = {
      WECHAT_OAUTH_USE_MOCK: "false",
      WECHAT_H5_APPID: "wxlive",
      WECHAT_H5_SECRET: "real-secret",
      NEXT_PUBLIC_APP_URL: "https://zhijiao.app",
    } as const;

    it("USE_MOCK='false' + full config → Real adapter (NOT Mock)", () => {
      const a = buildWechatH5Adapter({ ...baseReal });
      expect(a).toBeInstanceOf(RealWechatH5Adapter);
      expect(a).not.toBeInstanceOf(MockWechatH5Adapter);
    });

    it("USE_MOCK='false' + missing APPID → throws (no silent mock)", () => {
      const { WECHAT_H5_APPID: _omit, ...rest } = baseReal;
      void _omit;
      expect(() => buildWechatH5Adapter(rest)).toThrow(/WECHAT_H5_APPID/);
    });

    it("USE_MOCK='false' + missing SECRET → throws", () => {
      const { WECHAT_H5_SECRET: _omit, ...rest } = baseReal;
      void _omit;
      expect(() => buildWechatH5Adapter(rest)).toThrow(/WECHAT_H5_SECRET/);
    });

    it("USE_MOCK='false' + missing NEXT_PUBLIC_APP_URL → throws", () => {
      const { NEXT_PUBLIC_APP_URL: _omit, ...rest } = baseReal;
      void _omit;
      expect(() => buildWechatH5Adapter(rest)).toThrow(/NEXT_PUBLIC_APP_URL/);
    });

    it("USE_MOCK undefined (env not set) → treated as real-mode; missing config throws", () => {
      // Pre-fix behaviour fell into the mock branch via `|| !env.WECHAT_H5_APPID`,
      // which is exactly the C2 silent-mock fallback we are removing.
      expect(() => buildWechatH5Adapter({})).toThrow();
    });

    it("USE_MOCK='false' + non-string truthy value should NOT count as mock", () => {
      // Defends against typos like USE_MOCK="1" or "True" silently switching modes.
      expect(() =>
        buildWechatH5Adapter({ WECHAT_OAUTH_USE_MOCK: "True" } as Record<string, string>),
      ).toThrow();
    });
  });

  describe("C3 — real callback path is /wechat/callback (not /auth/wechat/callback)", () => {
    it("redirect_uri in authorize URL contains /wechat/callback (URL-encoded)", () => {
      const a = buildWechatH5Adapter({
        WECHAT_OAUTH_USE_MOCK: "false",
        WECHAT_H5_APPID: "wxlive",
        WECHAT_H5_SECRET: "real-secret",
        NEXT_PUBLIC_APP_URL: "https://zhijiao.app",
      });
      const url = a.buildAuthorizeUrl({ state: "s1", scope: "snsapi_userinfo" });
      expect(url).toContain("redirect_uri=https%3A%2F%2Fzhijiao.app%2Fwechat%2Fcallback");
      // Negative assertion: the old (auth) route-group path must not leak in.
      expect(url).not.toContain("%2Fauth%2Fwechat%2Fcallback");
    });
  });
});
