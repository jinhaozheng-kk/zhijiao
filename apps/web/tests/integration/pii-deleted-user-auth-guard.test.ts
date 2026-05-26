import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Persona, AuthProvider } from "@prisma/client";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  AuthError,
  COOKIE_AT,
  COOKIE_RT,
  createSession,
  signAccess,
  type AccessClaims,
} from "@zhijiao/auth";
import { POST as refreshPOST } from "@/app/api/auth/refresh/route";
import { createContext } from "@/server/context";
import {
  findUserByPhone,
  issueSessionAndCookies,
} from "@/server/auth-service";
import { appRouter } from "@/server/routers/_root";
import { env } from "@/server/env";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedUserWithSession(args: { deleted?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      name: "auth-user",
      persona: Persona.STUDENT,
      isMinor: false,
      deletedAt: args.deleted ? new Date() : null,
    },
  });
  const { sessionId, refreshToken } = await createSession(prisma, user.id, {});
  const claims: AccessClaims = {
    userId: user.id,
    sessionId,
    persona: Persona.STUDENT,
    roles: [],
  };
  const access = await signAccess(claims, env.ACCESS_JWT_SECRET);
  return { user, sessionId, refreshToken, access };
}

function reqWithAccessCookie(access: string): Request {
  return new Request("http://localhost/api/trpc/auth.me", {
    headers: { cookie: `${COOKIE_AT}=${encodeURIComponent(access)}` },
  });
}

function reqWithRefreshCookie(refreshToken: string): Request {
  return new Request("http://localhost/api/auth/refresh", {
    method: "POST",
    headers: { cookie: `${COOKIE_RT}=${encodeURIComponent(refreshToken)}` },
  });
}

async function ctxFor(req: Request) {
  return createContext({ req, resHeaders: new Headers(), info: {} as never });
}

describe("deleted user auth guard", () => {
  it("active user access token still authenticates", async () => {
    const { user, access } = await seedUserWithSession();
    const ctx = await ctxFor(reqWithAccessCookie(access));
    expect(ctx.auth?.userId).toBe(user.id);
    expect(ctx.authError).toBeNull();
  });

  it("deleted user access token becomes USER_DEACTIVATED", async () => {
    const { user, access } = await seedUserWithSession();
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date(), name: null },
    });

    const ctx = await ctxFor(reqWithAccessCookie(access));
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("USER_DEACTIVATED");
    await expect(appRouter.createCaller(ctx).auth.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      cause: { reason: "USER_DEACTIVATED" },
    });
  });

  it("revoked session takes precedence over USER_DEACTIVATED", async () => {
    const { user, sessionId, access } = await seedUserWithSession();
    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    const ctx = await ctxFor(reqWithAccessCookie(access));
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("SESSION_REVOKED");
  });

  it("refresh token for deleted user returns USER_DEACTIVATED and clears cookies", async () => {
    const { user, refreshToken } = await seedUserWithSession();
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    const res = await refreshPOST(reqWithRefreshCookie(refreshToken));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      reason: "USER_DEACTIVATED",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(COOKIE_AT);
    expect(setCookie).toContain(COOKIE_RT);
    await expect(
      prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).resolves.toBe(0);
  });

  it("issueSessionAndCookies rejects deleted users defensively", async () => {
    const { user } = await seedUserWithSession({ deleted: true });
    const resHeaders = new Headers();

    await expect(
      issueSessionAndCookies({
        prisma,
        userId: user.id,
        resHeaders,
      }),
    ).rejects.toMatchObject(new AuthError("USER_DEACTIVATED"));
    expect(resHeaders.get("set-cookie")).toBeNull();
  });

  it("findUserByPhone ignores a deleted tombstone user", async () => {
    const { user } = await seedUserWithSession({ deleted: true });
    await prisma.authIdentity.create({
      data: {
        userId: user.id,
        provider: AuthProvider.PHONE,
        providerScope: "GLOBAL",
        providerUserId: "13800000000",
      },
    });

    await expect(findUserByPhone(prisma, "13800000000")).resolves.toBeNull();
  });
});
