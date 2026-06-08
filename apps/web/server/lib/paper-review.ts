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
