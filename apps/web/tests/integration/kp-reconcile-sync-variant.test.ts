import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

// seed 一个 promoted variant：parent question + KP(+alias) + variantQuestion(source=VARIANT_GENERATED) + variantItem.questionId
async function seedPromotedVariant() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
  });
  const parentQuestion = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "parent", type: "ESSAY", status: "PUBLISHED" },
  });
  const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
  const entry = await prisma.errorBookEntry.create({
    data: { userId: user.id, questionId: parentQuestion.id, status: "ACTIVE", rootCause: "OTHER", rootCauseReasoning: "seed" },
  });
  const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
  const ledger = await prisma.creditLedger.create({
    data: { walletId: wallet.id, kind: "DEBIT", delta: -3, balanceAfter: 0, actionKind: "VARIANT_GROUP_GEN", idemKey: `debit:variant_group_gen:${user.id}:sync-variant` },
  });
  const group = await prisma.variantGroup.create({
    data: { entryId: entry.id, userId: user.id, creditsCost: 3, debitLedgerId: ledger.id },
  });
  const variantQuestion = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "variant", type: "ESSAY", status: "DRAFT", source: "VARIANT_GENERATED", createdByUserId: user.id },
  });
  const variantItem = await prisma.variantItem.create({
    data: { groupId: group.id, questionId: variantQuestion.id, level: "L1", position: 0, stemMd: "variant", solutionMd: "sol", knowledgePointHints: [kp.name] },
  });
  return { subjectId: subject.id, kpId: kp.id, parentQuestion, variantQuestion, variantItem };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// 红线 #2: VARIANT_ITEM 路径永不写 PARENT QuestionKPLink；只写变式题自己的 link。
describe("reconcileHintsSync — sourceRefType=VARIANT_ITEM 链到变式题，不污染 parent（红线 #2）", () => {
  it("EXACT 命中 → LINKED 到变式题 + 变式题 QuestionKPLink，parent 无 link", async () => {
    const { kpId, parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    const r = await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: ["一元一次方程"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    expect(r.linked).toBe(1);
    expect(r.queued).toBe(0);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
    });
    expect(match.status).toBe("LINKED");
    expect(match.matchVia).toBe("EXACT");
    expect(match.kpId).toBe(kpId);
    expect(match.questionId).toBe(variantQuestion.id);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } })).toBe(0);
  });

  it("ALIAS 命中 → 同样 LINKED 到变式题，parent 无 link", async () => {
    const { kpId, parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: ["Linear Eq"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
    });
    expect(match.status).toBe("LINKED");
    expect(match.matchVia).toBe("ALIAS");
    expect(match.questionId).toBe(variantQuestion.id);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } })).toBe(0);
  });

  it("source=BACKFILL + sourceRefType=VARIANT_ITEM → 仍按 VARIANT_ITEM 解析（分流看 sourceRefType 不看 source）", async () => {
    const { kpId, parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: ["一元一次方程"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
    });
    expect(match.status).toBe("LINKED");
    expect(match.source).toBe("BACKFILL");
    expect(match.questionId).toBe(variantQuestion.id);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } })).toBe(0);
  });
});
