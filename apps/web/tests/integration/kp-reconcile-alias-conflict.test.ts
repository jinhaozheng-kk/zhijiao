import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { learnAliasAndLink, KpAliasConflictError } from "@/server/lib/kp-reconcile";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// Plan 9 spec §5.4: learnAliasAndLink 必须检测 (subjectId, normalizedAlias) 已映射
// 到不同 kpId 的冲突，抛 KpAliasConflictError，不静默覆盖。
describe("alias 冲突防御（spec §5.4）", () => {
  it("已存在的 alias 指向不同 KP → 抛 KpAliasConflictError，不静默覆盖", async () => {
    const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const kpA = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
    });
    const kpB = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-b", name: "KP-B", difficulty: 2 },
    });
    const q = await prisma.question.create({
      data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });

    // 已存在 alias: "解题" → kpA
    await prisma.kpAlias.create({
      data: { subjectId: subject.id, kpId: kpA.id, normalizedAlias: "解题", source: "SEED" },
    });

    // PENDING_REVIEW 行 normalizedHint = "解题"，建议 kpA
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId: q.id, kpId: kpA.id, rawHint: "解题", normalizedHint: "解题",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM",
        sourceRefId: "clrelid000000000000000099",
        matchVia: "ALIAS", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });

    // 尝试把 "解题" 学成 kpB → 应抛 KpAliasConflictError
    await expect(
      learnAliasAndLink(prisma, {
        matchId: m.id,
        targetKpCode: "kp-b",
        reviewedByUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(KpAliasConflictError);

    // 原 alias 不变
    const alias = await prisma.kpAlias.findUniqueOrThrow({
      where: { subjectId_normalizedAlias: { subjectId: subject.id, normalizedAlias: "解题" } },
    });
    expect(alias.kpId).toBe(kpA.id);
    expect(alias.source).toBe("SEED");
    // KpReconcileMatch 状态不变
    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("PENDING_REVIEW");
    expect(reread.kpId).toBe(kpA.id);
    // 没有写 QuestionKPLink (kpB)
    expect(await prisma.questionKPLink.count({ where: { questionId: q.id, kpId: kpB.id } })).toBe(0);
  });

  it("已存在的 alias 指向相同 KP → 不抛，直接 LINKED（幂等，alias 不重复建）", async () => {
    const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const kp = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
    });
    const q = await prisma.question.create({
      data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });

    await prisma.kpAlias.create({
      data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "解题", source: "SEED" },
    });

    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId: q.id, kpId: kp.id, rawHint: "解题", normalizedHint: "解题",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM",
        sourceRefId: "clrelid000000000000000098",
        matchVia: "ALIAS", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });

    const updated = await learnAliasAndLink(prisma, {
      matchId: m.id, targetKpCode: "kp-a", reviewedByUserId: user.id,
    });
    expect(updated.status).toBe("LINKED");
    // 既存 alias 数量不变（不重新 create）
    expect(await prisma.kpAlias.count({ where: { subjectId: subject.id } })).toBe(1);
    // QuestionKPLink 已建
    expect(await prisma.questionKPLink.count({ where: { questionId: q.id, kpId: kp.id } })).toBe(1);
  });
});
