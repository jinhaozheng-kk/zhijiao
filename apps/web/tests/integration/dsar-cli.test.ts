import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { fulfillDeletion, rejectDeletion, listForOps } from "@/server/lib/dsar";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

async function seedPending(opts: { isMinor?: boolean; guardianApproved?: boolean; status?: "PENDING" | "AWAITING_GUARDIAN" } = {}) {
  const u = await prisma.user.create({ data: { persona: "STUDENT", isMinor: opts.isMinor ?? false, gradeLevel: "G7" } });
  const req = await prisma.dsarRequest.create({
    data: {
      userId: u.id, type: "DELETION", status: opts.status ?? "PENDING", isMinor: opts.isMinor ?? false,
      requestedAt: new Date(), dueAt: new Date(Date.now() - 86400000),
      guardianApprovedByUserId: opts.guardianApproved ? u.id : null,
    },
  });
  return { userId: u.id, requestId: req.id };
}

describe("dsar CLI service", () => {
  it("成年 fulfill → deactivate + COMPLETED", async () => {
    const { userId, requestId } = await seedPending();
    const r = await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" });
    expect(r.dryRun).toBe(false);
    expect((await prisma.dsarRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("COMPLETED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).not.toBeNull();
  });
  it("AWAITING_GUARDIAN 不可 fulfill", async () => {
    const { requestId } = await seedPending({ isMinor: true, status: "AWAITING_GUARDIAN" });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" })).rejects.toThrow(/not PENDING/);
  });
  it("未成年 PENDING 无 guardianApproved → 拒", async () => {
    const { requestId } = await seedPending({ isMinor: true, guardianApproved: false });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" })).rejects.toThrow(/guardian approval/);
  });
  it("未成年 PENDING 有 guardianApproved → 放行", async () => {
    const { requestId } = await seedPending({ isMinor: true, guardianApproved: true });
    expect((await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" })).dryRun).toBe(false);
  });
  it("二次 fulfill 已 COMPLETED → 拒", async () => {
    const { requestId } = await seedPending();
    await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" })).rejects.toThrow(/not PENDING/);
  });
  it("reject → REJECTED", async () => {
    const { requestId } = await seedPending();
    expect((await rejectDeletion(prisma, { requestId, note: "非本人核验失败", initiatorRef: "cli:test:op" })).status).toBe("REJECTED");
  });
  it("list --overdue 只列逾期未结", async () => {
    await seedPending();
    const rows = await listForOps(prisma, { status: "pending", overdueOnly: true });
    expect(rows.length).toBe(1);
    expect(rows[0]!.overdue).toBe(true);
  });
});
