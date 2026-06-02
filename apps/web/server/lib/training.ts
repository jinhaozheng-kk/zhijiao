import "server-only";
import type { PrismaClient } from "@prisma/client";
import { profileForStudent } from "@zhijiao/analytics";
import type { AnalyticsWindow } from "@zhijiao/analytics";

export const SESSION_ITEM_CAP = 8;
const MIN_TARGETED = 3; // below this, top up from the due-review queue

export type TrainingItemSourceT = "ERROR_BOOK" | "VARIANT";

export interface TrainingItem {
  questionId: string;
  source: TrainingItemSourceT;
  kpId: string | null;
  stemMd: string;
  solutionMd: string | null;
  level: string | null; // L1/L2/L3 for variants, null for error-book originals
}

export async function buildTrainingSession(
  db: PrismaClient,
  userId: string,
  window: AnalyticsWindow,
): Promise<{
  status: "OK" | "INSUFFICIENT_DATA";
  items: TrainingItem[];
  targetKpNames: string[];
}> {
  const profile = await profileForStudent(db, { userId, window });
  const focus = profile.masteries.filter((m) => m.tier === "FOCUS");
  const targets = (
    focus.length > 0
      ? focus
      : profile.masteries.filter((m) => m.tier === "PROGRESSING")
  ).slice(0, 3);
  const focusKpIds = targets.map((m) => m.kpId);
  const targetKpNames = targets.map((m) => m.kpName);

  const items: TrainingItem[] = [];
  if (focusKpIds.length > 0) {
    const entries = await db.errorBookEntry.findMany({
      where: {
        userId,
        status: "ACTIVE",
        question: { knowledgePoints: { some: { kpId: { in: focusKpIds } } } },
      },
      include: {
        question: {
          include: { answer: true, knowledgePoints: { select: { kpId: true } } },
        },
      },
      orderBy: { nextReviewAt: "asc" },
    });
    for (const e of entries) {
      const kpId =
        e.question.knowledgePoints.find((l) => focusKpIds.includes(l.kpId))?.kpId ??
        null;
      items.push({
        questionId: e.questionId,
        source: "ERROR_BOOK",
        kpId,
        stemMd: e.question.stemMd,
        solutionMd: e.question.answer?.solutionMd ?? null,
        level: null,
      });
    }
    const variants = await db.variantItem.findMany({
      where: {
        group: { userId },
        question: { knowledgePoints: { some: { kpId: { in: focusKpIds } } } },
      },
      include: {
        question: { include: { knowledgePoints: { select: { kpId: true } } } },
      },
      orderBy: [{ groupId: "asc" }, { position: "asc" }],
    });
    for (const v of variants) {
      const kpId =
        v.question.knowledgePoints.find((l) => focusKpIds.includes(l.kpId))?.kpId ??
        null;
      items.push({
        questionId: v.questionId,
        source: "VARIANT",
        kpId,
        stemMd: v.stemMd,
        solutionMd: v.solutionMd,
        level: v.level,
      });
    }
  }

  // Cold-start fallback: top up from the due-review queue so the session is
  // never a near-empty / paywall screen.
  if (items.length < MIN_TARGETED) {
    const seen = new Set(items.map((i) => i.questionId));
    const due = await db.errorBookEntry.findMany({
      where: { userId, status: "ACTIVE", nextReviewAt: { lte: new Date() } },
      include: { question: { include: { answer: true } } },
      orderBy: { nextReviewAt: "asc" },
      take: SESSION_ITEM_CAP,
    });
    for (const e of due) {
      if (seen.has(e.questionId)) continue;
      items.push({
        questionId: e.questionId,
        source: "ERROR_BOOK",
        kpId: null,
        stemMd: e.question.stemMd,
        solutionMd: e.question.answer?.solutionMd ?? null,
        level: null,
      });
    }
  }

  const capped = items.slice(0, SESSION_ITEM_CAP);
  return {
    status: capped.length === 0 ? "INSUFFICIENT_DATA" : "OK",
    items: capped,
    targetKpNames,
  };
}

// Ownership: the caller may only attempt a question that is in their own error
// book or among their own variant items.
export async function ownsTrainingQuestion(
  db: PrismaClient,
  userId: string,
  questionId: string,
): Promise<boolean> {
  const entry = await db.errorBookEntry.findFirst({
    where: { userId, questionId },
    select: { id: true },
  });
  if (entry) return true;
  const variant = await db.variantItem.findFirst({
    where: { questionId, group: { userId } },
    select: { id: true },
  });
  return variant != null;
}
