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
  points: number;
}

const AI_ARTIFACT_RE = /作为\s*AI|作为一个?语言模型|as an ai|我是一个?(AI|人工智能)/i;
const STEM_LEN_WARN = 600;

export function reviewPaperSlot(slot: BlueprintSlot, item: ReviewableItem): PaperReviewIssue[] {
  const issues: PaperReviewIssue[] = [];
  const push = (severity: PaperReviewSeverity, code: string, message: string) =>
    issues.push({ slotQuestionNo: slot.questionNo, severity, code, message });

  if (item.type !== slot.questionType) push("BLOCKER", "TYPE_MISMATCH", `题型应为 ${slot.questionType}，实际 ${item.type}`);
  if (Math.abs(item.difficulty - slot.difficulty) > 1) push("BLOCKER", "DIFFICULTY_DRIFT", `难度偏离目标 ${slot.difficulty} 超过 1 档`);
  if (slot.questionType === "SINGLE_CHOICE" || slot.questionType === "MULTI_CHOICE") {
    if (!item.options || item.options.length !== 4) push("BLOCKER", "CHOICE_OPTION_COUNT", "选择题必须恰有 4 个选项");
  }
  if (slot.questionType === "FILL_BLANK" && item.options && item.options.length > 0) {
    push("BLOCKER", "FILL_HAS_OPTIONS", "填空题不得输出选项");
  }
  if (slot.questionType === "ESSAY" && item.solutionMd.trim().length === 0) {
    push("BLOCKER", "MISSING_SOLUTION", "解答题必须有解析");
  }

  if (item.answerMd.trim().length === 0) push("BLOCKER", "EMPTY_ANSWER", "答案不能为空");

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
