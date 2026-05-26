import { Prisma, type PrismaClient, type KnowledgePoint } from "@prisma/client";

// Plan 9 Task 5 hotfix (review P1): 不能 `import "server-only"`，也不能直接
// `import { logger } from "../logger.js"`，因为 Task 8/9/10 的 CLI 脚本（kp:review /
// kp:reconcile-pending / kp-backfill-variant-items）会通过 tsx 直接 import 本文件。
// tsx/Node 不像 Next 那样 alias server-only，会直接 throw。
//
// Logger 用注入模式（与 @zhijiao/billing 的 setBillingLogger 一致）：
// apps/web/server/logger.ts 在 module-load 时调 setKpReconcileLogger(...)；
// CLI 脚本可注入自己的 console-logger 或接受 no-op 默认值。
interface KpReconcileLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}
let _logger: KpReconcileLogger = { warn: () => {} };
export function setKpReconcileLogger(logger: KpReconcileLogger): void {
  _logger = logger;
}

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
  const kpNameCounts = new Map<string, number>();
  const kpNameByNormalized = new Map<string, string>();
  for (const kp of kps) {
    kpById.set(kp.id, kp);
    const normalizedName = normalizeKpHint(kp.name);
    kpNameCounts.set(normalizedName, (kpNameCounts.get(normalizedName) ?? 0) + 1);
    kpNameByNormalized.set(normalizedName, kp.id);
    kpByNormalized.set(normalizeKpHint(kp.code), kp.id);
  }
  for (const [normalizedName, count] of kpNameCounts) {
    // code 在同学科内有唯一约束，可以直接 exact；name 没有唯一约束，
    // 同名时不能 1.0 自动落库，留给 alias / LLM / 人工确认。
    if (count === 1 && !kpByNormalized.has(normalizedName)) {
      kpByNormalized.set(normalizedName, kpNameByNormalized.get(normalizedName)!);
    }
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
          _logger.warn({
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
        // Plan 9 Task 5 hotfix (review P2): 只有 kp_reconcile_matches 的 unique
        // 才算 alreadySeen。QuestionKPLink 的 unique 由下面 atomic upsert 处理，
        // 理论上不会冒到这里；但万一未来加了其它 unique 约束，target 判定能避免
        // 把跨表的 race 误算成本表幂等。
        const target = (e.meta?.target ?? []) as string[] | string | undefined;
        const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
        if (targetStr.includes("normalized_hint")) {
          // 同 (sourceRefType, sourceRefId, normalizedHint) 已存在 → no-op
          result.alreadySeen++;
          continue;
        }
        // 非预期 P2002：审计行没成功落库，但调用方的业务流不能被它阻塞
        _logger.warn({
          event: "kp_reconcile_sync_unexpected_p2002",
          questionId: args.questionId,
          hint: normalized,
          target: targetStr,
        });
        continue;
      }
      // 单条 hint 失败不抛 —— 不影响同批其它
      _logger.warn({
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
  // Plan 9 Task 5 hotfix (review P2): atomic upsert via raw SQL ON CONFLICT.
  //
  // 旧版 findUnique → create / update 在并发场景下会 race：两个不同 source 同时
  // reconcile 同一 (questionId, kpId)，第二个 create 撞 (question_id, kp_id) unique
  // 抛 P2002 → 上层事务 rollback → KpReconcileMatch 审计行也丢了，且被外层 catch 误
  // 算作 alreadySeen。
  //
  // 用 INSERT ... ON CONFLICT DO UPDATE SET weight = GREATEST(...) 在 Postgres 层
  // 一次性完成 race-safe 的 max-weight upsert；不再抛 P2002 给上层。
  // spec §3.3: weight = max(existing, newWeight)。
  await tx.$executeRaw`
    INSERT INTO "question_kp_links" ("question_id", "kp_id", "weight")
    VALUES (${questionId}, ${kpId}, ${newWeight})
    ON CONFLICT ("question_id", "kp_id")
    DO UPDATE SET "weight" = GREATEST("question_kp_links"."weight", EXCLUDED."weight")
  `;
}

// ============ CLI / service 层操作 ============

export class KpAliasConflictError extends Error {
  constructor(
    public existing: { id: string; kpId: string; source: string },
    public requested: { kpId: string; normalizedAlias: string },
  ) {
    super(
      `Alias "${requested.normalizedAlias}" already maps to kp ${existing.kpId} (source=${existing.source}); refused to override`,
    );
    this.name = "KpAliasConflictError";
  }
}

export interface ApproveMatchArgs {
  matchId: string;
  reviewedByUserId: string;
}

// PENDING_REVIEW → LINKED；采纳 row.kpId 写 QuestionKPLink。
// weight = max(existing, row.confidence ?? 1.0) — 由 atomic upsert 保证。
export async function approveMatch(
  prisma: PrismaClient,
  args: ApproveMatchArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: args.matchId } });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`approveMatch: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  if (!match.kpId) {
    throw new Error(`approveMatch: match ${args.matchId} has no kpId (cannot approve)`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.kpReconcileMatch.update({
      where: { id: args.matchId },
      data: {
        status: "LINKED",
        reviewReason: null,
        reviewedAt: new Date(),
        reviewedByUserId: args.reviewedByUserId,
      },
    });
    await upsertQuestionKpLink(tx, match.questionId, match.kpId!, match.confidence ?? 1.0);
    return updated;
  });
}

export interface RejectMatchArgs {
  matchId: string;
  reviewedByUserId: string;
}

// PENDING_REVIEW → REJECTED；保留 kpId 作 audit 但不写 QuestionKPLink。
export async function rejectMatch(
  prisma: PrismaClient,
  args: RejectMatchArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: args.matchId } });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`rejectMatch: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  return prisma.kpReconcileMatch.update({
    where: { id: args.matchId },
    data: {
      status: "REJECTED",
      reviewReason: null,
      reviewedAt: new Date(),
      reviewedByUserId: args.reviewedByUserId,
    },
  });
}

