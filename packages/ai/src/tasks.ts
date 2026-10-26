export type TaskKind =
  | "TUTOR_TURN"
  | "TUTOR_ASK_IMAGE"           // 图片/OCR 拍照答疑：多模态转写 + 讲解
  | "ERROR_ANALYSIS"            // Plan 4: error.diagnose (replaces ERROR_DIAGNOSIS placeholder)
  | "VARIANT_GROUP_GEN"         // Plan 4: variant.generateForEntry (replaces VARIANT_L1/L2/L3_GEN trio — single call generates all 3 levels)
  | "ASSIGNMENT_QUESTION_GEN"   // Plan 10: teacher tiered assignment question generation
  | "PAPER_GEN"
  | "PAPER_FIGURE_GEN"          // 浙江卷配图：题干 → 受约束的几何/坐标系图形 DSL
  | "FORECAST_PAPER_GEN"
  | "LESSON_PLAN_GEN"           // Plan 18: 教师 AI 课件生成（五段结构化）
  | "EMBEDDING"
  | "KP_RECONCILE"              // Plan 9: kp:reconcile-pending CLI (hint→kp id LLM mapping)
  | "LEARNING_ADVICE";          // Plan 11: analytics.profile.generateAdvice (KP mastery → study method advice)

export interface TaskConfig {
  /** 默认模型 id。可被环境变量 `AI_MODEL_<TASK_KIND>` 覆盖（无需改代码即可灰度/回滚）。 */
  model: string;
  /**
   * 思考型模型（qwen3.x / deepseek-v4 等）默认先输出 reasoning tokens：更慢、更贵，
   * 且实测「正文」反而更短（预算被推理吃掉）。结构化生成类任务必须显式关闭。
   * `undefined` = 不向日志传该参数（兼容非思考模型）。
   */
  enableThinking?: boolean;
  /** 单次调用超时（毫秒）。长结构化生成（整卷/整份课件）需要放宽。 */
  timeoutMs?: number;
}

/**
 * task → 模型映射（2026-10-26 校准）。
 *
 * - 生成类任务（出卷/课件）默认仍走 `qwen-max`：延迟与单价最低，且适配器已支持
 *   `AI_MODEL_*` 覆盖，切换到 `qwen3.8-max` 无需改代码（见 .env.example）。
 * - `TUTOR_ASK_IMAGE` / `EMBEDDING` 的原模型已在百炼目录下架，此处已替换：
 *   `qwen-vl-plus` → `qwen3-vl-plus`；`text-embedding-v2` → `qwen3.7-text-embedding`。
 *   注意：embeddings 在当前 OpenAI 兼容端点（compatible-mode）不可用，需走 DashScope
 *   原生 embeddings 端点；当前仓库尚无调用方，保留 taskKind 为后续 RAG 预留。
 */
export const TASK_CONFIG: Record<TaskKind, TaskConfig> = {
  TUTOR_TURN:          { model: "qwen-plus" },
  TUTOR_ASK_IMAGE:     { model: "qwen3-vl-plus" },   // 多模态视觉模型（qwen-vl-plus 已下架）
  ERROR_ANALYSIS:      { model: "qwen-plus" },
  VARIANT_GROUP_GEN:   { model: "qwen-plus" },        // 一次出 3 道 L1/L2/L3，需要 plus 级
  ASSIGNMENT_QUESTION_GEN: { model: "qwen-plus" },
  PAPER_GEN:           { model: "qwen-max", enableThinking: false, timeoutMs: 600_000 },
  // 配图是短输出（<1k tokens）的小任务：超时收紧，避免拖慢整卷生成。
  PAPER_FIGURE_GEN:    { model: "qwen-max", enableThinking: false, timeoutMs: 120_000 },
  FORECAST_PAPER_GEN:  { model: "qwen-max", enableThinking: false, timeoutMs: 600_000 },
  LESSON_PLAN_GEN:     { model: "qwen-max", enableThinking: false, timeoutMs: 600_000 },
  // 兼容模式不支持 embeddings（会 404），需原生端点；当前无调用方。
  EMBEDDING:           { model: "qwen3.7-text-embedding" },
  KP_RECONCILE:        { model: "qwen-plus" },        // 候选集小、JSON 输出，plus 足够
  LEARNING_ADVICE:     { model: "qwen-plus" },        // 方法论建议，JSON 输出，plus 足够
};

/** 兼容旧调用方：只关心默认模型名时用这个。 */
export const TASK_MODEL_MAP: Record<TaskKind, string> = Object.fromEntries(
  (Object.entries(TASK_CONFIG) as Array<[TaskKind, TaskConfig]>).map(([kind, cfg]) => [kind, cfg.model]),
) as Record<TaskKind, string>;

function parseThinkingEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return undefined; // 非法值忽略，回落到默认配置
}

function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * 运行时解析任务配置，优先级：env 覆盖 > 代码默认。
 *
 * 支持的覆盖变量（按 taskKind 全大写）：
 * - `AI_MODEL_<KIND>`       例：AI_MODEL_PAPER_GEN=qwen3.8-max
 * - `AI_THINKING_<KIND>`    on/off（思考型模型建议 off）
 * - `AI_TIMEOUT_MS_<KIND>`  单次请求超时毫秒
 */
export function resolveTaskConfig(taskKind: TaskKind): TaskConfig {
  const base = TASK_CONFIG[taskKind];
  const envModel = process.env[`AI_MODEL_${taskKind}`]?.trim();
  const envThinking = parseThinkingEnv(process.env[`AI_THINKING_${taskKind}`]);
  const envTimeout = parsePositiveIntEnv(process.env[`AI_TIMEOUT_MS_${taskKind}`]);
  return {
    model: envModel && envModel.length > 0 ? envModel : base.model,
    enableThinking: envThinking ?? base.enableThinking,
    timeoutMs: envTimeout ?? base.timeoutMs,
  };
}
