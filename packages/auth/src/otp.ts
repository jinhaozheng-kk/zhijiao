import { createHash, randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AuthError } from "./errors.js";

const OTP_TTL_MS = 5 * 60 * 1000;
// MAX_ATTEMPTS = 5 — the maximum number of verify attempts allowed before
// lockout. We use `attempts > MAX_ATTEMPTS` as the gate, so attempts 1..5
// reach the hash comparison and the 6th attempt is rejected pre-comparison.
// (The previous boundary was `>= MAX_ATTEMPTS`, which gave only 4 effective
// tries — an off-by-one corrected as part of Task 4.)
const MAX_ATTEMPTS = 5;
const CODE_LENGTH = 6;

export function generateCode(): string {
  // 100000..999999 等概率
  return String(randomInt(100_000, 1_000_000));
}

export function hashCode(code: string, phone: string, pepper: string): string {
  return createHash("sha256").update(`${code}.${phone}.${pepper}`).digest("hex");
}

export interface IssueOtpInput {
  phone: string;
  purpose: "LOGIN" | "BIND_PHONE" | "DSAR_DELETION";
  ipCreated?: string | null;
  userAgent?: string | null;
  pepper: string;
}

export async function issueOtp(prisma: PrismaClient, input: IssueOtpInput): Promise<{ code: string; otpId: string }> {
  const code = generateCode();
  const codeHash = hashCode(code, input.phone, input.pepper);
  const row = await prisma.otpRequest.create({
    data: {
      phone: input.phone,
      purpose: input.purpose,
      codeHash,
      ipCreated: input.ipCreated ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  return { code, otpId: row.id };
}

// Plan 2 Hardening — Task 4 (I2 + G4): atomic OTP consume + corrected MAX.
//
// Previous implementation issued
//   findFirst → update(attempts++) → check `>= MAX` → compare hash → update(consumedAt)
// The final consume update had no `consumedAt: null` predicate, so two
// concurrent verifies with the right code both succeeded (last write wins).
// The OTP could be exchanged for two sessions / two register payloads.
//
// Fix #1 (race): replace the final consume with a predicate-on-update —
// `updateMany({where:{id, consumedAt:null}, data:{consumedAt:now}})`. The
// caller whose count === 1 won the race; count === 0 lost and throws
// OTP_EXPIRED (the same reason a sequential reuse would yield — keeps the
// loser from learning that someone else just succeeded).
//
// Fix #2 (boundary): change the lockout check from `attempts >= MAX_ATTEMPTS`
// to `attempts > MAX_ATTEMPTS` so the constant means "max attempts allowed"
// rather than "the index at which lockout fires". 5 hash comparisons are
// now allowed; the 6th rejects pre-comparison with OTP_MAX_ATTEMPTS.
//
// We do NOT wrap the body in `$transaction`: the increment must persist
// across the failure paths (otherwise a throw rolls back the brute-force
// counter — useless for rate limiting). Each predicate-on-update is
// individually atomic, which is what we actually need.
/** 校验：失败抛 AuthError，成功返回 otpId。命中即标记 consumed */
export async function verifyOtp(
  prisma: PrismaClient,
  phone: string,
  code: string,
  pepper: string,
  purpose?: "LOGIN" | "BIND_PHONE" | "DSAR_DELETION",
): Promise<{ otpId: string }> {
  const now = new Date();
  const row = await prisma.otpRequest.findFirst({
    where: { phone, consumedAt: null, expiredAt: null, expiresAt: { gt: now }, ...(purpose ? { purpose } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new AuthError("OTP_EXPIRED");

  const updated = await prisma.otpRequest.update({
    where: { id: row.id },
    data: { attempts: { increment: 1 } },
  });

  if (updated.attempts > MAX_ATTEMPTS) {
    // Past MAX → mark expired (predicate so concurrent over-MAX callers don't
    // race on the expiredAt write) and reject pre-hash-compare.
    await prisma.otpRequest.updateMany({
      where: { id: row.id, expiredAt: null },
      data: { expiredAt: new Date() },
    });
    throw new AuthError("OTP_MAX_ATTEMPTS");
  }

  const expected = hashCode(code, phone, pepper);
  if (expected !== row.codeHash) {
    throw new AuthError("OTP_INVALID", { remaining: MAX_ATTEMPTS - updated.attempts });
  }

  // Atomic consume: only the first caller flips consumedAt; losers see
  // count === 0 and throw OTP_EXPIRED (uniform with the sequential-reuse path
  // so the loser cannot infer "someone else just consumed this code").
  const consumed = await prisma.otpRequest.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) throw new AuthError("OTP_EXPIRED");

  return { otpId: row.id };
}

export const _internal = { OTP_TTL_MS, MAX_ATTEMPTS, CODE_LENGTH };
