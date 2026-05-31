import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { issueOtp } from "@zhijiao/auth";
import { redis, makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

const { appRouter } = await import("@/server/routers/_root");
const PEPPER = process.env.OTP_PEPPER ?? "test-otp-pepper-min16-bytes";

async function seedPhone(userId: string, phone: string) {
  await prisma.authIdentity.create({ data: { userId, provider: "PHONE", providerScope: "GLOBAL", providerUserId: phone } });
}
async function seedGuardian(childId: string): Promise<string> {
  const g = await prisma.user.create({ data: { persona: "PARENT", isMinor: false } });
  await prisma.familyLink.create({ data: { parentUserId: g.id, studentUserId: childId, status: "ACTIVE" } });
  return g.id;
}

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

describe("dsar.exportMine", () => {
  it("返数据 + COMPLETED 工单", async () => {
    const u = await seedUserWithBalance(5);
    const r = await appRouter.createCaller(makeCtx(u.id)).dsar.exportMine();
    expect(r.requestId).toBeTruthy();
    expect(r.export.userId).toBe(u.id);
    expect((await prisma.dsarRequest.findFirstOrThrow({ where: { userId: u.id, type: "EXPORT" } })).status).toBe("COMPLETED");
  });
  it("限频超额 → TOO_MANY_REQUESTS(cap 2)", async () => {
    const u = await seedUserWithBalance(5);
    const c = appRouter.createCaller(makeCtx(u.id));
    await c.dsar.exportMine();
    await c.dsar.exportMine();
    await expect(c.dsar.exportMine()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("dsar.requestDeletion", () => {
  it("成年有效 OTP → PENDING + dueAt 未来且 ≤30 天", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007777");
    const { code } = await issueOtp(prisma, { phone: "13800007777", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r = await appRouter.createCaller(makeCtx(u.id)).dsar.requestDeletion({ otpCode: code, reason: "不想用了" });
    expect(r.request.status).toBe("PENDING");
    const due = new Date(r.request.dueAt).getTime();
    expect(due).toBeGreaterThan(Date.now());
    expect(due).toBeLessThanOrEqual(Date.now() + 30 * 86400000 + 1000);
  });
  it("无效 OTP → 拒 + 不建工单", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007778");
    await expect(appRouter.createCaller(makeCtx(u.id)).dsar.requestDeletion({ otpCode: "000000" })).rejects.toBeInstanceOf(TRPCError);
    expect(await prisma.dsarRequest.count({ where: { userId: u.id, type: "DELETION" } })).toBe(0);
  });
  it("<14 有监护人 → AWAITING_GUARDIAN", async () => {
    const u = await seedUserWithBalance(5, { isMinor: true });
    await prisma.user.update({ where: { id: u.id }, data: { guardianConsentStatus: "GRANTED" } });
    await seedPhone(u.id, "13800007780");
    await seedGuardian(u.id);
    const { code } = await issueOtp(prisma, { phone: "13800007780", purpose: "DSAR_DELETION", pepper: PEPPER });
    const ctx = makeCtx(u.id, { isMinor: true, guardianConsentStatus: "GRANTED" });
    const r = await appRouter.createCaller(ctx).dsar.requestDeletion({ otpCode: code });
    expect(r.request.status).toBe("AWAITING_GUARDIAN");
  });
  it("<14 无监护人 → DSAR_GUARDIAN_REQUIRED + 不建工单", async () => {
    const u = await seedUserWithBalance(5, { isMinor: true });
    await prisma.user.update({ where: { id: u.id }, data: { guardianConsentStatus: "PENDING" } });
    await seedPhone(u.id, "13800007781");
    const { code } = await issueOtp(prisma, { phone: "13800007781", purpose: "DSAR_DELETION", pepper: PEPPER });
    const ctx = makeCtx(u.id, { isMinor: true, guardianConsentStatus: "PENDING" });
    await expect(appRouter.createCaller(ctx).dsar.requestDeletion({ otpCode: code })).rejects.toMatchObject({ cause: { reason: "DSAR_GUARDIAN_REQUIRED" } });
    expect(await prisma.dsarRequest.count({ where: { userId: u.id } })).toBe(0);
  });
  it("幂等:二次发起返同一条", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007782");
    const c = appRouter.createCaller(makeCtx(u.id));
    const { code: a } = await issueOtp(prisma, { phone: "13800007782", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r1 = await c.dsar.requestDeletion({ otpCode: a });
    const { code: b } = await issueOtp(prisma, { phone: "13800007782", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r2 = await c.dsar.requestDeletion({ otpCode: b });
    expect(r2.request.id).toBe(r1.request.id);
  });
});

describe("dsar.approveChildDeletion", () => {
  it("监护人 ACTIVE → AWAITING_GUARDIAN 转 PENDING + 留痕", async () => {
    const child = await seedUserWithBalance(5, { isMinor: true });
    await prisma.user.update({ where: { id: child.id }, data: { guardianConsentStatus: "GRANTED" } });
    await seedPhone(child.id, "13800007783");
    const guardianId = await seedGuardian(child.id);
    const { code } = await issueOtp(prisma, { phone: "13800007783", purpose: "DSAR_DELETION", pepper: PEPPER });
    await appRouter.createCaller(makeCtx(child.id, { isMinor: true, guardianConsentStatus: "GRANTED" })).dsar.requestDeletion({ otpCode: code });
    const approved = await appRouter.createCaller(makeCtx(guardianId)).dsar.approveChildDeletion({ childUserId: child.id });
    expect(approved.status).toBe("PENDING");
    expect((await prisma.dsarRequest.findFirstOrThrow({ where: { userId: child.id, type: "DELETION" } })).guardianApprovedByUserId).toBe(guardianId);
  });
  it("非监护人 → NOT_FOUND", async () => {
    const child = await seedUserWithBalance(5, { isMinor: true });
    const stranger = await seedUserWithBalance(5);
    await expect(appRouter.createCaller(makeCtx(stranger.id)).dsar.approveChildDeletion({ childUserId: child.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("dsar.cancelDeletion + myRequests + sendDeletionOtp", () => {
  it("PENDING → CANCELED;无 open → NOT_FOUND", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007784");
    const c = appRouter.createCaller(makeCtx(u.id));
    const { code } = await issueOtp(prisma, { phone: "13800007784", purpose: "DSAR_DELETION", pepper: PEPPER });
    await c.dsar.requestDeletion({ otpCode: code });
    expect((await c.dsar.cancelDeletion()).status).toBe("CANCELED");
    await expect(c.dsar.cancelDeletion()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("myRequests:REJECTED 回显 rejectionReason", async () => {
    const u = await seedUserWithBalance(5);
    await prisma.dsarRequest.create({ data: { userId: u.id, type: "DELETION", status: "REJECTED", isMinor: false, requestedAt: new Date(), dueAt: new Date(), resolutionNote: "经核验非本人" } });
    const r = await appRouter.createCaller(makeCtx(u.id)).dsar.myRequests();
    expect(r.requests[0]!.rejectionReason).toBe("经核验非本人");
  });
  it("无手机号 → DSAR_NO_PHONE", async () => {
    const u = await seedUserWithBalance(5);
    await expect(appRouter.createCaller(makeCtx(u.id)).dsar.sendDeletionOtp()).rejects.toMatchObject({ cause: { reason: "DSAR_NO_PHONE" } });
  });
});
