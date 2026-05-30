import type { Persona, GuardianConsentStatus } from "@prisma/client";

// 保守判龄：出生年使「最小可能年龄」< 14 即触发。年份粗粒度宁可多触发同意门禁。
// 例（2026）：2012 → 2026-2012=14 → true；2011 → 15 → false。
export function isUnder14(birthYear: number, now: Date = new Date()): boolean {
  return now.getFullYear() - birthYear <= 14;
}

// 注册期初始状态：STUDENT 且 <14 → PENDING；否则 NOT_REQUIRED（含 birthYear 缺失的 grandfather）。
export function initialConsentStatus(
  persona: Persona,
  birthYear: number | null,
  now: Date = new Date(),
): GuardianConsentStatus {
  if (persona === "STUDENT" && birthYear != null && isUnder14(birthYear, now)) {
    return "PENDING";
  }
  return "NOT_REQUIRED";
}
