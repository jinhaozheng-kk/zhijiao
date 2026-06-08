# 初中数学中考风格出卷与打印排版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有 AI 出卷地基上，新增「初中数学通用中考风格」模板：先生成命题蓝图（题位/题型/分值/难度/能力/KP/命题意图），再按蓝图取题 + AI 补缺 + 自动审题，最后用真题卷式 A4 版面打印学生卷/教师卷。

**Architecture:** 不改 Prisma schema、不加 migration——蓝图作为生成快照进 `Paper.paramsJson`，沿用 `Paper`/`PaperItem`。蓝图（`ZhongkaoMathBlueprint`）与自动审题（`PaperReviewIssue`）都是**纯函数**，可单测、可在客户端预览页复用。生成沿用现有「按题型 best-effort 命中题库 + AI 补缺 + dedup + 计费补偿」机器，**不**重写 AI 契约为逐题接口（spec §4.3/§10 明确允许「v1 先小批量按题型生成，再对疑似题重生」）；蓝图的作用是决定**有哪些 slot 及其权威元数据**——生成回来的题按 (题型, 顺序) zip 到 slot 上，`points/difficulty/cognitiveLevel` 一律以 slot 为准（spec §4.2「不采信 AI 自行调整」）。审题 BLOCKER 触发该题型缺口重生（复用既有 attempt 循环），耗尽则整卷失败 + 走既有补偿扣费。

**Tech Stack:** Next.js 14 (app router) · tRPC · Zod · Prisma/Postgres · Vitest · Playwright · 包内 mock LLM adapter。

**关联 spec:** `docs/superpowers/specs/2026-06-08-junior-math-zhongkao-style-paper-design.md`
**关联实现:** Plan 17 AI 出卷、`2026-06-07-paper-exam-layout-and-structure`（结构化 + 统考排版）、Plan 13 KP 树、Plan 9 KP reconcile、Plan 3 计费补偿、Plan 6/12 PII 与 owner-only。

**全程命令前缀**（Windows PowerShell；单测用 `--filter`）：
- web 单测：`pnpm --filter @zhijiao/web test -- <path>`
- ai 单测：`pnpm --filter @zhijiao/ai test -- <path>`
- domain 单测：`pnpm --filter @zhijiao/domain test -- <path>`
- E2E：`pnpm --filter @zhijiao/web test:e2e`
- 全量类型：`pnpm typecheck`

**执行期修订（2026-06-08）：** `DIFFICULTY_DRIFT` 审题规则在 Task 8 集成时移除——v1 按题型批量生成 + slot 难度权威覆盖，原始 AI 难度与具体 slot 难度不可比，该 BLOCKER 会误杀几乎所有卷。改为不校验难度（per-slot 生成落地后再恢复，spec §10）。连带：Task 8 的 BLOCKER 退款测试改用 `EMPTY_ANSWER` 触发（非难度漂移）。

**执行期完成（2026-06-08）：** Phase 2 Task 9–15 已完成：打印作答区高度 helper、layout 元数据透传、学生/教师卷打印升级、print-view 蓝图透传、教师卷来源标记、一键中考入口、预览页蓝图/warning 面板、teacher-paper E2E 和文档 probes 均已落地。`playwright test --list` 当前为 27 tests；全量 E2E 为 27/27。

**两阶段（可分别合并）：**
- **Phase 1（Task 1–8）** 蓝图 + 生成 + 自动审题 + 合规黑词。产出可工作软件：教师可生成一份「中考风格」卷并落库，用**现有**打印页即可查看。
- **Phase 2（Task 9–14）** 真题卷式 A4 打印渲染器升级（作答区高度、客观题答题栏、分页规则、压轴分页、蓝图预览）。产出可工作软件：打印学生卷/教师卷直接 A4 可用。

---

## File Structure

**新建**
- `apps/web/lib/zhongkao-blueprint.ts` —— 纯函数：默认模板常量 + `buildZhongkaoMathBlueprint()`。客户端/服务端共用（无 `server-only`），镜像 `paper-exam-layout.ts` 的放置约定。
- `apps/web/tests/unit/zhongkao-blueprint.test.ts` —— 蓝图纯函数单测。
- `apps/web/server/lib/paper-review.ts` —— 纯函数自动审题：`reviewPaperSlot()` / `reviewAssembledPaper()`，无 DB、无 import "server-only"（被 router 与单测 import）。
- `apps/web/tests/unit/paper-review.test.ts` —— 审题规则单测。
- `apps/web/tests/integration/paper-generate-zhongkao.test.ts` —— 中考模板生成集成测试。

**修改**
- `packages/domain/src/compliance.ts` —— `FORBIDDEN_PHRASES` 增补中考相关黑词。
- `packages/domain/tests/compliance.test.ts` —— 覆盖新黑词（若文件不存在则新建）。
- `packages/ai/src/schemas.ts` —— `PaperGenItemSchema` 不变；新增 `PaperGenSlotHint`（可选）传 intent/constraints，`PaperGenerationInputSchema` 增 `styleRules?`/`slotHints?`。
- `packages/ai/src/router.ts` —— `generatePaper` 插值增 `styleRules`/`slotHints`。
- `packages/ai/src/prompts/paper-gen/v1.md` —— **新建 v2** `paper-gen/v2.md`（中考风格命题语言 + slot 提示）；router 默认仍 v1，中考模式传 v2。
- `apps/web/server/routers/paper.ts` —— `GenInput` 增 `styleTemplate?`；resolver 蓝图分支。
- `apps/web/lib/paper-copy.ts` —— 增 `AnswerAreaHint` 类型、`answerAreaHeight()`、`ZHONGKAO_TEMPLATE_LABEL` re-export。
- `apps/web/lib/paper-exam-layout.ts` —— `ExamLayoutPaperItem` 增 `answerAreaHint?`/`isCapstone?`；分组保留这两字段透传。
- `apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx` —— 作答区高度按 hint、压轴分页、客观题答题栏教师卷不提前露答案。
- `apps/web/app/teacher/papers/[paperId]/print/paper-print-view.tsx` —— 透传 `answerAreaHint`/`isCapstone`。
- `apps/web/app/teacher/papers/new/paper-generation-form.tsx` —— 「一键生成中考风格卷」入口。
- `apps/web/app/teacher/papers/[paperId]/paper-preview-view.tsx` —— 显示模板名 / 命题蓝图 / warning 提示。

**测试更新**
- `apps/web/tests/integration/paper-generate.test.ts`（既有路径不回退）。
- `apps/web/e2e/teacher-paper.spec.ts`（新增中考风格 E2E 截图）。
- `docs/claude/implementation-state.md` / `docs/claude/merge-verification.md`（落地后追加现状与探针）。

---

# Phase 1 —— 蓝图 + 生成 + 自动审题

## Task 1: 命题蓝图纯函数（类型 + 默认模板常量）

**Files:**
- Create: `apps/web/lib/zhongkao-blueprint.ts`
- Test: `apps/web/tests/unit/zhongkao-blueprint.test.ts`

- [ ] **Step 1: 写失败测试（类型/模板常量存在性 + 总分）**

```ts
// apps/web/tests/unit/zhongkao-blueprint.test.ts
import { describe, it, expect } from "vitest";
import {
  ZHONGKAO_TEMPLATE_ID,
  ZHONGKAO_GENERIC_TEMPLATE,
} from "@/lib/zhongkao-blueprint";

describe("ZHONGKAO_GENERIC_TEMPLATE 常量", () => {
  it("模板 id 固定为 v1 标识", () => {
    expect(ZHONGKAO_TEMPLATE_ID).toBe("JUNIOR_MATH_ZHONGKAO_GENERIC_V1");
  });

  it("默认满分 120 分：选择 10×3 + 填空 6×3 + 解答(6+6+8+8+10+10+12+12)", () => {
    let total = 0;
    for (const sec of ZHONGKAO_GENERIC_TEMPLATE) {
      total += sec.pointsLadder.reduce((a, b) => a + b, 0);
    }
    expect(total).toBe(120);
  });

  it("三大题顺序：选择题→填空题→解答题，题型映射到既有 QuestionType", () => {
    expect(ZHONGKAO_GENERIC_TEMPLATE.map((s) => s.questionType)).toEqual([
      "SINGLE_CHOICE",
      "FILL_BLANK",
      "ESSAY",
    ]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/zhongkao-blueprint.test.ts`
Expected: FAIL —— `Cannot find module '@/lib/zhongkao-blueprint'`。

- [ ] **Step 3: 写类型与默认模板常量**

```ts
// apps/web/lib/zhongkao-blueprint.ts
import type { GradeLevel, QuestionTypeValue, TextbookVersion, CognitiveLevelValue } from "./paper-copy";

export type SectionType = "选择题" | "填空题" | "解答题";
export type AnswerAreaHint = "short" | "medium" | "large" | "extraLarge";

export const ZHONGKAO_TEMPLATE_ID = "JUNIOR_MATH_ZHONGKAO_GENERIC_V1" as const;
export const ZHONGKAO_TEMPLATE_LABEL = "初中数学通用中考风格 v1";

export interface BlueprintTemplateSection {
  sectionType: SectionType;
  questionType: QuestionTypeValue;
  pointsLadder: number[];        // 每题位分值，长度即题量
  difficultyLadder: number[];    // 每题位难度，1–5，与 pointsLadder 等长
  cognitiveLevel: CognitiveLevelValue;
  intent: string;
  constraints: string[];
  capstoneTail: number;          // 本大题末尾 N 题标 isCapstone
}

// spec §2 默认结构。解答题统一映射到 ESSAY（同一大题），用分值/作答区/压轴区分层级，
// 避免 CALCULATION/PROOF/ESSAY 拆成多个 大题 破坏中考卷「三、解答题」单大题观感。
export const ZHONGKAO_GENERIC_TEMPLATE: BlueprintTemplateSection[] = [
  {
    sectionType: "选择题",
    questionType: "SINGLE_CHOICE",
    pointsLadder: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    difficultyLadder: [1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
    cognitiveLevel: "UNDERSTAND",
    intent: "考查基础概念辨析、基本运算、图形识别与函数图像",
    constraints: ["题干简洁", "只有一个正确答案", "不提示解法"],
    capstoneTail: 0,
  },
  {
    sectionType: "填空题",
    questionType: "FILL_BLANK",
    pointsLadder: [3, 3, 3, 3, 3, 3],
    difficultyLadder: [2, 2, 3, 3, 3, 4],
    cognitiveLevel: "APPLY",
    intent: "考查代数运算、几何性质、函数关系与数据处理",
    constraints: ["答案唯一", "不提供选项", "不提示解法"],
    capstoneTail: 0,
  },
  {
    sectionType: "解答题",
    questionType: "ESSAY",
    pointsLadder: [6, 6, 8, 8, 10, 10, 12, 12],
    difficultyLadder: [2, 2, 3, 3, 4, 4, 5, 5],
    cognitiveLevel: "ANALYZE",
    intent: "考查计算、证明、应用建模、函数综合与几何综合",
    constraints: ["解题步骤完整", "条件唯一确定", "不直接提示解法"],
    capstoneTail: 2,
  },
];
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/zhongkao-blueprint.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/zhongkao-blueprint.ts apps/web/tests/unit/zhongkao-blueprint.test.ts
git commit -m "feat(paper): zhongkao math blueprint template constants"
```

