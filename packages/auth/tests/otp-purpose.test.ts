import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { issueOtp, verifyOtp } from "../src/otp.js";

const PEPPER = "test-pepper-min16-bytes";
const PHONE = "13800009999";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("verifyOtp purpose isolation (Plan 14b)", () => {
  it("DSAR 码用 DSAR purpose 验证 → 通过", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "DSAR_DELETION", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER, "DSAR_DELETION")).resolves.toBeTruthy();
  });
  it("LOGIN 码不能用 DSAR purpose 验证", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER, "DSAR_DELETION")).rejects.toThrow();
  });
  it("不传 purpose 时行为不变(LOGIN 码可验)", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER)).resolves.toBeTruthy();
  });
});
