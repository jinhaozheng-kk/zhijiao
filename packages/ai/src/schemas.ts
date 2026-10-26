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

// === PaperGeneration (Plan 17) ===
export const PaperItemTypeEnum = z.enum(["SINGLE_CHOICE","MULTI_CHOICE","FILL_BLANK","CALCULATION","PROOF","ESSAY"]);
export const CognitiveLevelEnum = z.enum(["REMEMBER","UNDERSTAND","APPLY","ANALYZE"]);

export const PaperGenSectionSchema = z.object({
  type: PaperItemTypeEnum,
  count: z.number().int().min(1).max(30),
});
export const PaperGenSlotHintSchema = z.object({
  type: PaperItemTypeEnum,
  intent: z.string(),
  constraints: z.array(z.string()).default([]),
});
export const PaperGenerationInputSchema = z.object({
  subject: z.string(),
  gradeLevel: z.string(),
  kpNames: z.array(z.string()).min(1),
  sections: z.array(PaperGenSectionSchema).min(1),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  textbookVersion: z.string().optional(),
  excludeStems: z.array(z.string()).default([]),
  styleRules: z.array(z.string()).optional(),
  slotHints: z.array(PaperGenSlotHintSchema).optional(),
  /**
   * 修复轮追加的针对性指令（例如「options 必须是 4 项 JSON 数组、题干不要抄选项」）。
   * 只在重生成已有 blocker 的题位时传入，正常首轮生成不传。
   */
  qualityInstructions: z.array(z.string()).optional(),
});
export type PaperGenerationInput = z.infer<typeof PaperGenerationInputSchema>;

// 真实 LLM 常把数组字段吐成字符串（如 knowledgePointHints:"一次函数" 或
// options:"A. x\nB. y\n..."）。落库前容错转数组；mock/合规数组输入是 no-op。
export function coerceStringArray(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return v;
  return v.split(/\r?\n|[、，,;；/]+/).map((s) => s.trim()).filter(Boolean);
}

// 选项分隔符：换行，或 LaTeX 行间距（`\[10pt]` / `\\[1ex]` / `\[0.5em]` 等，
// 真实 qwen-max 常用它分隔选项；单位不只 pt，ex/em/cm/mm 都出现过）。
const LATEX_SPACING = /\\{1,2}\s*\[[\d.]+\s*(?:pt|ex|em|cm|mm)\]/gi;
const OPTION_SEPARATOR = new RegExp(`\\r?\\n|${LATEX_SPACING.source}`, "i");

// 模型还会用 HTML 标签分隔选项（实测 `A. 2千克<br>B. 4千克<br>...`），
// 以及 HTML 转义写法 `&lt;br&gt;`。
const HTML_BREAK_RE = /<\s*br\s*\/?\s*>|<\s*\/?\s*(?:p|li|div)\s*>|&lt;\s*br\s*\/?\s*&gt;/gi;

