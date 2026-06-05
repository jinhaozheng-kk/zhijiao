export type TaskKind =
  | "TUTOR_TURN"
  | "TUTOR_ASK_IMAGE"           // 图片/OCR 拍照答疑：多模态转写 + 讲解
  | "ERROR_ANALYSIS"            // Plan 4: error.diagnose (replaces ERROR_DIAGNOSIS placeholder)
  | "VARIANT_GROUP_GEN"         // Plan 4: variant.generateForEntry (replaces VARIANT_L1/L2/L3_GEN trio — single call generates all 3 levels)
  | "ASSIGNMENT_QUESTION_GEN"   // Plan 10: teacher tiered assignment question generation
  | "PAPER_GEN"
  | "FORECAST_PAPER_GEN"
  | "LESSON_PLAN_GEN"           // Plan 18: 教师 AI 课件生成（五段结构化）
  | "EMBEDDING"
  | "KP_RECONCILE"              // Plan 9: kp:reconcile-pending CLI (hint→kp id LLM mapping)
  | "LEARNING_ADVICE";          // Plan 11: analytics.profile.generateAdvice (KP mastery → study method advice)

// spec §1.2 决定的初稿 task→model 映射（router 中可调）
export const TASK_MODEL_MAP: Record<TaskKind, string> = {
  TUTOR_TURN:          "qwen-plus",
  TUTOR_ASK_IMAGE:     "qwen-vl-plus",   // 多模态视觉模型
  ERROR_ANALYSIS:      "qwen-plus",
  VARIANT_GROUP_GEN:   "qwen-plus",        // 一次出 3 道 L1/L2/L3，需要 plus 级
  ASSIGNMENT_QUESTION_GEN: "qwen-plus",
  PAPER_GEN:           "qwen-max",
  FORECAST_PAPER_GEN:  "qwen-max",
  LESSON_PLAN_GEN:     "qwen-max",
  EMBEDDING:           "text-embedding-v2",
  KP_RECONCILE:        "qwen-plus",        // Plan 9: 候选集小、JSON 输出，plus 足够
  LEARNING_ADVICE:     "qwen-plus",        // Plan 11: 方法论建议，JSON 输出，plus 足够
};
