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
import { ComplianceRejectedError, type FigureSpec, type PaperGenerationOutput } from "@zhijiao/ai";
import { createPaperStemDeduper, selectBankQuestions, persistGeneratedPaper, uniquePaperItems } from "../lib/paper-generation.js";
import { buildSpecTable } from "../lib/paper-spec-table.js";
import { deriveFunctionFigure, deriveGeometryFigure } from "@/lib/paper-figure-derive";
import type { Prisma, PrismaClient, QuestionType } from "@prisma/client";
import { logger } from "../logger.js";
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
import { getReviewBlockersFromParams, reviewAssembledPaper, reviewGeneratedPaper, type PaperReviewIssue } from "../lib/paper-review.js";
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
const MAX_PAPER_REVIEW_REPAIR_ATTEMPTS = 2;
const BANK_CANDIDATE_OVERFETCH_FACTOR = 2;

// 修复轮把「上一轮为什么被 blocker 拦下」翻译成模型能执行的指令。
// 关键：格式类缺陷（options 拼成一行/字面量 \n）只重跑同一条 prompt 会复现，
// 必须显式告诉模型该怎么写。schema 层已做归一化兜底，这里是第二道保险。
export function repairInstructionsFor(blockers: PaperReviewIssue[]): string[] {
  const codes = new Set(blockers.map((blocker) => blocker.code));
  const instructions: string[] = [];
  if (codes.has("CHOICE_OPTION_COUNT") || codes.has("CHOICE_OPTIONS_MISSING")) {
    instructions.push(
      'options 必须是 JSON 数组且恰好 4 个字符串元素，例如 ["选项一","选项二","选项三","选项四"]；禁止把 4 个选项拼成一个字符串，禁止用字面量 \\n 或 LaTeX 间距分隔选项。',
    );
    instructions.push("题干 stemMd 只写题目本身，不要把选项抄进题干；选项只出现在 options 字段。");
  }
  if (codes.has("EMPTY_ANSWER")) instructions.push("每道题必须有非空的 answerMd。");
  if (codes.has("MISSING_SOLUTION")) instructions.push("每道题必须有非空的 solutionMd；解答题要分步书写。");
  if (codes.has("SHORT_SOLUTION")) {
    instructions.push(
      "解答题的 solutionMd 必须写出完整解题步骤：至少 4 步（设未知数/列式或作辅助线 → 推导 → 求解 → 检验作答），不少于 150 字，最后给明确结论；不能只写答案或一句话。",
    );
    instructions.push("解答题的 rubricMd 要按分值写出评分点，各评分点分值之和等于该题 points。");
  }
  if (codes.has("TYPE_MISMATCH")) instructions.push("每道题的 type 必须与本次请求的题型完全一致，不要混入其它题型。");
  if (codes.has("FILL_HAS_OPTIONS")) instructions.push("填空题不要输出 options 字段。");
  if (codes.has("FORBIDDEN_PHRASE")) instructions.push("不得出现押题/必考/提分/保过等禁用措辞，不得制造焦虑。");
  if (instructions.length === 0) {
    instructions.push("严格按 JSON schema 与题型要求重新生成，并避免与已有题目重复。");
  }
  return instructions;
}

// ── 浙江卷配图：出卷后 best-effort 补几何/函数图 ───────────────────────────
//
// 独立 AI 调用（task=PAPER_FIGURE_GEN）：只输入题干、只返回图形 DSL。
// 这样配图失败不会破坏主出卷（最多该题没有图，审题 warning 会保留）。
//
// 候选筛选策略：强信号（题干明确提到图/坐标/抛物线等）优先，其次是几何/函数类题干；
// 命中候选后仍由模型判断 `figure:null`（不需要图就跳过），避免给纯代数题硬配图。
const FIGURE_STRONG_RE =
  /如图|见图|图中|抛物[线物]|双曲线|坐标系|坐标轴|图[像象]|交点|折线|扇形统计|条形统计/;
