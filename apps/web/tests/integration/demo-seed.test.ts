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

    const subject = await prisma.subject.findUniqueOrThrow({
      where: { code: "demo-math" },
      include: { knowledgePoints: true },
    });
    expect(subject.name).toBe("数学");
    expect(subject.knowledgePoints.map((kp) => kp.name).sort()).toEqual([
      "一次函数与一元一次方程关系",
      "函数图像交点",
      "待定系数法",
    ]);

    const questions = await prisma.question.findMany({
      where: { source: { in: ["DEMO_SEED", "VARIANT_GENERATED"] } },
      select: { stemMd: true },
    });
    const questionText = questions.map((q) => q.stemMd).join("\n");
    expect(questionText).toContain("一次函数");
    expect(questionText).not.toMatch(/Demo Math|Solve the equation|Linear equations/i);

    await expect(
      prisma.errorBookEntry.count({ where: { userId: DEMO_IDS.studentUserId } }),
    ).resolves.toBeGreaterThanOrEqual(3);
    await expect(
      prisma.variantItem.count({
        where: { group: { userId: DEMO_IDS.studentUserId } },
      }),
    ).resolves.toBeGreaterThanOrEqual(3);

    const variantLevels = await prisma.variantItem.findMany({
      where: { group: { userId: DEMO_IDS.studentUserId } },
      select: { level: true },
      orderBy: { position: "asc" },
    });
    expect(new Set(variantLevels.map((item) => item.level))).toEqual(
      new Set(["L1", "L2", "L3"]),
    );

    const rootCauses = await prisma.errorBookEntry.findMany({
      where: { userId: DEMO_IDS.studentUserId },
      select: { rootCause: true },
    });
    expect(new Set(rootCauses.map((entry) => entry.rootCause)).size).toBeGreaterThanOrEqual(3);
  });
});
