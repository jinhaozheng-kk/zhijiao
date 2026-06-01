// Plan 9 spec §4 / Task 8: processBatch core (async LLM batch over UNMATCHED).
// CLI script (scripts/kp-reconcile-pending.ts) is a thin wrapper; tests cover
// the service via direct calls with injected MockAdapter + literal thresholds.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { processBatch } from "@/server/lib/kp-reconcile-pending";
import { AiRouter, MockAdapter } from "@zhijiao/ai";

const THRESHOLDS = { autoLink: 0.85, review: 0.6 };

async function seedSubjectKpQuestion() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
  });
  const q = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
  });
  return { subjectId: subject.id, kpId: kp.id, questionId: q.id };
}

async function seedUnmatched(
  questionId: string,
  sourceRefType: "QUESTION" | "VARIANT_ITEM",
  rawHint: string,
  sourceRefId?: string,
) {
  return prisma.kpReconcileMatch.create({
    data: {
      questionId,
      kpId: null,
      rawHint,
      normalizedHint: rawHint.toLowerCase(),
      source: sourceRefType === "VARIANT_ITEM" ? "VARIANT_ITEM" : "TUTOR_ADHOC",
      sourceRefType,
      sourceRefId: sourceRefId ?? questionId,
      matchVia: null,
      confidence: null,
      status: "UNMATCHED",
    },
  });
}

function makeAdapter(itemsBuilder: (req: { matchIds: string[]; kpIds: string[] }) => unknown[]) {
  return new MockAdapter({
    respondWith: (req) => {
      const userMsg = req.messages.find((m) => m.role === "user")?.content ?? "";
      // Parse matchId list from rendered hints block
      const matchIds = Array.from(userMsg.matchAll(/matchId=([a-z0-9]+)/g)).map((m) => m[1]!);
      // Parse candidate kp ids
      const kpIds = Array.from(userMsg.matchAll(/- id=([a-z0-9]+)/g)).map((m) => m[1]!);
      return Promise.resolve({
        content: JSON.stringify(itemsBuilder({ matchIds, kpIds })),
        tokensIn: 50,
        tokensOut: 30,
        model: "mock-v1",
      });
    },
  });
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("processBatch (kp-reconcile-pending core)", () => {
  it("confidence >= 0.85 + sourceRefType=QUESTION → LINKED + writes QuestionKPLink(weight=conf)", async () => {
    const { kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(questionId, "QUESTION", "linear");
    const adapter = makeAdapter(({ matchIds }) =>
      matchIds.map((matchId) => ({ matchId, kpId, confidence: 0.92 })),
    );
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 50, thresholds: THRESHOLDS });
    expect(r.totalProcessed).toBe(1);
    expect(r.batches[0]!.linked).toBe(1);
    expect(r.batches[0]!.pendingReview).toBe(0);
    expect(r.batches[0]!.dropped).toBe(0);
    expect(r.batches[0]!.failed).toBe(0);

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("LINKED");
    expect(reread.matchVia).toBe("LLM");
    expect(reread.confidence).toBe(0.92);
    expect(reread.modelCallId).toBeTruthy();
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId } },
    });
    expect(link.weight).toBe(0.92);
  });

  it("confidence >= 0.85 + sourceRefType=VARIANT_ITEM → LINKED 到变式题（Plan 12 cleanup）", async () => {
    const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const kp = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
    });
    // 变式题（异步路径只用 match.questionId；此处直接 seed 变式 Question）
    const variantQuestion = await prisma.question.create({
      data: { subjectId: subject.id, stemMd: "variant", type: "ESSAY", status: "DRAFT", source: "VARIANT_GENERATED" },
    });
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId: variantQuestion.id, // Task 5 后变式 UNMATCHED 行记变式题 id
        kpId: null, rawHint: "linear", normalizedHint: "linear",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000091",
        matchVia: null, confidence: null, status: "UNMATCHED",
      },
    });
    const adapter = makeAdapter(({ matchIds }) =>
      matchIds.map((matchId) => ({ matchId, kpId: kp.id, confidence: 0.95 })),
    );
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 50, thresholds: THRESHOLDS });
    expect(r.batches[0]!.linked).toBe(1);
    expect(r.batches[0]!.pendingReview).toBe(0);

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("LINKED");
    expect(reread.kpId).toBe(kp.id);
    expect(reread.confidence).toBe(0.95);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId: kp.id } })).toBe(1);
  });

  it("confidence in [0.6, 0.85) → PENDING_REVIEW(LLM_CONFIDENCE_BAND)", async () => {
    const { kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(questionId, "QUESTION", "hint-x");
    const adapter = makeAdapter(({ matchIds }) =>
      matchIds.map((matchId) => ({ matchId, kpId, confidence: 0.72 })),
    );
    const router = new AiRouter({ prisma, adapter });

    await processBatch(prisma, router, { limit: 50, thresholds: THRESHOLDS });

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("PENDING_REVIEW");
    expect(reread.reviewReason).toBe("LLM_CONFIDENCE_BAND");
    expect(reread.confidence).toBe(0.72);
    expect(reread.kpId).toBe(kpId);
  });

  it("confidence < 0.6 → DROPPED + 不写 QuestionKPLink", async () => {
    const { kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(questionId, "QUESTION", "hint-y");
    const adapter = makeAdapter(({ matchIds }) =>
      matchIds.map((matchId) => ({ matchId, kpId, confidence: 0.3 })),
    );
    const router = new AiRouter({ prisma, adapter });

    await processBatch(prisma, router, { limit: 50, thresholds: THRESHOLDS });

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("DROPPED");
    expect(reread.confidence).toBe(0.3);
    expect(reread.kpId).toBeNull();
    expect(await prisma.questionKPLink.count({ where: { questionId } })).toBe(0);
  });

  it("--limit 限制取的 UNMATCHED 行数", async () => {
    const { kpId, questionId } = await seedSubjectKpQuestion();
    for (let i = 0; i < 5; i++) {
      await seedUnmatched(questionId, "QUESTION", `hint-${i}`);
    }
    const adapter = makeAdapter(({ matchIds }) =>
      matchIds.map((matchId) => ({ matchId, kpId, confidence: 0.9 })),
    );
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 3, thresholds: THRESHOLDS });
    expect(r.totalProcessed).toBe(3);
    const stillUnmatched = await prisma.kpReconcileMatch.count({ where: { status: "UNMATCHED" } });
    expect(stillUnmatched).toBe(2);
  });

  it("LLM candidates 的 parentPath 使用真实学科名，不硬编码数学", async () => {
    const subject = await prisma.subject.create({ data: { code: "english", name: "英语" } });
    const kp = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "eng-kp-a", name: "Pronouns", difficulty: 2 },
    });
    const q = await prisma.question.create({
      data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    await seedUnmatched(q.id, "QUESTION", "pronouns");
    const adapter = new MockAdapter({
      respondWith: (req) => {
        const userMsg = req.messages.find((m) => m.role === "user")?.content ?? "";
        expect(userMsg).toContain("path=英语");
        expect(userMsg).not.toContain("path=数学");
        const matchId = userMsg.match(/matchId=([a-z0-9]+)/)?.[1];
        expect(matchId).toBeTruthy();
        return Promise.resolve({
          content: JSON.stringify([{ matchId, kpId: kp.id, confidence: 0.9 }]),
          tokensIn: 50,
          tokensOut: 30,
          model: "mock-v1",
        });
      },
    });
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 50, thresholds: THRESHOLDS });

    expect(r.batches[0]!.linked).toBe(1);
  });
});
