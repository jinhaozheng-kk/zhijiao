import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { backfillVariantQuestions } from "@/scripts/variant-backfill-questions";

async function seedOneVariantItem() {
  const subject = await prisma.subject.create({
    data: { code: "math-race", name: "Mathematics" },
  });
  const parentQuestion = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Solve x + 1 = 2",
      type: "ESSAY",
      status: "PUBLISHED",
    },
  });
  const user = await prisma.user.create({
    data: { persona: "STUDENT", isMinor: false },
  });
  const entry = await prisma.errorBookEntry.create({
    data: {
      userId: user.id,
      questionId: parentQuestion.id,
      status: "ACTIVE",
      rootCause: "OTHER",
      rootCauseReasoning: "seed",
    },
  });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, balance: 0 },
  });
  const ledger = await prisma.creditLedger.create({
    data: {
      walletId: wallet.id,
      kind: "DEBIT",
      delta: -3,
      balanceAfter: 0,
      actionKind: "VARIANT_GROUP_GEN",
      idemKey: `debit:variant_group_gen:${user.id}:race`,
    },
  });
  const group = await prisma.variantGroup.create({
    data: {
      entryId: entry.id,
      userId: user.id,
      creditsCost: 3,
      debitLedgerId: ledger.id,
    },
  });
  const item = await prisma.variantItem.create({
    data: {
      groupId: group.id,
      level: "L1",
      position: 0,
      stemMd: "Variant race stem",
      solutionMd: "Variant race solution",
      knowledgePointHints: [],
    },
  });

  return { item, parentQuestion, user };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backfillVariantQuestions race handling", () => {
  it("deletes its orphan question when another writer links the item first", async () => {
    const { item, parentQuestion, user } = await seedOneVariantItem();

    const result = await backfillVariantQuestions(prisma, {
      limit: 1000,
      dryRun: false,
      afterCreateBeforeUpdate: async ({ prisma: tx, itemId }) => {
        const competingQuestion = await tx.question.create({
          data: {
            subjectId: parentQuestion.subjectId,
            stemMd: "Competing variant question",
            type: "ESSAY",
            status: "DRAFT",
            source: "VARIANT_GENERATED",
            createdByUserId: user.id,
          },
        });
        await tx.variantItem.update({
          where: { id: itemId },
          data: { questionId: competingQuestion.id },
        });
      },
    });

    expect(result).toEqual({ processed: 1, created: 0, alreadySeen: 1, dryRun: false });

    const updatedItem = await prisma.variantItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { question: true },
    });
    expect(updatedItem.questionId).not.toBeNull();
    expect(updatedItem.question!.stemMd).toBe("Competing variant question");

    const generatedQuestions = await prisma.question.findMany({
      where: { source: "VARIANT_GENERATED" },
    });
    expect(generatedQuestions).toHaveLength(1);
    expect(generatedQuestions[0]!.id).toBe(updatedItem.questionId);
  });
});
