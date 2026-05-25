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
