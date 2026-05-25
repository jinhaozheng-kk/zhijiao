import { describe, it, expect } from "vitest";
import { normalizeKpHint } from "@/server/lib/kp-reconcile";

describe("normalizeKpHint", () => {
  it("trim + collapse whitespace + lowercase", () => {
    expect(normalizeKpHint("  Linear Equation  ")).toBe("linear equation");
    expect(normalizeKpHint("一元\n一次\t方程")).toBe("一元 一次 方程");
    expect(normalizeKpHint("SIN x")).toBe("sin x");
  });

  it("preserves emoji and full-width chars", () => {
    expect(normalizeKpHint("题目：一元一次方程 🧮")).toBe("题目：一元一次方程 🧮");
  });

  it("empty / whitespace-only → empty string", () => {
    expect(normalizeKpHint("")).toBe("");
    expect(normalizeKpHint("   ")).toBe("");
  });
});

// 注：reconcileHintsSync 的覆盖在 integration 测例（kp-reconcile-sync-*.test.ts）
// 因为需要真 DB。本文件只覆盖纯函数。
