import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { normalizeKpHint, reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedLegacyVariant() {
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
      idemKey: `debit:variant_group_gen:${user.id}:legacy-test`,
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
  const variantItem = await prisma.variantItem.create({
    data: {
      groupId: group.id,
      questionId: null,
      level: "L1",
      position: 0,
      stemMd: "Variant stem",
      solutionMd: "Variant solution",
      knowledgePointHints: [kp.name],
    },
  });

  return { kp, parentQuestion, variantItem };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("reconcileHintsSync legacy VariantItem path", () => {
  it("queues exact variant hints on the parent when VariantItem has no promoted question", async () => {
    const { kp, parentQuestion, variantItem } = await seedLegacyVariant();

    const result = await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: [kp.name],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    expect(result).toEqual({ linked: 0, queued: 1, alreadySeen: 0 });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: {
        sourceRefType: "VARIANT_ITEM",
        sourceRefId: variantItem.id,
        normalizedHint: normalizeKpHint(kp.name),
      },
    });

    expect(match.status).toBe("PENDING_REVIEW");
    expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(match.questionId).toBe(parentQuestion.id);
    expect(await prisma.questionKPLink.count()).toBe(0);
  });
});
