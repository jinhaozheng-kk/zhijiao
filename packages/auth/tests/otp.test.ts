import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { issueOtp, verifyOtp, hashCode } from "../src/otp.js";
import { AuthError } from "../src/errors.js";

const PEPPER = "test-pepper";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("otp", () => {
  it("issue + verify 成功，consumed", async () => {
    const { code } = await issueOtp(prisma, { phone: "13800000099", purpose: "LOGIN", pepper: PEPPER });
    const r = await verifyOtp(prisma, "13800000099", code, PEPPER);
    expect(r.otpId).toBeTruthy();
  });

  it("错码 → OTP_INVALID；attempts +1", async () => {
    await issueOtp(prisma, { phone: "13800000099", purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, "13800000099", "000000", PEPPER)).rejects.toBeInstanceOf(AuthError);
  });

  it("达 5 次失败 → OTP_MAX_ATTEMPTS + expiredAt 落地", async () => {
    await issueOtp(prisma, { phone: "13800000099", purpose: "LOGIN", pepper: PEPPER });
    for (let i = 0; i < 4; i++) {
      await expect(verifyOtp(prisma, "13800000099", "000000", PEPPER)).rejects.toBeInstanceOf(AuthError);
    }
    await expect(verifyOtp(prisma, "13800000099", "000000", PEPPER)).rejects.toMatchObject({ reason: "OTP_MAX_ATTEMPTS" });
    const row = await prisma.otpRequest.findFirstOrThrow({ where: { phone: "13800000099" } });
    expect(row.expiredAt).not.toBeNull();
  });

  it("已 consumed 后再校验 → 找不到新行 → OTP_EXPIRED", async () => {
    const { code } = await issueOtp(prisma, { phone: "13800000099", purpose: "LOGIN", pepper: PEPPER });
    await verifyOtp(prisma, "13800000099", code, PEPPER);
    await expect(verifyOtp(prisma, "13800000099", code, PEPPER)).rejects.toMatchObject({ reason: "OTP_EXPIRED" });
  });

  it("hashCode 同输入同输出，不同 pepper 不同输出", () => {
    expect(hashCode("123456", "138", "p1")).toBe(hashCode("123456", "138", "p1"));
    expect(hashCode("123456", "138", "p1")).not.toBe(hashCode("123456", "138", "p2"));
  });
});
