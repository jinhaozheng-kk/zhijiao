import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import {
  rotateSession, signAccess,
  COOKIE_RT, buildAccessCookie, buildRefreshCookie, clearCookie,
  AuthError, COOKIE_AT,
  takeRule, RedisRateLimitStore, RULE_REFRESH, RateLimitBackendDownError,
} from "@zhijiao/auth";
import { Persona, SessionRevokeReason } from "@prisma/client";
import { env } from "@/server/env";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // 限频闸门：放在 cookie 校验之前。理由：refresh token 单次轮换，token-hash 永远打不到同一个桶；
  // IP-based 才是抗"同源大量 refresh 滥用"的有意义维度（spec §3.8）。
  // failMode: open —— Redis 挂时不踩用户脚。
  const store = new RedisRateLimitStore(redis);
  try {
    const r = await takeRule(store, RULE_REFRESH, ip);
    if (!r.allowed) {
      return new NextResponse(
        JSON.stringify({ ok: false, reason: "REFRESH_TOO_FREQUENT" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)),
          },
        },
      );
    }
  } catch (e) {
    if (e instanceof RateLimitBackendDownError) {
      return new NextResponse(
        JSON.stringify({ ok: false, reason: "RATELIMIT_BACKEND_DOWN" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    throw e;
  }

  const cookies = parseCookies(req.headers.get("cookie"));
  const rt = cookies[COOKIE_RT];
  if (!rt) return json401("NO_SESSION");

  try {
    const { sessionId, userId, refreshToken } = await rotateSession(prisma, rt, {
      ipCreated: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: true } });
    if (user.deletedAt != null) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.ADMIN_REVOKED },
      });
      const res = json401("USER_DEACTIVATED");
      res.headers.append("Set-Cookie", clearCookie(COOKIE_AT, "/"));
      res.headers.append("Set-Cookie", clearCookie(COOKIE_RT, "/api/auth"));
      return res;
    }
    const access = await signAccess(
      { userId, sessionId, persona: user.persona as Persona, roles: user.roles.map(r => r.role) as never },
      env.ACCESS_JWT_SECRET,
    );
    const res = NextResponse.json({ ok: true, expiresIn: 900 });
    res.headers.append("Set-Cookie", buildAccessCookie(access));
    res.headers.append("Set-Cookie", buildRefreshCookie(refreshToken));
    return res;
  } catch (e) {
    if (e instanceof AuthError) {
      const res = json401(e.reason);
      // 重放检测 / session 过期：服务端帮忙清两个 cookie
      if (e.reason === "REUSE_DETECTED" || e.reason === "SESSION_REVOKED" || e.reason === "NO_SESSION") {
        res.headers.append("Set-Cookie", clearCookie(COOKIE_AT, "/"));
        res.headers.append("Set-Cookie", clearCookie(COOKIE_RT, "/api/auth"));
      }
      return res;
    }
    throw e;
  }
}

function json401(reason: string) {
  return NextResponse.json({ ok: false, reason }, { status: 401 });
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