// 真实 qwen-max 还会把 4 个选项写成一整行字符串
//（如 "A. 5个 B. 6个 C. 7个 D. 8个" / "（A）5个（B）6个（C）7个（D）8个"），
// 只按换行/LaTeX 间距切会得到 1 项，导致选择题丢选项、打印成一行。
// 这里按「行内 A./B./C./D. 标记」补切，并要求字母严格按 A→B→C→D 递增，
// 避免把普通题干文本里孤立的 "B." 误判成选项分隔。
function splitInlineOptions(raw: string): string[] {
  const markerRe = /(?:^|[\s；;（(])([A-D])\s*[.、．)）]/gu;
  const hits: Array<{ index: number; letter: string }> = [];
  for (const match of raw.matchAll(markerRe)) {
    const letter = match[1]!;
    hits.push({ letter, index: match.index! + match[0].indexOf(letter) });
  }
  if (hits.length < 2) return [raw];
  const letters = hits.map((hit) => hit.letter).join("");
  if (letters !== "ABCD".slice(0, hits.length)) return [raw];
  return hits
    .map((hit, i) => {
      const end = i + 1 < hits.length ? hits[i + 1]!.index : raw.length;
      // 去掉分隔符残留（如「…；B.」里的分号、「…（B）」里的左括号）。
      return raw.slice(hit.index, end).replace(/[；;，,、\s（(]+$/u, "").trim();
    })
    .filter(Boolean);
}

// 兜底：完全没有分隔符时（"A. 2千克B. 4千克C. 5千克D. 10千克"），
// 按 A→B→C→D 四个标记的严格顺序切；凑不齐 4 个就放弃（避免误切普通文本）。
function splitByOptionMarkersStrict(raw: string): string[] | null {
  const markerRe = /([A-D])\s*[.、．)）]/gu;
  const wanted = ["A", "B", "C", "D"];
  const chosen: Array<{ index: number }> = [];
  let cursor = 0;
  for (const match of raw.matchAll(markerRe)) {
    if (match[1] !== wanted[cursor]) continue;
    chosen.push({ index: match.index! });
    cursor += 1;
    if (cursor === wanted.length) break;
  }
  if (chosen.length !== wanted.length) return null;
  return chosen
    .map((hit, i) => {
      const end = i + 1 < chosen.length ? chosen[i + 1]!.index : raw.length;
      return raw.slice(hit.index, end).trim();
    })
    .filter(Boolean);
}

// 模型还会把 JSON 数组二次编码成字符串：options = "[\"A. x\",\"B. y\",...]"
function tryParseJsonArrayString(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.map((item) => String(item));
  } catch {
    // 非法 JSON 字符串 → 交给分隔符切分兜底
  }
  return null;
}

function stripOptionPrefix(option: unknown): string {
  return String(option)
    .trim()
    // 剥掉「A. / (A) / A、」式选项前缀（避免 UI 再加字母时重复）。
    .replace(/^[（(]?\s*[A-Da-d]\s*[)）.、．:：]\s*/, "")
    // 清掉残留的 LaTeX 行间距（分隔符被切走后可能粘在选项尾部）。
    .replace(LATEX_SPACING, "")
    .trim();
}

// 真实模型偶尔把换行「二次转义」：字符串里出现的是字面量 `\n` / `\\n` / `\r\n`
//（反斜杠 + n，甚至双反斜杠 + n，都不是真正的换行符）。这在 options 上会让 4 个
// 选项粘成 1 个（中考蓝图审题直接判 CHOICE_OPTION_COUNT BLOCKER，整卷失败），在
// 题干上会让尾部重复抄写的选项块剥不干净。两道规则：
//  1) 紧跟选项标记（`\nB.` / `\nC、` / `\n（D）`）的，一定是分隔符；
//  2) 其它位置只有后面不是 ASCII 字母时才还原，保护 LaTeX 命令
//     （`\neq` / `\nabla` / `\not` 等）。
// `\\{1,2}` 同时覆盖单/双反斜杠两种写法。
function normalizeAiText(text: string): string {
  return text
    .replace(/\\{1,2}(?:r\\{1,2})?n(?=\s*[（(]?\s*[A-D]\s*[.、．)）])/g, "\n")
    .replace(/\\{1,2}(?:r\\{1,2})?n(?![a-zA-Z])/g, "\n")
    .replace(HTML_BREAK_RE, "\n");
}

// 文本字段清理：去掉残留的 LaTeX 行间距命令（`\[1ex]` / `\[10pt]` 等）。
// 注意必须在选项切分之后调用，否则分隔符会被提前抹掉导致选项粘成一项。
function stripLatexSpacing(text: string): string {
  return text.replace(LATEX_SPACING, "").trim();
}

