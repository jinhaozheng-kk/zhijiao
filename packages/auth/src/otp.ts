import { createHash, randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AuthError } from "./errors.js";

const OTP_TTL_MS = 5 * 60 * 1000;
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
  purpose: "LOGIN" | "BIND_PHONE";
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

/** 校验：失败抛 AuthError，成功返回 otpId。命中即标记 consumed */
export async function verifyOtp(prisma: PrismaClient, phone: string, code: string, pepper: string): Promise<{ otpId: string }> {
  const row = await prisma.otpRequest.findFirst({
    where: { phone, consumedAt: null, expiredAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new AuthError("OTP_EXPIRED");

  // attempts +1（即使匹配也 +1；不影响 consumed 路径，但反爆破在 mismatch 路径生效）
  const updated = await prisma.otpRequest.update({
    where: { id: row.id },
    data: { attempts: { increment: 1 } },
  });
  if (updated.attempts >= MAX_ATTEMPTS) {
    await prisma.otpRequest.update({ where: { id: row.id }, data: { expiredAt: new Date() } });
    throw new AuthError("OTP_MAX_ATTEMPTS");
  }

  const expected = hashCode(code, phone, pepper);
  if (expected !== row.codeHash) throw new AuthError("OTP_INVALID", { remaining: MAX_ATTEMPTS - updated.attempts });

  await prisma.otpRequest.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return { otpId: row.id };
}

export const _internal = { OTP_TTL_MS, MAX_ATTEMPTS, CODE_LENGTH };
