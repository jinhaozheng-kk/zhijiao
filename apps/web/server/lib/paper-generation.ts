import type { Prisma, PrismaClient, QuestionType } from "@prisma/client";
import { reconcileHintsSync } from "./kp-reconcile.js";

export interface BankSelectArgs { subjectId: string; kpIds: string[]; questionTypes: QuestionType[]; difficultyRange: [number, number]; limit: number; }
export interface BankItem { questionId: string; stemMd: string; type: QuestionType; optionsJson: unknown; answerMd: string; solutionMd: string; rubricMd: string | null; difficulty: number; cognitiveLevel: string; kpHints: string[]; }

// 最小实现：best-effort，无命中/不足直接返回空；不依赖 Plan 15 schema。KP 命中按 kpId。
export async function selectBankQuestions(db: PrismaClient, args: BankSelectArgs): Promise<BankItem[]> {
  if (args.limit <= 0 || args.kpIds.length === 0) return [];
  const rows = await db.question.findMany({
    where: {
      subjectId: args.subjectId,
      status: "PUBLISHED",
      type: { in: args.questionTypes },
      difficulty: { gte: args.difficultyRange[0], lte: args.difficultyRange[1] },
      knowledgePoints: { some: { kpId: { in: args.kpIds } } },
    },
    include: { answer: true, knowledgePoints: { include: { kp: true } } },
    take: args.limit,
  });
  return rows
    .filter((q) => q.answer)
    .map((q) => ({
      questionId: q.id, stemMd: q.stemMd, type: q.type, optionsJson: null,
      answerMd: q.answer!.contentMd, solutionMd: q.answer!.solutionMd, rubricMd: null,
      difficulty: q.difficulty, cognitiveLevel: q.cognitiveLevel ?? "UNDERSTAND",
      kpHints: q.knowledgePoints.map((l) => l.kp.name),
    }));
}

export interface AiItem { stemMd: string; type: QuestionType; options?: string[]; answerMd: string; solutionMd: string; rubricMd?: string; difficulty: number; cognitiveLevel: string; points: number; knowledgePointHints: string[]; }

export function normalizePaperStemForDedup(stem: string): string {
  return stem
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*(?:第\s*)?\d+\s*[.、．]\s*/u, "")
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、,.!?;:]/g, "");
}

export function paperStemTemplateKey(stem: string): string {
  return normalizePaperStemForDedup(stem).replace(/\d+(?:\.\d+)?/g, "<num>");
}

export function paperStemDedupKeys(stem: string): string[] {
  const normalized = normalizePaperStemForDedup(stem);
  const template = paperStemTemplateKey(stem);
  return [`stem:${normalized}`, `template:${template}`];
}

export function createPaperStemDeduper(initialStems: string[] = []) {
  const seen = new Set<string>();

  function accept(stemMd: string): boolean {
    const keys = paperStemDedupKeys(stemMd);
    if (keys.some((key) => seen.has(key))) return false;
    for (const key of keys) seen.add(key);
    return true;
  }

  for (const stem of initialStems) accept(stem);
  return { accept };
}

function uniquePaperItems(args: {
  bankItems: Array<BankItem & { points: number }>;
  aiItems: AiItem[];
}): {
  bankItems: Array<BankItem & { points: number }>;
  aiItems: AiItem[];
} {
  const deduper = createPaperStemDeduper();

  const bankItems = args.bankItems.filter((item) => deduper.accept(item.stemMd));
  const aiItems = args.aiItems.filter((item) => deduper.accept(item.stemMd));
  return { bankItems, aiItems };
}

export async function persistGeneratedPaper(db: PrismaClient, args: {
  teacherUserId: string; subjectId: string; title: string; paramsJson: Prisma.InputJsonValue;
  debitLedgerId: string | null; modelCallId: string | null;
  bankItems: Array<BankItem & { points: number }>; aiItems: AiItem[];
}) {
  const reconcileTargets: Array<{ questionId: string; hints: string[] }> = [];
  const deduped = uniquePaperItems({
    bankItems: args.bankItems,
    aiItems: args.aiItems,
  });

  const paper = await db.$transaction(async (tx) => {
    const paper = await tx.paper.create({
      data: {
        teacherUserId: args.teacherUserId, subjectId: args.subjectId, title: args.title,
        paramsJson: args.paramsJson, generationLedgerId: args.debitLedgerId, generationCallId: args.modelCallId,
      },
    });
    let position = 1;
    for (const b of deduped.bankItems) {
      await tx.paperItem.create({ data: {
        paperId: paper.id, position: position++, questionId: b.questionId, source: "BANK",
        stemMd: b.stemMd, type: b.type, optionsJson: b.optionsJson as Prisma.InputJsonValue | undefined,
        answerMd: b.answerMd, solutionMd: b.solutionMd, rubricMd: b.rubricMd ?? undefined,
        points: b.points, difficulty: b.difficulty, cognitiveLevel: b.cognitiveLevel as never, kpHints: b.kpHints,
      }});
    }
    for (const a of deduped.aiItems) {
      const q = await tx.question.create({ data: {
        subjectId: args.subjectId, stemMd: a.stemMd, type: a.type, difficulty: a.difficulty,
        status: "DRAFT", source: "PAPER_GENERATED", createdByUserId: args.teacherUserId,
        cognitiveLevel: a.cognitiveLevel as never,
        answer: { create: { contentMd: a.answerMd, solutionMd: a.solutionMd } },
      }});
      await tx.paperItem.create({ data: {
        paperId: paper.id, position: position++, questionId: q.id, source: "AI_GENERATED",
        stemMd: a.stemMd, type: a.type, optionsJson: a.options as Prisma.InputJsonValue | undefined,
        answerMd: a.answerMd, solutionMd: a.solutionMd, rubricMd: a.rubricMd ?? undefined,
        points: a.points, difficulty: a.difficulty, cognitiveLevel: a.cognitiveLevel as never, kpHints: a.knowledgePointHints,
      }});
      reconcileTargets.push({ questionId: q.id, hints: a.knowledgePointHints });
    }
    return paper;
  });

  for (const t of reconcileTargets) {
    await reconcileHintsSync(db, {
      questionId: t.questionId,
      hints: t.hints,
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: t.questionId,
    });
  }
  return paper;
}