---

## Task 2: `buildZhongkaoMathBlueprint()` —— 题位展开 + KP 分配 + 压轴 + 作答区

**Files:**
- Modify: `apps/web/lib/zhongkao-blueprint.ts`
- Test: `apps/web/tests/unit/zhongkao-blueprint.test.ts:1-...`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 apps/web/tests/unit/zhongkao-blueprint.test.ts
import { buildZhongkaoMathBlueprint } from "@/lib/zhongkao-blueprint";

const KPS = [
  { id: "kp1", name: "一次函数" },
  { id: "kp2", name: "二元一次方程组" },
  { id: "kp3", name: "几何图形" },
];

describe("buildZhongkaoMathBlueprint", () => {
  it("展开 24 个连续题位，题号 1..24", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    expect(bp.slots).toHaveLength(24);
    expect(bp.slots.map((s) => s.questionNo)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1),
    );
  });

  it("末尾 2 道解答题标 isCapstone，作答区 extraLarge", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    const capstones = bp.slots.filter((s) => s.isCapstone);
    expect(capstones).toHaveLength(2);
    expect(capstones.map((s) => s.questionNo)).toEqual([23, 24]);
    expect(capstones.every((s) => s.answerAreaHint === "extraLarge")).toBe(true);
  });

  it("KP 轮转分配，每个 slot 至少一个 KP，且全部 KP 都被覆盖", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    expect(bp.slots.every((s) => s.kpIds.length >= 1)).toBe(true);
    const covered = new Set(bp.slots.flatMap((s) => s.kpIds));
    expect(covered).toEqual(new Set(["kp1", "kp2", "kp3"]));
  });

  it("少于 3 个 KP 视为专题卷 isTopical=true", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC",
      kps: [{ id: "kp1", name: "一次函数" }],
    });
    expect(bp.isTopical).toBe(true);
  });

  it("客观题 answerAreaHint=short；普通解答题按分值在 medium/large 间", () => {
    const bp = buildZhongkaoMathBlueprint({
      gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS,
    });
    const choice = bp.slots.find((s) => s.questionType === "SINGLE_CHOICE")!;
    expect(choice.answerAreaHint).toBe("short");
    const essayMid = bp.slots.find((s) => s.questionType === "ESSAY" && !s.isCapstone && s.points >= 10)!;
    expect(essayMid.answerAreaHint).toBe("large");
  });

  it("空 KP 抛错（非法输入）", () => {
    expect(() =>
      buildZhongkaoMathBlueprint({
        gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: [],
      }),
    ).toThrow(/至少一个知识点|kp/i);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/zhongkao-blueprint.test.ts`
Expected: FAIL —— `buildZhongkaoMathBlueprint is not a function`。

- [ ] **Step 3: 实现 builder + 接口**

追加到 `apps/web/lib/zhongkao-blueprint.ts`：

```ts
export interface BlueprintSlot {
  questionNo: number;
  sectionType: SectionType;
  questionType: QuestionTypeValue;
  points: number;
  difficulty: number;
  cognitiveLevel: CognitiveLevelValue;
  kpIds: string[];
  kpNames: string[];
  intent: string;
  constraints: string[];
  answerAreaHint: AnswerAreaHint;
  isCapstone: boolean;
}

export interface ZhongkaoMathBlueprint {
  styleTemplate: typeof ZHONGKAO_TEMPLATE_ID;
  blueprintVersion: "v1";
  examStage: "ZHONGKAO";
  subject: "MATH";
  gradeLevel: GradeLevel;
  durationMinutes: number;
  textbookVersion: TextbookVersion;
  isTopical: boolean;
  slots: BlueprintSlot[];
}

const TOPICAL_KP_THRESHOLD = 3; // 少于 3 个 KP → 专题练习卷

function answerAreaHintFor(args: { questionType: QuestionTypeValue; points: number; isCapstone: boolean }): AnswerAreaHint {
  if (args.questionType === "SINGLE_CHOICE" || args.questionType === "MULTI_CHOICE") return "short";
  if (args.questionType === "FILL_BLANK") return "short";
  if (args.isCapstone) return "extraLarge";
  return args.points >= 10 ? "large" : "medium";
}

export function buildZhongkaoMathBlueprint(args: {
  gradeLevel: GradeLevel;
  durationMinutes: number;
  textbookVersion: TextbookVersion;
  kps: Array<{ id: string; name: string }>;
}): ZhongkaoMathBlueprint {
  if (args.kps.length === 0) throw new Error("中考风格卷至少一个知识点");

  const slots: BlueprintSlot[] = [];
  let questionNo = 0;
  let kpCursor = 0;

  for (const sec of ZHONGKAO_GENERIC_TEMPLATE) {
    const count = sec.pointsLadder.length;
    for (let i = 0; i < count; i++) {
      questionNo += 1;
      const isCapstone = i >= count - sec.capstoneTail;
      const points = sec.pointsLadder[i]!;
      const difficulty = sec.difficultyLadder[i]!;
      const kp = args.kps[kpCursor % args.kps.length]!;
      kpCursor += 1;
      slots.push({
        questionNo,
        sectionType: sec.sectionType,
        questionType: sec.questionType,
        points,
        difficulty,
        cognitiveLevel: sec.cognitiveLevel,
        kpIds: [kp.id],
        kpNames: [kp.name],
        intent: sec.intent,
        constraints: sec.constraints,
        answerAreaHint: answerAreaHintFor({ questionType: sec.questionType, points, isCapstone }),
        isCapstone,
      });
    }
  }

  return {
    styleTemplate: ZHONGKAO_TEMPLATE_ID,
    blueprintVersion: "v1",
    examStage: "ZHONGKAO",
    subject: "MATH",
    gradeLevel: args.gradeLevel,
    durationMinutes: args.durationMinutes,
    textbookVersion: args.textbookVersion,
    isTopical: args.kps.length < TOPICAL_KP_THRESHOLD,
    slots,
  };
}
```

> **KP 覆盖保证（测试 3）：** 轮转分配下，只要 `slots.length (24) >= kps.length`，每个 KP 必被覆盖。若未来 KP 数 > slot 数需另设守卫，v1 KP 上限远小于 24，不处理。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/zhongkao-blueprint.test.ts`
Expected: PASS（全部 passed）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/zhongkao-blueprint.ts apps/web/tests/unit/zhongkao-blueprint.test.ts
git commit -m "feat(paper): buildZhongkaoMathBlueprint slot expansion + kp rotation"
```

---

## Task 3: 自动审题纯函数 `paper-review.ts`（结构 + 合规 + 数学质量）

**Files:**
- Create: `apps/web/server/lib/paper-review.ts`
- Test: `apps/web/tests/unit/paper-review.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/tests/unit/paper-review.test.ts
import { describe, it, expect } from "vitest";
import { reviewPaperSlot, type ReviewableItem } from "@/server/lib/paper-review";
import type { BlueprintSlot } from "@/lib/zhongkao-blueprint";

const choiceSlot: BlueprintSlot = {
  questionNo: 1, sectionType: "选择题", questionType: "SINGLE_CHOICE",
  points: 3, difficulty: 2, cognitiveLevel: "UNDERSTAND",
  kpIds: ["kp1"], kpNames: ["一次函数"], intent: "x", constraints: [],
  answerAreaHint: "short", isCapstone: false,
};
const okChoice: ReviewableItem = {
  stemMd: "下列哪个点在直线 y=2x 上？", type: "SINGLE_CHOICE",
  options: ["(0,0)", "(1,1)", "(1,3)", "(2,1)"],
  answerMd: "A", solutionMd: "代入验证 (0,0) 满足。", difficulty: 2, points: 3,
};

describe("reviewPaperSlot 结构校验", () => {
  it("合格选择题无 issue", () => {
    expect(reviewPaperSlot(choiceSlot, okChoice)).toEqual([]);
  });

  it("题型不匹配 → BLOCKER TYPE_MISMATCH", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, type: "FILL_BLANK" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "TYPE_MISMATCH" }));
  });

  it("选择题选项 ≠ 4 → BLOCKER CHOICE_OPTION_COUNT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, options: ["A", "B", "C"] });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "CHOICE_OPTION_COUNT" }));
  });

  it("难度偏离 slot 超过 1 档 → BLOCKER DIFFICULTY_DRIFT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, difficulty: 5 });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "DIFFICULTY_DRIFT" }));
  });

  it("答案为空 → BLOCKER EMPTY_ANSWER", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, answerMd: "  " });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "EMPTY_ANSWER" }));
  });

  it("填空题输出选项 → BLOCKER FILL_HAS_OPTIONS", () => {
    const fillSlot: BlueprintSlot = { ...choiceSlot, questionType: "FILL_BLANK", sectionType: "填空题" };
    const issues = reviewPaperSlot(fillSlot, {
      stemMd: "x+1=3，则 x=____", type: "FILL_BLANK", options: ["1", "2"],
      answerMd: "2", solutionMd: "移项得 x=2。", difficulty: 2, points: 3,
    });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "FILL_HAS_OPTIONS" }));
  });

  it("禁词命中 → BLOCKER FORBIDDEN_PHRASE", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, solutionMd: "本题为今年必考押题。" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "FORBIDDEN_PHRASE" }));
  });

  it("AI 生成痕迹 → WARNING AI_ARTIFACT", () => {
    const issues = reviewPaperSlot(choiceSlot, { ...okChoice, stemMd: "作为 AI，我给出：下列哪个点在 y=2x 上？" });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "WARNING", code: "AI_ARTIFACT" }));
  });

  it("解答题缺解析 → BLOCKER MISSING_SOLUTION", () => {
    const essaySlot: BlueprintSlot = { ...choiceSlot, questionType: "ESSAY", sectionType: "解答题", points: 10, answerAreaHint: "large" };
    const issues = reviewPaperSlot(essaySlot, {
      stemMd: "求证 ...", type: "ESSAY", answerMd: "见解析", solutionMd: "  ", difficulty: 2, points: 10,
    });
    expect(issues).toContainEqual(expect.objectContaining({ severity: "BLOCKER", code: "MISSING_SOLUTION" }));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-review.test.ts`
Expected: FAIL —— `Cannot find module '@/server/lib/paper-review'`。

- [ ] **Step 3: 实现审题纯函数**

```ts
// apps/web/server/lib/paper-review.ts
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
const STEM_LEN_WARN = 600; // 题干字数 warning 阈值

export function reviewPaperSlot(slot: BlueprintSlot, item: ReviewableItem): PaperReviewIssue[] {
  const issues: PaperReviewIssue[] = [];
  const push = (severity: PaperReviewSeverity, code: string, message: string) =>
    issues.push({ slotQuestionNo: slot.questionNo, severity, code, message });

  // —— 结构校验 ——
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

  // —— 数学质量 ——
  if (item.answerMd.trim().length === 0) push("BLOCKER", "EMPTY_ANSWER", "答案不能为空");

  // —— 合规与语言 ——
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
```

> **注意：** 「必考/押题」要进 `FORBIDDEN_PHRASE` 命中，需 Task 4 先把这些词加进 `FORBIDDEN_PHRASES`。本测试里 `禁词命中` 用例依赖 Task 4 —— **Task 3、Task 4 视为一组**，先写 Task 3 实现，再做 Task 4，最后一并跑绿。若严格 TDD 要求该用例此刻就过，可临时在测试用 `保证提分`（既有黑词），Task 4 落地后改回 `必考押题`。

- [ ] **Step 4: 运行（禁词用例预期此刻红，其余绿）**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-review.test.ts`
Expected: 除 `禁词命中` 外全 PASS；该用例在 Task 4 后转绿。

- [ ] **Step 5: 提交**

```bash
git add apps/web/server/lib/paper-review.ts apps/web/tests/unit/paper-review.test.ts
git commit -m "feat(paper): pure auto-review rules for zhongkao blueprint slots"
```

---

## Task 4: 合规黑词增补（必考/押题/预测题/原题还原）

**Files:**
- Modify: `packages/domain/src/compliance.ts:2-12`
- Test: `packages/domain/tests/compliance.test.ts`

- [ ] **Step 1: 写失败测试（新建或追加）**

```ts
// packages/domain/tests/compliance.test.ts
import { describe, it, expect } from "vitest";
import { findForbidden } from "../src/compliance.js";

describe("findForbidden 中考相关黑词", () => {
  it.each(["押题", "必考", "预测题", "原题还原", "考前答案"])(
    "命中 %s",
    (phrase) => {
      expect(findForbidden(`这是${phrase}范例`)).toContain(phrase);
    },
  );
  it("正常题干不误伤", () => {
    expect(findForbidden("求一次函数 y=2x+1 的图象与 x 轴交点。")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/domain test -- tests/compliance.test.ts`
Expected: FAIL —— `押题/必考/...` 不在命中列表。

- [ ] **Step 3: 增补黑词**

`packages/domain/src/compliance.ts` 的 `FORBIDDEN_PHRASES` 数组追加（保持既有项不动）：

```ts
  "代做作业",
  "押题",
  "必考",
  "预测题",
  "原题还原",
  "还原原题",
  "考前答案",
```

> **注意「内幕」已在列**；spec §7 的「内部题/考前答案/通过保证」中，「保证通过」「内幕」已有，新增「考前答案」。不加「预测」单字（命题预测中心的合规许可语含「趋势研判」，但「预测」单字过宽会误伤——只加「预测题」）。

- [ ] **Step 4: 运行确认通过（含 Task 3 的禁词用例）**

Run: `pnpm --filter @zhijiao/domain test -- tests/compliance.test.ts`
然后：`pnpm --filter @zhijiao/web test -- tests/unit/paper-review.test.ts`
Expected: 两者全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/domain/src/compliance.ts packages/domain/tests/compliance.test.ts
git commit -m "feat(compliance): forbid zhongkao marketing phrases (押题/必考/...)"
```

---

## Task 5: AI 契约扩展 —— slot 提示 + 中考风格 styleRules（schema + 类型）

**Files:**
- Modify: `packages/ai/src/schemas.ts:227-235`
- Test: `packages/ai/tests/paper-gen-schema.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/ai/tests/paper-gen-schema.test.ts （若已存在则追加 describe）
import { describe, it, expect } from "vitest";
import { PaperGenerationInputSchema } from "../src/schemas.js";

describe("PaperGenerationInputSchema 中考扩展", () => {
  it("接受可选 styleRules 与 slotHints", () => {
    const parsed = PaperGenerationInputSchema.parse({
      subject: "数学", gradeLevel: "G9", kpNames: ["一次函数"],
      sections: [{ type: "SINGLE_CHOICE", count: 2 }],
      difficultyRange: [1, 3],
      styleRules: ["题干使用正式考试语言"],
      slotHints: [{ type: "SINGLE_CHOICE", intent: "考查基础概念", constraints: ["只有一个正确答案"] }],
    });
    expect(parsed.styleRules).toEqual(["题干使用正式考试语言"]);
    expect(parsed.slotHints?.[0]?.intent).toBe("考查基础概念");
  });

  it("不传扩展字段仍向后兼容", () => {
    const parsed = PaperGenerationInputSchema.parse({
      subject: "数学", gradeLevel: "G9", kpNames: ["一次函数"],
      sections: [{ type: "FILL_BLANK", count: 1 }], difficultyRange: [2, 4],
    });
    expect(parsed.styleRules).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/ai test -- tests/paper-gen-schema.test.ts`
Expected: FAIL —— schema 不识别 `styleRules`（passthrough 会丢失或严格模式报错）。

- [ ] **Step 3: 扩展 schema**

`packages/ai/src/schemas.ts`，在 `PaperGenerationInputSchema` 内增两个可选字段（其余不动）：

```ts
export const PaperGenSlotHintSchema = z.object({
  type: PaperItemTypeEnum,
  intent: z.string(),
  constraints: z.array(z.string()).default([]),
});
export const PaperGenerationInputSchema = z.object({
  subject: z.string(),
  gradeLevel: z.string(),
  kpNames: z.array(z.string()).min(1),
  sections: z.array(PaperGenSectionSchema).min(1),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  textbookVersion: z.string().optional(),
  excludeStems: z.array(z.string()).default([]),
  styleRules: z.array(z.string()).optional(),
  slotHints: z.array(PaperGenSlotHintSchema).optional(),
});
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/ai test -- tests/paper-gen-schema.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/ai/src/schemas.ts packages/ai/tests/paper-gen-schema.test.ts
git commit -m "feat(ai): paper-gen input accepts styleRules + slotHints"
```

---

## Task 6: 中考风格 prompt v2 + router 插值 + mock 派发

**Files:**
- Create: `packages/ai/src/prompts/paper-gen/v2.md`
- Modify: `packages/ai/src/router.ts:692-732`
- Modify: `packages/ai/src/adapters/mock.ts:191-207`（mock 关键词分发，新增中考风格不影响——复用 `buildMockPaper`）
- Test: `packages/ai/tests/generate-paper.test.ts`

- [ ] **Step 1: 写失败测试（中考模式插值 styleRules 进 prompt）**

```ts
// packages/ai/tests/generate-paper.test.ts （追加）
import { describe, it, expect } from "vitest";
import { createTestAiRouter } from "./helpers/test-router.js"; // 复用既有 helper；若名不同按既有文件改

describe("generatePaper 中考风格", () => {
  it("传 promptVersion=v2 + styleRules 时仍返回合法 PaperGenerationOutput（mock）", async () => {
    const ai = createTestAiRouter({ promptVersion: "v2" });
    const out = await ai.generatePaper({
      subject: "数学", gradeLevel: "G9", kpNames: ["一次函数"],
      sections: [{ type: "SINGLE_CHOICE", count: 2 }],
      difficultyRange: [1, 3],
      styleRules: ["题干使用正式考试语言", "不使用押题、预测、必考等词"],
      slotHints: [{ type: "SINGLE_CHOICE", intent: "考查基础概念", constraints: ["只有一个正确答案"] }],
    });
    expect(out.items.length).toBe(2);
    expect(out.items.every((i) => i.type === "SINGLE_CHOICE")).toBe(true);
  });
});
```

> 注：`generate-paper.test.ts` 已存在并有 mock router 构造方式（见仓库），按既有 helper 形态写。若既有测试用 `MockAdapter` 直接构造，沿用之；上面 `createTestAiRouter` 为占位名，落地时对齐既有文件实际写法。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/ai test -- tests/generate-paper.test.ts`
Expected: FAIL —— `loadPrompt("paper-gen","v2")` 找不到 v2.md。

- [ ] **Step 3: 新建 v2 prompt**

```markdown
<!-- packages/ai/src/prompts/paper-gen/v2.md -->
你是严谨的 K12 数学练习卷命题助手。请生成符合初中数学中考命题风格的**原创**练习卷题目，只输出 JSON。

- 学科：{{subject}}
- 年级：{{gradeLevel}}
- 教材版本：{{textbookVersion}}
- 知识点：{{kpNames}}
- 各题型题数：{{sections}}
- 难度范围（1–5）：{{difficultyRange}}
- 需避免与以下题重复（题干摘要）：{{excludeStems}}
- 命题意图与约束（按题型）：{{slotHints}}
- 风格要求：{{styleRules}}

SECTIONS_JSON：{{sectionsJson}}

要求：
- 严格按"各题型题数"生成对应数量的题，题型只取所列。
- 题干使用正式考试语言，克制、准确，无教辅营销味。
- 覆盖给定知识点，难度落在范围内，贴合所给教材版本的表述习惯。
- 每题给出标准答案（answerMd）与分步解析（solutionMd）；解答题/证明题给评分标准（rubricMd）。
- 标注每题 cognitiveLevel ∈ {REMEMBER,UNDERSTAND,APPLY,ANALYZE} 与 points（整数）。
- knowledgePointHints 用中文知识点名。
- 全部原创题，不得复制任何真题题干/答案/解析。
- 严禁出现"押题/预测/必考/原题还原/提分/涨分/保过/通过保证/分数承诺/内幕"等措辞，不得制造焦虑。
- 严禁出现"作为 AI / 作为语言模型"等生成痕迹。
- 只输出 JSON：{ "title": string, "items": [{ "stemMd","type","options"?,"answerMd","solutionMd","rubricMd"?,"difficulty","cognitiveLevel","points","knowledgePointHints" }] }
```

- [ ] **Step 4: router 插值新增 styleRules / slotHints**

`packages/ai/src/router.ts` 的 `generatePaper`，在 `userContent = prompt.interpolate({...})` 内补两行（其余不动）：

```ts
    const userContent = prompt.interpolate({
      subject: parsed.subject,
      gradeLevel: parsed.gradeLevel,
      kpNames: parsed.kpNames.join(", "),
      textbookVersion: parsed.textbookVersion ?? "通用",
      sections: sectionsHuman,
      sectionsJson: JSON.stringify(parsed.sections),
      difficultyRange: `${parsed.difficultyRange[0]}-${parsed.difficultyRange[1]}`,
      excludeStems: parsed.excludeStems.length ? parsed.excludeStems.join(" / ") : "(无)",
      styleRules: parsed.styleRules?.length ? parsed.styleRules.join("；") : "(无)",
      slotHints: parsed.slotHints?.length
        ? parsed.slotHints.map((h) => `${h.type}: ${h.intent}（${h.constraints.join("、")}）`).join(" / ")
        : "(无)",
    });
```

> v1.md 不含 `{{styleRules}}`/`{{slotHints}}` 占位符；`interpolate` 对多余 key 应忽略（确认既有 `Prompt.interpolate` 行为；若严格匹配会报错，则 v1 模式只传它需要的 key——见落地时分支）。最稳妥：仅当 `promptVersion==="v2"` 时附加这两 key。落地用：
>
> ```ts
> const base = { subject: ..., /* 既有 7 个 key */ };
> const userContent = prompt.interpolate(
>   prompt.version === "v2"
>     ? { ...base, styleRules: ..., slotHints: ... }
>     : base,
> );
> ```
> 取 `prompt.version` 来自 `loadPrompt` 返回对象（确认其字段名；若无 version 字段，用 `this.opts.promptVersion === "v2"` 判断）。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @zhijiao/ai test -- tests/generate-paper.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/ai/src/prompts/paper-gen/v2.md packages/ai/src/router.ts packages/ai/tests/generate-paper.test.ts
git commit -m "feat(ai): zhongkao-style paper-gen v2 prompt with slot hints + style rules"
```

---

## Task 7: 出题接口分配 helper —— 蓝图 → AI sections + slotHints；items zip 回 slot

**Files:**
- Create: 复用 `apps/web/lib/zhongkao-blueprint.ts`，追加 `blueprintToAiSections()` + `assignItemsToSlots()`
- Test: `apps/web/tests/unit/zhongkao-blueprint.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 apps/web/tests/unit/zhongkao-blueprint.test.ts
import { blueprintToAiSections, assignItemsToSlots } from "@/lib/zhongkao-blueprint";

describe("blueprintToAiSections", () => {
  it("聚合 slot 为按题型计数 + slotHints（每题型一条）", () => {
    const bp = buildZhongkaoMathBlueprint({ gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS });
    const { sections, slotHints } = blueprintToAiSections(bp);
    expect(sections).toEqual([
      { type: "SINGLE_CHOICE", count: 10 },
      { type: "FILL_BLANK", count: 6 },
      { type: "ESSAY", count: 8 },
    ]);
    expect(slotHints.map((h) => h.type)).toEqual(["SINGLE_CHOICE", "FILL_BLANK", "ESSAY"]);
  });
});

describe("assignItemsToSlots", () => {
  it("按题型顺序把题 zip 到 slot，item 保留 RAW 值，slot 为权威元数据来源", () => {
    const bp = buildZhongkaoMathBlueprint({ gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS });
    // 占位题给离谱难度/分值；assignItemsToSlots **不覆盖**——审题需看 RAW 值（DIFFICULTY_DRIFT 才有意义）。
    const items = bp.slots.map((s) => ({
      stemMd: `题 ${s.questionNo}`, type: s.questionType, answerMd: "ans",
      solutionMd: "sol", difficulty: 99, cognitiveLevel: "REMEMBER" as const,
      points: 999, knowledgePointHints: [],
    }));
    const pairs = assignItemsToSlots(bp, items);
    expect(pairs).toHaveLength(24);
    // item 仍是原始值（不在此覆盖）：
    expect(pairs[0]!.item.difficulty).toBe(99);
    // slot 携带权威元数据，落库时由调用方用 slot 覆盖：
    expect(pairs[0]!.slot.points).toBe(bp.slots[0]!.points);
    expect(pairs[0]!.slot.difficulty).toBe(bp.slots[0]!.difficulty);
    expect(pairs[0]!.slot.cognitiveLevel).toBe(bp.slots[0]!.cognitiveLevel);
  });

  it("某题型题数不足时抛 INSUFFICIENT —— 由调用方决定重生", () => {
    const bp = buildZhongkaoMathBlueprint({ gradeLevel: "G9", durationMinutes: 120, textbookVersion: "GENERIC", kps: KPS });
    expect(() => assignItemsToSlots(bp, [])).toThrow(/INSUFFICIENT/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/zhongkao-blueprint.test.ts`
Expected: FAIL —— 两函数未定义。

- [ ] **Step 3: 实现两 helper**

追加到 `apps/web/lib/zhongkao-blueprint.ts`：

```ts
export interface BlueprintAiInputs {
  sections: Array<{ type: QuestionTypeValue; count: number }>;
  slotHints: Array<{ type: QuestionTypeValue; intent: string; constraints: string[] }>;
}

export function blueprintToAiSections(bp: ZhongkaoMathBlueprint): BlueprintAiInputs {
  const order: QuestionTypeValue[] = [];
  const counts = new Map<QuestionTypeValue, number>();
  const hints = new Map<QuestionTypeValue, { intent: string; constraints: string[] }>();
  for (const slot of bp.slots) {
    if (!counts.has(slot.questionType)) order.push(slot.questionType);
    counts.set(slot.questionType, (counts.get(slot.questionType) ?? 0) + 1);
    if (!hints.has(slot.questionType)) hints.set(slot.questionType, { intent: slot.intent, constraints: slot.constraints });
  }
  return {
    sections: order.map((type) => ({ type, count: counts.get(type)! })),
    slotHints: order.map((type) => ({ type, ...hints.get(type)! })),
  };
}

// 生成回来的题（任意来源：题库 + AI）按题型顺序 zip 到 slot；slot 元数据权威。
export interface AssignableItem {
  stemMd: string;
  type: QuestionTypeValue;
  options?: string[];
  answerMd: string;
  solutionMd: string;
  rubricMd?: string;
  difficulty: number;
  cognitiveLevel: CognitiveLevelValue;
  points: number;
  knowledgePointHints: string[];
}

export interface AssignedPair {
  slot: BlueprintSlot;   // 权威元数据：落库用 slot.points/difficulty/cognitiveLevel
  item: AssignableItem;  // RAW AI/题库原值，未覆盖——供审题比对（如 DIFFICULTY_DRIFT）
}

// 仅 zip，不覆盖。覆盖延后到落库（见 router）；审题在覆盖前跑，才能比 RAW 难度。
export function assignItemsToSlots(bp: ZhongkaoMathBlueprint, items: AssignableItem[]): AssignedPair[] {
  const byType = new Map<QuestionTypeValue, AssignableItem[]>();
  for (const it of items) {
    const list = byType.get(it.type) ?? [];
    list.push(it);
    byType.set(it.type, list);
  }
  const cursors = new Map<QuestionTypeValue, number>();
  const pairs: AssignedPair[] = [];
  for (const slot of bp.slots) {
    const pool = byType.get(slot.questionType) ?? [];
    const idx = cursors.get(slot.questionType) ?? 0;
    const raw = pool[idx];
    if (!raw) throw new Error(`INSUFFICIENT_ITEMS_FOR_TYPE:${slot.questionType}`);
    cursors.set(slot.questionType, idx + 1);
    pairs.push({ slot, item: raw });
  }
  return pairs;
}

// 落库前把 slot 权威元数据应用到 item（spec §4.2「不采信 AI 自行调整」）。
export function applySlotMetadata(pair: AssignedPair): AssignableItem {
  return {
    ...pair.item,
    points: pair.slot.points,
    difficulty: pair.slot.difficulty,
    cognitiveLevel: pair.slot.cognitiveLevel,
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/zhongkao-blueprint.test.ts`
Expected: PASS（全部）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/zhongkao-blueprint.ts apps/web/tests/unit/zhongkao-blueprint.test.ts
git commit -m "feat(paper): blueprintToAiSections + assignItemsToSlots + applySlotMetadata"
```

---

## Task 8: router 中考分支 —— 生成 + 审题 + 重生 + 落 paramsJson（集成）

**Files:**
- Modify: `apps/web/server/routers/paper.ts:17-182`
- Test: `apps/web/tests/integration/paper-generate-zhongkao.test.ts`

- [ ] **Step 1: 写失败集成测试**

```ts
// apps/web/tests/integration/paper-generate-zhongkao.test.ts
// 镜像 paper-generate.test.ts 的 mock + fixtures 模式（getAiRouter 被 vi.mock）。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx } from "./_helpers/error-book-fixtures";

const { generatePaperMock } = vi.hoisted(() => ({ generatePaperMock: vi.fn() }));
vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({ generatePaper: generatePaperMock }) }));
const { appRouter } = await import("@/server/routers/_root");

// mock 按请求 sections 造题；难度/分值/能力都给「非模板值」，验证落库时被 slot 覆盖。
function mockGenerate(input: { sections?: Array<{ type: string; count: number }> }) {
  const items: any[] = [];
  let n = 0;
  for (const s of input.sections ?? []) {
    for (let i = 0; i < s.count; i++) {
      items.push({
        stemMd: `${String.fromCharCode(97 + (n % 26))} ${s.type} 原创题 ${++n}`,
        type: s.type,
        options: s.type === "SINGLE_CHOICE" ? ["甲", "乙", "丙", "丁"] : undefined,
        answerMd: "答", solutionMd: "分步解析。",
        difficulty: 2, cognitiveLevel: "APPLY", points: 5,
        knowledgePointHints: ["一次函数"],
      });
    }
  }
  return { title: "卷", modelCallId: "mc1", items };
}

async function seedTeacher(balance: number) {
  const u = await prisma.user.create({ data: { persona: "TEACHER" } });
  await prisma.wallet.create({ data: { userId: u.id, balance } });
  const subject = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  const kp = await prisma.knowledgePoint.upsert({
    where: { subjectId_code: { subjectId: subject.id, code: "math-g8-linear-eq-solve" } },
    create: { subjectId: subject.id, code: "math-g8-linear-eq-solve", name: "一次方程求解" },
    update: {},
  });
  return { id: u.id, subjectId: subject.id, kpId: kp.id };
}

beforeEach(async () => {
  await resetDb();
  generatePaperMock.mockReset();
  generatePaperMock.mockImplementation(mockGenerate);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("paper.generate 中考风格模板", () => {
  it("styleTemplate 模式：落库 24 题 + paramsJson 含 blueprint + styleTemplate", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      clientRequestId: crypto.randomUUID(),
    });
    const paper = await prisma.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: true } });
    expect(paper.items).toHaveLength(24);
    const params = paper.paramsJson as any;
    expect(params.styleTemplate).toBe("JUNIOR_MATH_ZHONGKAO_GENERIC_V1");
    expect(params.blueprint.slots).toHaveLength(24);
  });

  it("落库分值/难度/能力以 slot 为准（覆盖 mock 自报的 5 分/难度 2/APPLY）", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const { paperId } = await caller.paper.generate({
      subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      clientRequestId: crypto.randomUUID(),
    });
    const items = await prisma.paperItem.findMany({ where: { paperId }, orderBy: { position: "asc" } });
    const firstChoice = items.find((i) => i.type === "SINGLE_CHOICE")!;
    expect(firstChoice.points).toBe(3);       // slot 模板分值，非 mock 的 5
    expect(firstChoice.difficulty).toBe(1);   // 选择题首位 slot 难度 1
    expect(items.reduce((n, i) => n + i.points, 0)).toBe(120); // 总分
  });

  it("BLOCKER（mock 返回题型不符的题）→ BAD_REQUEST + 退款（余额回到 100）", async () => {
    const t = await seedTeacher(100);
    // 让 mock 把 SINGLE_CHOICE 题型故意返回成 FILL_BLANK → reviewPaperSlot TYPE_MISMATCH BLOCKER
    generatePaperMock.mockImplementation((input: any) => {
      const out = mockGenerate(input);
      const bad = out.items.find((i: any) => i.type === "SINGLE_CHOICE");
      if (bad) bad.type = "FILL_BLANK";
      return out;
    });
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    await expect(
      caller.paper.generate({
        subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G9",
        styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
        clientRequestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: t.id } });
    expect(wallet.balance).toBe(100); // 计费补偿后净额 0
  });
});
```

> **注意 BLOCKER 测试的脆弱点：** mock 把某 SINGLE_CHOICE 题改成 FILL_BLANK 后，该题会被归到 FILL_BLANK 池，导致 SINGLE_CHOICE 池少一题 → `assignItemsToSlots` 可能先抛 `INSUFFICIENT`（被 attempt 循环补生）而非走到审题。落地时若如此，改用「mock 返回某题 `difficulty: 5`」触发 `DIFFICULTY_DRIFT` BLOCKER（不改题型、不破坏题数），更稳。两种触发法择一即可。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generate-zhongkao.test.ts`
Expected: FAIL —— `styleTemplate` 不在 `GenInput`，schema 报错。

- [ ] **Step 3: router 实现中考分支**

`apps/web/server/routers/paper.ts`：

3a. `GenInput` 增可选字段（`sections` 改为可选，中考模式不需要手填）：

```ts
const GenInput = z.object({
  subjectId: z.string().cuid(),
  kpIds: z.array(z.string().cuid()).min(1),
  gradeLevel: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]),
  styleTemplate: z.literal("JUNIOR_MATH_ZHONGKAO_GENERIC_V1").optional(),
  sections: z
    .array(Section)
    .min(1)
    .refine((s) => new Set(s.map((x) => x.type)).size === s.length, "题型不可重复")
    .refine((s) => s.reduce((n, x) => n + x.count, 0) <= 30, "总题量不超过 30 题")
    .refine((s) => s.reduce((n, x) => n + x.count, 0) >= 1, "至少 1 题")
    .optional(),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]).optional(),
  durationMinutes: z.number().int().min(1).max(300).optional(),
  textbookVersion: z.string().default("GENERIC"),
  clientRequestId: z.string().uuid(),
}).refine((v) => v.styleTemplate || (v.sections && v.difficultyRange), {
  message: "需指定 styleTemplate 或 sections+difficultyRange",
});
```

3b. resolver 顶部：中考模式先建蓝图，派生 `sections`/`difficultyRange`/`durationMinutes`/`styleRules`/`slotHints`，其余生成机器复用。新增 import：

```ts
import { buildZhongkaoMathBlueprint, blueprintToAiSections, assignItemsToSlots, applySlotMetadata, ZHONGKAO_TEMPLATE_ID, type ZhongkaoMathBlueprint, type AssignedPair } from "@/lib/zhongkao-blueprint";
import { reviewAssembledPaper } from "../lib/paper-review.js";
import { type TextbookVersion, type CognitiveLevelValue } from "@/lib/paper-copy";
```

在 KP 校验（kps fetch）之后插入：

```ts
      // —— 中考风格分支：用蓝图派生生成参数 ——
      let blueprint: ZhongkaoMathBlueprint | null = null;
      let effSections = input.sections;
      let effDifficulty = input.difficultyRange;
      let effDuration = input.durationMinutes;
      let styleRules: string[] | undefined;
      let slotHints: Array<{ type: QuestionType; intent: string; constraints: string[] }> | undefined;
      let promptVersion: "v1" | "v2" = "v1";

      if (input.styleTemplate === ZHONGKAO_TEMPLATE_ID) {
        blueprint = buildZhongkaoMathBlueprint({
          gradeLevel: input.gradeLevel,
          durationMinutes: input.durationMinutes ?? 120,
          textbookVersion: (input.textbookVersion as TextbookVersion) ?? "GENERIC",
          kps,
        });
        const ai = blueprintToAiSections(blueprint);
        effSections = ai.sections.map((s) => ({ type: s.type, count: s.count, pointsPerItem: 1 })); // pointsPerItem 占位，最终以 slot 为准
        effDifficulty = [1, 5];
        effDuration = blueprint.durationMinutes;
        slotHints = ai.slotHints;
        styleRules = ["题干使用正式考试语言", "避免教辅营销表达", "不使用押题、预测、必考等词", "解析步骤完整但不冗长"];
        promptVersion = "v2";
      }
```

> 之后，把原 resolver 内对 `input.sections` / `input.difficultyRange` / `input.durationMinutes` 的引用改为 `effSections` / `effDifficulty` / `effDuration`。`getAiRouter` 需支持传 promptVersion 与 styleRules/slotHints——见 3c。

3c. AI 调用处（`getAiRouter(...).generatePaper({...})`）传入新字段。`getAiRouter` 当前签名仅 userId；扩展为可接 `{ promptVersion }`（确认 `apps/web/lib/ai-client.ts` 的 `getAiRouter` 实现，给它加可选第二参把 promptVersion 透传到 AiRouter 构造的 `opts.promptVersion`）。`generatePaper` 调用：

```ts
          ai = await getAiRouter(ctx.auth.userId, { promptVersion }).generatePaper({
            subject: "数学",
            gradeLevel: input.gradeLevel,
            kpNames,
            sections: aiSections,
            difficultyRange: effDifficulty!,
            textbookVersion: input.textbookVersion,
            excludeStems,
            ...(styleRules ? { styleRules } : {}),
            ...(slotHints ? { slotHints: slotHints.map((h) => ({ type: h.type, intent: h.intent, constraints: h.constraints })) } : {}),
          });
```

3d. 落库前（`persistGeneratedPaper` 之前），中考模式做 zip + 审题。把 bank+ai 合并成一个 `AssignableItem[]`（题库题补 cognitiveLevel/points 占位，会被 slot 覆盖），调用 `assignItemsToSlots`，再 `reviewAssembledPaper`：

```ts
      let assignedPairs: AssignedPair[] | null = null;
      let reviewIssues: import("../lib/paper-review.js").PaperReviewIssue[] = [];
      if (blueprint) {
        // merged 保留 RAW 难度/分值/能力——审题须看原值（slot 覆盖在落库时才发生）。
        const merged = [
          ...bank.map((b) => ({ stemMd: b.stemMd, type: b.type, options: undefined, answerMd: b.answerMd, solutionMd: b.solutionMd, rubricMd: b.rubricMd ?? undefined, difficulty: b.difficulty, cognitiveLevel: (b.cognitiveLevel as CognitiveLevelValue) ?? "UNDERSTAND", points: b.difficulty, knowledgePointHints: b.kpHints })),
          ...aiItems.map((a) => ({ stemMd: a.stemMd, type: a.type, options: a.options, answerMd: a.answerMd, solutionMd: a.solutionMd, rubricMd: a.rubricMd, difficulty: a.difficulty, cognitiveLevel: a.cognitiveLevel, points: a.points, knowledgePointHints: a.knowledgePointHints })),
        ];
        // 题数不足时 assignItemsToSlots 抛 INSUFFICIENT——但上方 attempt 循环已保证每题型补足，
        // 到此 merged 各题型数 >= slot 数。
        assignedPairs = assignItemsToSlots(blueprint, merged);
        reviewIssues = reviewAssembledPaper(
          assignedPairs.map(({ slot, item }) => ({ slot, item: { stemMd: item.stemMd, type: item.type as QuestionType, options: item.options, answerMd: item.answerMd, solutionMd: item.solutionMd, rubricMd: item.rubricMd, difficulty: item.difficulty, points: item.points } })),
        );
        const blockers = reviewIssues.filter((x) => x.severity === "BLOCKER");
        if (blockers.length > 0) {
          // v1：BLOCKER 视为整卷质量不达标 → BAD_REQUEST 触发计费补偿（与 PAPER_DEDUP_SHORTFALL 同款）。
          // 逐题重生作为后续增强（spec §10）；v1 先失败可退款，不出残卷。
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "自动审题未通过，请调整知识点或稍后重试。",
            cause: { reason: "PAPER_REVIEW_BLOCKED", blockers: blockers.map((b) => b.code) },
          });
        }
      }
```

> `CognitiveLevelValue` 从 `@/lib/paper-copy` import（与 blueprint 同源）。`bank` 题缺 points，这里填占位（仅供审题，落库走 slot）。

> **重生 vs 失败的 v1 取舍：** spec §4.3 要求 BLOCKER 重生 2 次再失败。为控制 Phase 1 复杂度，v1 先实现「BLOCKER → 整卷失败 + 退款」（mock 路径下不会触发，因为 mock 题恒合规）。逐题重生标 `PAPER_REVIEW_BLOCKED` 留 Phase 1.1 增强（在本 plan 末「后续」列出）。**审题骨架与规则本任务已落地**，只是处置策略 v1 从简——这是有意的范围裁剪，需在 implementation-state 注明。

3e. 落库：中考模式把 `assignedPairs` 经 `applySlotMetadata` 应用 slot 权威值，整体作为 ai-shaped items 落库（`bankItems: []`），并把 blueprint 写进 paramsJson：

```ts
      // 中考模式：slot 权威元数据落库；题库命中题与 AI 题统一按 slot 落 PAPER_GENERATED。
      const zhongkaoItems = assignedPairs
        ? assignedPairs.map((p) => {
            const it = applySlotMetadata(p);
            return {
              stemMd: it.stemMd, type: it.type, options: it.options,
              answerMd: it.answerMd, solutionMd: it.solutionMd, rubricMd: it.rubricMd,
              difficulty: it.difficulty, cognitiveLevel: it.cognitiveLevel,
              points: it.points, knowledgePointHints: it.knowledgePointHints,
            };
          })
        : null;

      const paper = await persistGeneratedPaper(ctx.db, {
        teacherUserId: ctx.auth.userId,
        subjectId: input.subjectId,
        title: blueprint ? (blueprint.isTopical ? "九年级数学专题练习卷" : "九年级数学中考风格练习卷") : title,
        paramsJson: {
          ...input,
          ...(blueprint ? { styleTemplate: blueprint.styleTemplate, blueprintVersion: blueprint.blueprintVersion, blueprint, durationMinutes: blueprint.durationMinutes } : {}),
          dedupDroppedCount,
          refillRounds: Math.max(0, modelCallIds.length - 1),
          modelCallIds,
          reviewWarnings: reviewIssues.filter((x) => x.severity === "WARNING"),
        } as import("@prisma/client").Prisma.InputJsonValue,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId,
        bankItems: zhongkaoItems ? [] : bank.map((b) => ({ ...b, points: pointsByType.get(b.type) ?? 5 })),
        aiItems: zhongkaoItems ?? aiItems.map((a) => ({ ...a, points: pointsByType.get(a.type) ?? a.points })),
      });
```

> **来源标记取舍（v1）：** 中考模式把题库命中题也当 `PAPER_GENERATED` Question 落库（`bankItems: []`），换取「slot 权威分值」最简实现。代价：教师卷来源标记（Task 12）会把题库题也标「AI 生成」。spec §7 要求教师卷保留来源——若要精确区分，需扩展 `persistGeneratedPaper` 支持「带覆盖分值的 bank item」，列为落地决策点（见 Self-Review）。v1 接受统一标「AI 生成/原创」（对外措辞本就强调原创）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generate-zhongkao.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 回归既有出卷路径**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generate.test.ts`
Expected: PASS（手动 sections 模式不回退）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/server/routers/paper.ts apps/web/tests/integration/paper-generate-zhongkao.test.ts
git commit -m "feat(paper): zhongkao blueprint generation branch + auto-review gate"
```

---

> **Phase 1 完成校验（执行者跑一遍再进 Phase 2）：**
> - `pnpm --filter @zhijiao/web test -- tests/unit/zhongkao-blueprint.test.ts tests/unit/paper-review.test.ts tests/integration/paper-generate-zhongkao.test.ts tests/integration/paper-generate.test.ts`
> - `pnpm --filter @zhijiao/ai test -- tests/paper-gen-schema.test.ts tests/generate-paper.test.ts`
> - `pnpm --filter @zhijiao/domain test -- tests/compliance.test.ts`
> - `pnpm typecheck`
> 此刻：中考卷可生成、落库、用**现有**打印页查看（版面尚未升级）。Phase 1 可独立 merge。

---

# Phase 2 —— 真题卷式 A4 打印排版

## Task 9: `paper-copy` 作答区高度 helper + `AnswerAreaHint` 透出

**Files:**
- Modify: `apps/web/lib/paper-copy.ts:135-139`
- Test: `apps/web/tests/unit/paper-copy.test.ts`（新建或追加）

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/tests/unit/paper-copy.test.ts
import { describe, it, expect } from "vitest";
import { answerAreaHeight } from "@/lib/paper-copy";

describe("answerAreaHeight", () => {
  it.each([
    ["short", "2.4cm"],
    ["medium", "5cm"],
    ["large", "8.5cm"],
    ["extraLarge", "11.5cm"],
  ] as const)("hint %s → %s", (hint, css) => {
    expect(answerAreaHeight(hint)).toBe(css);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-copy.test.ts`
Expected: FAIL —— `answerAreaHeight` 未定义。

- [ ] **Step 3: 实现 helper**

追加到 `apps/web/lib/paper-copy.ts`：

```ts
export type AnswerAreaHint = "short" | "medium" | "large" | "extraLarge";

// spec §5.5 作答区建议高度（取区间中值，cm）。
export function answerAreaHeight(hint: AnswerAreaHint): string {
  switch (hint) {
    case "short": return "2.4cm";
    case "medium": return "5cm";
    case "large": return "8.5cm";
    case "extraLarge": return "11.5cm";
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-copy.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/paper-copy.ts apps/web/tests/unit/paper-copy.test.ts
git commit -m "feat(paper): answerAreaHeight helper for exam answer regions"
```

---

## Task 10: exam-layout 透传 `answerAreaHint` / `isCapstone`

**Files:**
- Modify: `apps/web/lib/paper-exam-layout.ts:3-18,71-74`
- Test: `apps/web/tests/unit/paper-exam-layout.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 apps/web/tests/unit/paper-exam-layout.test.ts
import { buildExamLayout } from "@/lib/paper-exam-layout";

it("透传 answerAreaHint 与 isCapstone 到布局 item", () => {
  const layout = buildExamLayout([
    { id: "a", type: "ESSAY", stemMd: "压轴", optionsJson: null, answerMd: "x", solutionMd: "y", rubricMd: null, points: 12, position: 1, answerAreaHint: "extraLarge", isCapstone: true },
  ]);
  const first = layout.sections[0]!.items[0]!.item;
  expect(first.answerAreaHint).toBe("extraLarge");
  expect(first.isCapstone).toBe(true);
});

it("缺省 answerAreaHint/isCapstone 时为 undefined（向后兼容手动卷）", () => {
  const layout = buildExamLayout([
    { id: "b", type: "FILL_BLANK", stemMd: "x=?", optionsJson: null, answerMd: "1", solutionMd: "s", rubricMd: null, points: 3, position: 1 },
  ]);
  const first = layout.sections[0]!.items[0]!.item;
  expect(first.answerAreaHint).toBeUndefined();
  expect(first.isCapstone).toBeUndefined();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-exam-layout.test.ts`
Expected: FAIL —— 接口无 `answerAreaHint`，TS 编译/断言失败。

- [ ] **Step 3: 扩展接口（两字段可选，透传不改分组逻辑）**

`apps/web/lib/paper-exam-layout.ts`：

```ts
import type { AnswerAreaHint } from "./paper-copy";

export interface ExamLayoutPaperItem {
  id: string;
  type: QuestionTypeValue;
  stemMd: string;
  optionsJson: unknown;
  answerMd: string;
  solutionMd: string;
  rubricMd: string | null;
  points: number;
  position: number;
  answerAreaHint?: AnswerAreaHint;
  isCapstone?: boolean;
}
```

`buildExamLayout` 内 `group.map` 不变（整个 `it` 对象透传，已含两新字段）——无需改逻辑，仅类型扩展即可让字段流过。确认 `laidOut` 的 `item: it` 原样保留。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-exam-layout.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/paper-exam-layout.ts apps/web/tests/unit/paper-exam-layout.test.ts
git commit -m "feat(paper): exam-layout passes answerAreaHint + isCapstone through"
```

---

## Task 11: 打印组件升级 —— 作答区高度、压轴分页、客观题栏教师卷不提前露答

**Files:**
- Modify: `apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx:104-166`
- Test: `apps/web/tests/unit/exam-paper-components.test.tsx`（SSR 渲染断言，沿用仓库既有 `.test.tsx` 模式）

- [ ] **Step 1: 写失败测试（SSR 字符串断言）**

```tsx
// apps/web/tests/unit/exam-paper-components.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudentSection } from "@/app/teacher/papers/[paperId]/print/exam-paper-components";
import type { ExamLayoutSection } from "@/lib/paper-exam-layout";

const capstoneSection: ExamLayoutSection = {
  type: "ESSAY", cnIndex: "三", title: "解答题", caption: "（共 1 小题）",
  isObjective: false, subtotalPoints: 12,
  items: [{ questionNo: 24, item: {
    id: "x", type: "ESSAY", stemMd: "压轴题", optionsJson: null,
    answerMd: "a", solutionMd: "s", rubricMd: null, points: 12, position: 1,
    answerAreaHint: "extraLarge", isCapstone: true,
  }}],
};

describe("StudentSection 中考作答区", () => {
  it("压轴题作答区使用 extraLarge 高度 11.5cm", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).toContain("11.5cm");
  });
  it("压轴题带 print-break-before 分页类", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).toContain("print-break-before");
  });
  it("学生卷不渲染答案/解析", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).not.toContain("解析");
    expect(html).not.toContain(">a<"); // answerMd 不出现
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/exam-paper-components.test.tsx`
Expected: FAIL —— 现作答区写死 `minHeight: "4.5cm"`，无 `11.5cm`、无 `print-break-before`。

- [ ] **Step 3: 升级 `StudentSection`（作答区高度按 hint + 压轴分页）**

替换 `apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx` 的 `StudentSection`：

```tsx
import { answerAreaHeight } from "@/lib/paper-copy";

export function StudentSection({ section }: { section: ExamLayoutSection }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold">
        {section.cnIndex}、{section.title}
        <span className="ml-1 text-xs font-normal text-slate-500">{section.caption}</span>
      </h2>
      <div className="mt-2 space-y-4">
        {section.items.map(({ questionNo, item }) => (
          <article key={item.id} className={item.isCapstone ? "print-break-before" : undefined}>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-900">
              {questionNo}. {item.stemMd}
            </p>
            <OptionsList optionsJson={item.optionsJson} />
            {section.type === "FILL_BLANK" && (
              <p className="mt-1 text-sm text-slate-400">答：______________________</p>
            )}
            {!section.isObjective && section.type !== "FILL_BLANK" && (
              <div
                className="answer-space mt-1"
                style={{ minHeight: answerAreaHeight(item.answerAreaHint ?? "medium"), borderBottom: "1px solid #e2e8f0" }}
              />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/exam-paper-components.test.tsx`
Expected: PASS。

- [ ] **Step 5: 教师卷答题栏不提前露答（spec §5.4）—— 现 `ObjectiveAnswerGrid` 已只渲空格，确认教师卷复用同组件即可，无需改。补一条断言守门：**

```tsx
// 追加到 exam-paper-components.test.tsx
import { ObjectiveAnswerGrid } from "@/app/teacher/papers/[paperId]/print/exam-paper-components";
import type { ExamLayout } from "@/lib/paper-exam-layout";

it("ObjectiveAnswerGrid 只渲题号与空格，不含答案字母", () => {
  const layout: ExamLayout = { totalPoints: 3, sections: [{
    type: "SINGLE_CHOICE", cnIndex: "一", title: "选择题", caption: "", isObjective: true, subtotalPoints: 3,
    items: [{ questionNo: 1, item: { id: "a", type: "SINGLE_CHOICE", stemMd: "q", optionsJson: ["x","y","z","w"], answerMd: "B", solutionMd: "s", rubricMd: null, points: 3, position: 1 } }],
  }]};
  const html = renderToStaticMarkup(<ObjectiveAnswerGrid layout={layout} />);
  expect(html).toContain("选择题答题栏");
  expect(html).not.toContain(">B<");
});
```

Run: `pnpm --filter @zhijiao/web test -- tests/unit/exam-paper-components.test.tsx`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx apps/web/tests/unit/exam-paper-components.test.tsx
git commit -m "feat(paper): exam answer-area heights by hint + capstone page break"
```

---

## Task 12: print-view 透传 hint/capstone + 来源标记（教师卷）

**Files:**
- Modify: `apps/web/app/teacher/papers/[paperId]/print/paper-print-view.tsx:38-50`
- Modify: `apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx`（TeacherSection 加来源标记）

- [ ] **Step 1: print-view 从 paramsJson.blueprint 取 slot 的 hint/capstone 喂进 layout**

`paper-print-view.tsx` 的 `buildExamLayout(...)` 映射段，按 `position` 关联蓝图 slot（中考卷有 blueprint，手动卷无——缺省 undefined）：

```tsx
  const params = (paper.paramsJson ?? {}) as PaperParams & { blueprint?: { slots: Array<{ questionNo: number; answerAreaHint: import("@/lib/zhongkao-blueprint").AnswerAreaHint; isCapstone: boolean }> } };
  const slotByPosition = new Map((params.blueprint?.slots ?? []).map((s) => [s.questionNo, s]));
  const layout = buildExamLayout(
    paper.items.map((i) => ({
      id: i.id,
      type: i.type as QuestionTypeValue,
      stemMd: i.stemMd,
      optionsJson: i.optionsJson,
      answerMd: i.answerMd,
      solutionMd: i.solutionMd,
      rubricMd: i.rubricMd,
      points: i.points,
      position: i.position,
      answerAreaHint: slotByPosition.get(i.position)?.answerAreaHint,
      isCapstone: slotByPosition.get(i.position)?.isCapstone,
    })),
  );
```

> blueprint slot 的 `questionNo` 是「全卷连续题号」，而 `PaperItem.position` 也是落库顺序（1..N，与 slot zip 同序）——两者一致，可按 position 关联。**落地确认**：Task 8 的 zip 保证 `PaperItem.position` 顺序 == blueprint slot 顺序。

- [ ] **Step 2: TeacherSection 显示题目来源（题库/AI）——** spec §7「教师卷保留来源标记，学生卷不显示」。`PaperItem.source` 已存（`BANK`/`AI_GENERATED`）。`ExamLayoutPaperItem` 增可选 `source?: string`，print-view 透传 `i.source`，`TeacherSection` 用 `paperItemSourceLabel`：

`exam-paper-components.tsx` `TeacherSection` 题号行后加：

```tsx
import { paperItemSourceLabel } from "@/lib/paper-copy";
// ...每题 article 内，答案上方：
            <p className="mt-0.5 text-xs text-slate-400">来源：{paperItemSourceLabel((item as { source?: string }).source ?? "AI_GENERATED")}</p>
```

并在 `ExamLayoutPaperItem` 接口加 `source?: string;`，print-view 映射加 `source: i.source`。

- [ ] **Step 3: 运行渲染测试 + typecheck**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/exam-paper-components.test.tsx`
Run: `pnpm --filter @zhijiao/web typecheck`
Expected: PASS / 无类型错误。

- [ ] **Step 4: 提交**

```bash
git add apps/web/app/teacher/papers/[paperId]/print/paper-print-view.tsx apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx apps/web/lib/paper-exam-layout.ts
git commit -m "feat(paper): print view threads blueprint hints + teacher-only source labels"
```

---

## Task 13: 生成表单「一键中考风格卷」入口 + 预览页蓝图展示

**Files:**
- Modify: `apps/web/app/teacher/papers/new/paper-generation-form.tsx:44-126`
- Modify: `apps/web/app/teacher/papers/[paperId]/paper-preview-view.tsx`

- [ ] **Step 1: 表单加「一键生成中考风格卷」按钮**

`paper-generation-form.tsx`：新增一个 mutation 调用分支（复用同一 `generate` mutation，传 `styleTemplate`，省略 sections/difficultyRange）：

```tsx
  function submitZhongkao() {
    setError(null);
    generate.mutate({
      subjectId,
      kpIds: selectedKpIds,
      gradeLevel,
      styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
      durationMinutes,
      textbookVersion,
      clientRequestId: crypto.randomUUID(),
    });
  }
```

在「生成试卷」按钮上方加：

```tsx
      <button
        type="button"
        disabled={generate.isPending || selectedKpIds.length === 0}
        onClick={submitZhongkao}
        className="rounded-full border border-slate-950 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="generate-zhongkao"
      >
        一键生成中考风格卷（120 分·24 题）
      </button>
      <p className="text-xs text-slate-500">
        中考风格卷按固定命题结构生成：选择 10 题 + 填空 6 题 + 解答 8 题，难度递进、末尾压轴；分值与结构由模板决定，无需手填题型。
      </p>
```

> 表单 `clientRequestId` 用法、`generate` onSuccess 跳转沿用既有。两入口共用同一 mutation。

- [ ] **Step 2: 预览页显示模板名 + 命题蓝图 + warning**

`paper-preview-view.tsx`：从 `paper.paramsJson` 读 `styleTemplate`/`blueprint`/`reviewWarnings`。若是中考卷，渲染模板徽标 + 折叠「命题结构」表（题号/题型/分值/难度/能力/命题意图/对应 KP）+ warning 列表。新增区块（在既有细目表附近）：

```tsx
import { ZHONGKAO_TEMPLATE_LABEL } from "@/lib/zhongkao-blueprint";

// 组件内，paper 拿到后：
const params = (paper.paramsJson ?? {}) as {
  styleTemplate?: string;
  blueprint?: { isTopical: boolean; slots: Array<{ questionNo: number; questionType: string; points: number; difficulty: number; cognitiveLevel: string; intent: string; kpNames: string[]; isCapstone: boolean }> };
  reviewWarnings?: Array<{ slotQuestionNo: number; code: string; message: string }>;
};

{params.styleTemplate && (
  <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="zhongkao-blueprint">
    <p className="text-sm font-semibold text-slate-800">
      {ZHONGKAO_TEMPLATE_LABEL}
      {params.blueprint?.isTopical && <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">专题练习卷</span>}
    </p>
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-slate-600">命题结构（{params.blueprint?.slots.length ?? 0} 题）</summary>
      <table className="mt-2 w-full text-left text-xs">
        <thead><tr className="text-slate-500"><th>题号</th><th>题型</th><th>分值</th><th>难度</th><th>能力</th><th>命题意图</th><th>知识点</th></tr></thead>
        <tbody>
          {params.blueprint?.slots.map((s) => (
            <tr key={s.questionNo} className="border-t border-slate-100">
              <td>{s.questionNo}{s.isCapstone && " ★"}</td>
              <td>{s.questionType}</td><td>{s.points}</td><td>{s.difficulty}</td>
              <td>{s.cognitiveLevel}</td><td>{s.intent}</td><td>{s.kpNames.join("、")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
    {params.reviewWarnings && params.reviewWarnings.length > 0 && (
      <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800" data-testid="review-warnings">
        <p className="font-medium">建议人工核对（{params.reviewWarnings.length}）：</p>
        <ul className="mt-1 list-disc pl-4">
          {params.reviewWarnings.map((w, i) => <li key={i}>第 {w.slotQuestionNo} 题：{w.message}</li>)}
        </ul>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: typecheck + 既有渲染测试**

Run: `pnpm --filter @zhijiao/web typecheck`
Expected: 无类型错误。

- [ ] **Step 4: 提交**

```bash
git add apps/web/app/teacher/papers/new/paper-generation-form.tsx apps/web/app/teacher/papers/[paperId]/paper-preview-view.tsx
git commit -m "feat(paper): one-click zhongkao paper entry + blueprint preview panel"
```

---

## Task 14: E2E —— 生成中考卷 + 学生/教师卷打印截图

**Files:**
- Modify: `apps/web/e2e/teacher-paper.spec.ts`

- [ ] **Step 1: 加 E2E 用例（沿用既有 teacher 登录 helper + 既有 papers 流程）**

```ts
// 追加到 apps/web/e2e/teacher-paper.spec.ts
test("教师一键生成中考风格卷并打印学生/教师卷", async ({ page }) => {
  await loginAsTeacher(page); // 沿用既有 helper
  await page.goto("/teacher/papers/new");

  // 选至少 1 个 KP（沿用既有 kp-picker testid）
  await page.getByTestId("kp-picker").locator("button").first().click();
  await page.getByTestId("generate-zhongkao").click();

  // 跳转到预览页，应见蓝图面板
  await expect(page.getByTestId("zhongkao-blueprint")).toBeVisible();

  // 进打印页
  await page.getByRole("link", { name: /打印|预览/ }).first().click();
  await page.getByTestId("variant-student").click();
  await expect(page.getByTestId("paper-student")).toBeVisible();
  await expect(page.getByText("选择题答题栏")).toBeVisible();
  await page.screenshot({ path: "output/playwright/zhongkao-student.png", fullPage: true });

  await page.getByTestId("variant-teacher").click();
  await expect(page.getByText("教师卷·含答案")).toBeVisible();
  await page.screenshot({ path: "output/playwright/zhongkao-teacher.png", fullPage: true });
});
```

> 截图落 `apps/web/output/playwright/`（已 gitignore，本地视觉验收用）。E2E 必须先确保 demo/seed 里有教师身份 + KP——沿用既有 `teacher-paper.spec.ts` 的 seed 前提；若该 spec 已有教师 fixture，直接复用，不新增手机号（避免并行抢 OTP，见 E2E 现状红线）。

- [ ] **Step 2: 跑 E2E**

Run: `pnpm --filter @zhijiao/web test:e2e -- teacher-paper`
Expected: 新用例 PASS；学生卷无答案、教师卷含答案与细目表；截图生成。

- [ ] **Step 3: 全量 E2E（确认无 flake、总数同步）**

Run: `pnpm --filter @zhijiao/web test:e2e`
Expected: 全绿。更新 `playwright test --list` Total 数到 `docs/claude/merge-verification.md` 探针 4 与 E2E 现状段。

- [ ] **Step 4: 提交**

```bash
git add apps/web/e2e/teacher-paper.spec.ts
git commit -m "test(e2e): zhongkao-style paper generate + student/teacher print"
```

---

## Task 15: 文档收口（implementation-state + merge-verification）

**Files:**
- Modify: `docs/claude/implementation-state.md`
- Modify: `docs/claude/merge-verification.md`

- [ ] **Step 1: implementation-state 追加「中考风格出卷现状」段**

要点（写进文件）：蓝图存 `paramsJson` 不建表；解答题统一映射 ESSAY 单大题；slot 元数据权威（points/difficulty/cognitiveLevel 覆盖 AI 自报）；审题 BLOCKER 处置 v1 = 整卷失败+退款（逐题重生留后续）；中考卷题库题被当 PAPER_GENERATED 落库（v1 取舍，来源标记仅教师卷）；新增黑词押题/必考/预测题/原题还原/考前答案；prompt v2（手动卷仍 v1）。

- [ ] **Step 2: merge-verification 追加探针**

新增探针（逐条可跑）：
1. `buildZhongkaoMathBlueprint` 24 题、总分 120、末 2 压轴、KP 覆盖。
2. `reviewPaperSlot` 9 类规则命中/放行。
3. 中考集成：`styleTemplate` 落库 24 题、`paramsJson.blueprint.slots` 24、分值以 slot 为准。
4. 既有手动出卷不回退（`paper-generate.test.ts`）。
5. 黑词增补 `compliance.test.ts`。
6. 学生卷打印无答案 / 教师卷含答案 + 细目表 + 来源标记（SSR 测 + E2E）。
7. E2E Total 数已同步。

- [ ] **Step 3: 提交**

```bash
git add docs/claude/implementation-state.md docs/claude/merge-verification.md
git commit -m "docs: record zhongkao-style paper state + regression probes"
```

---

## Self-Review（已对照 spec 核查）

**Spec 覆盖：**
- §2 中考模板 → Task 1（常量）/Task 2（展开）。
- §3 命题蓝图（slot 字段、KP 分配、专题卷、压轴）→ Task 2。
- §4.1 题库按 slot 混入 → Task 8（复用既有 `selectBankQuestions` 按题型 best-effort；slot 级精确匹配 v1 仅做题型+难度，KP 命中沿用既有 kpIds 整体匹配——**spec §4.1 的「难度接近/不重复」已由既有 difficultyRange + deduper 覆盖**）。
- §4.2 逐题/小批量生成 + slot 权威 → Task 5/6/7/8（按题型批量 + zip 覆盖，spec §10 允许）。
- §4.3 自动审题三类 + BLOCKER/WARNING → Task 3/4；**处置策略 v1 裁剪**（BLOCKER 失败退款而非重生 2 次）已在 Task 8 注释 + Task 15 文档标注。
- §5 打印排版（A4/卷头/密封线/客观题栏/作答区/分页）→ 卷头/密封线/客观题栏既有（Plan 06-07 已落），本 plan 补**作答区高度按 hint**（Task 9/11）+**压轴分页**（Task 11）+ 来源标记（Task 12）。
- §6 教师审核（模板名/蓝图/warning/不阻打印）→ Task 13。
- §7 合规（来源标记、原创、禁词）→ Task 4/12 + prompt v2。
- §8 测试三层 → Task 1–14 全覆盖。

**已知裁剪（spec 允许 / v1 范围）：** 逐题重生（§4.3 改 v1 失败退款）；slot 级 KP 精确取库题（§4.1 用题型+难度 best-effort）；分地区模板 / DOCX 导出 / 几何绘图（§out of scope）。这些在 Task 15 文档明确记录。

**类型一致性核查：** `BlueprintSlot` / `AssignableItem` / `AssignedPair` / `ReviewableItem` / `PaperReviewIssue` 跨 Task 引用签名一致；`answerAreaHint` 类型在 `paper-copy`（Task 9）定义、`zhongkao-blueprint`（Task 1）import、`paper-exam-layout`（Task 10）与组件（Task 11）消费，同名同形。`ZHONGKAO_TEMPLATE_ID` 字面量在 schema literal、router 分支、blueprint 三处一致。

**落地决策点（执行者遇到需确认）：**
1. `getAiRouter` 是否已支持第二参 promptVersion——若否，Task 8 需先小改 `apps/web/lib/ai-client.ts`。
2. `Prompt.interpolate` 对多余 key 的容忍度——决定 v1/v2 是否分支传 key（Task 6 已给两种写法）。
3. 中考卷题库命中题落库为 BANK 还是 PAPER_GENERATED——v1 建议后者（更简），如需保 BANK 来源标记则扩 `persistGeneratedPaper`。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-junior-math-zhongkao-style-paper.md`.

**建议分两次执行/合并**：Phase 1（Task 1–8）独立可 merge（生成闭环），Phase 2（Task 9–15）再做（打印升级）。两执行选项：

1. **Subagent-Driven（推荐）** —— 每个 Task 派新 subagent，Task 间审查，迭代快。
2. **Inline Execution** —— 本会话内按 executing-plans 批量执行 + checkpoint 审查。
