import "server-only";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { prisma } from "@zhijiao/db";
import { redis } from "../lib/redis.js";
import { verifyAccess, type AccessClaims, COOKIE_AT } from "@zhijiao/auth";
import { env } from "./env.js";

export type AuthError = "ACCESS_EXPIRED" | "ACCESS_INVALID" | "NO_SESSION";

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

export async function createContext({ req, resHeaders }: FetchCreateContextFnOptions): Promise<Ctx> {
  const cookies = parseCookies(req.headers.get("cookie"));
  const at = cookies[COOKIE_AT];
  let auth: AccessClaims | null = null;
  let authError: AuthError | null = null;
  if (!at) authError = "NO_SESSION";
  else {
    const v = await verifyAccess(at, env.ACCESS_JWT_SECRET);
    if (v.ok) auth = v.claims; else authError = v.reason;
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ua = req.headers.get("user-agent") || "";
  return { db: prisma, redis, auth, authError, ip, ua, resHeaders, cookies };
}
