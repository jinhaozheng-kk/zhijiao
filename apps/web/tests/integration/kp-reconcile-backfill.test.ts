// Plan 9 Task 10: backfill existing VariantItem.knowledgePointHints through
// the BACKFILL + VARIANT_ITEM reconcile path. The CLI script is a thin wrapper;
// these tests cover the service semantics and idempotency guard.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedVariantItem(opts: { knowledgePointHints: string[] }) {
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
  const question = await prisma.question.create({
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
      questionId: question.id,
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
      idemKey: `debit:variant_group_gen:${user.id}:backfill-test`,
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
      level: "L1",
      position: 0,
      stemMd: "Variant stem",
      solutionMd: "Variant solution",
      knowledgePointHints: opts.knowledgePointHints,
    },
  });

  return { questionId: question.id, variantItemId: variantItem.id, kpId: kp.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("kp-backfill-variant-items idempotency", () => {
  it("running the same backfill input twice keeps one KpReconcileMatch row", async () => {
    const { questionId, variantItemId } = await seedVariantItem({
      knowledgePointHints: ["linear equation"],
    });

    const first = await reconcileHintsSync(prisma, {
      questionId,
      hints: ["linear equation"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItemId,
    });
    expect(first.alreadySeen).toBe(0);
    expect(await prisma.kpReconcileMatch.count({ where: { sourceRefId: variantItemId } })).toBe(1);

    const second = await reconcileHintsSync(prisma, {
      questionId,
      hints: ["linear equation"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItemId,
    });
    expect(second.alreadySeen).toBe(1);
    expect(await prisma.kpReconcileMatch.count({ where: { sourceRefId: variantItemId } })).toBe(1);
  });

  it("BACKFILL exact hit still uses VARIANT_ITEM review path and does not write parent link", async () => {
    const { questionId, variantItemId, kpId } = await seedVariantItem({
      knowledgePointHints: ["linear equation"],
    });

    await reconcileHintsSync(prisma, {
      questionId,
      hints: ["linear equation"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItemId,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefId: variantItemId },
    });
    expect(match.status).toBe("PENDING_REVIEW");
    expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(match.kpId).toBe(kpId);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId } })).toBe(0);
  });
});
