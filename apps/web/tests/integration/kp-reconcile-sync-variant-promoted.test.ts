import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { normalizeKpHint, reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedPromotedVariant() {
  const subject = await prisma.subject.create({
    data: { code: "math", name: "Mathematics" },
  });
  const kp = await prisma.knowledgePoint.create({
    data: {
      subjectId: subject.id,
      code: "math-g7-linear-eq",
      name: "linear equation",
      difficulty: 2,
    },
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
      idemKey: `debit:variant_group_gen:${user.id}:promoted-test`,
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
  const variantQuestion = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Variant stem",
      type: "ESSAY",
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
      position: 0,
      stemMd: "Variant stem",
      solutionMd: "Variant solution",
      knowledgePointHints: [kp.name],
    },
  });

  return { kp, parentQuestion, variantQuestion, variantItem };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("reconcileHintsSync promoted VariantItem path", () => {
  it("links exact variant hints to the promoted variant Question", async () => {
    const { kp, parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    const result = await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: [kp.name],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    expect(result).toEqual({ linked: 1, queued: 0, alreadySeen: 0 });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: {
        sourceRefType: "VARIANT_ITEM",
        sourceRefId: variantItem.id,
        normalizedHint: normalizeKpHint(kp.name),
      },
    });
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: {
        questionId_kpId: {
          questionId: variantQuestion.id,
          kpId: kp.id,
        },
      },
    });

    expect(match.status).toBe("LINKED");
    expect(match.questionId).toBe(variantQuestion.id);
    expect(link.questionId).toBe(variantQuestion.id);
    expect(match.questionId).toBe(link.questionId);
    expect(await prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } })).toBe(0);
  });
});
