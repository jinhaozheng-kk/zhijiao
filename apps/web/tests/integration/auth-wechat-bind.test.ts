// Plan 2 Hardening — Task 6 (I4): the WeChat callback's bind branch must
// re-verify the current access cookie + DB session before writing an
// AuthIdentity row. The old code trusted `state.userId` (set by the start
// route at bind-start time, stored in Redis), so a user who logged out
// between starting the bind flow and completing the wechat OAuth round-trip
// would still have a wechat identity attached to the now-revoked user. Worse,
// if the access cookie was rotated to a different user mid-flow (shared
// browser, cookie theft, account switch), the bind would attach wechat to
// the WRONG user.
//
// Acceptance:
//   1. active session + JWT.userId === state.userId → bind succeeds
//      (AuthIdentity row written, redirect /profile?bind=ok)
//   2. session revoked / row missing / expired → reject, NO AuthIdentity,
//      only COOKIE_WX_STATE cleared, auth cookies untouched
//   3. no access cookie → reject, NO AuthIdentity, only COOKIE_WX_STATE cleared
//   4. JWT.userId !== state.userId → reject, NO AuthIdentity
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { GET as wxCallback } from "@/app/(auth)/wechat/callback/route";
import {
  putWechatState,
  createSession,
  signAccess,
  COOKIE_AT,
  COOKIE_RT,
  COOKIE_WX_STATE,
  type AccessClaims,
} from "@zhijiao/auth";
import { AuthProvider, Persona } from "@prisma/client";

(globalThis as Record<string, unknown>)["__zhijiaoPrisma"] = undefined;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

async function seedActiveUser(): Promise<{ userId: string; sessionId: string; accessCookie: string }> {
  const user = await prisma.user.create({ data: { persona: Persona.STUDENT, isMinor: false } });
  const { sessionId } = await createSession(prisma, user.id, {});
  const claims: AccessClaims = { userId: user.id, sessionId, persona: Persona.STUDENT, roles: [] };
  const access = await signAccess(claims, process.env.ACCESS_JWT_SECRET!);
  return { userId: user.id, sessionId, accessCookie: access };
}

function callbackReq(opts: { code: string; state: string; cookies: Record<string, string> }): Request {
  const cookieHeader = Object.entries(opts.cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
  return new Request(
    `http://localhost/wechat/callback?code=${encodeURIComponent(opts.code)}&state=${encodeURIComponent(opts.state)}`,
    { method: "GET", headers: cookieHeader ? { cookie: cookieHeader } : {} },
  );
}

function setCookieNames(setCookies: string[]): string[] {
  return setCookies.map((c) => c.split("=")[0]!);
}

function authCookiesUntouched(setCookies: string[]) {
  // Either auth cookies appear with Max-Age=0 (cleared) or not at all. We want
  // "not at all" — the callback's bind-reject path must never touch auth state.
  for (const c of setCookies) {
    expect(c).not.toMatch(/^__Host-zj_at=/);
    expect(c).not.toMatch(/^zj_rt=/);
  }
}

describe("wechat /wechat/callback bind branch — Task 6 (I4)", () => {
  it("活跃 session + state.userId 与 JWT.userId 一致 → 绑定成功", async () => {
    const { userId, accessCookie } = await seedActiveUser();
    const state = await putWechatState(redis, { mode: "bind", userId });

    const res = await wxCallback(callbackReq({
      code: `mock-new-bindtest-${Date.now()}`,
      state,
      cookies: { [COOKIE_AT]: accessCookie, [COOKIE_WX_STATE]: state },
    }));
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toContain("/profile?bind=ok");

    const ids = await prisma.authIdentity.count({
      where: { userId, provider: AuthProvider.WECHAT_H5 },
    });
    expect(ids).toBe(1);

    // Only COOKIE_WX_STATE cleared
    const sets = res.headers.getSetCookie();
    expect(sets.some((c) => c.startsWith(`${COOKIE_WX_STATE}=`) && /Max-Age=0/.test(c))).toBe(true);
    authCookiesUntouched(sets);
  });

  it("session 已 revoke → 拒绝绑定，不写 AuthIdentity，只清 COOKIE_WX_STATE", async () => {
    const { userId, sessionId, accessCookie } = await seedActiveUser();
    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: "USER_LOGOUT" },
    });
    const state = await putWechatState(redis, { mode: "bind", userId });

    const res = await wxCallback(callbackReq({
      code: `mock-new-revoked-${Date.now()}`,
      state,
      cookies: { [COOKIE_AT]: accessCookie, [COOKIE_WX_STATE]: state },
    }));
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).not.toContain("/profile?bind=ok");
    expect(res.headers.get("Location")).toContain("/login");

    const ids = await prisma.authIdentity.count({ where: { provider: AuthProvider.WECHAT_H5 } });
    expect(ids).toBe(0);

    const sets = res.headers.getSetCookie();
    // Only COOKIE_WX_STATE in the cleared cookies; nothing else
    const cleared = sets.filter((c) => /Max-Age=0/.test(c)).map((c) => c.split("=")[0]);
    expect(cleared).toEqual([COOKIE_WX_STATE]);
    authCookiesUntouched(sets);
  });

  it("session 行被删（burn）→ 拒绝绑定", async () => {
    const { userId, sessionId, accessCookie } = await seedActiveUser();
    await prisma.session.delete({ where: { id: sessionId } });
    const state = await putWechatState(redis, { mode: "bind", userId });

    const res = await wxCallback(callbackReq({
      code: `mock-new-burned-${Date.now()}`,
      state,
      cookies: { [COOKIE_AT]: accessCookie, [COOKIE_WX_STATE]: state },
    }));
    expect(res.headers.get("Location")).toContain("/login");
    const ids = await prisma.authIdentity.count({ where: { provider: AuthProvider.WECHAT_H5 } });
    expect(ids).toBe(0);
    authCookiesUntouched(res.headers.getSetCookie());
  });

  it("无 COOKIE_AT → 拒绝绑定（信任 state.userId 是漏洞的关键面）", async () => {
    const { userId } = await seedActiveUser();
    const state = await putWechatState(redis, { mode: "bind", userId });

    const res = await wxCallback(callbackReq({
      code: `mock-new-noauth-${Date.now()}`,
      state,
      cookies: { [COOKIE_WX_STATE]: state },
    }));
    expect(res.headers.get("Location")).toContain("/login");
    const ids = await prisma.authIdentity.count({ where: { provider: AuthProvider.WECHAT_H5 } });
    expect(ids).toBe(0);
    authCookiesUntouched(res.headers.getSetCookie());
  });

  it("JWT.userId 与 state.userId 不一致（A 启动 bind，B 完成 callback）→ 拒绝", async () => {
    const a = await seedActiveUser();
    const b = await seedActiveUser();
    // State 记录 A 启动 bind；callback 带 B 的 access cookie
    const state = await putWechatState(redis, { mode: "bind", userId: a.userId });

    const res = await wxCallback(callbackReq({
      code: `mock-new-mismatch-${Date.now()}`,
      state,
      cookies: { [COOKIE_AT]: b.accessCookie, [COOKIE_WX_STATE]: state },
    }));
    expect(res.headers.get("Location")).toContain("/login");

    // Critically: no wechat identity attached to EITHER user.
    expect(await prisma.authIdentity.count({ where: { userId: a.userId } })).toBe(0);
    expect(await prisma.authIdentity.count({ where: { userId: b.userId } })).toBe(0);
    authCookiesUntouched(res.headers.getSetCookie());
  });
});
