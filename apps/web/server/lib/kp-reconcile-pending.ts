// Plan 9 spec §4: 异步 LLM batch 处理。
//
// 注意：本模块**不**用 `import "server-only"` —— 同 kp-reconcile.ts 的理由
// (Task 5 hotfix P1): apps/web/scripts/kp-reconcile-pending.ts 用 tsx 直接
// import 本模块，tsx/Node 不像 Next 那样 alias server-only，会直接 throw。

import type { PrismaClient } from "@prisma/client";
import type { AiRouter } from "@zhijiao/ai";

export interface BatchResult {
  subjectId: string;
  hintsCount: number;
  linked: number;
  pendingReview: number;
  dropped: number;
  failed: number;
}

export interface ProcessBatchResult {
  totalProcessed: number;
  batches: BatchResult[];
}

export interface KpReconcileThresholds {
  autoLink: number;   // ≥ auto_link AND sourceRefType ≠ VARIANT_ITEM → LINKED
  review: number;     // ≥ review AND < auto_link → PENDING_REVIEW; < review → DROPPED
}

export interface ProcessBatchOpts {
  limit: number;
  thresholds: KpReconcileThresholds;
}

// CLI script supplies thresholds via env (parsed with same defaults as env.ts
// superRefine; see scripts/kp-reconcile-pending.ts). Tests inject literals.
// processBatch does NOT import server/env.ts so the module stays CLI-safe
// (Task 5 hotfix P1 lesson).

// Plan 9 spec §4.1: 取 UNMATCHED 行 limit 条，按 subjectId 分桶，每个 subject
// 单独跑 LLM；matchId 对齐写回；状态机分流（spec §3.3 + §4.3）。
//
// 不计 Credit (spec §4.4 / 红线 #9) —— LLM 走 aiRouter.kpReconcile()，
// 由 router 写 ModelCall(taskKind="KP_RECONCILE")；不写计费账本。
export async function processBatch(
  prisma: PrismaClient,
  router: AiRouter,
  opts: ProcessBatchOpts,
): Promise<ProcessBatchResult> {
  const { autoLink, review } = opts.thresholds;

  const matches = await prisma.kpReconcileMatch.findMany({
    where: { status: "UNMATCHED" },
    orderBy: { createdAt: "asc" },
    take: opts.limit,
    include: { question: { select: { subjectId: true } } },
  });
  if (matches.length === 0) return { totalProcessed: 0, batches: [] };

  // 按 subjectId 分组；不同 subject 各自一轮 LLM call（不同候选集）
  const bySubject = new Map<string, typeof matches>();
  for (const m of matches) {
    const sid = m.question.subjectId;
    if (!bySubject.has(sid)) bySubject.set(sid, []);
    bySubject.get(sid)!.push(m);
  }

  const batches: BatchResult[] = [];
  for (const [subjectId, batchMatches] of bySubject) {
    const candidates = await prisma.knowledgePoint.findMany({ where: { subjectId } });

    const batchSummary: BatchResult = {
      subjectId,
      hintsCount: batchMatches.length,
      linked: 0,
      pendingReview: 0,
      dropped: 0,
      failed: 0,
    };

    if (candidates.length === 0) {
      // 没候选；本批整批不能跑 LLM。状态保留 UNMATCHED 留给以后（spec §10.1）
      batchSummary.failed = batchMatches.length;
      batches.push(batchSummary);
      continue;
    }

    const hints = batchMatches.map((m) => ({
      matchId: m.id,
      rawHint: m.rawHint,
      normalizedHint: m.normalizedHint,
    }));

    try {
      const llmOut = await router.kpReconcile({
        subjectId,
        candidates: candidates.map((kp) => ({
          id: kp.id,
          code: kp.code,
          name: kp.name,
          description: kp.description,
          // MVP 简化：parentPath 直接给学科名。完整 ancestry 链由独立 plan 完善。
          parentPath: "数学",
        })),
        hints,
      });

      const itemById = new Map(llmOut.items.map((it) => [it.matchId, it]));
      for (const m of batchMatches) {
        const item = itemById.get(m.id);
        if (!item) {
          // router 已经守门 matchId 对齐 (kpReconcile retry 3 次再 PARSE_FAILED)。
          // 走到这里说明本批仍然有漏返 → 计入 failed，状态留 UNMATCHED 等下次。
          batchSummary.failed++;
          continue;
        }

        const result = await applyLlmResult(prisma, m, item, llmOut.modelCallId, { autoLink, review });
        if (result === "LINKED") batchSummary.linked++;
        else if (result === "PENDING_REVIEW") batchSummary.pendingReview++;
        else batchSummary.dropped++;
      }
    } catch {
      // router 本身抛错 (ADAPTER_ERROR / PARSE_FAILED 3 retries / TIMEOUT) —
      // 已写 ModelCall 留 audit。本批整批 fail，状态留 UNMATCHED。
      batchSummary.failed = batchMatches.length;
    }

    batches.push(batchSummary);
  }

  return { totalProcessed: matches.length, batches };
}

