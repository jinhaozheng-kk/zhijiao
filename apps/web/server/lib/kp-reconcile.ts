import "server-only";
import { Prisma, type PrismaClient, type KnowledgePoint } from "@prisma/client";
import { logger } from "../logger.js";

// ============ 类型与常量 ============

export type KpReconcileSourceLiteral =
  | "ERROR_ANALYSIS"
  | "VARIANT_ITEM"
  | "TUTOR_ADHOC"
  | "BACKFILL";

export type KpReconcileSourceRefTypeLiteral =
  | "ERROR_BOOK_ENTRY"
  | "VARIANT_ITEM"
  | "QUESTION";

export interface ReconcileHintsSyncArgs {
  questionId: string;
  hints: string[];
  source: KpReconcileSourceLiteral;
  sourceRefType: KpReconcileSourceRefTypeLiteral;
  sourceRefId: string;
}

export interface ReconcileHintsSyncResult {
  linked: number;
  queued: number;
  alreadySeen: number;
}

// ============ normalize ============

// Plan 9 spec §3.2.1: KP 名称域大小写不带语义（"一元一次方程"/"Linear Equation"/"移项"），
// 跟 Plan 8 normalizeStem 拒绝 lowercase 的数学题面不同，本函数可以 lowercase。
export function normalizeKpHint(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// ============ KP / Alias map 构造 ============

interface SubjectCandidates {
  kpById: Map<string, KnowledgePoint>;
  kpByNormalized: Map<string, string>;   // normalized key → kpId
  aliasByNormalized: Map<string, string>; // normalized key → kpId
}

async function loadSubjectCandidates(
  prisma: PrismaClient,
  subjectId: string,
): Promise<SubjectCandidates> {
  const [kps, aliases] = await Promise.all([
    prisma.knowledgePoint.findMany({ where: { subjectId } }),
    prisma.kpAlias.findMany({ where: { subjectId } }),
  ]);

  const kpById = new Map<string, KnowledgePoint>();
  const kpByNormalized = new Map<string, string>();
  for (const kp of kps) {
    kpById.set(kp.id, kp);
    kpByNormalized.set(normalizeKpHint(kp.name), kp.id);
    kpByNormalized.set(normalizeKpHint(kp.code), kp.id);
  }
  const aliasByNormalized = new Map<string, string>();
  for (const a of aliases) {
    aliasByNormalized.set(a.normalizedAlias, a.kpId);
  }
  return { kpById, kpByNormalized, aliasByNormalized };
}

// ============ reconcileHintsSync ============

// Plan 9 spec §3.1 + §3.3:
// - 三个 router body 调用：tutor.ask / error.diagnose / variant.generateForEntry
// - 决定写不写 parent QuestionKPLink 的条件是 sourceRefType=VARIANT_ITEM（不是 source，
//   因为 BACKFILL source + sourceRefType=VARIANT_ITEM 也走 VARIANT 路径）
// - VARIANT_ITEM EXACT/ALIAS 命中 → PENDING_REVIEW + reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW
// - 其它 sourceRefType EXACT/ALIAS 命中 → LINKED + upsert QuestionKPLink
// - 未命中 → UNMATCHED
//
// 错误处理：单条 hint 失败不影响同批其它；调用方必须 try/catch 包住（reconcile 失败
// 不能破坏主流程）。
export async function reconcileHintsSync(
  prisma: PrismaClient,
  args: ReconcileHintsSyncArgs,
): Promise<ReconcileHintsSyncResult> {
  const result: ReconcileHintsSyncResult = { linked: 0, queued: 0, alreadySeen: 0 };
  if (args.hints.length === 0) return result;

  const question = await prisma.question.findUniqueOrThrow({
    where: { id: args.questionId },
    select: { subjectId: true },
  });
  const candidates = await loadSubjectCandidates(prisma, question.subjectId);
  const writesToParent = args.sourceRefType !== "VARIANT_ITEM";

  // 同批内 dedup：同一 normalized hint 不重复处理
  const seen = new Set<string>();

  for (const rawHint of args.hints) {
    const normalized = normalizeKpHint(rawHint);
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // EXACT
    let matchVia: "EXACT" | "ALIAS" | null = null;
    let matchedKpId: string | null = candidates.kpByNormalized.get(normalized) ?? null;
    if (matchedKpId) matchVia = "EXACT";

    // ALIAS（EXACT miss 才查；并守 cross-subject 防御）
    if (!matchedKpId) {
      const aliasKpId = candidates.aliasByNormalized.get(normalized) ?? null;
      if (aliasKpId) {
        const kp = candidates.kpById.get(aliasKpId);
        if (kp && kp.subjectId === question.subjectId) {
          matchedKpId = aliasKpId;
          matchVia = "ALIAS";
        } else {
          // 防御：alias 表里有跨 subject 行（理论上 @@unique 挡住）
          logger.warn({
            event: "kp_reconcile_alias_cross_subject",
            questionId: args.questionId,
            aliasKpId,
            questionSubjectId: question.subjectId,
          });
        }
      }
    }

    try {
      if (matchedKpId && matchVia) {
        if (writesToParent) {
          // LINKED + upsert QuestionKPLink
          await prisma.$transaction(async (tx) => {
            await upsertReconcileMatch(tx, {
              ...args,
              normalizedHint: normalized,
              rawHint,
              kpId: matchedKpId,
              matchVia,
              confidence: 1.0,
              status: "LINKED",
              reviewReason: null,
            });
            await upsertQuestionKpLink(tx, args.questionId, matchedKpId!, 1.0);
          });
          result.linked++;
        } else {
          // VARIANT_ITEM → PENDING_REVIEW + 不写 QuestionKPLink
          await upsertReconcileMatch(prisma, {
            ...args,
            normalizedHint: normalized,
            rawHint,
            kpId: matchedKpId,
            matchVia,
            confidence: 1.0,
            status: "PENDING_REVIEW",
            reviewReason: "VARIANT_TO_PARENT_NEEDS_REVIEW",
          });
          result.queued++;
        }
      } else {
        // UNMATCHED
        await upsertReconcileMatch(prisma, {
          ...args,
          normalizedHint: normalized,
          rawHint,
          kpId: null,
          matchVia: null,
          confidence: null,
          status: "UNMATCHED",
          reviewReason: null,
        });
        result.queued++;
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // 同 (sourceRefType, sourceRefId, normalizedHint) 已存在 → no-op
        result.alreadySeen++;
        continue;
      }
      // 单条 hint 失败不抛 —— 不影响同批其它
      logger.warn({
        event: "kp_reconcile_sync_hint_failed",
        questionId: args.questionId,
        hint: normalized,
        error: String(e),
      });
    }
  }

  return result;
}

interface ReconcileMatchUpsertArgs extends ReconcileHintsSyncArgs {
  normalizedHint: string;
  rawHint: string;
  kpId: string | null;
  matchVia: "EXACT" | "ALIAS" | "LLM" | "MANUAL" | null;
  confidence: number | null;
  status: "UNMATCHED" | "PENDING_REVIEW" | "LINKED" | "REJECTED" | "DROPPED";
  reviewReason: "LLM_CONFIDENCE_BAND" | "VARIANT_TO_PARENT_NEEDS_REVIEW" | null;
}

async function upsertReconcileMatch(
  tx: PrismaClient | Prisma.TransactionClient,
  args: ReconcileMatchUpsertArgs,
): Promise<void> {
  // Plan 8 工艺：先尝试 create，捕 P2002 当 no-op（上面调用方在 catch 处理 alreadySeen 计数）。
  await tx.kpReconcileMatch.create({
    data: {
      questionId: args.questionId,
      kpId: args.kpId,
      rawHint: args.rawHint,
      normalizedHint: args.normalizedHint,
      source: args.source,
      sourceRefType: args.sourceRefType,
      sourceRefId: args.sourceRefId,
      matchVia: args.matchVia,
      confidence: args.confidence,
      status: args.status,
      reviewReason: args.reviewReason,
    },
  });
}

async function upsertQuestionKpLink(
  tx: PrismaClient | Prisma.TransactionClient,
  questionId: string,
  kpId: string,
  newWeight: number,
): Promise<void> {
  // weight = max(existing, newWeight) — spec §3.3
  const existing = await tx.questionKPLink.findUnique({
    where: { questionId_kpId: { questionId, kpId } },
  });
  if (existing) {
    if (existing.weight < newWeight) {
      await tx.questionKPLink.update({
        where: { questionId_kpId: { questionId, kpId } },
        data: { weight: newWeight },
      });
    }
  } else {
    await tx.questionKPLink.create({
      data: { questionId, kpId, weight: newWeight },
    });
  }
}
