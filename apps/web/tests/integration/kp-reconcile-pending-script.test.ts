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

  it("confidence >= 0.85 + sourceRefType=VARIANT_ITEM → PENDING_REVIEW + 不写 QuestionKPLink (红线 #2)", async () => {
    const { kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(
      questionId,
      "VARIANT_ITEM",
      "linear",
      "clrelid000000000000000091",
    );
    const adapter = makeAdapter(({ matchIds }) =>
      matchIds.map((matchId) => ({ matchId, kpId, confidence: 0.95 })),
    );
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 50, thresholds: THRESHOLDS });
    expect(r.batches[0]!.linked).toBe(0);
    expect(r.batches[0]!.pendingReview).toBe(1);

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("PENDING_REVIEW");
    expect(reread.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(reread.kpId).toBe(kpId);
    expect(reread.confidence).toBe(0.95);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId } })).toBe(0);
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
});
