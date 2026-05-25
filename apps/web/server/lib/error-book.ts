import "server-only";
import {
  Prisma,
  type PrismaClient,
  type ErrorBookEntry,
  type Question,
  type QuestionAnswer,
  type QuestionKPLink,
  type KnowledgePoint,
  type VariantGroup,
  type VariantItem,
} from "@prisma/client";
import type { ErrorAnalysisOutput } from "@zhijiao/ai";

export const DAY_MS = 24 * 60 * 60 * 1000;

// spec §6.3 — fixed 5-step interval, capped at 30d after the 5th review.
//   reviewCountAfter = 1 → +1d
//   reviewCountAfter = 2 → +3d
//   reviewCountAfter = 3 → +7d
//   reviewCountAfter = 4 → +14d
//   reviewCountAfter >= 5 → +30d (cap; MVP does NOT implement SM-2 / FSRS)
export const REVIEW_INTERVALS_MS: readonly number[] = [
  1 * DAY_MS,
  3 * DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  30 * DAY_MS,
];

export function nextReviewAtAfter(reviewCountAfter: number, now: Date): Date {
  // safeIdx maps `reviewCountAfter ∈ [1, n]` → array index [0, n-1].
  // Anything ≥ 5 saturates at the last bucket (cap).
  const safeIdx = Math.min(
    Math.max(reviewCountAfter - 1, 0),
    REVIEW_INTERVALS_MS.length - 1,
  );
  return new Date(now.getTime() + REVIEW_INTERVALS_MS[safeIdx]!);
}

// spec §4.1 修订: P2002 helper — preserves Plan 4 spec "isErrorBookPartialUniqueP2002"
// contract. Extracted as a single returnable so the partial-unique race detection
// can't be expressed inline as `a && b && c || d` (which TS parses as
// `(a && b && c) || d` — d alone makes the whole expression truthy and bypasses
// the instanceof guard).
export function isErrorBookPartialUniqueP2002(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code !== "P2002") return false;
  const meta = e.meta as { target?: string | string[] } | undefined;
  const target = meta?.target;
  const targetParts = Array.isArray(target) ? target : target ? [target] : [];
  const targetStr = targetParts.join(",");
  // Prisma's meta.target for raw SQL partial unique indexes is version/runtime
  // dependent: sometimes it reports the index name, sometimes just the columns.
  // Treat both shapes as the same race-path signal; ErrorBookEntry has no schema
  // @@unique([userId, questionId]), so this field pair can only come from the
  // active/archived partial unique index.
  return (
    targetStr.includes("user_question_active") ||
    (targetParts.includes("user_id") && targetParts.includes("question_id"))
  );
}

export interface UpsertEntryOnDiagnoseArgs {
  userId: string;
  questionId: string;
  ai: ErrorAnalysisOutput;
  debitLedgerId: string;
  modelCallId: string;
  actualAnswerMd: string | null;
}

