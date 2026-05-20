import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { GET as wxStart } from "@/app/(auth)/wechat/start/route";
import { GET as wxCallback } from "@/app/(auth)/wechat/callback/route";
import { COOKIE_WX_STATE } from "@zhijiao/auth";
import { AuthProvider, Persona } from "@prisma/client";

process.env.WECHAT_OAUTH_USE_MOCK = "true";
process.env.WECHAT_H5_APPID = "wx-mock-app";
process.env.ACCESS_JWT_SECRET = "test-secret-at-least-32-bytes-long-aaaa";
// DATABASE_URL comes from vitest.config.ts `test.env` (plan §Task -1, zhijiao_test_web).
// Clear any cached singleton so it re-initialises with the test DB URL.
(globalThis as Record<string, unknown>)["__zhijiaoPrisma"] = undefined;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

function get(url: string, cookieHeader = "") {
  return new Request(url, { method: "GET", headers: cookieHeader ? { cookie: cookieHeader } : {} });
}

function extractStateCookieValue(setCookies: string[]): string {
  const c = setCookies.find((c) => c.startsWith("__Host-zj_wx_state="))!;
  return decodeURIComponent(c.split(";")[0]!.split("=")[1]!);
}

describe("wechat start + callback", () => {
  it("login mode: state cookie 与 url state 一致；callback 走 need_register", async () => {
    const start = await wxStart(get("http://localhost/auth/wechat/start"));
    const sets = start.headers.getSetCookie();
    const state = extractStateCookieValue(sets);
    const targetUrl = new URL(start.headers.get("Location")!);
    expect(targetUrl.searchParams.get("state")).toBe(state);
    // mock 给的 target 路径是 /auth/wechat/callback?code=mock-new-<ts>&state=...
    const callbackUrl = new URL("http://localhost" + targetUrl.pathname + targetUrl.search);
    const cb = await wxCallback(get(callbackUrl.toString(), `${COOKIE_WX_STATE}=${encodeURIComponent(state)}`));
    expect(cb.status).toBe(307);
    expect(cb.headers.get("Location")).toContain("/register?from=wechat");
    const cbSets = cb.headers.getSetCookie();
    expect(cbSets.some((c) => c.startsWith("__Host-zj_register_token="))).toBe(true);
  });

  it("state mismatch → redirect /login?wechat=state_mismatch", async () => {
    const cb = await wxCallback(get("http://localhost/auth/wechat/callback?code=x&state=mismatch", `${COOKIE_WX_STATE}=other`));
    expect(cb.headers.get("Location")).toContain("/login?wechat=state_mismatch");
  });

  it("login mode 命中已存在的 AuthIdentity → logged_in 走默认路由", async () => {
    await prisma.user.create({ data: { persona: Persona.STUDENT, isMinor: true,
      identities: { create: { provider: AuthProvider.WECHAT_H5, providerScope: "wx-mock-app", providerUserId: "mock-openid-existing" } } } });
    // 手工构造一个 state（绕过 start）
    const { putWechatState } = await import("@zhijiao/auth");
    const state = await putWechatState(redis, { mode: "login" });
    const cb = await wxCallback(get(`http://localhost/auth/wechat/callback?code=mock-existing-1&state=${state}`, `${COOKIE_WX_STATE}=${encodeURIComponent(state)}`));
    expect(cb.status).toBe(307);
    // STUDENT 默认路由 /
    expect(cb.headers.get("Location")).toMatch(/\/$|\/(\?|$)/);
    const sets = cb.headers.getSetCookie();
    expect(sets.some((c) => c.startsWith("__Host-zj_at="))).toBe(true);
  });
});
