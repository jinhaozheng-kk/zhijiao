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
import { selectBankQuestions, persistGeneratedPaper } from "../lib/paper-generation.js";
import { buildSpecTable } from "../lib/paper-spec-table.js";

const QType = z.enum(["SINGLE_CHOICE", "MULTI_CHOICE", "FILL_BLANK", "CALCULATION", "PROOF", "ESSAY"]);
const Section = z.object({
  type: QType,
  count: z.number().int().min(1).max(30),
  pointsPerItem: z.number().int().min(1).max(100),
});
const GenInput = z.object({
  subjectId: z.string().cuid(),
  kpIds: z.array(z.string().cuid()).min(1),
  gradeLevel: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]),
  sections: z
    .array(Section)
    .min(1)
    .refine((s) => new Set(s.map((x) => x.type)).size === s.length, "题型不可重复")
    .refine((s) => s.reduce((n, x) => n + x.count, 0) <= 30, "总题量不超过 30 题")
    .refine((s) => s.reduce((n, x) => n + x.count, 0) >= 1, "至少 1 题"),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  durationMinutes: z.number().int().min(1).max(300).optional(),
  textbookVersion: z.string().default("GENERIC"),
  clientRequestId: z.string().uuid(),
});

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
      const pointsByType = new Map(input.sections.map((s) => [s.type, s.pointsPerItem]));

      // 题库按题型分别 best-effort 命中；不足的题型攒成 AI 缺口。
      const bank: Awaited<ReturnType<typeof selectBankQuestions>> = [];
      const aiSections: Array<{ type: (typeof input.sections)[number]["type"]; count: number }> = [];
      for (const s of input.sections) {
        const hit = await selectBankQuestions(ctx.db, {
          subjectId: input.subjectId,
          kpIds: input.kpIds,
          questionTypes: [s.type],
          difficultyRange: input.difficultyRange,
          limit: s.count,
        });
        bank.push(...hit);
        const gap = s.count - hit.length;
        if (gap > 0) aiSections.push({ type: s.type, count: gap });
      }

      let aiItems: PaperGenerationOutput["items"] = [];
      let title = "练习卷";
      let modelCallId: string | null = null;

      if (aiSections.length > 0) {
        let ai: PaperGenerationOutput & { modelCallId: string };
        try {
          ai = await getAiRouter(ctx.auth.userId).generatePaper({
            subject: "数学",
            gradeLevel: input.gradeLevel,
            kpNames,
            sections: aiSections,
            difficultyRange: input.difficultyRange,
            textbookVersion: input.textbookVersion,
            excludeStems: bank.map((b) => b.stemMd.slice(0, 40)),
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
        aiItems = ai.items;
        title = ai.title;
        modelCallId = ai.modelCallId;
      }

      const paper = await persistGeneratedPaper(ctx.db, {
        teacherUserId: ctx.auth.userId,
        subjectId: input.subjectId,
        title,
        paramsJson: input as import("@prisma/client").Prisma.InputJsonValue,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId,
        bankItems: bank.map((b) => ({ ...b, points: pointsByType.get(b.type) ?? 5 })),
        aiItems: aiItems.map((a) => ({ ...a, points: pointsByType.get(a.type) ?? a.points })),
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
