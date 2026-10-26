import { describe, it, expect, afterEach } from "vitest";
import {
  TASK_CONFIG,
  TASK_MODEL_MAP,
  resolveTaskConfig,
  type TaskKind,
} from "../src/index.js";

const KEYS = Object.keys(TASK_CONFIG) as TaskKind[];
const ENV_NAMES = ["AI_MODEL_PAPER_GEN", "AI_THINKING_PAPER_GEN", "AI_TIMEOUT_MS_PAPER_GEN"] as const;

afterEach(() => {
  for (const k of ENV_NAMES) delete process.env[k];
});

describe("task model config", () => {
  it("生成类任务默认关闭 thinking 并放宽超时", () => {
    for (const kind of ["PAPER_GEN", "FORECAST_PAPER_GEN", "LESSON_PLAN_GEN"] as const) {
      expect(TASK_CONFIG[kind].enableThinking).toBe(false);
      expect(TASK_CONFIG[kind].timeoutMs).toBe(600_000);
    }
  });

  it("不再引用已下架的模型 id（qwen-vl-plus / text-embedding-v2）", () => {
    const models = Object.values(TASK_MODEL_MAP);
    expect(models).not.toContain("qwen-vl-plus");
    expect(models).not.toContain("text-embedding-v2");
    expect(TASK_CONFIG.TUTOR_ASK_IMAGE.model).toBe("qwen3-vl-plus");
    expect(TASK_CONFIG.EMBEDDING.model).toBe("qwen3.7-text-embedding");
  });

  it("每个 taskKind 都有配置，且模型名非空", () => {
    for (const kind of KEYS) {
      const cfg = resolveTaskConfig(kind);
      expect(cfg.model.length).toBeGreaterThan(0);
    }
  });

  it("默认解析结果与静态 map 一致（未设 env 时）", () => {
    for (const kind of KEYS) {
      expect(resolveTaskConfig(kind).model).toBe(TASK_MODEL_MAP[kind]);
    }
  });

  it("env 覆盖模型 / thinking / 超时", () => {
    process.env.AI_MODEL_PAPER_GEN = "qwen3.8-max";
    process.env.AI_THINKING_PAPER_GEN = "off";
    process.env.AI_TIMEOUT_MS_PAPER_GEN = "123456";

    const cfg = resolveTaskConfig("PAPER_GEN");
    expect(cfg.model).toBe("qwen3.8-max");
    expect(cfg.enableThinking).toBe(false);
    expect(cfg.timeoutMs).toBe(123456);
    // 静态 map 不随 env 变化：它只是默认值的快照，运行时以 resolveTaskConfig 为准。
    expect(TASK_MODEL_MAP.PAPER_GEN).toBe("qwen-max");
  });

  it("AI_THINKING_<KIND>=on 可显式开启思考", () => {
    process.env.AI_THINKING_PAPER_GEN = "on";
    expect(resolveTaskConfig("PAPER_GEN").enableThinking).toBe(true);
  });

  it("非法 env 值被忽略并回落到默认配置", () => {
    process.env.AI_THINKING_PAPER_GEN = "maybe";
    process.env.AI_TIMEOUT_MS_PAPER_GEN = "-5";
    process.env.AI_MODEL_PAPER_GEN = "   ";
    const cfg = resolveTaskConfig("PAPER_GEN");
    expect(cfg.enableThinking).toBe(false);
    expect(cfg.timeoutMs).toBe(600_000);
    expect(cfg.model).toBe("qwen-max");
  });

  it("env 覆盖只影响目标 taskKind，不串味", () => {
    process.env.AI_MODEL_PAPER_GEN = "qwen3.8-max";
    expect(resolveTaskConfig("LESSON_PLAN_GEN").model).toBe("qwen-max");
    expect(resolveTaskConfig("TUTOR_TURN").model).toBe("qwen-plus");
  });
});
