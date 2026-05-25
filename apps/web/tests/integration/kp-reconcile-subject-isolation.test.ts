import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// 红线 #6 配合: KpAlias @@unique([subjectId, normalizedAlias]) + service 层学科隔离防御。
// math hint 不应该匹到 english KP 或 alias。
describe("subject isolation: math hint 不匹 english KP / alias", () => {
  it("english 题里的 'function' hint 不命中其它 subject 同名 KP，走 UNMATCHED", async () => {
    // math subject + KP("function")
    const math = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-function", name: "function", difficulty: 2 },
    });
    // english subject + 独立 KP
    const english = await prisma.subject.create({ data: { code: "english", name: "英语" } });
    await prisma.knowledgePoint.create({
      data: { subjectId: english.id, code: "eng-g7-pronouns", name: "Pronouns", difficulty: 2 },
    });
    // english 题
    const engQ = await prisma.question.create({
      data: { subjectId: english.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });

    const r = await reconcileHintsSync(prisma, {
      questionId: engQ.id,
      hints: ["function"],   // 文本上跟 math 的 KP name 完全一样
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: "clrelid000000000000000001",
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: engQ.id } });
    expect(match.status).toBe("UNMATCHED");
    expect(match.kpId).toBeNull();
  });

  it("english 题里的 alias 不能命中 math subject 的 alias 表", async () => {
    // math: alias "代数"→math KP
    const math = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const mathKp = await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-algebra", name: "代数", difficulty: 2 },
    });
    await prisma.kpAlias.create({
      data: { subjectId: math.id, kpId: mathKp.id, normalizedAlias: "代数", source: "SEED" },
    });
    // english 不存在 "代数" alias
    const english = await prisma.subject.create({ data: { code: "english", name: "英语" } });
    const engQ = await prisma.question.create({
      data: { subjectId: english.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });

    const r = await reconcileHintsSync(prisma, {
      questionId: engQ.id,
      hints: ["代数"],
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: "clrelid000000000000000002",
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: engQ.id } });
    expect(match.status).toBe("UNMATCHED");
    expect(match.kpId).toBeNull();
  });
});
