import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { SessionRevokeReason } from "@prisma/client";
import { AuthError } from "./errors.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashRefresh(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface DeviceMeta { ipCreated?: string | null; userAgent?: string | null; deviceLabel?: string | null; }

export async function createSession(prisma: PrismaClient, userId: string, meta: DeviceMeta) {
  const refreshToken = randomBytes(32).toString("base64url");
  const refreshTokenHash = hashRefresh(refreshToken);
  const session = await prisma.session.create({
    data: {
      userId, refreshTokenHash,
      ipCreated: meta.ipCreated ?? null,
      userAgent: meta.userAgent ?? null,
      deviceLabel: meta.deviceLabel ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { sessionId: session.id, refreshToken };
}

export async function rotateSession(prisma: PrismaClient, refreshToken: string, meta: DeviceMeta) {
  const hash = hashRefresh(refreshToken);
  const current = await prisma.session.findUnique({ where: { refreshTokenHash: hash } });

  if (!current) throw new AuthError("NO_SESSION");

  if (current.revokedAt != null) {
    // 重放检测：吊销该 user 所有未失效 session
    await prisma.session.updateMany({
      where: { userId: current.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.REUSE_DETECTED },
    });
    throw new AuthError("REUSE_DETECTED");
  }

  if (current.expiresAt <= new Date()) {
    await prisma.session.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.EXPIRED },
    });
    throw new AuthError("SESSION_REVOKED");
  }

  // 事务：旧 session revoke + 新 session insert + 立刻把占位 hash 改为真 hash
  return prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.ROTATED },
    });
    const next = await tx.session.create({
      data: {
        userId: current.userId,
        refreshTokenHash: hashRefresh(refreshToken + "__placeholder"), // 占位，立刻覆盖
        ipCreated: meta.ipCreated ?? null,
        userAgent: meta.userAgent ?? null,
        deviceLabel: meta.deviceLabel ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const newRefresh = randomBytes(32).toString("base64url");
    await tx.session.update({
      where: { id: next.id },
      data: { refreshTokenHash: hashRefresh(newRefresh), lastUsedAt: new Date() },
    });
    return { sessionId: next.id, userId: current.userId, refreshToken: newRefresh };
  });
}

export async function revokeSession(prisma: PrismaClient, sessionId: string, reason: SessionRevokeReason) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeByRefreshToken(prisma: PrismaClient, refreshToken: string, reason: SessionRevokeReason) {
  const hash = hashRefresh(refreshToken);
  await prisma.session.updateMany({
    where: { refreshTokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}
