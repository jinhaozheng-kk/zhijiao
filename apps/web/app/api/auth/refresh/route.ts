import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import {
  rotateSession, signAccess,
  COOKIE_RT, buildAccessCookie, buildRefreshCookie, clearCookie,
  AuthError, COOKIE_AT,
} from "@zhijiao/auth";
import { Persona } from "@prisma/client";
import { env } from "@/server/env";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const cookies = parseCookies(req.headers.get("cookie"));
  const rt = cookies[COOKIE_RT];
  if (!rt) return json401("NO_SESSION");

  try {
    const { sessionId, userId, refreshToken } = await rotateSession(prisma, rt, {
      ipCreated: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: true } });
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
