import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import { redis } from "@/lib/redis";
import { buildWechatH5Adapter } from "@zhijiao/integrations";
import { consumeWechatState, COOKIE_WX_STATE, clearCookie } from "@zhijiao/auth";
import { loginOrPrepareRegisterByWechat, bindWechatToUser } from "@/server/auth-service";

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
  const outcome = await bindWechatToUser({
    prisma, appId: adapter.appId, openid: userInfo.openid, unionid: userInfo.unionid, bindUserId: meta.userId,
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