type ApplyResult = "LINKED" | "PENDING_REVIEW" | "DROPPED";

// Plan 9 spec §3.3 + §4.3: 状态机分流（按 sourceRefType 而非 source）。
// - kpId=null 或 confidence < review_threshold → DROPPED
// - confidence ≥ auto_link AND sourceRefType ≠ VARIANT_ITEM → LINKED + QuestionKPLink
// - confidence ≥ auto_link AND sourceRefType = VARIANT_ITEM → PENDING_REVIEW
//   (reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW)
// - review ≤ confidence < auto_link → PENDING_REVIEW
//   (reviewReason=LLM_CONFIDENCE_BAND)
async function applyLlmResult(
  prisma: PrismaClient,
  match: { id: string; questionId: string; sourceRefType: string },
  item: { matchId: string; kpId: string | null; confidence: number },
  modelCallId: string,
  thresholds: { autoLink: number; review: number },
): Promise<ApplyResult> {
  const isVariant = match.sourceRefType === "VARIANT_ITEM";

  // DROPPED — LLM 给 null 或低于 review threshold
  if (!item.kpId || item.confidence < thresholds.review) {
    await prisma.kpReconcileMatch.update({
      where: { id: match.id },
      data: {
        kpId: null,
        matchVia: "LLM",
        confidence: item.confidence,
        status: "DROPPED",
        modelCallId,
      },
    });
    return "DROPPED";
  }

  // confidence ≥ review_threshold
  if (item.confidence >= thresholds.autoLink && !isVariant) {
    // LINKED + 写 QuestionKPLink (atomic raw SQL upsert with GREATEST)
    await prisma.$transaction(async (tx) => {
      await tx.kpReconcileMatch.update({
        where: { id: match.id },
        data: {
          kpId: item.kpId,
          matchVia: "LLM",
          confidence: item.confidence,
          status: "LINKED",
          modelCallId,
        },
      });
      // weight = max(existing, confidence) via ON CONFLICT DO UPDATE GREATEST
      await tx.$executeRaw`
        INSERT INTO "question_kp_links" ("question_id", "kp_id", "weight")
        VALUES (${match.questionId}, ${item.kpId}, ${item.confidence})
        ON CONFLICT ("question_id", "kp_id")
        DO UPDATE SET "weight" = GREATEST("question_kp_links"."weight", EXCLUDED."weight")
      `;
    });
    return "LINKED";
  }

  // PENDING_REVIEW
  const reviewReason =
    isVariant && item.confidence >= thresholds.autoLink
      ? "VARIANT_TO_PARENT_NEEDS_REVIEW"
      : "LLM_CONFIDENCE_BAND";
  await prisma.kpReconcileMatch.update({
    where: { id: match.id },
    data: {
      kpId: item.kpId,
      matchVia: "LLM",
      confidence: item.confidence,
      status: "PENDING_REVIEW",
      reviewReason,
      modelCallId,
    },
  });
  return "PENDING_REVIEW";
}
