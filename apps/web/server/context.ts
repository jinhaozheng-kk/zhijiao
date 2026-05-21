import "server-only";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { prisma } from "@zhijiao/db";
import { redis } from "../lib/redis.js";
import { verifyAccess, type AccessClaims, COOKIE_AT } from "@zhijiao/auth";
import { env } from "./env.js";

export type AuthError = "ACCESS_EXPIRED" | "ACCESS_INVALID" | "NO_SESSION" | "SESSION_REVOKED";

export type Ctx = {
  db: typeof prisma;
  redis: typeof redis;
  auth: AccessClaims | null;
  authError: AuthError | null;
  ip: string;
  ua: string;
  resHeaders: Headers;
  cookies: Record<string, string>;
};

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

// Plan 2 Hardening — Task 5 (I3): DB-truth session revocation.
//
// The access JWT TTL is 15min. With JWT alone as the gate, a session that
// was just logged out / admin-revoked / burned by REUSE_DETECTED still
// authenticates for up to 15 more minutes — every server-side revoke is
// best-effort. The fix is a single Session lookup after verifyAccess: if
// the row is missing, revoked, or past expiresAt, we drop the claims and
// set authError = SESSION_REVOKED.
//
// No Redis caching: every authed request pays one indexed PK lookup. That
// is a deliberate trade — the alternative (a TTL cache) would re-introduce
// the same revocation lag we are fixing, just shorter. DB is the sole
// truth.
//
// The four AuthError reasons are kept distinct so the client can route
// behaviour: NO_SESSION → silent redirect to login; ACCESS_EXPIRED → try
// /api/auth/refresh; ACCESS_INVALID → clear cookies + login; SESSION_REVOKED
// → clear cookies + surface "您已在其他设备登出 / 会话被服务端撤销".
async function isSessionRevoked(sessionId: string): Promise<boolean> {
  const row = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!row) return true;
  if (row.revokedAt != null) return true;
  if (row.expiresAt <= new Date()) return true;
  return false;
}

export async function createContext({ req, resHeaders }: FetchCreateContextFnOptions): Promise<Ctx> {
  const cookies = parseCookies(req.headers.get("cookie"));
  const at = cookies[COOKIE_AT];
  let auth: AccessClaims | null = null;
  let authError: AuthError | null = null;
  if (!at) authError = "NO_SESSION";
  else {
    const v = await verifyAccess(at, env.ACCESS_JWT_SECRET);
    if (v.ok) {
      if (await isSessionRevoked(v.claims.sessionId)) {
        authError = "SESSION_REVOKED";
      } else {
        auth = v.claims;
      }
    } else {
      authError = v.reason;
    }
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ua = req.headers.get("user-agent") || "";
  return { db: prisma, redis, auth, authError, ip, ua, resHeaders, cookies };
}