export interface RemapMatchArgs {
  matchId: string;
  newKpCode: string;
  reviewedByUserId: string;
}

// PENDING_REVIEW → LINKED but with newKpCode 指定的 KP (subject-scoped lookup)。
// matchVia=MANUAL, confidence=1.0 (人工确认 = 满信心)。
export async function remapMatch(
  prisma: PrismaClient,
  args: RemapMatchArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({
    where: { id: args.matchId },
    include: { question: { select: { subjectId: true } } },
  });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`remapMatch: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  const targetKp = await prisma.knowledgePoint.findUnique({
    where: { subjectId_code: { subjectId: match.question.subjectId, code: args.newKpCode } },
  });
  if (!targetKp) {
    throw new Error(`remapMatch: KP code ${args.newKpCode} not found in subject ${match.question.subjectId}`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.kpReconcileMatch.update({
      where: { id: args.matchId },
      data: {
        kpId: targetKp.id,
        matchVia: "MANUAL",
        confidence: 1.0,
        status: "LINKED",
        reviewReason: null,
        reviewedAt: new Date(),
        reviewedByUserId: args.reviewedByUserId,
      },
    });
    await upsertQuestionKpLink(tx, match.questionId, targetKp.id, 1.0);
    return updated;
  });
}

export interface LearnAliasAndLinkArgs {
  matchId: string;
  targetKpCode: string;
  reviewedByUserId: string;
}

// PENDING_REVIEW → LINKED + 写 KpAlias(source=CLI_MANUAL)。
// Plan 9 spec §5.4: alias 冲突防御 —— 已存在 (subjectId, normalizedAlias) 指向不同
// KP 时抛 KpAliasConflictError，不静默覆盖。
export async function learnAliasAndLink(
  prisma: PrismaClient,
  args: LearnAliasAndLinkArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({
    where: { id: args.matchId },
    include: { question: { select: { subjectId: true } } },
  });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`learnAliasAndLink: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  const targetKp = await prisma.knowledgePoint.findUnique({
    where: { subjectId_code: { subjectId: match.question.subjectId, code: args.targetKpCode } },
  });
  if (!targetKp) {
    throw new Error(`learnAliasAndLink: KP code ${args.targetKpCode} not found in subject ${match.question.subjectId}`);
  }

  // 冲突检测（spec §5.4）
  const existingAlias = await prisma.kpAlias.findUnique({
    where: {
      subjectId_normalizedAlias: {
        subjectId: match.question.subjectId,
        normalizedAlias: match.normalizedHint,
      },
    },
  });
  if (existingAlias && existingAlias.kpId !== targetKp.id) {
    throw new KpAliasConflictError(
      { id: existingAlias.id, kpId: existingAlias.kpId, source: existingAlias.source },
      { kpId: targetKp.id, normalizedAlias: match.normalizedHint },
    );
  }

  return prisma.$transaction(async (tx) => {
    if (!existingAlias) {
      await tx.kpAlias.create({
        data: {
          subjectId: match.question.subjectId,
          kpId: targetKp.id,
          normalizedAlias: match.normalizedHint,
          source: "CLI_MANUAL",
          createdByUserId: args.reviewedByUserId,
        },
      });
    }
    const updated = await tx.kpReconcileMatch.update({
      where: { id: args.matchId },
      data: {
        kpId: targetKp.id,
        matchVia: "MANUAL",
        confidence: 1.0,
        status: "LINKED",
        reviewReason: null,
        reviewedAt: new Date(),
        reviewedByUserId: args.reviewedByUserId,
      },
    });
    await upsertQuestionKpLink(tx, match.questionId, targetKp.id, 1.0);
    return updated;
  });
}

// Plan 9 不暴露给 CLI / router（spec §5.5 / 探针 33）；只 export 给 unit test 验证
// + 未来开 ad-hoc 批量修错脚本时复用。
// 删 QuestionKPLink 前先查是否还有其它 LINKED match 在背书；有则不删。
export async function unlinkIfOrphan(
  prisma: PrismaClient,
  args: { questionId: string; kpId: string },
): Promise<{ removed: boolean }> {
  const stillLinked = await prisma.kpReconcileMatch.count({
    where: { questionId: args.questionId, kpId: args.kpId, status: "LINKED" },
  });
  if (stillLinked === 0) {
    await prisma.questionKPLink.deleteMany({
      where: { questionId: args.questionId, kpId: args.kpId },
    });
    return { removed: true };
  }
  return { removed: false };
}
