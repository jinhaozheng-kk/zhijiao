export type ActionKind =
  | "TUTOR_ASK"
  | "PAPER_GEN"
  | "LESSON_PLAN_GEN"
  | "PPT_GEN"
  | "VARIANT_GROUP_GEN"
  | "ERROR_ANALYSIS"
  | "ASSIGNMENT_QUESTION_GEN";

export const PRICING: Record<ActionKind, number> = {
  TUTOR_ASK: 1,
  PAPER_GEN: 5,
  LESSON_PLAN_GEN: 3,
  PPT_GEN: 5,
  VARIANT_GROUP_GEN: 3,
  ERROR_ANALYSIS: 1,
  ASSIGNMENT_QUESTION_GEN: 1,
};

export function priceOf(kind: ActionKind): number {
  const p = PRICING[kind];
  if (p == null) throw new Error(`Unknown action kind: ${kind}`);
  return p;
}