// 模型常在 stemMd 末尾把选项也抄了一遍（"...多少元？\nA. 5\nB. 8..."），
// 与独立 options 字段重复渲染。这里按 options 内容把尾部重复块剥掉。
function stripTrailingOptionBlock(stemMd: string, options: string[] | undefined): string {
  if (!options?.length) return stemMd;
  const known = new Set(options.map((option) => normalizeAiText(String(option)).trim()));
  const lines = normalizeAiText(stemMd).split("\n");
  while (lines.length > 1) {
    const bare = stripOptionPrefix(lines[lines.length - 1]!);
    if (!known.has(bare)) break;
    lines.pop();
  }
  return lines.join("\n").trim();
}

function splitOptionString(raw: string): string[] {
  const normalized = normalizeAiText(raw);
  const fromJson = tryParseJsonArrayString(normalized);
  if (fromJson) {
    return fromJson.flatMap((item) => {
      const normalizedItem = normalizeAiText(item);
      return normalizedItem.includes("\n") ? splitOptionString(normalizedItem) : [normalizedItem];
    });
  }
  const bySeparator = normalized.split(OPTION_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (bySeparator.length > 1) return bySeparator;
  const inline = splitInlineOptions(normalized);
  if (inline.length > 1) return inline;
  const strict = splitByOptionMarkersStrict(normalized);
  if (strict) return strict;
  return [normalized];
}

export function coerceOptionArray(v: unknown): unknown {
  if (v == null) return v;
  if (Array.isArray(v)) {
    // 单元素数组可能是「整串选项」：如 ["A. x<br>B. y<br>C. z<br>D. w"]
    const source =
      v.length === 1 && typeof v[0] === "string"
        ? splitOptionString(String(v[0]))
        : v.flatMap((option) => {
            const text = String(option);
            const normalized = normalizeAiText(text);
            return normalized.includes("\n") ? splitOptionString(normalized) : [normalized];
          });
    return source.map(stripOptionPrefix).filter(Boolean);
  }
  if (typeof v !== "string") return v;
  return splitOptionString(v).map(stripOptionPrefix).filter(Boolean);
}

export const PaperGenItemSchema = z
  .object({
    stemMd: z.string().min(1),
    type: PaperItemTypeEnum,
    options: z.preprocess(coerceOptionArray, z.array(z.string()).optional()),
    answerMd: z.string().min(1),
    solutionMd: z.string().min(1),
    rubricMd: z.string().optional(),
    difficulty: z.number().int().min(1).max(5),
    cognitiveLevel: CognitiveLevelEnum,
    points: z.number().int().min(1).max(100),
    knowledgePointHints: z.preprocess(coerceStringArray, z.array(z.string()).default([])),
  })
  .transform((item) => ({
    ...item,
    // 统一把「字面量 \n」还原成真换行，并去掉题干尾部重复的选项块 / 残留间距命令。
    stemMd: stripLatexSpacing(stripTrailingOptionBlock(item.stemMd, item.options)),
    answerMd: stripLatexSpacing(normalizeAiText(item.answerMd)),
    solutionMd: stripLatexSpacing(normalizeAiText(item.solutionMd)),
    ...(item.rubricMd === undefined
      ? {}
      : { rubricMd: stripLatexSpacing(normalizeAiText(item.rubricMd)) }),
  }));
export const PaperGenerationOutputSchema = z.object({
  title: z.string().min(1),
  items: z.array(PaperGenItemSchema).min(1),
});
export type PaperGenerationOutput = z.infer<typeof PaperGenerationOutputSchema>;

// === 试卷配图（几何/坐标系图形 DSL）— 浙江卷真题普遍带图 ===
//
// 不让模型直接输出 SVG（不可校验、存在注入风险），而让它输出**受约束的图形描述**，
// 由前端确定性渲染成 SVG：
// - GEOMETRY：平面几何示意图，坐标统一在 0–100 画布（y 向下），点名与题干一致；
// - COORDINATE：平面直角坐标系，points 用数据坐标，axes 给出取值范围。
// 渲染器（apps/web/components/paper-figure.tsx）只做纯几何绘制，不解析任何文本指令。

const FigureCoordSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const FigurePointIdSchema = z
  .string()
  .min(1)
  .max(6)
  .regex(/^[A-Za-z][A-Za-z0-9'′]{0,5}$/u, "点必须用字母命名，如 A / B1 / A'");

export const FigurePointSchema = z.object({
  id: FigurePointIdSchema,
  x: FigureCoordSchema,
  y: FigureCoordSchema,
});
export const FigureSegmentSchema = z.object({
  from: FigurePointIdSchema,
  to: FigurePointIdSchema,
  dashed: z.boolean().optional(),
});
export const FigureCircleSchema = z.object({
  /** 圆心：GEOMETRY 用 0–100 画布坐标；COORDINATE 用数据坐标。 */
  cx: FigureCoordSchema,
  cy: FigureCoordSchema,
  r: z.number().finite().positive().max(1_000_000),
  dashed: z.boolean().optional(),
});
export const FigureLabelSchema = z.object({
  text: z.string().min(1).max(16),
  x: FigureCoordSchema,
  y: FigureCoordSchema,
});

// 函数图象：只接受受限表达式（数字 / x / + - * / ^ / 括号 / sqrt / abs），
// 由前端自研解析器**安全求值**后取样成折线，绝不 eval 任意字符串。
// 例："y=x^2-2x+3" / "y=2x+1" / "y=1/x" / "y=-x^2+4" / "y=sqrt(x+1)"。
export const FigureCurveSchema = z.object({
  expression: z
    .string()
    .min(3)
    .max(80)
    .refine((value) => /^y\s*=/.test(value.trim()) || /[xX]/.test(value), "表达式需含 x，形如 y=2x+1"),
  dashed: z.boolean().optional(),
});

const FigureCommon = {
  points: z.array(FigurePointSchema).max(16).default([]),
  segments: z.array(FigureSegmentSchema).max(32).default([]),
  circles: z.array(FigureCircleSchema).max(6).default([]),
  labels: z.array(FigureLabelSchema).max(12).default([]),
};

export const GeometryFigureSchema = z.object({
  kind: z.literal("GEOMETRY"),
  ...FigureCommon,
  points: z.array(FigurePointSchema).min(2).max(16),
});

export const CoordinateFigureSchema = z.object({
  kind: z.literal("COORDINATE"),
  axes: z
    .object({
      xMin: z.number().finite().min(-1000).max(1000),
      xMax: z.number().finite().min(-1000).max(1000),
      yMin: z.number().finite().min(-1000).max(1000),
      yMax: z.number().finite().min(-1000).max(1000),
    })
    .refine((a) => a.xMin < a.xMax && a.yMin < a.yMax, "坐标轴范围必须 min < max"),
  ...FigureCommon,
  points: z.array(FigurePointSchema).min(1).max(16),
  /** 函数图象（抛物线/直线/双曲线等），按表达式在坐标轴范围内取样绘制。 */
  curves: z.array(FigureCurveSchema).max(4).default([]),
});

export const FigureSpecSchema = z.discriminatedUnion("kind", [
  GeometryFigureSchema,
  CoordinateFigureSchema,
]);
export type FigureSpec = z.infer<typeof FigureSpecSchema>;
export type FigurePoint = z.infer<typeof FigurePointSchema>;
export type FigureSegment = z.infer<typeof FigureSegmentSchema>;
export type FigureCircle = z.infer<typeof FigureCircleSchema>;
export type FigureLabel = z.infer<typeof FigureLabelSchema>;
export type FigureCurve = z.infer<typeof FigureCurveSchema>;

// ── 图形描述容错归一化 ───────────────────────────────────────────────────
//
// 实测 qwen-max 会偷懒给简写：`points:["A","B","C"]`、`segments:["AB","BC","CA"]`、
// `labels:["5","13"]`（甚至 points 用 {A:{x,y}} 映射）。直接 schema.parse 会全量失败，
// 所以先做一次确定性的宽松归一化：补全点坐标（自动布局）、把 "AB" 解析成 from/to、
// 给无坐标的标签找位置。仍然不合法的结构原样返回，让 Zod 报错（不静默吞掉）。
function autoLayoutPoints(ids: string[]): FigurePoint[] {
  const n = ids.length;
  if (n <= 0) return [];
  if (n === 1) return [{ id: ids[0]!, x: 50, y: 50 }];
  if (n === 2) {
    return [
      { id: ids[0]!, x: 25, y: 65 },
      { id: ids[1]!, x: 75, y: 65 },
    ];
  }
  if (n === 3) {
    return [
      { id: ids[0]!, x: 20, y: 78 },
      { id: ids[1]!, x: 80, y: 78 },
      { id: ids[2]!, x: 50, y: 18 },
    ];
  }
  if (n === 4) {
    return [
      { id: ids[0]!, x: 20, y: 22 },
      { id: ids[1]!, x: 80, y: 22 },
      { id: ids[2]!, x: 80, y: 78 },
      { id: ids[3]!, x: 20, y: 78 },
    ];
  }
  // 5 个以上：正多边形顺时针分布
  return ids.map((id, i) => {
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / n;
    return { id, x: 50 + 36 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) };
  });
}

function coercePointId(raw: unknown, index: number): string {
  const fallback = String.fromCharCode(65 + (index % 26));
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const cleaned = raw.trim().replace(/[^A-Za-z0-9'′]/g, "");
  if (/^[A-Za-z]/.test(cleaned) && cleaned.length <= 6) return cleaned;
  return fallback;
}

function normalizePoints(raw: unknown): FigurePoint[] {
  if (Array.isArray(raw)) {
    return raw.map((entry, index) => {
      if (typeof entry === "string") {
        return { id: coercePointId(entry, index), x: Number.NaN, y: Number.NaN };
      }
      if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const id = coercePointId(obj.id ?? obj.name ?? obj.label, index);
        const x = Number(obj.x ?? obj.cx ?? (Array.isArray(obj.coord) ? obj.coord[0] : undefined));
        const y = Number(obj.y ?? obj.cy ?? (Array.isArray(obj.coord) ? obj.coord[1] : undefined));
        return { id, x, y };
      }
      return { id: coercePointId(undefined, index), x: Number.NaN, y: Number.NaN };
    });
  }
  if (raw && typeof raw === "object") {
    // {A:{x,y}} / {A:[x,y]} / {A:"3,4"}
    return Object.entries(raw as Record<string, unknown>).map(([key, value], index) => {
      const id = coercePointId(key, index);
      if (Array.isArray(value)) {
        return { id, x: Number(value[0]), y: Number(value[1]) };
      }
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        return { id, x: Number(obj.x ?? obj.cx), y: Number(obj.y ?? obj.cy) };
      }
      if (typeof value === "string") {
        const [xs, ys] = value.split(/[,，\s]+/);
        return { id, x: Number(xs), y: Number(ys) };
      }
      return { id, x: Number.NaN, y: Number.NaN };
    });
  }
  return [];
}

function fillMissingPointCoords(points: FigurePoint[]): FigurePoint[] {
  const missing = points.filter((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y));
  if (missing.length === 0) return points;
  if (missing.length === points.length) {
    const layout = autoLayoutPoints(points.map((p) => p.id));
    return points.map((p, i) => layout[i] ?? p);
  }
  // 部分点有坐标：缺失点沿已有点的包围盒中心附近补位
  const known = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const cx = known.reduce((n, p) => n + p.x, 0) / known.length;
  const cy = known.reduce((n, p) => n + p.y, 0) / known.length;
  return points.map((p, i) => {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    const angle = (i / Math.max(points.length, 1)) * 2 * Math.PI;
    return { ...p, x: cx + 25 * Math.cos(angle), y: cy + 25 * Math.sin(angle) };
  });
}

function normalizeSegments(raw: unknown, points: FigurePoint[]): FigureSegment[] {
  if (!Array.isArray(raw)) return [];
  const ids = points.map((p) => p.id);
  const out: FigureSegment[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const clean = entry.replace(/[\s\-–—→,.，、()〔〕]/g, "");
      let pair: [string, string] | null = null;
      for (const a of ids) {
        for (const b of ids) {
          if (a !== b && clean === `${a}${b}`) {
            pair = [a, b];
            break;
          }
        }
        if (pair) break;
      }
      if (!pair) {
        const m = clean.match(/^([A-Za-z][A-Za-z0-9'′]{0,5})([A-Za-z][A-Za-z0-9'′]{0,5})$/u);
        if (m) pair = [m[1]!, m[2]!];
      }
      if (pair) out.push({ from: pair[0], to: pair[1] });
      continue;
    }
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const from =
        obj.from ?? obj.start ?? obj.a ?? (Array.isArray(obj.points) ? obj.points[0] : undefined);
      const to = obj.to ?? obj.end ?? obj.b ?? (Array.isArray(obj.points) ? obj.points[1] : undefined);
      if (typeof from === "string" && typeof to === "string") {
        out.push({ from: coercePointId(from, 0), to: coercePointId(to, 1), ...(obj.dashed === true ? { dashed: true } : {}) });
      }
    }
  }
  return out;
}

