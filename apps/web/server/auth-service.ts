import "server-only";
import type { PrismaClient } from "@prisma/client";
import { Persona, AuthProvider } from "@prisma/client";
import {
  signAccess, createSession, buildAccessCookie, buildRefreshCookie,
  putRegisterPayload, buildRegisterCookie,
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

export async function loginOrPrepareRegisterByWechat(opts: {
  prisma: PrismaClient;
  redis: import("ioredis").default;
  resHeaders: Headers;
  appId: string;
  openid: string;
  unionid?: string;
  profile?: { nickname?: string; avatarUrl?: string };
  ip?: string | null;
  ua?: string | null;
}): Promise<{ status: "logged_in"; defaultRoute: string } | { status: "need_register"; redirectPath: string }> {
  const hit = await opts.prisma.authIdentity.findUnique({
    where: { uniq_identity: { provider: AuthProvider.WECHAT_H5, providerScope: opts.appId, providerUserId: opts.openid } },
  });
  if (hit) {
    const { defaultRoute } = await issueSessionAndCookies({
      prisma: opts.prisma, userId: hit.userId, resHeaders: opts.resHeaders, ip: opts.ip, ua: opts.ua,
    });
    return { status: "logged_in", defaultRoute };
  }
  // unionId 合并：找其他 WECHAT_* identity
  if (opts.unionid) {
    const sibling = await opts.prisma.authIdentity.findFirst({ where: { provider: { in: [AuthProvider.WECHAT_H5, AuthProvider.WECHAT_OPEN, AuthProvider.WECHAT_MINIAPP] }, unionId: opts.unionid } });
    if (sibling) {
      await opts.prisma.authIdentity.create({
        data: { userId: sibling.userId, provider: AuthProvider.WECHAT_H5, providerScope: opts.appId, providerUserId: opts.openid, unionId: opts.unionid, metadata: opts.profile as object | undefined },
      });
      const { defaultRoute } = await issueSessionAndCookies({
        prisma: opts.prisma, userId: sibling.userId, resHeaders: opts.resHeaders, ip: opts.ip, ua: opts.ua,
      });
      return { status: "logged_in", defaultRoute };
    }
  }
  const nonce = await putRegisterPayload(opts.redis, {
    provider: "WECHAT_H5", providerScope: opts.appId, providerUserId: opts.openid, unionId: opts.unionid, profile: opts.profile,
  });
  opts.resHeaders.append("Set-Cookie", buildRegisterCookie(nonce));
  return { status: "need_register", redirectPath: "/register?from=wechat" };
}

export async function bindWechatToUser(opts: {
  prisma: PrismaClient;
  appId: string;
  openid: string;
  unionid?: string;
  bindUserId: string;
}): Promise<"ok" | "noop" | "conflict"> {
  const hit = await opts.prisma.authIdentity.findUnique({
    where: { uniq_identity: { provider: AuthProvider.WECHAT_H5, providerScope: opts.appId, providerUserId: opts.openid } },
  });
  if (hit) return hit.userId === opts.bindUserId ? "noop" : "conflict";
  await opts.prisma.authIdentity.create({
    data: { userId: opts.bindUserId, provider: AuthProvider.WECHAT_H5, providerScope: opts.appId, providerUserId: opts.openid, unionId: opts.unionid },
  });
  return "ok";
}
