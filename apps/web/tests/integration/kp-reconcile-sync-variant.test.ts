import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedSubjectKpAlias() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
  });
  return { subjectId: subject.id, kpId: kp.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// 红线 #2: sourceRefType=VARIANT_ITEM 永不自动写 parent QuestionKPLink。
// 分流条件是 sourceRefType (不是 source)，因为 BACKFILL source + sourceRefType=VARIANT_ITEM
// 也走 VARIANT 路径。
describe("reconcileHintsSync — sourceRefType=VARIANT_ITEM 永不自动写 QuestionKPLink（红线 #2）", () => {
  it("EXACT 命中 → PENDING_REVIEW + 不写 QuestionKPLink", async () => {
    const { subjectId, kpId } = await seedSubjectKpAlias();
    const q = await prisma.question.create({
      data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    // 模拟 VariantItem.id（实际 Task 7 接 router 时用真 VariantItem.id）
    const fakeVariantItemId = "clrelid000000000000000123";

    const r = await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["一元一次方程"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: fakeVariantItemId,
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("PENDING_REVIEW");
    expect(match.matchVia).toBe("EXACT");
    expect(match.kpId).toBe(kpId);
    expect(match.confidence).toBe(1.0);
    expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");

    // 关键：QuestionKPLink 没有被写
    const linkCount = await prisma.questionKPLink.count({ where: { questionId: q.id } });
    expect(linkCount).toBe(0);
  });

  it("ALIAS 命中 → 同样 PENDING_REVIEW，不写 QuestionKPLink", async () => {
    const { subjectId } = await seedSubjectKpAlias();
    const q = await prisma.question.create({
      data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const fakeVariantItemId = "clrelid000000000000000124";

    await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["Linear Eq"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: fakeVariantItemId,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("PENDING_REVIEW");
    expect(match.matchVia).toBe("ALIAS");
    expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(await prisma.questionKPLink.count({ where: { questionId: q.id } })).toBe(0);
  });

  it("source=BACKFILL + sourceRefType=VARIANT_ITEM → 仍走 VARIANT 路径，不写 QuestionKPLink", async () => {
    // 守门：分流条件是 sourceRefType (不是 source)
    const { subjectId } = await seedSubjectKpAlias();
    const q = await prisma.question.create({
      data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const fakeVariantItemId = "clrelid000000000000000125";

    await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["一元一次方程"],
      source: "BACKFILL",        // 不同的 source
      sourceRefType: "VARIANT_ITEM",  // 但 sourceRefType 是 VARIANT_ITEM
      sourceRefId: fakeVariantItemId,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("PENDING_REVIEW");  // 关键：不是 LINKED
    expect(match.source).toBe("BACKFILL");
    expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(await prisma.questionKPLink.count({ where: { questionId: q.id } })).toBe(0);
  });
});
