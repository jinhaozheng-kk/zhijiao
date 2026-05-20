// Plan 2 Hardening — Task 5 (I3): the access JWT TTL is 15min. Without a
// DB-truth check on every request, a revoked session can still authenticate
// for up to 15min — server-side logout / admin revoke / REUSE_DETECTED burn
// all become best-effort. This test pins the DB-truth semantics:
//   - valid cookie + active session     → authed procedure succeeds
//   - valid cookie + revokedAt != null  → SESSION_REVOKED (401)
//   - valid cookie + session row gone   → SESSION_REVOKED
//   - valid cookie + expiresAt <= now   → SESSION_REVOKED
//   - no cookie                          → NO_SESSION (unchanged)
//   - invalid JWT                        → ACCESS_INVALID (unchanged)
//
// We exercise the real createContext(...) so the DB lookup actually runs —
// using createCaller with a manually-built ctx would bypass exactly the gate
// we are adding.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { SignJWT } from "jose";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { Persona, SessionRevokeReason } from "@prisma/client";
import {
  createSession,
  signAccess,
  COOKIE_AT,
  type AccessClaims,
} from "@zhijiao/auth";
import { createContext } from "@/server/context";
import { appRouter } from "@/server/routers/_root";

// env (ACCESS_JWT_SECRET / OTP_PEPPER / DATABASE_URL / etc.) is set centrally
// in apps/web/tests/setup.ts (Task 1).
(globalThis as Record<string, unknown>)["__zhijiaoPrisma"] = undefined;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

async function seedUserWithSession() {
  const user = await prisma.user.create({ data: { name: "u", persona: Persona.STUDENT, isMinor: false } });
  const { sessionId } = await createSession(prisma, user.id, {});
  const claims: AccessClaims = {
    userId: user.id, sessionId, persona: Persona.STUDENT, roles: [],
  };
  const access = await signAccess(claims, process.env.ACCESS_JWT_SECRET!);
  return { user, sessionId, access };
}

function reqWithAccessCookie(access: string): Request {
  return new Request("http://localhost/api/trpc/auth.me", {
    headers: { cookie: `${COOKIE_AT}=${encodeURIComponent(access)}` },
  });
}

async function ctxFor(req: Request) {
  return createContext({ req, resHeaders: new Headers(), info: {} as never });
}

describe("session revocation (Task 5 — DB-truth)", () => {
  it("有效 cookie + 活跃 session → auth.me 成功", async () => {
    const { user, access } = await seedUserWithSession();
    const ctx = await ctxFor(reqWithAccessCookie(access));
    expect(ctx.auth?.userId).toBe(user.id);
    expect(ctx.authError).toBeNull();
    const r = await appRouter.createCaller(ctx).auth.me();
    expect(r.user.id).toBe(user.id);
  });

  it("有效 cookie 但 session 已 revoke → ctx.authError = SESSION_REVOKED + auth.me 401", async () => {
    const { sessionId, access } = await seedUserWithSession();
    // Sanity: still works pre-revoke
    expect((await ctxFor(reqWithAccessCookie(access))).auth).not.toBeNull();

    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.USER_LOGOUT },
    });

    const ctx = await ctxFor(reqWithAccessCookie(access));
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("SESSION_REVOKED");

    await expect(appRouter.createCaller(ctx).auth.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      cause: { reason: "SESSION_REVOKED" },
    });
  });

  it("有效 cookie 但 session 行已不存在（被 burn）→ SESSION_REVOKED", async () => {
    const { sessionId, access } = await seedUserWithSession();
    await prisma.session.delete({ where: { id: sessionId } });
    const ctx = await ctxFor(reqWithAccessCookie(access));
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("SESSION_REVOKED");
  });

  it("有效 cookie 但 session 已过期 (expiresAt <= now) → SESSION_REVOKED", async () => {
    const { sessionId, access } = await seedUserWithSession();
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const ctx = await ctxFor(reqWithAccessCookie(access));
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("SESSION_REVOKED");
  });

  // Task 5 acceptance #4: unauthenticated paths must NOT be relabelled as
  // SESSION_REVOKED. SESSION_REVOKED means "you had a real session that was
  // killed" — surfacing it for no-cookie / bad-JWT requests would (a) leak
  // server state to anonymous callers and (b) confuse the client which uses
  // the reason to decide between "redirect to login" and "clear cookies +
  // notify".
  it("无 cookie → NO_SESSION（不能误报成 SESSION_REVOKED）", async () => {
    const req = new Request("http://localhost/api/trpc/auth.me");
    const ctx = await ctxFor(req);
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("NO_SESSION");
    await expect(appRouter.createCaller(ctx).auth.me()).rejects.toMatchObject({
      cause: { reason: "NO_SESSION" },
    });
  });

  it("乱码 JWT → ACCESS_INVALID（不能误报成 SESSION_REVOKED）", async () => {
    const ctx = await ctxFor(reqWithAccessCookie("garbage.jwt.value"));
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("ACCESS_INVALID");
  });

  // Regression guard for Task 5: the DB session check MUST run only after
  // verifyAccess succeeds. If someone later restructured createContext to do
  // the DB lookup based on the decoded payload regardless of signature/exp
  // validity, an expired JWT pointing at a still-active session would be
  // reported as authenticated, OR a valid-payload-but-expired JWT pointing at
  // a revoked session would be relabelled SESSION_REVOKED instead of
  // ACCESS_EXPIRED — both leak server-side state and confuse the client
  // (ACCESS_EXPIRED → /api/auth/refresh; SESSION_REVOKED → clear cookies +
  // surface error). Sign a JWT with a past `exp` against a still-active
  // session row and assert the reason stays ACCESS_EXPIRED.
  it("过期 JWT → ACCESS_EXPIRED（session 仍活跃；DB 检查只在 verify 成功后做）", async () => {
    const { user, sessionId } = await seedUserWithSession();
    const claims: AccessClaims = {
      userId: user.id, sessionId, persona: Persona.STUDENT, roles: [],
    };
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(nowSec - 7200)
      .setExpirationTime(nowSec - 1)
      .setSubject(user.id)
      .sign(new TextEncoder().encode(process.env.ACCESS_JWT_SECRET!));

    const ctx = await ctxFor(reqWithAccessCookie(expired));
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("ACCESS_EXPIRED");
  });
});
