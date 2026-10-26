import { findForbidden } from "@zhijiao/domain";
import type { QuestionType } from "@prisma/client";
import type { BlueprintSlot } from "../../lib/zhongkao-blueprint.js";

export type PaperReviewSeverity = "BLOCKER" | "WARNING";

export interface PaperReviewIssue {
  slotQuestionNo: number;
  severity: PaperReviewSeverity;
  code: string;
  message: string;
}

export function getReviewBlockersFromParams(params: unknown): PaperReviewIssue[] {
  if (!params || typeof params !== "object") return [];
  const maybeBlockers = (params as { reviewBlockers?: unknown }).reviewBlockers;
  if (!Array.isArray(maybeBlockers)) return [];
  return maybeBlockers.filter((issue): issue is PaperReviewIssue => {
    if (!issue || typeof issue !== "object") return false;
    const item = issue as Partial<PaperReviewIssue>;
    return (
      typeof item.slotQuestionNo === "number" &&
      item.severity === "BLOCKER" &&
      typeof item.code === "string" &&
      typeof item.message === "string"
    );
  });
}

export interface ReviewableItem {
  stemMd: string;
  type: QuestionType;
  options?: string[];
  answerMd: string;
  solutionMd: string;
  rubricMd?: string;
  difficulty: number;
  points: number; // 仅作上下文，不做「分值匹配」校验：分值以 slot 为权威，落库时覆盖（spec §4.2 优先于 §4.3）。
}

const AI_ARTIFACT_RE = /作为\s*AI|作为一个?语言模型|\bas an ai\b|我是一个?(AI|人工智能)/i;
const STEM_LEN_WARN = 600;

