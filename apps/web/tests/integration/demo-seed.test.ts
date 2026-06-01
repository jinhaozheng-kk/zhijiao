import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { DEMO_IDS } from "@/server/demo/config";
import { resetDemoData, verifyDemoData } from "@/server/demo/seed";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("demo data seed", () => {
  it("resets deterministic demo data idempotently", async () => {
    await resetDemoData(prisma);
    await resetDemoData(prisma);

    const result = await verifyDemoData(prisma);

    expect(result.ok).toBe(true);
    await expect(
      prisma.classroom.count({ where: { id: DEMO_IDS.classroomId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.familyLink.count({
        where: {
          parentUserId: DEMO_IDS.parentUserId,
          studentUserId: DEMO_IDS.studentUserId,
          status: "ACTIVE",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.studentAssignment.count({
        where: {
          studentUserId: DEMO_IDS.studentUserId,
          status: "SUBMITTED",
          submittedAt: { not: null },
          gradedAt: null,
        },
      }),
    ).resolves.toBe(1);

    const studentWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: DEMO_IDS.studentUserId },
    });
    expect(studentWallet.balance).toBe(47);

    const variantDebit = await prisma.creditLedger.findUniqueOrThrow({
      where: { idemKey: "demo:variant:debit:seed" },
    });
    expect(variantDebit.walletId).toBe(studentWallet.id);
    expect(variantDebit.createdByUserId).toBe(DEMO_IDS.studentUserId);
    expect(variantDebit.actionKind).toBe("VARIANT_GROUP_GEN");
  });
});
