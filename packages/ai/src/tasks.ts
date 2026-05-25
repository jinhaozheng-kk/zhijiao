export type TaskKind =
  | "TUTOR_TURN"
  | "ERROR_ANALYSIS"            // Plan 4: error.diagnose (replaces ERROR_DIAGNOSIS placeholder)
  | "VARIANT_GROUP_GEN"         // Plan 4: variant.generateForEntry (replaces VARIANT_L1/L2/L3_GEN trio — single call generates all 3 levels)
  | "PAPER_GEN"
  | "FORECAST_PAPER_GEN"
  | "EMBEDDING"
  | "KP_RECONCILE";             // Plan 9: kp:reconcile-pending CLI (hint→kp id LLM mapping)

// spec §1.2 决定的初稿 task→model 映射（router 中可调）
export const TASK_MODEL_MAP: Record<TaskKind, string> = {
  TUTOR_TURN:          "qwen-plus",
  ERROR_ANALYSIS:      "qwen-plus",
  VARIANT_GROUP_GEN:   "qwen-plus",        // 一次出 3 道 L1/L2/L3，需要 plus 级
  PAPER_GEN:           "qwen-max",
  FORECAST_PAPER_GEN:  "qwen-max",
  EMBEDDING:           "text-embedding-v2",
  KP_RECONCILE:        "qwen-plus",        // Plan 9: 候选集小、JSON 输出，plus 足够
};