export function reviewPaperSlot(slot: BlueprintSlot, item: ReviewableItem): PaperReviewIssue[] {
  const issues: PaperReviewIssue[] = [];
  const push = (severity: PaperReviewSeverity, code: string, message: string) =>
    issues.push({ slotQuestionNo: slot.questionNo, severity, code, message });

  if (item.type !== slot.questionType) push("BLOCKER", "TYPE_MISMATCH", `题型应为 ${slot.questionType}，实际 ${item.type}`);
  // 注：v1 不校验难度偏离——按题型批量生成 + slot 难度权威覆盖，原始 AI 难度不可比；
  //     per-slot 生成落地后再恢复（spec §10）。
  if (slot.questionType === "SINGLE_CHOICE" || slot.questionType === "MULTI_CHOICE") {
    if (!item.options || item.options.length !== 4) push("BLOCKER", "CHOICE_OPTION_COUNT", "选择题必须恰有 4 个选项");
  }
  if (slot.questionType === "FILL_BLANK" && item.options && item.options.length > 0) {
    push("BLOCKER", "FILL_HAS_OPTIONS", "填空题不得输出选项");
  }
  // 选择题答案指向不存在的选项（如 4 选项却答 E）——保守 WARNING：只看答案前导字母，
  // 无前导字母（如纯公式/"见解析"）不触发；不判断「选对没」（数学正误靠教师审核）。
  if ((slot.questionType === "SINGLE_CHOICE" || slot.questionType === "MULTI_CHOICE") && item.options && item.options.length > 0) {
    const lead = (item.answerMd.trim().match(/^[（(]?\s*([A-Za-z]+)/)?.[1] ?? "").toUpperCase();
    if (lead && [...lead].some((c) => c.charCodeAt(0) - 65 >= item.options!.length)) {
      push("WARNING", "CHOICE_ANSWER_OUT_OF_RANGE", "选择题答案指向了不存在的选项，建议核对");
    }
  }
  // 仅 ESSAY 查缺解析：中考蓝图把全部「解答题」映射为 ESSAY，不会出现 CALCULATION/PROOF slot。
  if (slot.questionType === "ESSAY" && item.solutionMd.trim().length === 0) {
    push("BLOCKER", "MISSING_SOLUTION", "解答题必须有解析");
  }

  // 内容质量门（浙江卷路径）：解析过短 = 不可用于考试卷，直接 BLOCKER 触发修复轮；
  // 介于阈值之间的给 WARNING，不阻断但供教师核对。
  const solutionLen = item.solutionMd.trim().length;
  if (slot.questionType === "ESSAY" && solutionLen > 0) {
    if (solutionLen < 120) {
      push("BLOCKER", "SHORT_SOLUTION", "解答题解析过短，必须写出完整分步过程（至少 4 步、150 字以上）");
    } else if (solutionLen < 180) {
      push("WARNING", "SHORT_SOLUTION_WARN", "解答题解析偏短，建议补充关键步骤");
    }
    if (!item.rubricMd || item.rubricMd.trim().length === 0) {
      push("WARNING", "MISSING_RUBRIC", "解答题缺少评分标准，建议补充分步分值");
    }
  }
  if ((slot.questionType === "FILL_BLANK" || slot.questionType === "SINGLE_CHOICE" || slot.questionType === "MULTI_CHOICE") && solutionLen > 0 && solutionLen < 20) {
    push("WARNING", "SHORT_SOLUTION_WARN", "解析过短，建议给出简要推导");
  }

  // 选择题选项质量：重复选项 / 凑数选项会让题目不可用或产生歧义。
  if ((slot.questionType === "SINGLE_CHOICE" || slot.questionType === "MULTI_CHOICE") && item.options && item.options.length > 0) {
    const normalized = item.options.map((opt) => opt.replace(/\s+/g, "").toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      push("WARNING", "CHOICE_OPTIONS_DUPLICATE", "选择题存在重复选项，建议重新设计干扰项");
    }
    if (item.options.some((opt) => /以上都|都不对|无法确定/.test(opt))) {
      push("WARNING", "CHOICE_ALL_OF_ABOVE", "选择题出现「以上都对/都不对」类凑数选项，建议换成有区分度的选项");
    }
    const lead = item.answerMd.trim().match(/^[（(]?\s*([A-Za-z]+)/)?.[1] ?? "";
    if (!lead || !/^[A-D]$/i.test(lead)) {
      push("WARNING", "CHOICE_ANSWER_NOT_LETTER", "选择题答案建议只写选项字母（A/B/C/D）");
    }
  }
  if (item.stemMd.trim().length < 12) push("WARNING", "STEM_TOO_SHORT", "题干过短，条件可能不完整");

  if (item.answerMd.trim().length === 0) push("BLOCKER", "EMPTY_ANSWER", "答案不能为空");

  // options 故意不纳入合规/AI 痕迹扫描：中考数学选项多为短数字/代数串，风险可忽略。
  const corpus = [item.stemMd, item.answerMd, item.solutionMd, item.rubricMd ?? ""].join("\n");
  const forbidden = findForbidden(corpus);
  if (forbidden.length > 0) push("BLOCKER", "FORBIDDEN_PHRASE", `命中禁用措辞：${forbidden.join("、")}`);
  if (AI_ARTIFACT_RE.test(corpus)) push("WARNING", "AI_ARTIFACT", "疑似 AI 生成痕迹，建议人工核对");
  if (item.stemMd.length > STEM_LEN_WARN) push("WARNING", "STEM_TOO_LONG", "题干偏长，建议精简");

  return issues;
}

export function reviewAssembledPaper(pairs: Array<{ slot: BlueprintSlot; item: ReviewableItem }>): PaperReviewIssue[] {
  return pairs.flatMap(({ slot, item }) => reviewPaperSlot(slot, item));
}

// ── 通用（非中考模板）出卷审题 ─────────────────────────────────────────────
//
// 中考蓝图路径有 slot 作为权威元数据（题型/分值/难度），可做 per-slot 审题；
// 普通出卷没有 slot，因此这里做「与题位无关」的结构与质量检查：
//   BLOCKER：空答案 / 空解析 / AI 选择题完全没有选项 / 命中禁用措辞
//   WARNING：选项数量异常、填空题带选项、答案字母越界、AI 痕迹、题干过长、
//            解析过短、依赖插图、同模板重复（仅数值不同的近似重复题）
//
// 注意：BLOCKER 会让整次生成失败并走既有扣费补偿（与中考路径一致）；
// 因此这里只把「确定不可用」的缺陷判为 BLOCKER，其余留给教师人工核对。

export interface GeneratedReviewItem extends ReviewableItem {
  /** 1-based 位置，与落库后的 PaperItem.position 对齐。 */
  questionNo: number;
  source: "BANK" | "AI";
}

const GENERIC_SOLUTION_MIN: Partial<Record<QuestionType, number>> = {
  SINGLE_CHOICE: 40,
  MULTI_CHOICE: 40,
  FILL_BLANK: 40,
  CALCULATION: 120,
  PROOF: 120,
  ESSAY: 150,
};

const FIGURE_DEPENDENT_RE = /如图|见图|图中/;

/** 去掉题号/标点/空白，并把数字统一成 # —— 用于识别「只改数字」的近似重复题。 */
function genericTemplateKey(stemMd: string): string {
  return stemMd
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*(?:第\s*)?\d+\s*[.、．]\s*/u, "")
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、,.!?;:]/g, "")
    .replace(/\d+(?:\.\d+)?/g, "#");
}