const FIGURE_MEDIUM_RE =
  /△|Rt△|一次函数|二次函数|反比例函数|函数|三角形|四边形|矩形|正方形|平行四边形|菱形|梯形|圆|折叠|旋转|轴对称|中心对称|相似|全等|勾股|角平分线|垂直平分线|切线|弦|弧|扇形|平均数|中位数|众数|概率|统计/;
const FIGURE_GENERATION_LIMIT = 8;
const FIGURE_GENERATION_CONCURRENCY = 3;

export async function generatePaperFigures(args: {
  db: PrismaClient;
  userId: string;
  paperId: string;
  gradeLevel: string;
  limit?: number;
}): Promise<Record<string, FigureSpec>> {
  const items = await args.db.paperItem.findMany({
    where: { paperId: args.paperId },
    select: { position: true, stemMd: true, type: true },
    orderBy: { position: "asc" },
  });
  const ranked = items
    .map((item) => ({
      item,
      score: FIGURE_STRONG_RE.test(item.stemMd) ? 0 : FIGURE_MEDIUM_RE.test(item.stemMd) ? 1 : -1,
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.item.position - b.item.position)
    .map((entry) => entry.item);
  const targets = ranked.slice(0, args.limit ?? FIGURE_GENERATION_LIMIT);
  logger.info({
    event: "paper_figure_targets",
    paperId: args.paperId,
    candidates: ranked.length,
    selected: targets.length,
  });
  if (targets.length === 0) return {};

  const ai = getAiRouter(args.userId);
  const figures: Record<string, FigureSpec> = {};

  // 第一优先级：本地确定性推导（不花 AI 调用、图像更准）——
  // 先试函数图象（题干有显式解析式），再试几何示意图（能从文字认出顶点）。
  const aiTargets = targets.filter((item) => {
    const derived = deriveFunctionFigure(item.stemMd) ?? deriveGeometryFigure(item.stemMd);
    if (derived) {
      figures[String(item.position)] = derived;
      return false;
    }
    return true;
  });

  for (let i = 0; i < aiTargets.length; i += FIGURE_GENERATION_CONCURRENCY) {
    const batch = aiTargets.slice(i, i + FIGURE_GENERATION_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const out = await ai.generateFigure({
          stemMd: item.stemMd,
          gradeLevel: args.gradeLevel,
          questionType: item.type,
        });
        return { position: item.position, figure: out.figure };
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        const figure = result.value.figure;
        // 过滤「无效图」：只有 2 个点的散图、或没有任何线段/圆/曲线的空图，不如不放。
        if (figure && isUsefulFigure(figure)) {
          figures[String(result.value.position)] = figure;
        }
      } else {
        logger.warn({
          event: "paper_figure_generation_failed",
          paperId: args.paperId,
          error: String(result.reason).slice(0, 200),
        });
      }
    }
  }
  return figures;
}

/** 图形是否值得展示（避免模型输出"两个点"或空图，反而让卷面更差）。 */
function isUsefulFigure(figure: FigureSpec): boolean {
  if (figure.kind === "GEOMETRY") {
    const hasLines = figure.segments.length > 0;
    const hasCircle = figure.circles.length > 0;
    return figure.points.length >= 3 || hasCircle || (hasLines && figure.points.length >= 2);
  }
  return figure.curves.length > 0 || figure.points.length >= 2;
}

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
      let promptVersion: "v1" | "v2" | "v4" | "v5" | "v6" = "v1";

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
        // v4：在 v2（格式稳定）基础上只加「内容质量硬性要求」：
        // 解答题分步解析≥150 字、评分标准按分值拆点、选择题 4 个互异选项、
        // 题干不依赖插图、公式用简单 KaTeX。格式段保持 v2 原样——历史教训：
        // 在 prompt 里给 options JSON 数组示例会把 qwen-max 逼出非法 JSON（PARSE_FAILED 500），
        // 格式问题继续由 coerceOptionArray 多格式归一化兜底。
        // v6 = v5 内容（prompt 文件统一规范成 LF 后重新注册，指纹才稳定；
        // .gitattributes 固定 prompts 目录 LF，见 2026-10-27 的 CRLF 指纹事故）。
        promptVersion = "v6";
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
      const spareBank: Awaited<ReturnType<typeof selectBankQuestions>> = [];
      let dedupDroppedCount = 0;
      const excludeStems: string[] = [];
      const bankHitsBySection = await Promise.all(
        effSections.map((s) => selectBankQuestions(ctx.db, {
          subjectId: input.subjectId,
          kpIds: input.kpIds,
          questionTypes: [s.type],
          difficultyRange: effDifficulty,
          limit: s.count * BANK_CANDIDATE_OVERFETCH_FACTOR,
        })),
      );
      for (let i = 0; i < effSections.length; i++) {
        const s = effSections[i]!;
        const hit = bankHitsBySection[i] ?? [];
        for (const item of hit) {
          excludeStems.push(item.stemMd);
          if (deduper.accept(item.stemMd)) {
            if (bank.filter((x) => x.type === s.type).length < (desiredByType.get(s.type) ?? 0)) {
              bank.push(item);
            } else {
              spareBank.push(item);
            }
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
        let aiResults: Array<PaperGenerationOutput & { modelCallId: string }>;
        try {
          aiResults = await Promise.all(
            aiSections.map((section) =>
              getAiRouter(ctx.auth.userId, { promptVersion }).generatePaper({
                subject: "数学",
                gradeLevel: input.gradeLevel,
                kpNames,
                sections: [section],
                difficultyRange: effDifficulty,
                textbookVersion: input.textbookVersion,
                excludeStems,
                ...(styleRules ? { styleRules } : {}),
                ...(slotHints ? { slotHints: slotHints.filter((hint) => hint.type === section.type) } : {}),
              }),
            ),
          );
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
        for (const ai of aiResults) {
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
        }
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
        const buildBankAssignable = (b: (typeof bank)[number]): AssignableItem => ({
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
        });
        const buildAiAssignable = (a: PaperGenerationOutput["items"][number]): AssignableItem => ({
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
        });
        const reviewCandidate = (items: AssignableItem[]) => {
          const pairs = assignItemsToSlots(blueprint!, items).map((pair) => {
            if (pair.slot.questionType === "FILL_BLANK" && pair.item.options && pair.item.options.length > 0) {
              return { ...pair, item: { ...pair.item, options: undefined } };
            }
            return pair;
          });
          const issues = reviewAssembledPaper(
            pairs.map(({ slot, item }) => ({
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
          return { pairs, issues, blockers: issues.filter((x) => x.severity === "BLOCKER") };
        };

        const merged: AssignableItem[] = [
          ...bank.map(buildBankAssignable),
          ...aiItems.map(buildAiAssignable),
        ];
        let reviewed = reviewCandidate(merged);
        assignedPairs = reviewed.pairs;
        reviewIssues = reviewed.issues;
        let blockers = reviewed.blockers;

        for (let repairAttempt = 0; blockers.length > 0 && repairAttempt < MAX_PAPER_REVIEW_REPAIR_ATTEMPTS; repairAttempt++) {
          const blockedQuestionNos = new Set(blockers.map((issue) => issue.slotQuestionNo));
          const blockedPairs = assignedPairs.filter((pair) => blockedQuestionNos.has(pair.slot.questionNo));

          const bankRepairedPairs = assignedPairs.map((pair) => {
            if (!blockedQuestionNos.has(pair.slot.questionNo)) return pair;
            const spareIndex = spareBank.findIndex((item) => item.type === pair.slot.questionType && item.answerMd.trim().length > 0);
            if (spareIndex < 0) return pair;
            const [replacement] = spareBank.splice(spareIndex, 1);
            return replacement ? { ...pair, item: buildBankAssignable(replacement) } : pair;
          });
          reviewed = reviewCandidate(bankRepairedPairs.map((pair) => pair.item));
          assignedPairs = reviewed.pairs;
          reviewIssues = reviewed.issues;
          blockers = reviewed.blockers;
          if (blockers.length === 0) break;

          const remainingBlockedQuestionNos = new Set(blockers.map((issue) => issue.slotQuestionNo));
          const remainingBlockedPairs = assignedPairs.filter((pair) => remainingBlockedQuestionNos.has(pair.slot.questionNo));
          for (const pair of assignedPairs) excludeStems.push(pair.item.stemMd);
          const repairDeduper = createPaperStemDeduper(excludeStems);
          const repairSelected: PaperGenerationOutput["items"] = [];
          const repairSelectedCount = (type: QuestionType) => repairSelected.filter((item) => item.type === type).length;
          const repairSections = Array.from(
            remainingBlockedPairs.reduce((acc, pair) => {
              const type = pair.slot.questionType as QuestionType;
              acc.set(type, (acc.get(type) ?? 0) + 1);
              return acc;
            }, new Map<QuestionType, number>()),
            ([type, count]) => ({ type, count }),
          );
          if (repairSections.length === 0) continue;
          const repairAi = await getAiRouter(ctx.auth.userId, { promptVersion }).generatePaper({
            subject: "数学",
            gradeLevel: input.gradeLevel,
            kpNames,
            sections: repairSections,
            difficultyRange: effDifficulty,
            textbookVersion: input.textbookVersion,
            excludeStems,
            qualityInstructions: repairInstructionsFor(blockers),
            ...(styleRules ? { styleRules } : {}),
            slotHints: remainingBlockedPairs.map((pair) => ({
              type: pair.slot.questionType as QuestionType,
              intent: pair.slot.intent,
              constraints: pair.slot.constraints,
            })),
          });
          modelCallIds.push(repairAi.modelCallId);
          for (const item of repairAi.items) {
            excludeStems.push(item.stemMd);
            if (!repairDeduper.accept(item.stemMd)) {
              dedupDroppedCount++;
              continue;
            }
            const target = desiredByType.get(item.type) ?? 0;
            if (repairSelectedCount(item.type) < target) {
              repairSelected.push(item);
            } else {
              dedupDroppedCount++;
            }
          }
          if (repairSections.some((section) => repairSelectedCount(section.type) < section.count)) {
            continue;
          }
          const replacementsByType = new Map<QuestionTypeValue, AssignableItem[]>();
          for (const item of repairSelected.map(buildAiAssignable)) {
            const list = replacementsByType.get(item.type) ?? [];
            list.push(item);
            replacementsByType.set(item.type, list);
          }
          assignedPairs = assignedPairs.map((pair) => {
            if (!remainingBlockedQuestionNos.has(pair.slot.questionNo)) return pair;
            const list = replacementsByType.get(pair.slot.questionType) ?? [];
            const replacement = list.shift();
            return replacement ? { ...pair, item: replacement } : pair;
          });
          reviewed = reviewCandidate(assignedPairs.map((pair) => pair.item));
          assignedPairs = reviewed.pairs;
          reviewIssues = reviewed.issues;
          blockers = reviewed.blockers;
        }

        if (blockers.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "自动审题未通过，未生成可用试卷。请调整知识点或稍后重试。",
            cause: { reason: "PAPER_REVIEW_BLOCKED", blockers: blockers.map((b) => b.code) },
          });
        }
      }

      // 通用出卷（无 blueprint/slot）：仍跑一遍与题位无关的结构审题闸门。
      // BLOCKER 会让本次生成失败并走既有扣费补偿；WARNING 落 paramsJson 供预览页提示。
      if (!blueprint) {
        const normalizedBank = bank.map((b) => ({ ...b, points: pointsByType.get(b.type) ?? 5 }));
        const normalizedAi = aiItems.map((a) => ({ ...a, points: pointsByType.get(a.type) ?? a.points }));
        const deduped = uniquePaperItems({ bankItems: normalizedBank, aiItems: normalizedAi });
        const asOptions = (value: unknown): string[] | undefined =>
          Array.isArray(value) ? value.map((option) => String(option)) : undefined;
        const reviewItems = [
          ...deduped.bankItems.map((b, index) => ({
            questionNo: index + 1,
            source: "BANK" as const,
            stemMd: b.stemMd,
            type: b.type,
            options: asOptions(b.optionsJson),
            answerMd: b.answerMd,
            solutionMd: b.solutionMd,
            rubricMd: b.rubricMd ?? undefined,
            difficulty: b.difficulty,
            points: b.points,
          })),
          ...deduped.aiItems.map((a, index) => ({
            questionNo: deduped.bankItems.length + index + 1,
            source: "AI" as const,
            stemMd: a.stemMd,
            type: a.type,
            options: a.options,
            answerMd: a.answerMd,
            solutionMd: a.solutionMd,
            rubricMd: a.rubricMd,
            difficulty: a.difficulty,
            points: a.points,
          })),
        ];
        reviewIssues = reviewGeneratedPaper(reviewItems);
        const genericBlockers = reviewIssues.filter((issue) => issue.severity === "BLOCKER");
        if (genericBlockers.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "自动审题未通过，未生成可用试卷。请调整知识点或稍后重试。",
            cause: { reason: "PAPER_REVIEW_BLOCKED", blockers: genericBlockers.map((b) => b.code) },
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

      const paramsJson = {
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
        reviewBlockers: reviewIssues.filter((x) => x.severity === "BLOCKER"),
      } as unknown as Prisma.InputJsonValue;

      const paper = await persistGeneratedPaper(ctx.db, {
        teacherUserId: ctx.auth.userId,
        subjectId: input.subjectId,
        title: blueprint
          ? blueprint.isTopical
            ? "九年级数学专题练习卷"
            : "九年级数学中考风格练习卷"
          : title,
        paramsJson,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId,
        bankItems: zhongkaoItems ? [] : bank.map((b) => ({ ...b, points: pointsByType.get(b.type) ?? 5 })),
        aiItems: zhongkaoItems ?? aiItems.map((a) => ({ ...a, points: pointsByType.get(a.type) ?? a.points })),
      });
      if (blueprint) {
        await ctx.db.paper.update({
          where: { id: paper.id },
          data: { status: "READY" },
        });
      }

      // 浙江卷配图：主出卷成功后 best-effort 补图（失败不影响出卷，最多拖慢几十秒）。
      // 图描述存 paramsJson.figures（按 item.position），打印/预览按题号取用；
      // 补图成功后顺手清掉对应题的「依赖插图」warning。
      const figures = await (async () => {
        try {
          return await generatePaperFigures({
            db: ctx.db,
            userId: ctx.auth.userId,
            paperId: paper.id,
            gradeLevel: input.gradeLevel,
          });
        } catch (error) {
          // 补图是增强能力：任何异常都不能让已落库的试卷变成失败。
          logger.warn({
            event: "paper_figure_generation_skipped",
            paperId: paper.id,
            error: String(error).slice(0, 300),
          });
          return {} as Record<string, FigureSpec>;
        }
      })();
      if (Object.keys(figures).length > 0) {
        const merged: Record<string, unknown> = {
          ...(paramsJson as unknown as Record<string, unknown>),
          figures,
          reviewWarnings: reviewIssues
            .filter((issue) => issue.severity === "WARNING")
            .filter((issue) => !(issue.code === "FIGURE_DEPENDENT" && figures[String(issue.slotQuestionNo)])),
        };
        await ctx.db.paper.update({
          where: { id: paper.id },
          data: { paramsJson: merged as unknown as Prisma.InputJsonValue },
        });
      }
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
      const blockers = getReviewBlockersFromParams(ctx.paper.paramsJson);
      if (blockers.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "自动审题未通过的草稿不能确认完成，请先修正或重新生成。",
          cause: { reason: "PAPER_REVIEW_BLOCKED", blockers: blockers.map((b) => b.code) },
        });
      }
      if (ctx.paper.items.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "空试卷不能确认完成。",
          cause: { reason: "PAPER_EMPTY" },
        });
      }
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
