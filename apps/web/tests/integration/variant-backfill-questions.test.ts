import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { backfillVariantQuestions } from "@/scripts/variant-backfill-questions";

async function seedVariantBackfillRows(count: number, opts: { linked?: number } = {}) {
  const linked = opts.linked ?? 0;
  const subject = await prisma.subject.create({
    data: { code: `math-${count}-${linked}`, name: "Mathematics" },
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
  const itemIds: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const ledger = await prisma.creditLedger.create({
      data: {
        walletId: wallet.id,
        kind: "DEBIT",
        delta: -3,
        balanceAfter: 0,
        actionKind: "VARIANT_GROUP_GEN",
        idemKey: `debit:variant_group_gen:${user.id}:${count}-${linked}-${i}`,
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
    let questionId: string | undefined;
    if (i < linked) {
      const question = await prisma.question.create({
        data: {
          subjectId: subject.id,
          stemMd: `Pre-linked variant ${i}`,
          type: "ESSAY",
          status: "DRAFT",
          source: "VARIANT_GENERATED",
          createdByUserId: user.id,
        },
      });
      questionId = question.id;
    }

    const item = await prisma.variantItem.create({
      data: {
        groupId: group.id,
        questionId,
        level: "L1",
        position: i,
        stemMd: `Variant stem ${i}`,
        solutionMd: `Variant solution ${i}`,
        knowledgePointHints: [],
      },
    });
    itemIds.push(item.id);
  }

  return { itemIds, parentQuestion, user };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backfillVariantQuestions", () => {
  it("creates linked VARIANT_GENERATED Questions for historical VariantItems", async () => {
    const { itemIds, parentQuestion, user } = await seedVariantBackfillRows(5);

    const result = await backfillVariantQuestions(prisma, { limit: 1000, dryRun: false });

    expect(result).toEqual({ processed: 5, created: 5, alreadySeen: 0, dryRun: false });

    const items = await prisma.variantItem.findMany({
      where: { id: { in: itemIds } },
      include: { question: true },
      orderBy: { position: "asc" },
    });
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.questionId).not.toBeNull();
      expect(item.question).not.toBeNull();
      expect(item.question!.source).toBe("VARIANT_GENERATED");
      expect(item.question!.createdByUserId).toBe(user.id);
      expect(item.question!.subjectId).toBe(parentQuestion.subjectId);
      expect(item.question!.status).toBe("DRAFT");
    }
  });

  it("is idempotent after rows are linked", async () => {
    await seedVariantBackfillRows(5);

    await backfillVariantQuestions(prisma, { limit: 1000, dryRun: false });
    const result = await backfillVariantQuestions(prisma, { limit: 1000, dryRun: false });

    expect(result).toEqual({ processed: 0, created: 0, alreadySeen: 0, dryRun: false });
    await expect(
      prisma.question.count({ where: { source: "VARIANT_GENERATED" } }),
    ).resolves.toBe(5);
  });

  it("reports would-be creations without writing in dry-run mode", async () => {
    await seedVariantBackfillRows(5);

    const result = await backfillVariantQuestions(prisma, { limit: 1000, dryRun: true });

    expect(result).toEqual({ processed: 5, created: 5, alreadySeen: 0, dryRun: true });
    await expect(
      prisma.question.count({ where: { source: "VARIANT_GENERATED" } }),
    ).resolves.toBe(0);
    await expect(prisma.variantItem.count({ where: { questionId: null } })).resolves.toBe(5);
  });

  it("skips already linked rows and creates only missing links", async () => {
    await seedVariantBackfillRows(3, { linked: 1 });

    const result = await backfillVariantQuestions(prisma, { limit: 1000, dryRun: false });

    expect(result).toEqual({ processed: 2, created: 2, alreadySeen: 0, dryRun: false });
    await expect(
      prisma.question.count({ where: { source: "VARIANT_GENERATED" } }),
    ).resolves.toBe(3);
    await expect(prisma.variantItem.count({ where: { questionId: null } })).resolves.toBe(0);
  });
});