export function reviewGeneratedPaper(items: GeneratedReviewItem[]): PaperReviewIssue[] {
  const issues: PaperReviewIssue[] = [];
  const push = (
    questionNo: number,
    severity: PaperReviewSeverity,
    code: string,
    message: string,
  ) => issues.push({ slotQuestionNo: questionNo, severity, code, message });

  const byTemplate = new Map<string, number[]>();

  for (const item of items) {
    const no = item.questionNo;
    const type = item.type;
    const isChoice = type === "SINGLE_CHOICE" || type === "MULTI_CHOICE";

    if (item.answerMd.trim().length === 0) {
      push(no, "BLOCKER", "EMPTY_ANSWER", "答案不能为空");
    }
    if (item.solutionMd.trim().length === 0) {
      push(no, "BLOCKER", "MISSING_SOLUTION", "解析不能为空");
    }

    if (isChoice) {
      const optionCount = item.options?.length ?? 0;
      if (optionCount === 0) {
        if (item.source === "AI") {
          push(no, "BLOCKER", "CHOICE_OPTIONS_MISSING", "选择题缺少选项，无法作为选择题使用");
        } else {
          push(no, "WARNING", "BANK_CHOICE_OPTIONS_MISSING", "题库选择题没有选项数据，建议人工补充或换题");
        }
      } else if (optionCount !== 4) {
        push(no, "WARNING", "CHOICE_OPTION_COUNT", `选择题有 ${optionCount} 个选项（通常应为 4 个），请核对`);
      }

      const lead = (item.answerMd.trim().match(/^[（(]?\s*([A-Za-z]+)/)?.[1] ?? "").toUpperCase();
      if (lead && [...lead].some((c) => c.charCodeAt(0) - 65 >= optionCount)) {
        push(no, "WARNING", "CHOICE_ANSWER_OUT_OF_RANGE", "选择题答案指向了不存在的选项，建议核对");
      }
    }

    if (type === "FILL_BLANK" && item.options && item.options.length > 0) {
      push(no, "WARNING", "FILL_HAS_OPTIONS", "填空题不应带选项，建议删除选项");
    }

    const corpus = [item.stemMd, item.answerMd, item.solutionMd, item.rubricMd ?? ""].join("\n");
    const forbidden = findForbidden(corpus);
    if (forbidden.length > 0) {
      push(no, "BLOCKER", "FORBIDDEN_PHRASE", `命中禁用措辞：${forbidden.join("、")}`);
    }
    if (AI_ARTIFACT_RE.test(corpus)) {
      push(no, "WARNING", "AI_ARTIFACT", "疑似 AI 生成痕迹，建议人工核对");
    }
    if (item.stemMd.length > STEM_LEN_WARN) {
      push(no, "WARNING", "STEM_TOO_LONG", "题干偏长，建议精简");
    }
    const minSolution = GENERIC_SOLUTION_MIN[type];
    if (minSolution && item.solutionMd.trim().length < minSolution) {
      push(
        no,
        "WARNING",
        "SOLUTION_TOO_SHORT",
        `解析偏短（${item.solutionMd.trim().length} 字，建议不少于 ${minSolution} 字），请核对是否讲清步骤`,
      );
    }
    if (FIGURE_DEPENDENT_RE.test(item.stemMd)) {
      push(no, "WARNING", "FIGURE_DEPENDENT", "题干依赖插图（如图），当前卷面无配图能力，建议改写或换题");
    }

    const key = genericTemplateKey(item.stemMd);
    if (key.length >= 8) {
      const level = byTemplate.get(key) ?? [];
      level.push(no);
      byTemplate.set(key, level);
    }
  }

  for (const [, questionNos] of byTemplate) {
    if (questionNos.length < 2) continue;
    const [first, ...rest] = questionNos;
    for (const no of rest) {
      push(no, "WARNING", "DUPLICATE_TEMPLATE", `与第 ${first} 题模板高度相似（仅数值不同），建议换题`);
    }
  }

  return issues.sort(
    (a, b) =>
      a.slotQuestionNo - b.slotQuestionNo ||
      (a.severity === b.severity ? 0 : a.severity === "BLOCKER" ? -1 : 1),
  );
}