// spec §4.1 step 5: UPSERT semantics for error.diagnose.
//
//   - already-ACTIVE entry for (userId, questionId) → update in place; preserve
//     reviewCount and nextReviewAt so the user doesn't lose review-schedule
//     progress by re-running diagnose.
//   - ARCHIVED entry → resurrect to ACTIVE; if nextReviewAt was null (cleared
//     by archive(true)), set to now+1d so the entry re-enters the queue.
//   - DELETED entry → invisible to findFirst() because it's not in the
//     ACTIVE/ARCHIVED status filter. The create() path fires, producing a
//     NEW row that coexists with the DELETED row (allowed by the partial
//     unique index that only constrains ACTIVE/ARCHIVED).
//   - concurrent diagnose on the same (userId, questionId) → second writer's
//     create() throws P2002 on the partial unique index; re-read on the
//     top-level client finds the winner and we fall through to the update
//     path. Both calls complete successfully and both get charged 1 credit
//     (both received AI service).
//
// Plan 4 hotfix (surfaced by Plan 9 Task 7): function accepts PrismaClient,
// NOT TransactionClient. Mirrors the Plan 8 fix for upsertUserAdhocQuestion:
// when create() throws P2002 *inside* a $transaction callback, Postgres
// marks the tx aborted (25P02). Subsequent tx.findFirstOrThrow() then fails
// with PrismaClientUnknownRequestError, swallowing the race detection. The
// caller now invokes us with the bare client (not via $transaction); each
// DB call is atomic on its own, and the partial unique index at DB level
// guarantees the race-time contract.
export async function upsertEntryOnDiagnose(
  prisma: PrismaClient,
  args: UpsertEntryOnDiagnoseArgs,
): Promise<ErrorBookEntry> {
  const { userId, questionId, ai, debitLedgerId, modelCallId, actualAnswerMd } = args;
  const existing = await prisma.errorBookEntry.findFirst({
    where: { userId, questionId, status: { in: ["ACTIVE", "ARCHIVED"] } },
  });
  if (existing) {
    return prisma.errorBookEntry.update({
      where: { id: existing.id },
      data: {
        // ARCHIVED → ACTIVE allowed (user explicitly re-engaging the question);
        // distinct from DELETED → ACTIVE which is forbidden (and prevented by
        // DELETED rows being outside the findFirst() filter above).
        status: "ACTIVE",
        rootCause: ai.rootCause,
        rootCauseReasoning: ai.reasoning,
        // Keep prior actualAnswerMd if the new diagnose call didn't supply one.
        actualAnswerMd: actualAnswerMd ?? existing.actualAnswerMd,
        diagnoseLedgerId: debitLedgerId,
        lastDiagnoseCallId: modelCallId,
        // Don't roll back schedule progress on re-diagnose. Only re-seed when
        // the entry had been archived (nextReviewAt cleared) so it re-enters
        // the review queue.
        nextReviewAt: existing.nextReviewAt ?? new Date(Date.now() + DAY_MS),
      },
    });
  }
  try {
    return await prisma.errorBookEntry.create({
      data: {
        userId,
        questionId,
        status: "ACTIVE",
        rootCause: ai.rootCause,
        rootCauseReasoning: ai.reasoning,
        actualAnswerMd,
        diagnoseLedgerId: debitLedgerId,
        lastDiagnoseCallId: modelCallId,
        nextReviewAt: new Date(Date.now() + DAY_MS),
      },
    });
  } catch (e) {
    if (isErrorBookPartialUniqueP2002(e)) {
      // Concurrent race: another diagnose for the same (userId, questionId)
      // created the entry while we were preparing ours. Re-read (on the
      // top-level client — NOT inside an aborted tx) and apply our analysis
      // to the winner.
      const winner = await prisma.errorBookEntry.findFirstOrThrow({
        where: { userId, questionId, status: { in: ["ACTIVE", "ARCHIVED"] } },
      });
      return prisma.errorBookEntry.update({
        where: { id: winner.id },
        data: {
          status: "ACTIVE",
          rootCause: ai.rootCause,
          rootCauseReasoning: ai.reasoning,
          diagnoseLedgerId: debitLedgerId,
          lastDiagnoseCallId: modelCallId,
          nextReviewAt: winner.nextReviewAt ?? new Date(Date.now() + DAY_MS),
        },
      });
    }
    throw e;
  }
}

// === View serializers ===

type EntryListItem = ErrorBookEntry & {
  question?: Pick<Question, "id" | "stemMd" | "type"> | null;
};

export function toEntryView(entry: EntryListItem) {
  return {
    id: entry.id,
    userId: entry.userId,
    questionId: entry.questionId,
    status: entry.status,
    rootCause: entry.rootCause,
    rootCauseReasoning: entry.rootCauseReasoning,
    actualAnswerMd: entry.actualAnswerMd,
    reviewCount: entry.reviewCount,
    nextReviewAt: entry.nextReviewAt,
    lastReviewedAt: entry.lastReviewedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    question: entry.question
      ? {
          id: entry.question.id,
          stemMd: entry.question.stemMd,
          type: entry.question.type,
        }
      : null,
  };
}

type QuestionWithRelations = Question & {
  answer?: QuestionAnswer | null;
  knowledgePoints?: (QuestionKPLink & { kp: KnowledgePoint })[];
};

export function toQuestionView(q: QuestionWithRelations) {
  return {
    id: q.id,
    stemMd: q.stemMd,
    type: q.type,
    difficulty: q.difficulty,
    answer: q.answer
      ? { contentMd: q.answer.contentMd, solutionMd: q.answer.solutionMd }
      : null,
    knowledgePoints:
      q.knowledgePoints?.map((l) => ({
        id: l.kp.id,
        name: l.kp.name,
        difficulty: l.kp.difficulty,
        weight: l.weight,
      })) ?? [],
  };
}

export function toVariantGroupView(
  g: VariantGroup & { items: VariantItem[] },
) {
  return {
    id: g.id,
    entryId: g.entryId,
    creditsCost: g.creditsCost,
    createdAt: g.createdAt,
    items: g.items.map((it) => ({
      id: it.id,
      level: it.level,
      position: it.position,
      stemMd: it.stemMd,
      solutionMd: it.solutionMd,
      knowledgePointHints: it.knowledgePointHints,
    })),
  };
}
