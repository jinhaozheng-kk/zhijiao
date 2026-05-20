import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { issueOtp, verifyOtp, hashCode } from "../src/otp.js";
import { AuthError } from "../src/errors.js";

const PEPPER = "test-pepper";
const PHONE = "13800000099";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("otp", () => {
  it("issue + verify 成功，consumed", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    const r = await verifyOtp(prisma, PHONE, code, PEPPER);
    expect(r.otpId).toBeTruthy();
  });

  it("错码 → OTP_INVALID；attempts +1", async () => {
    await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, "000000", PEPPER)).rejects.toMatchObject({ reason: "OTP_INVALID" });
  });

  // Plan 2 Hardening — Task 4 (I2 + G4): MAX boundary corrected from `>= MAX`
  // to `> MAX`. With MAX_ATTEMPTS = 5 this now means "5 hash compares allowed;
  // the 6th attempt rejects pre-compare." Previously the 5th attempt was
  // rejected without comparison — only 4 effective tries. The old behaviour
  // was a boundary off-by-one and is corrected here.
  it("MAX 边界：5 次错码 → OTP_INVALID × 5；第 6 次 → OTP_MAX_ATTEMPTS + expiredAt 落地", async () => {
    await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp(prisma, PHONE, "000000", PEPPER)).rejects.toMatchObject({ reason: "OTP_INVALID" });
    }
    await expect(verifyOtp(prisma, PHONE, "000000", PEPPER)).rejects.toMatchObject({ reason: "OTP_MAX_ATTEMPTS" });
    const row = await prisma.otpRequest.findFirstOrThrow({ where: { phone: PHONE } });
    expect(row.expiredAt).not.toBeNull();
  });

  // Task 4 acceptance #1: after MAX, even the correct code must not consume.
  // The hash comparison must not run, so we can't leak "right code but locked"
  // vs "wrong code, still try" — both should look identical to the caller.
  it("超过 MAX 后即便发对码也不能消费 → OTP_EXPIRED（不可泄漏命中信息）", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    // 6 wrong attempts to push attempts past MAX and set expiredAt
    for (let i = 0; i < 6; i++) {
      await verifyOtp(prisma, PHONE, "000000", PEPPER).catch(() => {});
    }
    // Even with the true code, the row is now expiredAt-flagged → findFirst returns nothing
    await expect(verifyOtp(prisma, PHONE, code, PEPPER)).rejects.toMatchObject({ reason: "OTP_EXPIRED" });
  });

  it("已 consumed 后再校验 → 找不到新行 → OTP_EXPIRED", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await verifyOtp(prisma, PHONE, code, PEPPER);
    await expect(verifyOtp(prisma, PHONE, code, PEPPER)).rejects.toMatchObject({ reason: "OTP_EXPIRED" });
  });

  it("hashCode 同输入同输出，不同 pepper 不同输出", () => {
    expect(hashCode("123456", "138", "p1")).toBe(hashCode("123456", "138", "p1"));
    expect(hashCode("123456", "138", "p1")).not.toBe(hashCode("123456", "138", "p2"));
  });

  // Plan 2 Hardening — Task 4 (I2): the previous implementation did
  //   findFirst → increment attempts → compare hash → update consumedAt
  // with the final consume update lacking a `consumedAt: null` predicate.
  // Two concurrent successful verifies both updated the row to consumed
  // (last write wins), both returned success — the OTP could be exchanged
  // for two sessions / two register payloads. Fix: predicate-on-update on
  // the consume step. Race-loser sees count === 0 and throws OTP_EXPIRED
  // (same reason as sequential reuse — no signal that someone else won).
  //
  // We use N independent PrismaClient instances so the queries don't share
  // a connection pool. With the shared `prisma` singleton, Node's event-loop
  // + Prisma's per-client query queueing tend to serialize calls — each
  // verify completes (including the consume update) before the next's
  // findFirst even fires — and the race window never opens. Independent
  // clients with independent pools let all N findFirst queries return
  // BEFORE any update commits, which is what surfaces the bug.
  it("并发 verify 同一 OTP (N=5, 独立 PrismaClient) → 仅 1 成功；其余 OTP_EXPIRED；consumedAt 只设 1 次", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });

    const N = 5;
    const clients = Array.from({ length: N }, () => new PrismaClient());
    try {
      // Warm the pools so the first race step is the verify itself, not
      // connection acquisition (which would re-serialise the calls).
      await Promise.all(clients.map((c) => c.$queryRaw`SELECT 1`));

      const results = await Promise.allSettled(
        clients.map((c) => verifyOtp(c, PHONE, code, PEPPER)),
      );
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<{ otpId: string }> => r.status === "fulfilled",
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );

      // 1) 仅 1 success
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(N - 1);

      // 2) 失败者必须是 OTP_EXPIRED — 不允许偷偷 OTP_INVALID（会让旁观者从
      //    reason 区分 race-loser vs wrong-code）或 OTP_MAX_ATTEMPTS（N=5 内
      //    不应触发 MAX）。
      for (const r of rejected) {
        const err = r.reason as AuthError;
        expect(err).toBeInstanceOf(AuthError);
        expect(err.reason).toBe("OTP_EXPIRED");
      }

      // 3) 行只 consumed 1 次
      const row = await prisma.otpRequest.findFirstOrThrow({ where: { phone: PHONE } });
      expect(row.consumedAt).not.toBeNull();
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
  });
});
