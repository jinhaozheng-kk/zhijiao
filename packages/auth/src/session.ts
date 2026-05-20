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

// Plan 2 Hardening — Task 3 (I1): atomic refresh rotation.
//
// The previous read-then-write implementation was a textbook TOCTOU race:
//   findUnique → check revokedAt → tx.update({where:{id}})
// The inner update had no `revokedAt: null` predicate, so two concurrent
// callers with the same refresh token both passed the check and both produced
// a fresh session — one revoked-old plus N new active sessions instead of
// the intended 1 → 1 rotation.
//
// Fix: predicate-on-update inside a single $transaction. Only the caller
// whose `updateMany({hash, revokedAt:null, expiresAt:{gt:now}})` returns
// count === 1 advances to creating the new session. Postgres READ COMMITTED
// + EvalPlanQual re-evaluates the WHERE clause after the row lock releases,
// so the losers see count === 0 and the diagnosis branch maps to
//   - row missing       → NO_SESSION
//   - row revoked       → REUSE_DETECTED (mass-revoke runs OUTSIDE the tx so
//                         it isn't rolled back by the thrown AuthError, and
//                         it sees the winner's just-committed new session)
//   - row past expiresAt → SESSION_REVOKED (mark this row EXPIRED inside tx)
//
// `refreshTokenHash` has a UNIQUE constraint so updateMany matches at most
// one row; count > 1 would be an invariant breach and we throw.
type RotateOutcome =
  | { kind: "OK"; sessionId: string; userId: string; refreshToken: string }
  | { kind: "NO_SESSION" }
  | { kind: "SESSION_REVOKED" }
  | { kind: "REUSE_DETECTED"; userId: string };

export async function rotateSession(prisma: PrismaClient, refreshToken: string, meta: DeviceMeta) {
  const hash = hashRefresh(refreshToken);

  const outcome: RotateOutcome = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const revoke = await tx.session.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokedReason: SessionRevokeReason.ROTATED },
    });

    if (revoke.count === 0) {
      const row = await tx.session.findUnique({ where: { refreshTokenHash: hash } });
      if (!row) return { kind: "NO_SESSION" };
      if (row.revokedAt != null) return { kind: "REUSE_DETECTED", userId: row.userId };

      // Predicate fell out for a non-revoked row → must be expired.
      await tx.session.update({
        where: { id: row.id },
        data: { revokedAt: now, revokedReason: SessionRevokeReason.EXPIRED },
      });
      return { kind: "SESSION_REVOKED" };
    }

    if (revoke.count > 1) {
      // `refreshTokenHash` is UNIQUE; count > 1 means a schema invariant broke.
      throw new Error(
        `rotateSession: predicate matched ${revoke.count} rows; refreshTokenHash uniqueness broken`,
      );
    }

    // Winner. Re-read the just-revoked row for userId; field is preserved.
    const revokedRow = await tx.session.findUniqueOrThrow({ where: { refreshTokenHash: hash } });
    const newRefresh = randomBytes(32).toString("base64url");
    const next = await tx.session.create({
      data: {
        userId: revokedRow.userId,
        refreshTokenHash: hashRefresh(newRefresh),
        ipCreated: meta.ipCreated ?? null,
        userAgent: meta.userAgent ?? null,
        deviceLabel: meta.deviceLabel ?? null,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
        lastUsedAt: now,
      },
    });
    return { kind: "OK", sessionId: next.id, userId: revokedRow.userId, refreshToken: newRefresh };
  });

  if (outcome.kind === "OK") {
    return { sessionId: outcome.sessionId, userId: outcome.userId, refreshToken: outcome.refreshToken };
  }
  if (outcome.kind === "NO_SESSION") throw new AuthError("NO_SESSION");
  if (outcome.kind === "SESSION_REVOKED") throw new AuthError("SESSION_REVOKED");

  // REUSE_DETECTED: mass-revoke OUTSIDE the diagnosis tx so the writes are
  // not rolled back by the throw, and so we see any concurrent winner's
  // just-committed new session (which we want to burn as part of the
  // OAuth 2.0 reuse-detection response).
  await prisma.session.updateMany({
    where: { userId: outcome.userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.REUSE_DETECTED },
  });
  throw new AuthError("REUSE_DETECTED");
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
