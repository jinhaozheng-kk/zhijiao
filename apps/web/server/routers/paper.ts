import "server-only";
import { z } from "zod";
import {
  authedProcedure,
  requireTeacherPersona,
  requireGuardianConsent,
  chargeMiddleware,
  validatePaperOwnership,
  router,
} from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";
import { ComplianceRejectedError, type PaperGenerationOutput } from "@zhijiao/ai";
import { createPaperStemDeduper, selectBankQuestions, persistGeneratedPaper } from "../lib/paper-generation.js";
import { buildSpecTable } from "../lib/paper-spec-table.js";
import type { Prisma, QuestionType } from "@prisma/client";
import {
  buildZhongkaoMathBlueprint,
  blueprintToAiSections,
  assignItemsToSlots,
  applySlotMetadata,
  ZHONGKAO_TEMPLATE_ID,
  type ZhongkaoMathBlueprint,
  type AssignedPair,
  type AssignableItem,
} from "@/lib/zhongkao-blueprint";
import { reviewAssembledPaper, type PaperReviewIssue } from "../lib/paper-review.js";
import { type TextbookVersion, type QuestionTypeValue, type CognitiveLevelValue } from "@/lib/paper-copy";

const QType = z.enum(["SINGLE_CHOICE", "MULTI_CHOICE", "FILL_BLANK", "CALCULATION", "PROOF", "ESSAY"]);
const Section = z.object({
  type: QType,
  count: z.number().int().min(1).max(30),
  pointsPerItem: z.number().int().min(1).max(100),
});
const GenInput = z
  .object({
    subjectId: z.string().cuid(),
    kpIds: z.array(z.string().cuid()).min(1),
    gradeLevel: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]),
    styleTemplate: z.literal("JUNIOR_MATH_ZHONGKAO_GENERIC_V1").optional(),
    sections: z
      .array(Section)
      .min(1)
      .refine((s) => new Set(s.map((x) => x.type)).size === s.length, "题型不可重复")
      .refine((s) => s.reduce((n, x) => n + x.count, 0) <= 30, "总题量不超过 30 题")
      .refine((s) => s.reduce((n, x) => n + x.count, 0) >= 1, "至少 1 题")
      .optional(),
    difficultyRange: z
      .tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)])
      .optional(),
    durationMinutes: z.number().int().min(1).max(300).optional(),
    textbookVersion: z.string().default("GENERIC"),
    clientRequestId: z.string().uuid(),
  })
  .refine((v) => Boolean(v.styleTemplate) || (Boolean(v.sections) && Boolean(v.difficultyRange)), {
    message: "需指定 styleTemplate 或 sections+difficultyRange",
  });

const MAX_PAPER_AI_ATTEMPTS = 3;
const REFILL_OVERGEN_FACTOR = 2;

