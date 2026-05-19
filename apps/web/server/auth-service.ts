import "server-only";
import type { PrismaClient } from "@prisma/client";
import { Persona, AuthProvider } from "@prisma/client";
import {
  signAccess, createSession, buildAccessCookie, buildRefreshCookie,
  type AccessClaims,
} from "@zhijiao/auth";
import { defaultRouteFor } from "@zhijiao/domain";
import { appendSetCookie } from "./cookie-utils.js";

export async function issueSessionAndCookies(opts: {
  prisma: PrismaClient;
  userId: string;
  resHeaders: Headers;
  ip?: string | null;
  ua?: string | null;
}) {
  const user = await opts.prisma.user.findUniqueOrThrow({
    where: { id: opts.userId },
    include: { roles: true },
  });
  const { sessionId, refreshToken } = await createSession(opts.prisma, opts.userId, {
    ipCreated: opts.ip ?? null, userAgent: opts.ua ?? null,
  });
  const claims: AccessClaims = {
    userId: user.id,
    sessionId,
    persona: user.persona as Persona,
    roles: user.roles.map((r) => r.role) as AccessClaims["roles"],
  };
  const access = await signAccess(claims, process.env.ACCESS_JWT_SECRET ?? "");
  appendSetCookie(opts.resHeaders, buildAccessCookie(access));
  appendSetCookie(opts.resHeaders, buildRefreshCookie(refreshToken));
  return {
    user: { id: user.id, name: user.name, persona: user.persona, gradeLevel: user.gradeLevel, isMinor: user.isMinor },
    defaultRoute: defaultRouteFor(user.persona as Persona),
  };
}

export async function findUserByPhone(prisma: PrismaClient, phone: string) {
  const id = await prisma.authIdentity.findUnique({
    where: { uniq_identity: { provider: AuthProvider.PHONE, providerScope: "GLOBAL", providerUserId: phone } },
  });
  return id ? prisma.user.findUnique({ where: { id: id.userId } }) : null;
}
