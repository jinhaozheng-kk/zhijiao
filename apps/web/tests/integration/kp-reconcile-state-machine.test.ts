import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  approveMatch,
  rejectMatch,
  remapMatch,
  learnAliasAndLink,
  unlinkIfOrphan,
} from "@/server/lib/kp-reconcile";

async function seedFixtures() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kpA = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  const kpB = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-substitution", name: "代入消元", difficulty: 2 },
  });
  const q = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
  });
  // Reviewer 用户 —— 任意 persona 都可以，FK 只要存在即可
  const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
  return { subjectId: subject.id, kpAId: kpA.id, kpBId: kpB.id, questionId: q.id, userId: user.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("KpReconcileMatch state machine: PENDING_REVIEW 4 个转移 + LINKED orphan 清理", () => {
  it("approve: PENDING_REVIEW → LINKED + 写 QuestionKPLink(weight=row.confidence)", async () => {
    const { kpAId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "一元一次方程", normalizedHint: "一元一次方程",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000001",
        matchVia: "EXACT", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });
    expect(m.status).toBe("PENDING_REVIEW");

    const updated = await approveMatch(prisma, { matchId: m.id, reviewedByUserId: userId });
    expect(updated.status).toBe("LINKED");
    expect(updated.reviewReason).toBeNull();
    expect(updated.reviewedByUserId).toBe(userId);
    expect(updated.reviewedAt).not.toBeNull();
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpAId } },
    });
    expect(link.weight).toBe(1.0);
  });

  it("reject: PENDING_REVIEW → REJECTED + 不写 QuestionKPLink", async () => {
    const { kpAId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "一元一次方程", normalizedHint: "一元一次方程",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000002",
        matchVia: "EXACT", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });

    const updated = await rejectMatch(prisma, { matchId: m.id, reviewedByUserId: userId });
    expect(updated.status).toBe("REJECTED");
    expect(updated.kpId).toBe(kpAId);   // 保留 audit
    expect(await prisma.questionKPLink.count({ where: { questionId } })).toBe(0);
  });

  it("remap: PENDING_REVIEW → LINKED with 新 kpId (matchVia=MANUAL, confidence=1.0)", async () => {
    const { kpAId, kpBId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "一元一次方程", normalizedHint: "一元一次方程",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000003",
        matchVia: "EXACT", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });
    expect(m.kpId).toBe(kpAId);

    const updated = await remapMatch(prisma, {
      matchId: m.id,
      newKpCode: "math-g7-substitution",
      reviewedByUserId: userId,
    });
    expect(updated.status).toBe("LINKED");
    expect(updated.kpId).toBe(kpBId);
    expect(updated.matchVia).toBe("MANUAL");
    expect(updated.confidence).toBe(1.0);

    // QuestionKPLink 写到新 KP
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpBId } },
    });
    expect(link.weight).toBe(1.0);
    // 旧 kpId 的 link 不存在（remap 不会自动把 kpAId 的 link 清掉 —— 因为别的 match
    // 可能还在背书；该案没那条，所以 kpA link 本来就没建）
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId: kpAId } })).toBe(0);
  });

  it("learnAliasAndLink: PENDING_REVIEW → LINKED + 写 KpAlias(source=CLI_MANUAL)", async () => {
    const { subjectId, kpAId, questionId, userId } = await seedFixtures();
    // 制造 LLM-band PENDING_REVIEW
    await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "解一元", normalizedHint: "解一元",
        source: "ERROR_ANALYSIS", sourceRefType: "ERROR_BOOK_ENTRY", sourceRefId: "clrelid000000000000000004",
        matchVia: "LLM", confidence: 0.72,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });
    const m = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId } });

    const updated = await learnAliasAndLink(prisma, {
      matchId: m.id,
      targetKpCode: "math-g7-linear-eq",
      reviewedByUserId: userId,
    });
    expect(updated.status).toBe("LINKED");
    expect(updated.matchVia).toBe("MANUAL");
    expect(updated.confidence).toBe(1.0);

    const alias = await prisma.kpAlias.findUniqueOrThrow({
      where: { subjectId_normalizedAlias: { subjectId, normalizedAlias: "解一元" } },
    });
    expect(alias.kpId).toBe(kpAId);
    expect(alias.source).toBe("CLI_MANUAL");
    expect(alias.createdByUserId).toBe(userId);

    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpAId } },
    });
    expect(link.weight).toBe(1.0);
  });

  it("unlinkIfOrphan: LINKED 的 match 还在 → 不删", async () => {
    const { kpAId, questionId } = await seedFixtures();
    await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "x", normalizedHint: "x",
        source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: questionId,
        matchVia: "EXACT", confidence: 1.0,
        status: "LINKED",
      },
    });
    await prisma.questionKPLink.create({ data: { questionId, kpId: kpAId, weight: 1.0 } });

    const r = await unlinkIfOrphan(prisma, { questionId, kpId: kpAId });
    expect(r.removed).toBe(false);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId: kpAId } })).toBe(1);
  });

  it("unlinkIfOrphan: 没有 LINKED match → 删 QuestionKPLink", async () => {
    const { kpAId, questionId } = await seedFixtures();
    await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "x", normalizedHint: "x",
        source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: questionId,
        matchVia: "EXACT", confidence: 1.0,
        status: "REJECTED",   // 不是 LINKED
      },
    });
    await prisma.questionKPLink.create({ data: { questionId, kpId: kpAId, weight: 1.0 } });

    const r = await unlinkIfOrphan(prisma, { questionId, kpId: kpAId });
    expect(r.removed).toBe(true);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId: kpAId } })).toBe(0);
  });
});

describe("KpReconcileMatch state machine: 非 PENDING_REVIEW 状态的 CLI action 拒绝", () => {
  it("approveMatch 对已 LINKED 的行 → throw", async () => {
    const { kpAId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "x", normalizedHint: "x",
        source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: questionId,
        matchVia: "EXACT", confidence: 1.0,
        status: "LINKED",
      },
    });
    await expect(
      approveMatch(prisma, { matchId: m.id, reviewedByUserId: userId }),
    ).rejects.toThrow(/expected PENDING_REVIEW/);
  });

  it("rejectMatch 对已 REJECTED 的行 → throw（防止重复 review）", async () => {
    const { kpAId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "x", normalizedHint: "x",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000005",
        matchVia: "EXACT", confidence: 1.0,
        status: "REJECTED",
      },
    });
    await expect(
      rejectMatch(prisma, { matchId: m.id, reviewedByUserId: userId }),
    ).rejects.toThrow(/expected PENDING_REVIEW/);
  });
});
