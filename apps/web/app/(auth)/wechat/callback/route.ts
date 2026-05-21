import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import { redis } from "@/lib/redis";
import { buildWechatH5Adapter } from "@zhijiao/integrations";
import {
  consumeWechatState,
  verifyAccess,
  COOKIE_AT,
  COOKIE_WX_STATE,
  clearCookie,
} from "@zhijiao/auth";
import { loginOrPrepareRegisterByWechat, bindWechatToUser } from "@/server/auth-service";
import { env } from "@/server/env";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(req.headers.get("cookie"));
  const cookieState = cookies[COOKIE_WX_STATE];

  if (!code || !state || !cookieState || cookieState !== state) {
    return redirectWithClear(new URL("/login?wechat=state_mismatch", url));
  }
  const meta = await consumeWechatState(redis, state);
  if (!meta) return redirectWithClear(new URL("/login?wechat=state_mismatch", url));

  const adapter = buildWechatH5Adapter(process.env);
  let userInfo;
  try { userInfo = await adapter.exchangeCodeForUser(code); }
  catch { return redirectWithClear(new URL("/login?wechat=code_invalid", url)); }

  const resHeadersHolder = new Headers();
  if (meta.mode === "login") {
    const r = await loginOrPrepareRegisterByWechat({
      prisma, redis,
      resHeaders: resHeadersHolder,
      appId: adapter.appId,
      openid: userInfo.openid,
      unionid: userInfo.unionid,
      profile: { nickname: userInfo.nickname, avatarUrl: userInfo.avatarUrl },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      ua: req.headers.get("user-agent") ?? null,
    });
    const target = r.status === "logged_in" ? r.defaultRoute : r.redirectPath;
    const res = NextResponse.redirect(new URL(target, url));
    resHeadersHolder.getSetCookie().forEach((c) => res.headers.append("Set-Cookie", c));
    res.headers.append("Set-Cookie", clearCookie(COOKIE_WX_STATE, "/"));
    return res;
  }

  // bind
  if (!meta.userId) return redirectWithClear(new URL("/profile?bind=state_lost", url));

  // Plan 2 Hardening — Task 6 (I4): re-verify the CURRENT access cookie + DB
  // session before binding. `meta.userId` is set by /wechat/start at flow
  // initiation; if we trust it alone, a user who has since logged out / had
  // their session burned / switched accounts would still get a wechat
  // identity attached to the original (possibly revoked) user. Worst case:
  // user A starts a bind, user B's access cookie ends up in the browser (eg
  // shared device, account switch, cookie theft), and the callback attaches
  // A's wechat identity to A — except now B is the one driving the request.
  // We require the freshly-verified JWT.userId to match meta.userId, AND
  // the underlying session row to be active.
  //
  // On rejection: only clear COOKIE_WX_STATE. Auth cookies (zj_at, zj_rt)
  // are NOT touched — if they're stale, Task 5's createContext gate catches
  // them on the next request. Touching them here would clear good cookies
  // (eg JWT is fine but session was revoked) on a callback path the user
  // didn't initiate maliciously.
  const at = cookies[COOKIE_AT];
  let currentUserId: string | null = null;
  if (at) {
    const v = await verifyAccess(at, env.ACCESS_JWT_SECRET);
    if (v.ok) {
      const row = await prisma.session.findUnique({ where: { id: v.claims.sessionId } });
      if (row && row.revokedAt == null && row.expiresAt > new Date()) {
        currentUserId = v.claims.userId;
      }
    }
  }
  if (!currentUserId || currentUserId !== meta.userId) {
    return redirectWithClear(new URL("/login?bind=session_lost", url));
  }

  const outcome = await bindWechatToUser({
    prisma, appId: adapter.appId, openid: userInfo.openid, unionid: userInfo.unionid, bindUserId: currentUserId,
  });
  const target = outcome === "ok" ? "/profile?bind=ok" : outcome === "noop" ? "/profile?bind=noop" : "/profile?bind=conflict";
  const res = NextResponse.redirect(new URL(target, url));
  res.headers.append("Set-Cookie", clearCookie(COOKIE_WX_STATE, "/"));
  return res;
}

function redirectWithClear(to: URL) {
  const res = NextResponse.redirect(to);
  res.headers.append("Set-Cookie", clearCookie(COOKIE_WX_STATE, "/"));
  return res;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}
