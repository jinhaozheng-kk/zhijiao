import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { deactivateUser } from "@/server/lib/pii-governance";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("deactivateUser generated variant questions", () => {
  it("scrubs generated variant Question ownership while deleting variant content rows", async () => {
    const subject = await prisma.subject.create({
      data: { code: "math", name: "Math" },
    });
    const user = await prisma.user.create({
      data: { persona: "STUDENT", isMinor: false },
    });
    const parentQuestion = await prisma.question.create({
      data: {
        subjectId: subject.id,
        stemMd: "Parent stem",
        type: "CALCULATION",
        status: "PUBLISHED",
      },
    });
    const entry = await prisma.errorBookEntry.create({
      data: {
        userId: user.id,
        questionId: parentQuestion.id,
        rootCause: "OTHER",
        rootCauseReasoning: "reasoning",
      },
    });
    const group = await prisma.variantGroup.create({
      data: {
        entryId: entry.id,
        userId: user.id,
        creditsCost: 3,
        debitLedgerId: "debit-generated-variant",
      },
    });
    const variantQuestion = await prisma.question.create({
      data: {
        subjectId: subject.id,
        stemMd: "Generated variant stem",
        type: "CALCULATION",
        status: "DRAFT",
        source: "VARIANT_GENERATED",
        createdByUserId: user.id,
      },
    });
    const variantItem = await prisma.variantItem.create({
      data: {
        groupId: group.id,
        questionId: variantQuestion.id,
        level: "L1",
        position: 1,
        stemMd: "Generated variant stem",
        solutionMd: "Generated variant solution",
      },
    });

    const result = await deactivateUser(prisma, {
      userId: user.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });

    expect(result.payload.scrubbed.variantGeneratedQuestions).toBe(1);

    await expect(
      prisma.question.findUniqueOrThrow({ where: { id: variantQuestion.id } }),
    ).resolves.toMatchObject({
      id: variantQuestion.id,
      source: "VARIANT_GENERATED",
      createdByUserId: null,
    });

    await expect(
      prisma.variantItem.findUnique({ where: { id: variantItem.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.variantGroup.findUnique({ where: { id: group.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.errorBookEntry.findUnique({ where: { id: entry.id } }),
    ).resolves.toBeNull();
  });
});