function normalizeLabels(raw: unknown): FigureLabel[] {
  if (!Array.isArray(raw)) return [];
  const out: FigureLabel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const text = String(obj.text ?? obj.label ?? "").slice(0, 16);
    const x = Number(obj.x);
    const y = Number(obj.y);
    // 只保留模型给了明确坐标的标注：简写标签（如 ["5","13"]）没有位置，自动摆放
    // 会误导（把角度符号放到边中间），而且这些条件题干里已经有了，直接丢弃更安全。
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ text, x, y });
  }
  return out;
}

// 函数图象：接受 ["y=x^2+1"] / [{expression}] / {expression} 等写法；
// 另外把模型写进 labels 的解析式（text: "y=x^2-2x+3"）也算曲线，避免只标不发。
function collectCurveExpressions(...sources: unknown[]): string[] {
  const out: string[] = [];
  const pushString = (value: unknown) => {
    if (typeof value !== "string") return;
    const expr = value.trim();
    if (expr.length < 3 || expr.length > 80) return;
    if (!/[xX]/.test(expr) || !/[yY]\s*=|[-+*/^()]/.test(expr)) return;
    if (out.includes(expr) || out.length >= 4) return;
    out.push(expr);
  };
  const visit = (value: unknown) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "string") {
      pushString(value);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["expression", "expr", "formula", "function", "curve", "text", "label", "y"] as const) {
        if (key in obj) pushString(obj[key]);
      }
    }
  };
  for (const source of sources) visit(source);
  return out;
}

