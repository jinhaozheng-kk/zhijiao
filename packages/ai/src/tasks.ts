export type TaskKind =
  | "TUTOR_TURN"
  | "ERROR_DIAGNOSIS"
  | "VARIANT_L1_GEN"
  | "VARIANT_L2_GEN"
  | "VARIANT_L3_GEN"
  | "PAPER_GEN"
  | "FORECAST_PAPER_GEN"
  | "EMBEDDING";

// spec §1.2 决定的初稿 task→model 映射（router 中可调）
export const TASK_MODEL_MAP: Record<TaskKind, string> = {
  TUTOR_TURN:          "qwen-plus",
  ERROR_DIAGNOSIS:     "qwen-plus",
  VARIANT_L1_GEN:      "qwen-turbo",
  VARIANT_L2_GEN:      "qwen-plus",
  VARIANT_L3_GEN:      "qwen-plus",
  PAPER_GEN:           "qwen-max",
  FORECAST_PAPER_GEN:  "qwen-max",
  EMBEDDING:           "text-embedding-v2",
};
