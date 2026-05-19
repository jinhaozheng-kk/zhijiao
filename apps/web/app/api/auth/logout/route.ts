import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import { COOKIE_AT, COOKIE_RT, clearCookie, revokeByRefreshToken } from "@zhijiao/auth";
import { SessionRevokeReason } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const cookies = parseCookies(req.headers.get("cookie"));
  const rt = cookies[COOKIE_RT];
  if (rt) {
    try { await revokeByRefreshToken(prisma, rt, SessionRevokeReason.USER_LOGOUT); } catch { /* noop */ }
  }
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearCookie(COOKIE_AT, "/"));
  res.headers.append("Set-Cookie", clearCookie(COOKIE_RT, "/api/auth"));
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