function normalizeCurves(rawCurves: unknown, rawFunctions: unknown, rawLabels: unknown): FigureCurve[] {
  return collectCurveExpressions(rawCurves, rawFunctions, rawLabels).map((expression) => ({ expression }));
}

function normalizeCircles(raw: unknown): FigureCircle[] {  if (!Array.isArray(raw)) return [];
  const out: FigureCircle[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const center = Array.isArray(obj.center) ? obj.center : undefined;
    const cx = Number(obj.cx ?? obj.x ?? center?.[0]);
    const cy = Number(obj.cy ?? obj.y ?? center?.[1]);
    const r = Number(obj.r ?? obj.radius);
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r) && r > 0) {
      out.push({ cx, cy, r, ...(obj.dashed === true ? { dashed: true } : {}) });
    }
  }
  return out;
}

function normalizeAxes(raw: unknown): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const xMin = Number(obj.xMin ?? obj.minX ?? (Array.isArray(obj.x) ? obj.x[0] : undefined));
  const xMax = Number(obj.xMax ?? obj.maxX ?? (Array.isArray(obj.x) ? obj.x[1] : undefined));
  const yMin = Number(obj.yMin ?? obj.minY ?? (Array.isArray(obj.y) ? obj.y[0] : undefined));
  const yMax = Number(obj.yMax ?? obj.maxY ?? (Array.isArray(obj.y) ? obj.y[1] : undefined));
  if (![xMin, xMax, yMin, yMax].every(Number.isFinite) || xMin >= xMax || yMin >= yMax) return null;
  return { xMin, xMax, yMin, yMax };
}

