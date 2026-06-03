import { z } from "zod";

// TUTOR_TURN 的输入与输出契约
export const TutoringInputSchema = z.object({
  questionStem: z.string().min(1).max(4000),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).optional(),
});
export type TutoringInput = z.infer<typeof TutoringInputSchema>;

// 与 spec §1（产品定位）的「题意 → 关键 KP → 分步思路 → 易错点 → 完整答案」一致
export const TutoringOutputSchema = z.object({
  restatement: z.string().min(1, "题意重述不能为空"),
  knowledgePoints: z.array(z.string()).min(1, "至少标注一个关键知识点"),
  steps: z.array(z.string()).min(1, "至少给出一步思路"),
  pitfalls: z.array(z.string()).default([]),
  finalAnswer: z.string().min(1, "最终答案不能为空"),
});
export type TutoringOutput = z.infer<typeof TutoringOutputSchema>;

// 图片/OCR 拍照答疑（image tutor）— 单次多模态：转写 + 讲解一次出
export const TutoringImageInputSchema = z.object({
  imageDataUrl: z.string().min(1),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).optional(),
});
export type TutoringImageInput = z.infer<typeof TutoringImageInputSchema>;

export const TutoringImageOutputSchema = TutoringOutputSchema.extend({
  stemTranscript: z.string().min(1, "题面转写不能为空").max(4000),
});
export type TutoringImageOutput = z.infer<typeof TutoringImageOutputSchema>;

// === ErrorAnalysis (error.diagnose) — Plan 4 ===

// 与 ErrorBookEntry.rootCause Prisma enum 一一对应（packages/db/prisma/schema.prisma）
export const ErrorRootCauseEnum = z.enum([
  "CONCEPT_CONFUSION",
  "READING_ERROR",
  "FORMULA_MISUSE",
  "CALCULATION_SLIP",
  "TRANSFER_GAP",
  "OTHER",
]);
export type ErrorRootCauseValue = z.infer<typeof ErrorRootCauseEnum>;

export const ErrorAnalysisInputSchema = z.object({
  stemMd: z.string().min(1).max(4000),
  correctAnswerMd: z.string().min(1).max(4000).nullable(),
  actualAnswerMd: z.string().min(1).max(4000).nullable(),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).nullable(),
});
export type ErrorAnalysisInput = z.infer<typeof ErrorAnalysisInputSchema>;

export const ErrorAnalysisOutputSchema = z.object({
  rootCause: ErrorRootCauseEnum,
  reasoning: z.string().min(1).max(2000),
  suggestedKnowledgePoints: z.array(z.string().min(1).max(200)).max(10).default([]),
});
export type ErrorAnalysisOutput = z.infer<typeof ErrorAnalysisOutputSchema>;

// === VariantGeneration (variant.generateForEntry) — Plan 4 ===

export const VariantLevelEnum = z.enum(["L1", "L2", "L3"]);
export type VariantLevelValue = z.infer<typeof VariantLevelEnum>;

export const VariantAnchorKpSchema = z.object({
  id: z.string(),
  name: z.string(),
  difficulty: z.number().int().min(1).max(5),
});
export type VariantAnchorKp = z.infer<typeof VariantAnchorKpSchema>;

export const VariantGenerationInputSchema = z.object({
  anchorStemMd: z.string().min(1).max(4000),
  anchorRootCause: ErrorRootCauseEnum,
  anchorKps: z.array(VariantAnchorKpSchema).min(1),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).nullable(),
});
export type VariantGenerationInput = z.infer<typeof VariantGenerationInputSchema>;

export const VariantItemSchema = z.object({
  level: VariantLevelEnum,
  stemMd: z.string().min(1).max(4000),
  solutionMd: z.string().min(1).max(4000),
  knowledgePointHints: z.array(z.string().min(1).max(200)).max(10).default([]),
});
export type VariantItemValue = z.infer<typeof VariantItemSchema>;

export const VariantGenerationOutputSchema = z.object({
  // 必须恰好 3 道，分别 L1 / L2 / L3 各一道
  items: z.array(VariantItemSchema)
    .length(3, "必须生成 3 道变式（L1/L2/L3 各一）")
    .refine(
      (arr) => {
        const levels = arr.map((it) => it.level).sort();
        return levels[0] === "L1" && levels[1] === "L2" && levels[2] === "L3";
      },
      "items 的 level 必须为 {L1, L2, L3} 各一",
    ),
});
export type VariantGenerationOutput = z.infer<typeof VariantGenerationOutputSchema>;

// === KpReconciliation (Plan 9) ===

export const KpReconciliationCandidateSchema = z.object({
  id: z.string().cuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  parentPath: z.string(),
});
export type KpReconciliationCandidate = z.infer<typeof KpReconciliationCandidateSchema>;

