export type AssignmentStatusValue = "DRAFT" | "PUBLISHED" | "CLOSED";
export type AssignmentTierValue = "BASIC" | "CONSOLIDATION" | "CHALLENGE";
export type StudentAssignmentStatusValue = "ASSIGNED" | "SUBMITTED" | "GRADED";
export type GradeStatusValue = "UNGRADED" | "CORRECT" | "PARTIAL" | "WRONG";
export type RootCauseValue =
  | "CONCEPT_CONFUSION"
  | "READING_ERROR"
  | "FORMULA_MISUSE"
  | "CALCULATION_SLIP"
  | "TRANSFER_GAP"
  | "OTHER";
export type QuestionTypeValue =
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "FILL_BLANK"
  | "CALCULATION"
  | "PROOF"
  | "ESSAY";

export function assignmentStatusLabel(status: AssignmentStatusValue): string {
  switch (status) {
    case "DRAFT":
      return "草稿";
    case "PUBLISHED":
      return "已发布";
    case "CLOSED":
      return "已结束";
  }
}

export function assignmentTierLabel(tier: AssignmentTierValue): string {
  switch (tier) {
    case "BASIC":
      return "基础层";
    case "CONSOLIDATION":
      return "巩固层";
    case "CHALLENGE":
      return "挑战层";
  }
}

export function studentAssignmentStatusLabel(
  status: StudentAssignmentStatusValue,
): string {
  switch (status) {
    case "ASSIGNED":
      return "待提交";
    case "SUBMITTED":
      return "待批改";
    case "GRADED":
      return "已批改";
  }
}

export function gradeStatusLabel(status: GradeStatusValue): string {
  switch (status) {
    case "UNGRADED":
      return "未批改";
    case "CORRECT":
      return "正确";
    case "PARTIAL":
      return "部分正确";
    case "WRONG":
      return "待订正";
  }
}

export function rootCauseLabel(cause: RootCauseValue): string {
  switch (cause) {
    case "CONCEPT_CONFUSION":
      return "概念混淆";
    case "READING_ERROR":
      return "读题失误";
    case "FORMULA_MISUSE":
      return "公式误用";
    case "CALCULATION_SLIP":
      return "计算疏漏";
    case "TRANSFER_GAP":
      return "迁移不足";
    case "OTHER":
      return "其他原因";
  }
}

export function questionTypeLabel(type: QuestionTypeValue): string {
  switch (type) {
    case "SINGLE_CHOICE":
      return "单选题";
    case "MULTI_CHOICE":
      return "多选题";
    case "FILL_BLANK":
      return "填空题";
    case "CALCULATION":
      return "计算题";
    case "PROOF":
      return "证明题";
    case "ESSAY":
      return "解答题";
  }
}