/** 宽松归一化：把模型常见的简写/别名转成 FigureSpec 的严格结构；无法识别时原样返回。 */
export function normalizeFigureSpec(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const axes = normalizeAxes(obj.axes);
  const rawPoints = normalizePoints(obj.points);
  // 「模型是否真的给了坐标」要在自动补位之前判断：坐标系图没有真实数据坐标时，
  // 自动布局的 0–100 坐标会被误当成数据坐标画出来，所以降级成平面示意图。
  const hasRealCoords =
    rawPoints.length > 0 &&
    rawPoints.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const points = fillMissingPointCoords(rawPoints);
  const segments = normalizeSegments(obj.segments, points);
  const labels = normalizeLabels(obj.labels);
  const circles = normalizeCircles(obj.circles);
  const curves = normalizeCurves(obj.curves, obj.functions, obj.labels);
  const kind =
    obj.kind === "COORDINATE" || axes || curves.length > 0 ? "COORDINATE" : "GEOMETRY";
  if (kind === "COORDINATE") {
    // 坐标系图必须有点的真实数据坐标；若模型只给了点名（简写），降级成平面示意图更安全。
    if (!hasRealCoords) {
      return { kind: "GEOMETRY", points, segments, circles, labels };
    }
    return {
      kind: "COORDINATE",
      axes: axes ?? { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      points,
      segments,
      circles,
      labels,
      curves,
    };
  }
  return { kind: "GEOMETRY", points, segments, circles, labels };
}

export const FigureGenerationInputSchema = z.object({
  stemMd: z.string().min(1).max(4000),
  gradeLevel: z.string().optional(),
  /** 可选题型提示，帮助模型判断是否需要坐标系图。 */
  questionType: z.string().optional(),
});
export type FigureGenerationInput = z.infer<typeof FigureGenerationInputSchema>;

export const FigureGenerationOutputSchema = z.object({
  /** null = 本题不需要配图；其它情况先走宽松归一化再严格校验。 */
  figure: z.preprocess(
    (value) => (value == null ? null : normalizeFigureSpec(value)),
    FigureSpecSchema.nullable(),
  ),
});
export type FigureGenerationOutput = z.infer<typeof FigureGenerationOutputSchema>;

// === LessonPlanGeneration / Courseware (Plan 18) ===
export const CoursewareSectionTypeEnum = z.enum([
  "INTRO",
  "EXPLANATION",
  "EXAMPLE",
  "PITFALL",
  "EXERCISE",
]);
export const LESSON_SECTION_ORDER = [
  "INTRO",
  "EXPLANATION",
  "EXAMPLE",
  "PITFALL",
  "EXERCISE",
] as const;

export const LessonPlanGenerationInputSchema = z.object({
  gradeLevel: z.string(),
  kpNames: z.array(z.string()).min(1),
  teachingGoal: z.string().optional(),
});
export type LessonPlanGenerationInput = z.infer<typeof LessonPlanGenerationInputSchema>;

export const LessonPlanGenerationOutputSchema = z
  .object({
    title: z.string().min(1),
    sections: z
      .array(
        z.object({
          type: CoursewareSectionTypeEnum,
          title: z.string().min(1),
          contentMd: z.string().min(1),
        }),
      )
      .length(5),
  })
  .superRefine((v, ctx) => {
    const set = new Set(v.sections.map((s) => s.type));
    if (set.size !== 5 || !LESSON_SECTION_ORDER.every((t) => set.has(t))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "sections 必须恰好五段且 INTRO/EXPLANATION/EXAMPLE/PITFALL/EXERCISE 各一",
      });
    }
  });
export type LessonPlanGenerationOutput = z.infer<typeof LessonPlanGenerationOutputSchema>;

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