export const KpReconciliationHintSchema = z.object({
  matchId: z.string().cuid(),
  rawHint: z.string().min(1).max(2000),
  normalizedHint: z.string().min(1).max(2000),
});
export type KpReconciliationHint = z.infer<typeof KpReconciliationHintSchema>;

export const KpReconciliationInputSchema = z.object({
  subjectId: z.string().cuid(),
  candidates: z.array(KpReconciliationCandidateSchema).min(1),
  hints: z.array(KpReconciliationHintSchema).min(1).max(50),
});
export type KpReconciliationInput = z.infer<typeof KpReconciliationInputSchema>;

// LLM output: 一项对一条 hint（按 matchId 对齐，多/漏在 router 层 retry）
export const KpReconciliationItemSchema = z.object({
  matchId: z.string().cuid(),
  kpId: z.string().cuid().nullable(),          // null = NO_MATCH
  confidence: z.number().min(0).max(1),         // NO_MATCH 时也要给 0
});
export type KpReconciliationItem = z.infer<typeof KpReconciliationItemSchema>;

export const KpReconciliationOutputSchema = z.array(KpReconciliationItemSchema);
export type KpReconciliationOutput = z.infer<typeof KpReconciliationOutputSchema>;

// === AssignmentQuestionGeneration (Plan 10) ===

export const AssignmentTierLevelSchema = z.enum([
  "BASIC",
  "CONSOLIDATION",
  "CHALLENGE",
]);
export type AssignmentTierLevel = z.infer<typeof AssignmentTierLevelSchema>;

export const AssignmentQuestionTypeSchema = z.enum([
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "FILL_BLANK",
  "CALCULATION",
  "PROOF",
  "ESSAY",
]);
export type AssignmentQuestionType = z.infer<
  typeof AssignmentQuestionTypeSchema
>;

export const AssignmentQuestionGenerationInputSchema = z.object({
  mode: z.enum(["CLASS_WEAKNESS", "MANUAL_CRITERIA"]),
  subject: z.string().min(1),
  gradeLevel: z.string().min(1),
  tierCounts: z.object({
    BASIC: z.number().int().min(0).max(10),
    CONSOLIDATION: z.number().int().min(0).max(10),
    CHALLENGE: z.number().int().min(0).max(10),
  }),
  questionTypes: z.array(AssignmentQuestionTypeSchema).min(1),
  kpNames: z.array(z.string().min(1)).min(1),
  difficultyRange: z.tuple([
    z.number().int().min(1).max(5),
    z.number().int().min(1).max(5),
  ]),
  teachingGoalMd: z.string().max(2000).optional(),
  classWeaknessSummaryMd: z.string().max(4000).optional(),
});
export type AssignmentQuestionGenerationInput = z.infer<
  typeof AssignmentQuestionGenerationInputSchema
>;

export const AssignmentQuestionGenerationItemSchema = z.object({
  type: AssignmentQuestionTypeSchema,
  stemMd: z.string().min(1).max(4000),
  options: z
    .array(
      z.object({
        key: z.string().min(1).max(4),
        text: z.string().min(1),
      }),
    )
    .optional(),
  answerMd: z.string().min(1).max(4000),
  solutionMd: z.string().min(1).max(6000),
  rubricMd: z.string().max(4000).optional(),
  knowledgePointHints: z.array(z.string().min(1)).max(8),
  difficulty: z.number().int().min(1).max(5),
});
export type AssignmentQuestionGenerationItem = z.infer<
  typeof AssignmentQuestionGenerationItemSchema
>;

export const AssignmentQuestionGenerationOutputSchema = z.object({
  title: z.string().min(1).max(120),
  tiers: z
    .array(
      z.object({
        level: AssignmentTierLevelSchema,
        rationaleMd: z.string().min(1).max(2000),
        items: z.array(AssignmentQuestionGenerationItemSchema).max(10),
      }),
    )
    .min(1)
    .max(3),
});
export type AssignmentQuestionGenerationOutput = z.infer<
  typeof AssignmentQuestionGenerationOutputSchema
>;

// Plan 11: LEARNING_ADVICE 的输入与输出契约
export const LearningAdviceInputSchema = z.object({
  studentGrade: z.string().optional(),
  focusAreas: z
    .array(z.object({ kpName: z.string(), score: z.number().nullable() }))
    .max(10),
  strengths: z.array(z.string()).max(10),
});
export type LearningAdviceInput = z.infer<typeof LearningAdviceInputSchema>;

export const LearningAdviceOutputSchema = z.object({
  summaryMd: z.string(),
  suggestions: z
    .array(z.object({ focusKp: z.string(), methodMd: z.string() }))
    .min(1)
    .max(5),
  encouragementMd: z.string(),
});
export type LearningAdviceOutput = z.infer<typeof LearningAdviceOutputSchema>;