export const paperRouter = router({
  generate: authedProcedure
    .input(GenInput)                    // schema validation before any middleware — malformed input fails before charge
    .use(requireTeacherPersona)         // non-teacher fails before DEBIT is written
    .use(requireGuardianConsent)
    .use(chargeMiddleware("PAPER_GEN")) // fixed 5 credits
    .mutation(async ({ ctx, input }) => {
      // Validate KP → subject relationship before touching AI or persisting.
      // This runs AFTER charge (by design): a BAD_REQUEST here triggers
      // shouldCompensate → true, so the debit is refunded. Net balance = 0.
      const kps = await ctx.db.knowledgePoint.findMany({
        where: { id: { in: input.kpIds }, subjectId: input.subjectId },
        select: { id: true, name: true },
      });
      if (kps.length !== input.kpIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "知识点与学科不匹配",
          cause: { reason: "KP_SUBJECT_MISMATCH" },
        });
      }
      const kpNames = kps.map((k) => k.name);

      // 中考风格：用蓝图派生生成参数；否则用手动 sections。
      let blueprint: ZhongkaoMathBlueprint | null = null;
      let effSections: Array<{ type: QuestionType; count: number; pointsPerItem: number }>;
      let effDifficulty: [number, number];
      let styleRules: string[] | undefined;
      let slotHints: Array<{ type: QuestionType; intent: string; constraints: string[] }> | undefined;
      let promptVersion: "v1" | "v2" = "v1";

      if (input.styleTemplate === ZHONGKAO_TEMPLATE_ID) {
        blueprint = buildZhongkaoMathBlueprint({
          gradeLevel: input.gradeLevel,
          durationMinutes: input.durationMinutes ?? 120,
          textbookVersion: (input.textbookVersion as TextbookVersion) ?? "GENERIC",
          kps,
        });
        const ai = blueprintToAiSections(blueprint);
        effSections = ai.sections.map((s) => ({ type: s.type as QuestionType, count: s.count, pointsPerItem: 1 }));
        effDifficulty = [1, 5];
        slotHints = ai.slotHints.map((h) => ({ type: h.type as QuestionType, intent: h.intent, constraints: h.constraints }));
        styleRules = ["题干使用正式考试语言", "避免教辅营销表达", "不使用押题、预测、必考等词", "解析步骤完整但不冗长"];
        promptVersion = "v2";
      } else {
        if (!input.sections || !input.difficultyRange) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "缺少出卷参数", cause: { reason: "PAPER_PARAMS_MISSING" } });
        }
        effSections = input.sections.map((s) => ({ type: s.type, count: s.count, pointsPerItem: s.pointsPerItem }));
        effDifficulty = input.difficultyRange;
      }

      const pointsByType = new Map(effSections.map((s) => [s.type, s.pointsPerItem]));
      const desiredByType = new Map(effSections.map((s) => [s.type, s.count]));
      const deduper = createPaperStemDeduper();

      // 题库按题型分别 best-effort 命中；不足的题型攒成 AI 缺口。
      const bank: Awaited<ReturnType<typeof selectBankQuestions>> = [];
      let dedupDroppedCount = 0;
      const excludeStems: string[] = [];
      for (const s of effSections) {
        const hit = await selectBankQuestions(ctx.db, {
          subjectId: input.subjectId,
          kpIds: input.kpIds,
          questionTypes: [s.type],
          difficultyRange: effDifficulty,
          limit: s.count,
        });
        for (const item of hit) {
          excludeStems.push(item.stemMd);
          if (deduper.accept(item.stemMd)) {
            bank.push(item);
          } else {
            dedupDroppedCount++;
          }
        }
      }

      let aiItems: PaperGenerationOutput["items"] = [];
      let title = "练习卷";
      let modelCallId: string | null = null;
      const modelCallIds: string[] = [];

      function selectedCount(type: QuestionType) {
        return bank.filter((item) => item.type === type).length + aiItems.filter((item) => item.type === type).length;
      }

      function missingSections(multiplier: number) {
        return effSections.flatMap((section) => {
          const gap = (desiredByType.get(section.type) ?? 0) - selectedCount(section.type);
          if (gap <= 0) return [];
          return [{ type: section.type, count: Math.min(gap * multiplier, 30) }];
        });
      }

      let aiSections = missingSections(1);
      for (let attempt = 0; aiSections.length > 0 && attempt < MAX_PAPER_AI_ATTEMPTS; attempt++) {
        let ai: PaperGenerationOutput & { modelCallId: string };
        try {
          ai = await getAiRouter(ctx.auth.userId, { promptVersion }).generatePaper({
            subject: "数学",
            gradeLevel: input.gradeLevel,
            kpNames,
            sections: aiSections,
            difficultyRange: effDifficulty,
            textbookVersion: input.textbookVersion,
            excludeStems,
            ...(styleRules ? { styleRules } : {}),
            ...(slotHints ? { slotHints } : {}),
          });
        } catch (e) {
          if (e instanceof ComplianceRejectedError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "生成内容未通过合规检查，请调整参数重试。",
              cause: { reason: "COMPLIANCE_REJECTED", original: e },
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "出卷失败，请稍后再试。",
            cause: { reason: "PAPER_INTERNAL" },
          });
        }
        for (const item of ai.items) {
          excludeStems.push(item.stemMd);
          if (deduper.accept(item.stemMd)) {
            const target = desiredByType.get(item.type) ?? 0;
            if (selectedCount(item.type) < target) {
              aiItems.push(item);
            } else {
              dedupDroppedCount++;
            }
          } else {
            dedupDroppedCount++;
          }
        }
        title = ai.title;
        if (!modelCallId) modelCallId = ai.modelCallId;
        modelCallIds.push(ai.modelCallId);
        aiSections = missingSections(REFILL_OVERGEN_FACTOR);
      }

      if (aiSections.length > 0) {
        const shortfallByType = Object.fromEntries(
          effSections
            .map((section) => [section.type, (desiredByType.get(section.type) ?? 0) - selectedCount(section.type)] as const)
            .filter(([, gap]) => gap > 0),
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "题目重复率过高，未能生成满足题量要求的试卷，请调整题型或知识点后重试。",
          cause: { reason: "PAPER_DEDUP_SHORTFALL", shortfallByType },
        });
      }

      // 中考模式：zip → 审题闸门 → slot 权威落库。
      let assignedPairs: AssignedPair[] | null = null;
      let reviewIssues: PaperReviewIssue[] = [];
      if (blueprint) {
        const merged: AssignableItem[] = [
          ...bank.map((b) => ({
            stemMd: b.stemMd,
            type: b.type as QuestionTypeValue,
            options: undefined,
            answerMd: b.answerMd,
            solutionMd: b.solutionMd,
            rubricMd: b.rubricMd ?? undefined,
            difficulty: b.difficulty,
            cognitiveLevel: (b.cognitiveLevel as CognitiveLevelValue) ?? "UNDERSTAND",
            points: b.difficulty,
            knowledgePointHints: b.kpHints,
          })),
          ...aiItems.map((a) => ({
            stemMd: a.stemMd,
            type: a.type as QuestionTypeValue,
            options: a.options,
            answerMd: a.answerMd,
            solutionMd: a.solutionMd,
            rubricMd: a.rubricMd,
            difficulty: a.difficulty,
            cognitiveLevel: a.cognitiveLevel as CognitiveLevelValue,
            points: a.points,
            knowledgePointHints: a.knowledgePointHints,
          })),
        ];
        assignedPairs = assignItemsToSlots(blueprint, merged);
        reviewIssues = reviewAssembledPaper(
          assignedPairs.map(({ slot, item }) => ({
            slot,
            item: {
              stemMd: item.stemMd,
              type: item.type as QuestionType,
              options: item.options,
              answerMd: item.answerMd,
              solutionMd: item.solutionMd,
              rubricMd: item.rubricMd,
              difficulty: item.difficulty,
              points: item.points,
            },
          })),
        );
        const blockers = reviewIssues.filter((x) => x.severity === "BLOCKER");
        if (blockers.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "自动审题未通过，请调整知识点或稍后重试。",
            cause: { reason: "PAPER_REVIEW_BLOCKED", blockers: blockers.map((b) => b.code) },
          });
        }
      }

      const zhongkaoItems = assignedPairs
        ? assignedPairs.map((p) => {
            const it = applySlotMetadata(p);
            return {
              stemMd: it.stemMd,
              type: it.type as QuestionType,
              options: it.options,
              answerMd: it.answerMd,
              solutionMd: it.solutionMd,
              rubricMd: it.rubricMd,
              difficulty: it.difficulty,
              cognitiveLevel: it.cognitiveLevel,
              points: it.points,
              knowledgePointHints: it.knowledgePointHints,
            };
          })
        : null;

      const paper = await persistGeneratedPaper(ctx.db, {
        teacherUserId: ctx.auth.userId,
        subjectId: input.subjectId,
        title: blueprint
          ? blueprint.isTopical
            ? "九年级数学专题练习卷"
            : "九年级数学中考风格练习卷"
          : title,
        paramsJson: {
          ...input,
          ...(blueprint
            ? {
                styleTemplate: blueprint.styleTemplate,
                blueprintVersion: blueprint.blueprintVersion,
                blueprint,
                durationMinutes: blueprint.durationMinutes,
              }
            : {}),
          dedupDroppedCount,
          refillRounds: Math.max(0, modelCallIds.length - 1),
          modelCallIds,
          reviewWarnings: reviewIssues.filter((x) => x.severity === "WARNING"),
        } as unknown as Prisma.InputJsonValue,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId,
        bankItems: zhongkaoItems ? [] : bank.map((b) => ({ ...b, points: pointsByType.get(b.type) ?? 5 })),
        aiItems: zhongkaoItems ?? aiItems.map((a) => ({ ...a, points: pointsByType.get(a.type) ?? a.points })),
      });
      return { paperId: paper.id };
    }),

  list: authedProcedure
    .use(requireTeacherPersona)
    .query(async ({ ctx }) => {
      return ctx.db.paper.findMany({
        where: { teacherUserId: ctx.auth.userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      });
    }),

  get: authedProcedure
    .use(requireTeacherPersona)
    .use(validatePaperOwnership)
    .input(z.object({ paperId: z.string().cuid() }))
    .query(async ({ ctx }) => {
      const specTable = buildSpecTable(
        ctx.paper.items.map((i) => ({
          kpHints: i.kpHints,
          cognitiveLevel: i.cognitiveLevel ?? "UNDERSTAND",
          type: i.type,
          difficulty: i.difficulty,
          points: i.points,
        })),
      );
      return { paper: ctx.paper, specTable };
    }),

  markReady: authedProcedure
    .use(requireTeacherPersona)
    .use(validatePaperOwnership)
    .input(z.object({ paperId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
      await ctx.db.paper.update({
        where: { id: ctx.paper.id },
        data: { status: "READY" },
      });
      return { ok: true };
    }),

  removeItem: authedProcedure
    .use(requireTeacherPersona)
    .use(validatePaperOwnership)
    .input(z.object({ paperId: z.string().cuid(), itemId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = ctx.paper.items.find((i) => i.id === input.itemId);
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "题目不存在",
          cause: { reason: "ITEM_NOT_FOUND" },
        });
      }
      await ctx.db.paperItem.delete({ where: { id: input.itemId } });
      return { ok: true };
    }),

  updateItemPoints: authedProcedure
    .use(requireTeacherPersona)
    .use(validatePaperOwnership)
    .input(
      z.object({
        paperId: z.string().cuid(),
        itemId: z.string().cuid(),
        points: z.number().int().min(0).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = ctx.paper.items.find((i) => i.id === input.itemId);
      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "题目不存在",
          cause: { reason: "ITEM_NOT_FOUND" },
        });
      }
      await ctx.db.paperItem.update({
        where: { id: input.itemId },
        data: { points: input.points },
      });
      return { ok: true };
    }),
});
