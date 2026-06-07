# 出卷·结构化 + 国内统考排版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 17 的扁平出卷升级为符合国内统考卷面的结构化试卷：每题型设题数/分值、考试时长、教材版本，按题型分大题渲染，可切学生卷/教师卷打印。

**Architecture:** 不改 Prisma schema、不加 migration。新增信息全进 `Paper.paramsJson`；大题分组用纯函数在渲染时计算（镜像 `buildSpecTable`）；分值以教师设定为准（不采信 AI）。`selectBankQuestions` / `persistGeneratedPaper` 签名不变——resolver 按题型循环命中题库、补 AI 缺口、落库前按题型 remap 分值。

**Tech Stack:** Next.js 14 (app router) · tRPC · Zod · Prisma/Postgres · Vitest · Playwright · 包内 mock LLM adapter。

**关联 spec:** `docs/superpowers/specs/2026-06-07-paper-exam-layout-and-structure-design.md`

**全程命令前缀**（Windows PowerShell；单测用 `--filter`）：
- web 单测：`pnpm --filter @zhijiao/web test -- <path>`
- ai 单测：`pnpm --filter @zhijiao/ai test -- <path>`
- E2E：`pnpm --filter @zhijiao/web test:e2e`
- 全量类型：`pnpm typecheck`

---

## File Structure

**新建**
- `apps/web/lib/paper-exam-layout.ts` —— 纯函数：扁平 `PaperItem[]` → 有序大题 + 中文序号 + 小计 + 全卷连续小题号。
- `apps/web/tests/unit/paper-exam-layout.test.ts` —— 分组纯函数单测。
- `apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx` —— 卷头 / 密封线 / 客观题作答表 / 大题区 子组件（学生卷+教师卷共用）。

**修改**
- `apps/web/lib/paper-copy.ts` —— 加 `TextbookVersion` 枚举+label、`examSectionTitle`、`EXAM_NOTICE`、卷头 label helper。
- `apps/web/server/routers/paper.ts` —— `GenInput` 改 `sections`+`durationMinutes`+`textbookVersion`；resolver 按题型循环。
- `packages/ai/src/schemas.ts` —— `PaperGenerationInputSchema` 改 `sections`+`textbookVersion`。
- `packages/ai/src/router.ts` —— `generatePaper` 插值改造。
- `packages/ai/src/prompts/paper-gen/v1.md` —— 模板占位符改造 + `SECTIONS_JSON` 机读行。
- `packages/ai/src/adapters/mock.ts` —— `DEFAULT_PAPER` → `buildMockPaper(req)` 按 sections 出题。
- `apps/web/app/teacher/papers/new/paper-generation-form.tsx` —— 每题型行 + 时长 + 教材版本 + 满分汇总。
- `apps/web/app/teacher/papers/[paperId]/print/paper-print-view.tsx` —— 双视图重做。

**测试更新**
- `packages/ai/tests/paper-gen-schema.test.ts`、`packages/ai/tests/generate-paper.test.ts`
- `apps/web/tests/integration/paper-generate.test.ts`、`apps/web/tests/integration/paper-generation-lib.test.ts`
- `apps/web/tests/unit/paper-ui.test.tsx`
- `apps/web/e2e/teacher-paper.spec.ts`

---

## Task 1: 文案与枚举扩展（paper-copy）

**Files:**
- Modify: `apps/web/lib/paper-copy.ts`
- Test: `apps/web/tests/unit/paper-copy.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `apps/web/tests/unit/paper-copy.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import {
  TEXTBOOK_VERSIONS,
  textbookVersionLabel,
  examSectionTitle,
  EXAM_NOTICE,
} from "@/lib/paper-copy";

describe("paper-copy 统考扩展", () => {
  it("教材版本含通用且默认 label 正确", () => {
    expect(TEXTBOOK_VERSIONS).toContain("GENERIC");
    expect(textbookVersionLabel("RENJIAO")).toBe("人教版");
    expect(textbookVersionLabel("GENERIC")).toBe("通用");
  });

  it("大题标题把单选/多选都归到选择题口径", () => {
    expect(examSectionTitle("SINGLE_CHOICE")).toBe("选择题");
    expect(examSectionTitle("MULTI_CHOICE")).toBe("多选题");
    expect(examSectionTitle("FILL_BLANK")).toBe("填空题");
    expect(examSectionTitle("CALCULATION")).toBe("计算题");
    expect(examSectionTitle("PROOF")).toBe("证明题");
    expect(examSectionTitle("ESSAY")).toBe("解答题");
  });

  it("注意事项是数组且不含违规措辞", () => {
    expect(EXAM_NOTICE.length).toBeGreaterThan(0);
    const joined = EXAM_NOTICE.join("");
    for (const bad of ["提分", "涨分", "保过", "必考", "分数"]) {
      expect(joined).not.toContain(bad);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-copy.test.ts`
Expected: FAIL（`TEXTBOOK_VERSIONS` 等未导出）

- [ ] **Step 3: 实现**

在 `apps/web/lib/paper-copy.ts` 末尾追加：

```ts
export const TEXTBOOK_VERSIONS = [
  "GENERIC",
  "RENJIAO",
  "BSD",
  "HUASHI",
  "SUKE",
  "ZHEJIAO",
] as const;
export type TextbookVersion = (typeof TEXTBOOK_VERSIONS)[number];

export function textbookVersionLabel(v: TextbookVersion): string {
  switch (v) {
    case "GENERIC":
      return "通用";
    case "RENJIAO":
      return "人教版";
    case "BSD":
      return "北师大版";
    case "HUASHI":
      return "华师大版";
    case "SUKE":
      return "苏科版";
    case "ZHEJIAO":
      return "浙教版";
  }
}

// 大题标题：单选题在统考里归"选择题"，其余沿用题型名。
export function examSectionTitle(type: QuestionTypeValue): string {
  switch (type) {
    case "SINGLE_CHOICE":
      return "选择题";
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

// 静态注意事项模板（合规：无提分/分数/保过措辞）。
export const EXAM_NOTICE: string[] = [
  "答题前请将姓名、班级、考号填写清楚。",
  "选择题答案填涂在卷头答题栏内，其余各题在对应题目下方作答。",
  "请保持卷面整洁，字迹清楚。",
];
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-copy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/paper-copy.ts apps/web/tests/unit/paper-copy.test.ts
git commit -m "feat(paper): textbook versions + exam section titles + notice copy"
```

---

## Task 2: 纯函数 buildExamLayout（大题分组）

**Files:**
- Create: `apps/web/lib/paper-exam-layout.ts`
- Test: `apps/web/tests/unit/paper-exam-layout.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/tests/unit/paper-exam-layout.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildExamLayout, type ExamLayoutPaperItem } from "@/lib/paper-exam-layout";

function item(p: Partial<ExamLayoutPaperItem>): ExamLayoutPaperItem {
  return {
    id: p.id ?? "x",
    type: p.type ?? "CALCULATION",
    stemMd: p.stemMd ?? "题",
    optionsJson: p.optionsJson ?? null,
    answerMd: p.answerMd ?? "答",
    solutionMd: p.solutionMd ?? "解",
    rubricMd: p.rubricMd ?? null,
    points: p.points ?? 5,
    position: p.position ?? 1,
  };
}

describe("buildExamLayout", () => {
  it("按统考题型序分大题，跨类型小题号连续，中文序号递增", () => {
    const layout = buildExamLayout([
      item({ id: "c1", type: "CALCULATION", position: 1, points: 8 }),
      item({ id: "s1", type: "SINGLE_CHOICE", position: 2, points: 3 }),
      item({ id: "s2", type: "SINGLE_CHOICE", position: 3, points: 3 }),
      item({ id: "f1", type: "FILL_BLANK", position: 4, points: 3 }),
    ]);
    // 选择题排到计算题前
    expect(layout.sections.map((s) => s.type)).toEqual([
      "SINGLE_CHOICE",
      "FILL_BLANK",
      "CALCULATION",
    ]);
    expect(layout.sections.map((s) => s.cnIndex)).toEqual(["一", "二", "三"]);
    // 全卷小题号连续：选择 1,2 → 填空 3 → 计算 4
    expect(layout.sections[0].items.map((i) => i.questionNo)).toEqual([1, 2]);
    expect(layout.sections[1].items.map((i) => i.questionNo)).toEqual([3]);
    expect(layout.sections[2].items.map((i) => i.questionNo)).toEqual([4]);
    expect(layout.totalPoints).toBe(8 + 3 + 3 + 3);
  });

  it("同大题分值一致用'每小题X分'，不一致省略每小题分值", () => {
    const uniform = buildExamLayout([
      item({ id: "a", type: "SINGLE_CHOICE", position: 1, points: 3 }),
      item({ id: "b", type: "SINGLE_CHOICE", position: 2, points: 3 }),
    ]);
    expect(uniform.sections[0].caption).toBe("（本大题共 2 小题，每小题 3 分，共 6 分）");
    expect(uniform.sections[0].subtotalPoints).toBe(6);

    const varied = buildExamLayout([
      item({ id: "a", type: "CALCULATION", position: 1, points: 8 }),
      item({ id: "b", type: "CALCULATION", position: 2, points: 10 }),
    ]);
    expect(varied.sections[0].caption).toBe("（本大题共 2 小题，共 18 分）");
  });

  it("客观题标记 isObjective", () => {
    const layout = buildExamLayout([
      item({ id: "a", type: "SINGLE_CHOICE", position: 1 }),
      item({ id: "b", type: "FILL_BLANK", position: 2 }),
    ]);
    expect(layout.sections[0].isObjective).toBe(true);
    expect(layout.sections[1].isObjective).toBe(false);
  });

  it("空题目返回空布局", () => {
    expect(buildExamLayout([])).toEqual({ sections: [], totalPoints: 0 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-exam-layout.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

新建 `apps/web/lib/paper-exam-layout.ts`：

```ts
import { examSectionTitle, type QuestionTypeValue } from "./paper-copy";

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
}

export interface ExamLayoutItem {
  questionNo: number; // 全卷连续小题号
  item: ExamLayoutPaperItem;
}

export interface ExamLayoutSection {
  type: QuestionTypeValue;
  cnIndex: string; // 大题中文序号「一」
  title: string; // 「选择题」
  caption: string; // 「（本大题共 X 小题…）」
  items: ExamLayoutItem[];
  subtotalPoints: number;
  isObjective: boolean;
}

export interface ExamLayout {
  sections: ExamLayoutSection[];
  totalPoints: number;
}

const SECTION_ORDER: QuestionTypeValue[] = [
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "FILL_BLANK",
  "CALCULATION",
  "PROOF",
  "ESSAY",
];
const CN_NUM = [
  "一", "二", "三", "四", "五", "六",
  "七", "八", "九", "十", "十一", "十二",
];
const OBJECTIVE: ReadonlySet<QuestionTypeValue> = new Set([
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
]);

export function buildExamLayout(items: ExamLayoutPaperItem[]): ExamLayout {
  // 按题型聚合（保稳定：组内按 position 排序）
  const byType = new Map<QuestionTypeValue, ExamLayoutPaperItem[]>();
  for (const it of items) {
    const list = byType.get(it.type) ?? [];
    list.push(it);
    byType.set(it.type, list);
  }

  const sections: ExamLayoutSection[] = [];
  let questionNo = 0;
  let cnPos = 0;
  let totalPoints = 0;

  for (const type of SECTION_ORDER) {
    const group = byType.get(type);
    if (!group || group.length === 0) continue;
    group.sort((a, b) => a.position - b.position);

    const laidOut: ExamLayoutItem[] = group.map((it) => {
      questionNo += 1;
      return { questionNo, item: it };
    });
    const subtotal = group.reduce((n, it) => n + it.points, 0);
    totalPoints += subtotal;

    const uniform = group.every((it) => it.points === group[0].points);
    const caption = uniform
      ? `（本大题共 ${group.length} 小题，每小题 ${group[0].points} 分，共 ${subtotal} 分）`
      : `（本大题共 ${group.length} 小题，共 ${subtotal} 分）`;

    sections.push({
      type,
      cnIndex: CN_NUM[cnPos] ?? String(cnPos + 1),
      title: examSectionTitle(type),
      caption,
      items: laidOut,
      subtotalPoints: subtotal,
      isObjective: OBJECTIVE.has(type),
    });
    cnPos += 1;
  }

  return { sections, totalPoints };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-exam-layout.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/lib/paper-exam-layout.ts apps/web/tests/unit/paper-exam-layout.test.ts
git commit -m "feat(paper): pure buildExamLayout for 大题 grouping"
```

---

## Task 3: AI 契约改造（schema + router + prompt + mock）

**Files:**
- Modify: `packages/ai/src/schemas.ts:223-232`（`PaperGenerationInputSchema`）
- Modify: `packages/ai/src/router.ts`（`generatePaper` 插值）
- Modify: `packages/ai/src/prompts/paper-gen/v1.md`
- Modify: `packages/ai/src/adapters/mock.ts`（`DEFAULT_PAPER` → `buildMockPaper`）
- Test: `packages/ai/tests/paper-gen-schema.test.ts`、`packages/ai/tests/generate-paper.test.ts`

- [ ] **Step 1: 写失败测试（schema + mock 按 sections 出题）**

替换 `packages/ai/tests/generate-paper.test.ts` 中"按数量生成"相关用例，新增（保留文件其余 import/结构，按需调整旧断言）：

```ts
it("按 sections 的题型与数量产出对应 mock 题", async () => {
  const router = makeRouter(); // 文件已有的工厂；用 MockAdapter
  const out = await router.generatePaper({
    subject: "数学",
    gradeLevel: "G8",
    kpNames: ["一次函数"],
    sections: [
      { type: "SINGLE_CHOICE", count: 3 },
      { type: "FILL_BLANK", count: 2 },
    ],
    difficultyRange: [2, 4],
    textbookVersion: "RENJIAO",
    excludeStems: [],
  });
  const single = out.items.filter((i) => i.type === "SINGLE_CHOICE");
  const fill = out.items.filter((i) => i.type === "FILL_BLANK");
  expect(single).toHaveLength(3);
  expect(fill).toHaveLength(2);
});
```

> 注：`makeRouter` 用文件中已有的构造方式。若文件无工厂，照已有用例同样的 `new AiRouter({ prisma, adapter: new MockAdapter() })` 写法构造。

`packages/ai/tests/paper-gen-schema.test.ts`：把旧的 `questionTypes`+`count` 输入用例改为 `sections`，并加一条拒绝旧字段/空 sections：

```ts
it("PaperGenerationInputSchema 接受 sections，拒绝空 sections", () => {
  expect(() =>
    PaperGenerationInputSchema.parse({
      subject: "数学", gradeLevel: "G8", kpNames: ["x"],
      sections: [{ type: "SINGLE_CHOICE", count: 3 }],
      difficultyRange: [1, 5],
    }),
  ).not.toThrow();
  expect(() =>
    PaperGenerationInputSchema.parse({
      subject: "数学", gradeLevel: "G8", kpNames: ["x"],
      sections: [], difficultyRange: [1, 5],
    }),
  ).toThrow();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/ai test -- tests/paper-gen-schema.test.ts tests/generate-paper.test.ts`
Expected: FAIL（schema 仍是 questionTypes/count；mock 仍返回固定 2 题）

- [ ] **Step 3a: 改 schema** `packages/ai/src/schemas.ts`

把 `PaperGenerationInputSchema`（约 223-232 行）替换为：

```ts
export const PaperGenSectionSchema = z.object({
  type: PaperItemTypeEnum,
  count: z.number().int().min(1).max(30),
});
export const PaperGenerationInputSchema = z.object({
  subject: z.string(),
  gradeLevel: z.string(),
  kpNames: z.array(z.string()).min(1),
  sections: z.array(PaperGenSectionSchema).min(1),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  textbookVersion: z.string().optional(),
  excludeStems: z.array(z.string()).default([]),
});
export type PaperGenerationInput = z.infer<typeof PaperGenerationInputSchema>;
```

（`PaperGenerationOutputSchema` / `PaperGenItemSchema` 不变。）

- [ ] **Step 3b: 改 router** `packages/ai/src/router.ts` `generatePaper` 的 `userContent` 插值块替换为：

```ts
    const sectionsHuman = parsed.sections
      .map((s) => `${s.type}×${s.count}`)
      .join("，");
    const userContent = prompt.interpolate({
      subject: parsed.subject,
      gradeLevel: parsed.gradeLevel,
      kpNames: parsed.kpNames.join(", "),
      textbookVersion: parsed.textbookVersion ?? "通用",
      sections: sectionsHuman,
      sectionsJson: JSON.stringify(parsed.sections),
      difficultyRange: `${parsed.difficultyRange[0]}-${parsed.difficultyRange[1]}`,
      excludeStems: parsed.excludeStems.length ? parsed.excludeStems.join(" / ") : "(无)",
    });
```

- [ ] **Step 3c: 改 prompt** `packages/ai/src/prompts/paper-gen/v1.md` 全文替换为：

```markdown
你是严谨的 K12 数学练习卷命题助手。根据参数生成一份练习卷，只输出 JSON。

- 学科：{{subject}}
- 年级：{{gradeLevel}}
- 教材版本：{{textbookVersion}}
- 知识点：{{kpNames}}
- 各题型题数：{{sections}}
- 难度范围（1–5）：{{difficultyRange}}
- 需避免与以下题重复（题干摘要）：{{excludeStems}}

SECTIONS_JSON：{{sectionsJson}}

要求：
- 严格按"各题型题数"生成对应数量的题，题型只取所列。
- 覆盖给定知识点，难度落在范围内，贴合所给教材版本的表述习惯。
- 每题给出标准答案（answerMd）与分步解析（solutionMd）；主观题/证明题给评分标准（rubricMd）。
- 标注每题 cognitiveLevel ∈ {REMEMBER,UNDERSTAND,APPLY,ANALYZE} 与 points（分值，整数）。
- knowledgePointHints 用中文知识点名。
- 严禁出现"提分/涨分/必考/保过/通过保证/分数承诺"等措辞，不得制造焦虑。
- 只输出 JSON：{ "title": string, "items": [{ "stemMd","type","options"?,"answerMd","solutionMd","rubricMd"?,"difficulty","cognitiveLevel","points","knowledgePointHints" }] }
```

- [ ] **Step 3d: 改 mock** `packages/ai/src/adapters/mock.ts`

把 `DEFAULT_PAPER`（75-81 行）替换为按题型造题的工厂：

```ts
// Plan 17 / 统考排版：按请求 sections 造 mock 题，保证 E2E 版式与题量正确。
function mockItemForType(type: string, n: number) {
  const base = { difficulty: 2, cognitiveLevel: "UNDERSTAND" as const, points: 5 };
  switch (type) {
    case "SINGLE_CHOICE":
      return { ...base, stemMd: `下列是一次函数的是（ ）（第${n}题）`, type, options: ["y=x^2", "y=2x+1", "y=1/x", "y=|x|"], answerMd: "B", solutionMd: "y=2x+1 形如 y=kx+b", knowledgePointHints: ["一次函数概念"] };
    case "MULTI_CHOICE":
      return { ...base, stemMd: `下列属于一次函数的有（ ）（第${n}题）`, type, options: ["y=2x", "y=2x+1", "y=x^2", "y=3"], answerMd: "AB", solutionMd: "形如 y=kx+b 且 k≠0", knowledgePointHints: ["一次函数概念"] };
    case "FILL_BLANK":
      return { ...base, stemMd: `y=2x+1 当 x=2 时 y=____（第${n}题）`, type, answerMd: "5", solutionMd: "代入得 5", knowledgePointHints: ["一次函数求值"] };
    case "CALCULATION":
      return { ...base, points: 8, stemMd: `求 y=2x+1 当 x=2 的值（第${n}题）`, type, answerMd: "5", solutionMd: "代入得 5", knowledgePointHints: ["一次函数求值"] };
    case "PROOF":
      return { ...base, points: 10, stemMd: `证明 y=2x+1 是一次函数（第${n}题）`, type, answerMd: "见解析", solutionMd: "符合 y=kx+b 定义", rubricMd: "定义对应 5 分，推理完整 5 分", knowledgePointHints: ["一次函数概念"] };
    default: // ESSAY 及其它
      return { ...base, points: 10, stemMd: `结合图象说明 y=2x+1 的性质（第${n}题）`, type, answerMd: "见解析", solutionMd: "斜率为 2，截距为 1，单调递增", rubricMd: "每个性质点 2 分", knowledgePointHints: ["一次函数图象"] };
  }
}

function buildMockPaper(req: AdapterRequest): unknown {
  const user = req.messages.find((m) => m.role === "user")?.content ?? "";
  const m = user.match(/SECTIONS_JSON：(\[.*?\])/);
  if (m) {
    try {
      const sections = JSON.parse(m[1]) as Array<{ type: string; count: number }>;
      const items: unknown[] = [];
      let n = 0;
      for (const s of sections) {
        for (let i = 0; i < s.count; i++) items.push(mockItemForType(s.type, ++n));
      }
      if (items.length > 0) return { title: "Mock 一次函数练习卷", items };
    } catch {
      // 落到下方兜底
    }
  }
  // 兜底：旧调用方/无 marker 时仍给两道题
  return {
    title: "Mock 一次函数练习卷",
    items: [mockItemForType("CALCULATION", 1), mockItemForType("SINGLE_CHOICE", 2)],
  };
}
```

把 `pickDefault` 中的 `if (sys.includes("练习卷命题助手")) return DEFAULT_PAPER;`（120 行）改为：

```ts
  if (sys.includes("练习卷命题助手")) return buildMockPaper(req);
```

> `pickDefault(req)` 已经接收 `req`，无需改签名。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/ai test -- tests/paper-gen-schema.test.ts tests/generate-paper.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/ai/src/schemas.ts packages/ai/src/router.ts packages/ai/src/prompts/paper-gen/v1.md packages/ai/src/adapters/mock.ts packages/ai/tests/paper-gen-schema.test.ts packages/ai/tests/generate-paper.test.ts
git commit -m "feat(ai): paper-gen contract uses per-type sections + textbook version"
```

---

## Task 4: resolver 按题型循环 + 分值确定性（router paper.generate）

**Files:**
- Modify: `apps/web/server/routers/paper.ts:17-106`
- Test: `apps/web/tests/integration/paper-generate.test.ts`

- [ ] **Step 1: 改测试为 sections 契约 + 断言分值/参数**

在 `apps/web/tests/integration/paper-generate.test.ts` 把生成调用改为 `sections`，并加断言。核心新用例（沿用文件已有的 caller/seed helper，保持其登录为教师、kp/subject 与 seed 一致）：

```ts
it("按题型设定题数与分值落库，paramsJson 含时长/教材版本", async () => {
  const res = await caller.paper.generate({
    subjectId,
    kpIds: [kpId],
    gradeLevel: "G8",
    sections: [
      { type: "SINGLE_CHOICE", count: 3, pointsPerItem: 3 },
      { type: "CALCULATION", count: 2, pointsPerItem: 8 },
    ],
    difficultyRange: [2, 4],
    durationMinutes: 120,
    textbookVersion: "RENJIAO",
    clientRequestId: crypto.randomUUID(),
  });

  const paper = await db.paper.findUniqueOrThrow({
    where: { id: res.paperId },
    include: { items: true },
  });
  const single = paper.items.filter((i) => i.type === "SINGLE_CHOICE");
  const calc = paper.items.filter((i) => i.type === "CALCULATION");
  expect(single).toHaveLength(3);
  expect(calc).toHaveLength(2);
  expect(single.every((i) => i.points === 3)).toBe(true);
  expect(calc.every((i) => i.points === 8)).toBe(true);

  const params = paper.paramsJson as { durationMinutes?: number; textbookVersion?: string };
  expect(params.durationMinutes).toBe(120);
  expect(params.textbookVersion).toBe("RENJIAO");
});
```

> 文件中既有的 KP↔subject mismatch 补偿用例、非教师 FORBIDDEN 用例：把它们的 `questionTypes`/`count` 字段改成等价 `sections`，断言不变（净余额补偿、扣费前 FORBIDDEN 仍成立——中间件链未动）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generate.test.ts`
Expected: FAIL（入参 schema 仍是旧字段）

- [ ] **Step 3: 改 router** `apps/web/server/routers/paper.ts`

把 `GenInput`（17-26 行）替换为：

```ts
const QType = z.enum(["SINGLE_CHOICE", "MULTI_CHOICE", "FILL_BLANK", "CALCULATION", "PROOF", "ESSAY"]);
const Section = z.object({
  type: QType,
  count: z.number().int().min(1).max(30),
  pointsPerItem: z.number().int().min(1).max(100),
});
const GenInput = z.object({
  subjectId: z.string().cuid(),
  kpIds: z.array(z.string().cuid()).min(1),
  gradeLevel: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]),
  sections: z
    .array(Section)
    .min(1)
    .refine((s) => new Set(s.map((x) => x.type)).size === s.length, "题型不可重复")
    .refine((s) => s.reduce((n, x) => n + x.count, 0) <= 30, "总题量不超过 30 题")
    .refine((s) => s.reduce((n, x) => n + x.count, 0) >= 1, "至少 1 题"),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  durationMinutes: z.number().int().min(1).max(300).optional(),
  textbookVersion: z.string().default("GENERIC"),
  clientRequestId: z.string().uuid(),
});
```

把 resolver 主体（38-105 行，从 `const kps = ...` 到 `return { paperId: paper.id };`）替换为：

```ts
      const kps = await ctx.db.knowledgePoint.findMany({
        where: { id: { in: input.kpIds }, subjectId: input.subjectId },
        select: { id: true, name: true },
      });
      if (kps.length !== input.kpIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "知识点与学科不匹配",
          cause: { reason: "KP_SUBJECT_MISMATCH" },
        });
      }
      const kpNames = kps.map((k) => k.name);
      const pointsByType = new Map(input.sections.map((s) => [s.type, s.pointsPerItem]));

      // 题库按题型分别 best-effort 命中；不足的题型攒成 AI 缺口。
      const bank: Awaited<ReturnType<typeof selectBankQuestions>> = [];
      const aiSections: Array<{ type: (typeof input.sections)[number]["type"]; count: number }> = [];
      for (const s of input.sections) {
        const hit = await selectBankQuestions(ctx.db, {
          subjectId: input.subjectId,
          kpIds: input.kpIds,
          questionTypes: [s.type],
          difficultyRange: input.difficultyRange,
          limit: s.count,
        });
        bank.push(...hit);
        const gap = s.count - hit.length;
        if (gap > 0) aiSections.push({ type: s.type, count: gap });
      }

      let aiItems: PaperGenerationOutput["items"] = [];
      let title = "练习卷";
      let modelCallId: string | null = null;

      if (aiSections.length > 0) {
        let ai: PaperGenerationOutput & { modelCallId: string };
        try {
          ai = await getAiRouter(ctx.auth.userId).generatePaper({
            subject: "数学",
            gradeLevel: input.gradeLevel,
            kpNames,
            sections: aiSections,
            difficultyRange: input.difficultyRange,
            textbookVersion: input.textbookVersion,
            excludeStems: bank.map((b) => b.stemMd.slice(0, 40)),
          });
        } catch (e) {
          if (e instanceof ComplianceRejectedError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "生成内容未通过合规检查，请调整参数重试。",
              cause: { reason: "COMPLIANCE_REJECTED", original: e },
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "出卷失败，请稍后再试。",
            cause: { reason: "PAPER_INTERNAL" },
          });
        }
        aiItems = ai.items;
        title = ai.title;
        modelCallId = ai.modelCallId;
      }

      const paper = await persistGeneratedPaper(ctx.db, {
        teacherUserId: ctx.auth.userId,
        subjectId: input.subjectId,
        title,
        paramsJson: input as import("@prisma/client").Prisma.InputJsonValue,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId,
        bankItems: bank.map((b) => ({ ...b, points: pointsByType.get(b.type) ?? 5 })),
        aiItems: aiItems.map((a) => ({ ...a, points: pointsByType.get(a.type) ?? a.points })),
      });
      return { paperId: paper.id };
```

> `persistGeneratedPaper` / `selectBankQuestions` 签名不变。`paramsJson` 原样存入 input（含 sections / durationMinutes / textbookVersion）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generate.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/server/routers/paper.ts apps/web/tests/integration/paper-generate.test.ts
git commit -m "feat(paper): per-type bank+AI fill with deterministic points; persist exam params"
```

---

## Task 5: 出题表单（每题型行 + 时长 + 教材版本 + 满分汇总）

**Files:**
- Modify: `apps/web/app/teacher/papers/new/paper-generation-form.tsx`
- Test: `apps/web/tests/unit/paper-ui.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `apps/web/tests/unit/paper-ui.test.tsx` 追加（沿用文件已有 render helper / trpc mock 模式；若该文件用 `@testing-library/react` 渲染，按既有写法）：

```ts
it("满分随题型题数与每题分值实时汇总", async () => {
  render(<PaperGenerationForm subjectId="s1" kps={[{ id: "k1", name: "一次函数" }]} />);
  // 勾选单选题，设题数 3、每题 3 分 → 满分 9
  await userEvent.click(screen.getByTestId("type-toggle-SINGLE_CHOICE"));
  await userEvent.clear(screen.getByTestId("count-SINGLE_CHOICE"));
  await userEvent.type(screen.getByTestId("count-SINGLE_CHOICE"), "3");
  await userEvent.clear(screen.getByTestId("points-SINGLE_CHOICE"));
  await userEvent.type(screen.getByTestId("points-SINGLE_CHOICE"), "3");
  expect(screen.getByTestId("total-points")).toHaveTextContent("9");
});
```

> 若现有 `paper-ui.test.tsx` 已 import `PaperGenerationForm`，复用其 import。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-ui.test.tsx`
Expected: FAIL（无 `type-toggle-*` / `total-points`）

- [ ] **Step 3: 实现** 整体替换 `paper-generation-form.tsx` 为：

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";
import {
  QUESTION_TYPES,
  GRADE_LEVELS,
  TEXTBOOK_VERSIONS,
  questionTypeLabel,
  gradeLevelLabel,
  textbookVersionLabel,
  type GradeLevel,
  type QuestionTypeValue,
  type TextbookVersion,
} from "@/lib/paper-copy";

type KpOption = { id: string; name: string };
type SectionConfig = { count: number; pointsPerItem: number };

const DEFAULT_POINTS: Record<QuestionTypeValue, number> = {
  SINGLE_CHOICE: 3,
  MULTI_CHOICE: 4,
  FILL_BLANK: 3,
  CALCULATION: 8,
  PROOF: 10,
  ESSAY: 12,
};

export function PaperGenerationForm({
  subjectId,
  kps,
}: {
  subjectId: string;
  kps: KpOption[];
}) {
  const router = useRouter();
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>("G8");
  const [textbookVersion, setTextbookVersion] = useState<TextbookVersion>("GENERIC");
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [selectedKpIds, setSelectedKpIds] = useState<string[]>(
    kps.slice(0, 1).map((k) => k.id),
  );
  const [sections, setSections] = useState<Partial<Record<QuestionTypeValue, SectionConfig>>>({
    SINGLE_CHOICE: { count: 6, pointsPerItem: 3 },
    CALCULATION: { count: 4, pointsPerItem: 8 },
  });
  const [diffMin, setDiffMin] = useState(2);
  const [diffMax, setDiffMax] = useState(4);
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.paper.generate.useMutation({
    onSuccess: (result) => router.push(`/teacher/papers/${result.paperId}`),
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      if (reason === "INSUFFICIENT_BALANCE") setError("Credits 余额不足，请先充值后再出卷。");
      else if (reason === "COMPLIANCE_REJECTED") setError("生成内容未通过合规检查，请调整参数重试。");
      else if (reason === "KP_SUBJECT_MISMATCH") setError("选择的知识点与学科不匹配，请刷新后重试。");
      else setError("出卷失败，请稍后再试。");
    },
  });

  function toggleKp(id: string) {
    setSelectedKpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleType(t: QuestionTypeValue) {
    setSections((prev) => {
      const next = { ...prev };
      if (next[t]) delete next[t];
      else next[t] = { count: 5, pointsPerItem: DEFAULT_POINTS[t] };
      return next;
    });
  }

  function patchSection(t: QuestionTypeValue, patch: Partial<SectionConfig>) {
    setSections((prev) => ({ ...prev, [t]: { ...prev[t]!, ...patch } }));
  }

  const activeTypes = QUESTION_TYPES.filter((t) => sections[t]);
  const totalCount = activeTypes.reduce((n, t) => n + (sections[t]!.count || 0), 0);
  const totalPoints = activeTypes.reduce(
    (n, t) => n + (sections[t]!.count || 0) * (sections[t]!.pointsPerItem || 0),
    0,
  );

  const canSubmit =
    !generate.isPending &&
    selectedKpIds.length > 0 &&
    activeTypes.length > 0 &&
    diffMin <= diffMax &&
    totalCount >= 1 &&
    totalCount <= 30 &&
    activeTypes.every((t) => sections[t]!.count >= 1 && sections[t]!.pointsPerItem >= 1);

  function submit() {
    setError(null);
    generate.mutate({
      subjectId,
      kpIds: selectedKpIds,
      gradeLevel,
      sections: activeTypes.map((t) => ({
        type: t,
        count: sections[t]!.count,
        pointsPerItem: sections[t]!.pointsPerItem,
      })),
      difficultyRange: [diffMin, diffMax],
      durationMinutes,
      textbookVersion,
      clientRequestId: crypto.randomUUID(),
    });
  }

  return (
    <section className="mt-6 space-y-6 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {/* 年级 + 教材版本 + 时长 */}
      <div className="flex flex-wrap gap-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">年级</label>
          <select
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value as GradeLevel)}
            className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            data-testid="grade-select"
          >
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>{gradeLevelLabel(g)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">教材版本</label>
          <select
            value={textbookVersion}
            onChange={(e) => setTextbookVersion(e.target.value as TextbookVersion)}
            className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            data-testid="textbook-select"
          >
            {TEXTBOOK_VERSIONS.map((v) => (
              <option key={v} value={v}>{textbookVersionLabel(v)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">考试时长（分钟）</label>
          <input
            type="number"
            min={1}
            max={300}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="mt-1 w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            data-testid="duration-input"
          />
        </div>
      </div>

      {/* 知识点 */}
      <div>
        <p className="text-sm font-medium text-slate-700">知识点（至少选 1 个）</p>
        <div className="mt-2 flex flex-wrap gap-2" data-testid="kp-picker">
          {kps.map((kp) => {
            const selected = selectedKpIds.includes(kp.id);
            return (
              <button
                key={kp.id}
                type="button"
                onClick={() => toggleKp(kp.id)}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
                data-testid={`kp-${kp.id}`}
              >
                {kp.name}
              </button>
            );
          })}
        </div>
        {selectedKpIds.length === 0 && (
          <p className="mt-1 text-xs text-red-600">请至少选一个知识点。</p>
        )}
      </div>

      {/* 题型逐行：题数 × 每题分值 */}
      <div>
        <p className="text-sm font-medium text-slate-700">题型与题数（至少选 1 种）</p>
        <div className="mt-2 space-y-2">
          {QUESTION_TYPES.map((t) => {
            const cfg = sections[t];
            return (
              <div key={t} className="flex flex-wrap items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`w-24 rounded-full border px-3 py-1 transition ${
                    cfg ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                  data-testid={`type-toggle-${t}`}
                >
                  {questionTypeLabel(t)}
                </button>
                {cfg && (
                  <>
                    <label className="flex items-center gap-1">
                      题数
                      <input
                        type="number" min={1} max={30} value={cfg.count}
                        onChange={(e) => patchSection(t, { count: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1"
                        data-testid={`count-${t}`}
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      每题
                      <input
                        type="number" min={1} max={100} value={cfg.pointsPerItem}
                        onChange={(e) => patchSection(t, { pointsPerItem: Number(e.target.value) })}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1"
                        data-testid={`points-${t}`}
                      />
                      分
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {activeTypes.length === 0 && (
          <p className="mt-1 text-xs text-red-600">请至少选一种题型。</p>
        )}
        {totalCount > 30 && (
          <p className="mt-1 text-xs text-red-600">总题量不超过 30 题（当前 {totalCount}）。</p>
        )}
      </div>

      {/* 难度范围 */}
      <div>
        <p className="text-sm font-medium text-slate-700">难度范围（1 最简单，5 最难）</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            最低
            <select value={diffMin} onChange={(e) => setDiffMin(Number(e.target.value))} className="rounded-lg border border-slate-200 px-2 py-1" data-testid="diff-min">
              {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <span className="text-slate-400">&ndash;</span>
          <label className="flex items-center gap-2">
            最高
            <select value={diffMax} onChange={(e) => setDiffMax(Number(e.target.value))} className="rounded-lg border border-slate-200 px-2 py-1" data-testid="diff-max">
              {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          {diffMin > diffMax && <p className="text-xs text-red-600">最低难度不能大于最高难度。</p>}
        </div>
      </div>

      {/* 满分汇总 + Credits */}
      <p className="text-sm text-slate-600">
        共 <span data-testid="total-count">{totalCount}</span> 题 · 满分{" "}
        <span data-testid="total-points" className="font-semibold">{totalPoints}</span> 分 ·
        出卷消耗 5 credits（题库命中越多，AI 调用越少）。
      </p>

      {generate.isPending && <AiGeneratingPanel label="AI 出卷中，请稍候…" />}

      {error && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700" data-testid="generate-error">
          {error}{" "}
          <button type="button" onClick={submit} className="underline" data-testid="generate-retry">重试</button>
        </p>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="generate-submit"
      >
        {generate.isPending ? "生成中…" : "生成试卷"}
      </button>
    </section>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-ui.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/app/teacher/papers/new/paper-generation-form.tsx apps/web/tests/unit/paper-ui.test.tsx
git commit -m "feat(paper): per-type count/points form with live total + duration + textbook"
```

---

## Task 6: 统考排版打印页（学生卷 / 教师卷双视图）

**Files:**
- Create: `apps/web/app/teacher/papers/[paperId]/print/exam-paper-components.tsx`
- Modify: `apps/web/app/teacher/papers/[paperId]/print/paper-print-view.tsx`
- Test: 由 Task 7 的 E2E 覆盖（本任务做 typecheck 验证）

- [ ] **Step 1: 新建子组件** `exam-paper-components.tsx`：

```tsx
"use client";

import { textbookVersionLabel, type TextbookVersion } from "@/lib/paper-copy";
import type { ExamLayout, ExamLayoutSection } from "@/lib/paper-exam-layout";

export const EXAM_PRINT_CSS = `
@media print {
  nav, .print-hidden { display: none !important; }
  body { background: white !important; }
  main { padding: 0 !important; }
  .seal-line { display: flex !important; }
  .answer-space { break-inside: avoid; }
  .print-break-before { break-before: page; page-break-before: always; }
}
`;

export function SealLine() {
  return (
    <div
      className="seal-line hidden"
      style={{
        position: "fixed",
        left: "0.6cm",
        top: 0,
        bottom: 0,
        width: "1.6cm",
        alignItems: "center",
        justifyContent: "center",
        borderRight: "1px dashed #000",
      }}
    >
      <span style={{ writingMode: "vertical-rl", letterSpacing: "0.4em", fontSize: "12px" }}>
        姓名_____ 班级_____ 考号_____ ……………装………订………线………内………不………要………答………题……………
      </span>
    </div>
  );
}

export function ExamHeader({
  title,
  gradeLabel,
  textbookVersion,
  durationMinutes,
  totalPoints,
  notice,
  variant,
}: {
  title: string;
  gradeLabel: string;
  textbookVersion?: TextbookVersion;
  durationMinutes?: number;
  totalPoints: number;
  notice: string[];
  variant: "student" | "teacher";
}) {
  const sub: string[] = [];
  if (durationMinutes) sub.push(`考试时长 ${durationMinutes} 分钟`);
  sub.push(`满分 ${totalPoints} 分`);
  if (textbookVersion && textbookVersion !== "GENERIC") sub.push(textbookVersionLabel(textbookVersion));
  return (
    <header className="text-center">
      <h1 className="text-2xl font-bold tracking-tight">
        {title}
        {variant === "teacher" && <span className="ml-2 text-sm font-normal text-slate-500">（教师卷·含答案）</span>}
      </h1>
      <p className="mt-1 text-sm text-slate-600">{gradeLabel} · {sub.join(" · ")}</p>
      <div className="mt-3 flex justify-center gap-6 text-sm text-slate-700">
        <span>姓名：__________</span>
        <span>班级：__________</span>
        <span>考号：__________</span>
        <span>座位号：______</span>
      </div>
      <ol className="mx-auto mt-3 max-w-2xl list-decimal pl-6 text-left text-xs text-slate-500">
        {notice.map((n) => <li key={n}>{n}</li>)}
      </ol>
    </header>
  );
}

// 客观题统一答题栏（卷头）：列出所有客观题号留填涂格。
export function ObjectiveAnswerGrid({ layout }: { layout: ExamLayout }) {
  const nums = layout.sections
    .filter((s) => s.isObjective)
    .flatMap((s) => s.items.map((i) => i.questionNo));
  if (nums.length === 0) return null;
  return (
    <div className="mt-4 border border-slate-300 p-2">
      <p className="text-xs font-medium text-slate-600">选择题答题栏</p>
      <div className="mt-1 flex flex-wrap gap-2 text-sm">
        {nums.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 border-b border-slate-400 px-2">
            {n}.<span className="inline-block w-8" />
          </span>
        ))}
      </div>
    </div>
  );
}

export function StudentSection({ section }: { section: ExamLayoutSection }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold">
        {section.cnIndex}、{section.title}
        <span className="ml-1 text-xs font-normal text-slate-500">{section.caption}</span>
      </h2>
      <div className="mt-2 space-y-4">
        {section.items.map(({ questionNo, item }) => (
          <article key={item.id}>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-900">
              {questionNo}. {item.stemMd}
            </p>
            {Array.isArray(item.optionsJson) && (
              <ul className="mt-1 space-y-1 text-sm text-slate-800">
                {(item.optionsJson as string[]).map((opt, idx) => (
                  <li key={idx}>{String.fromCharCode(65 + idx)}. {opt}</li>
                ))}
              </ul>
            )}
            {section.type === "FILL_BLANK" && (
              <p className="mt-1 text-sm text-slate-400">答：______________________</p>
            )}
            {!section.isObjective && section.type !== "FILL_BLANK" && (
              <div className="answer-space mt-1" style={{ minHeight: "4.5cm", borderBottom: "1px solid #e2e8f0" }} />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export function TeacherSection({ section }: { section: ExamLayoutSection }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold">
        {section.cnIndex}、{section.title}
        <span className="ml-1 text-xs font-normal text-slate-500">{section.caption}</span>
      </h2>
      <div className="mt-2 space-y-4">
        {section.items.map(({ questionNo, item }) => (
          <article key={item.id}>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-900">
              {questionNo}. {item.stemMd}
            </p>
            {Array.isArray(item.optionsJson) && (
              <ul className="mt-1 space-y-1 text-sm text-slate-800">
                {(item.optionsJson as string[]).map((opt, idx) => (
                  <li key={idx}>{String.fromCharCode(65 + idx)}. {opt}</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-sm leading-7"><span className="font-medium">答案：</span>{item.answerMd}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-7"><span className="font-medium">解析：</span>{item.solutionMd}</p>
            {item.rubricMd && (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-slate-600"><span className="font-medium">评分标准：</span>{item.rubricMd}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 重做** `paper-print-view.tsx`：

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { SkeletonList } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/ui/state-panel";
import { PaperSpecTable } from "../../paper-detail-components";
import { buildExamLayout } from "@/lib/paper-exam-layout";
import { EXAM_NOTICE, gradeLevelLabel, type GradeLevel, type TextbookVersion } from "@/lib/paper-copy";
import {
  EXAM_PRINT_CSS,
  SealLine,
  ExamHeader,
  ObjectiveAnswerGrid,
  StudentSection,
  TeacherSection,
} from "./exam-paper-components";

type PaperParams = {
  gradeLevel?: GradeLevel;
  textbookVersion?: TextbookVersion;
  durationMinutes?: number;
};

export function PaperPrintView({ paperId }: { paperId: string }) {
  const [variant, setVariant] = useState<"student" | "teacher">("student");
  const query = trpc.paper.get.useQuery({ paperId }, { retry: false });

  if (query.isLoading) return <SkeletonList rows={5} />;
  if (query.isError) {
    return <StatePanel title="试卷加载失败" description="试卷不存在，或当前账号没有访问权限。" />;
  }
  if (!query.data) return null;

  const paper = query.data.paper;
  const params = (paper.paramsJson ?? {}) as PaperParams;
  const layout = buildExamLayout(
    paper.items.map((i) => ({
      id: i.id,
      type: i.type as never,
      stemMd: i.stemMd,
      optionsJson: i.optionsJson,
      answerMd: i.answerMd,
      solutionMd: i.solutionMd,
      rubricMd: i.rubricMd,
      points: i.points,
      position: i.position,
    })),
  );
  const gradeLabel = params.gradeLevel ? gradeLevelLabel(params.gradeLevel) : "";

  return (
    <div className="space-y-6">
      <style jsx global>{EXAM_PRINT_CSS}</style>

      <div className="print-hidden flex flex-wrap gap-2">
        <Link href={`/teacher/papers/${paper.id}`} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">返回预览</Link>
        <button
          type="button"
          onClick={() => setVariant("student")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${variant === "student" ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-700"}`}
          data-testid="variant-student"
        >学生卷</button>
        <button
          type="button"
          onClick={() => setVariant("teacher")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${variant === "teacher" ? "bg-slate-950 text-white" : "border border-slate-200 text-slate-700"}`}
          data-testid="variant-teacher"
        >教师卷（含答案）</button>
        <button type="button" onClick={() => window.print()} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800">打印</button>
      </div>

      <SealLine />

      <section className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0" data-testid={`paper-${variant}`}>
        <ExamHeader
          title={paper.title}
          gradeLabel={gradeLabel}
          textbookVersion={params.textbookVersion}
          durationMinutes={params.durationMinutes}
          totalPoints={layout.totalPoints}
          notice={EXAM_NOTICE}
          variant={variant}
        />

        {variant === "student" ? (
          <>
            <ObjectiveAnswerGrid layout={layout} />
            {layout.sections.map((s) => <StudentSection key={s.type} section={s} />)}
          </>
        ) : (
          <>
            {layout.sections.map((s) => <TeacherSection key={s.type} section={s} />)}
            <div className="print-break-before mt-8">
              <PaperSpecTable specTable={query.data.specTable} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @zhijiao/web exec tsc --noEmit`
Expected: 无错误（特别确认 `paper.items[].rubricMd` / `optionsJson` / `paramsJson` 类型与 `ExamLayoutPaperItem` 对齐；若 `i.type` 报枚举不兼容，保持 `as never` 转换）。

- [ ] **Step 4: 提交**

```bash
git add apps/web/app/teacher/papers/[paperId]/print/
git commit -m "feat(paper): national-exam print layout with student/teacher variants"
```

---

## Task 7: E2E（生成→预览→打印→切卷）

**Files:**
- Modify: `apps/web/e2e/teacher-paper.spec.ts`

- [ ] **Step 1: 更新 E2E** —— 把出题步骤改为新表单交互，并断言统考版式。核心片段（沿用文件已有的教师登录/导航 helper 与选择器风格）：

```ts
test("教师按题型出卷并查看统考版式学生卷/教师卷", async ({ page }) => {
  await loginAsTeacher(page); // 文件已有 helper
  await page.goto("/teacher/papers/new");

  // 单选题 3 题、每题 3 分
  await page.getByTestId("type-toggle-SINGLE_CHOICE").click();
  await page.getByTestId("count-SINGLE_CHOICE").fill("3");
  await page.getByTestId("points-SINGLE_CHOICE").fill("3");
  // 计算题 2 题、每题 8 分（默认已选 CALCULATION，若未选则点开）
  if (!(await page.getByTestId("count-CALCULATION").isVisible())) {
    await page.getByTestId("type-toggle-CALCULATION").click();
  }
  await page.getByTestId("count-CALCULATION").fill("2");
  await page.getByTestId("points-CALCULATION").fill("8");

  await expect(page.getByTestId("total-points")).toHaveText("25"); // 3*3 + 2*8
  await page.getByTestId("generate-submit").click();

  // 跳到预览页后进入打印页
  await page.waitForURL(/\/teacher\/papers\/[^/]+$/);
  const paperUrl = page.url();
  await page.goto(`${paperUrl}/print`);

  // 默认学生卷：有大题标题与选择题答题栏，无"答案："
  await expect(page.getByTestId("paper-student")).toBeVisible();
  await expect(page.getByText("一、选择题")).toBeVisible();
  await expect(page.getByText("选择题答题栏")).toBeVisible();
  await expect(page.getByTestId("paper-student")).not.toContainText("答案：");

  // 切教师卷：出现答案/解析与双向细目表
  await page.getByTestId("variant-teacher").click();
  await expect(page.getByTestId("paper-teacher")).toContainText("答案：");
  await expect(page.getByTestId("paper-teacher")).toContainText("解析：");
});
```

- [ ] **Step 2: 跑 E2E**

Run: `pnpm --filter @zhijiao/web test:e2e -- teacher-paper`
Expected: PASS（global-setup 已 seed `zhijiao_test_web`；mock 按 sections 出题）

- [ ] **Step 3: 提交**

```bash
git add apps/web/e2e/teacher-paper.spec.ts
git commit -m "test(e2e): teacher paper exam-layout student/teacher variants"
```

---

## Task 8: 全量校验 + 落地文档

**Files:**
- Modify: `docs/claude/implementation-state.md`、`docs/claude/merge-verification.md`

- [ ] **Step 1: 全量类型 + 单测 + 集成**

Run:
```
pnpm typecheck
pnpm --filter @zhijiao/ai test
pnpm --filter @zhijiao/web test
```
Expected: 全 PASS。若 `paper-generation-lib.test.ts` 因 points 默认值断言失败，确认其断言与"分值由 section 决定、lib 仍按传入 points 落库"一致并更新。

- [ ] **Step 2: 更新 implementation-state**

在 `docs/claude/implementation-state.md` 的「AI 出卷现状（Plan 17）」段后追加小节：

```markdown
- **统考排版/结构化（2026-06-07）**：`paper.generate` 入参由 `questionTypes`+`count` 改为 `sections[{type,count,pointsPerItem}]` + `durationMinutes` + `textbookVersion`；分值以教师设定为准（不采信 AI 返回 points）。考试时长/教材版本只进 `paramsJson`，**无 schema 变更/无 migration**。大题分组用纯函数 `lib/paper-exam-layout.ts` 在渲染时计算（题型序 选择→多选→填空→计算→证明→解答、中文大题号、全卷连续小题号、大题小计）。打印页 `/teacher/papers/[id]/print` 学生卷/教师卷双视图：学生卷=卷头块+密封线+客观题答题栏+解答题留空；教师卷=逐题穿插答案/解析/评分标准+卷末双向细目表。题库按题型分别 best-effort 命中、不足才 AI 补缺。mock `buildMockPaper` 按 `SECTIONS_JSON` 机读行出题。`selectBankQuestions`/`persistGeneratedPaper` 签名未变。旧 Paper（旧 paramsJson）向后兼容渲染。
```

- [ ] **Step 3: 追加回归探针** 到 `docs/claude/merge-verification.md` 末尾：

```markdown
### 出卷·统考排版（2026-06-07）
- [ ] `paper.generate` 用 `sections` 入参；`PaperItem.points` 按题型 `pointsPerItem` 落库；`paramsJson` 含 `durationMinutes`/`textbookVersion`。
- [ ] `buildExamLayout` 题型序固定、中文大题号、全卷小题号连续、同/异分值 caption 分支正确。
- [ ] 打印页学生卷有大题标题+选择题答题栏+解答题留空且无"答案："；教师卷有答案/解析+双向细目表。
- [ ] mock 按 `SECTIONS_JSON` 题数/题型出题；KP↔subject mismatch 仍补偿净零不落 Paper；非教师扣费前 FORBIDDEN。
- [ ] 旧 Paper（无新 paramsJson 字段）仍能在新打印页渲染（卷头省略时长/教材版本）。
```

- [ ] **Step 4: 提交**

```bash
git add docs/claude/implementation-state.md docs/claude/merge-verification.md
git commit -m "docs: record paper exam-layout state + regression probes"
```

---

## Self-Review（已执行）

- **Spec 覆盖**：§1 参数/契约→Task 3/4/5；§2 paramsJson→Task 4；§3 契约→Task 3/4；§4 分组纯函数→Task 2；§5 双视图渲染→Task 6；§6 文案枚举→Task 1；§7 合规→Task 1（静态文案）+ Task 3（AI 扫描不变）；§8 测试→Task 1-7；§10 落地文档→Task 8。无遗漏。
- **占位符**：无 TBD/TODO；每个代码步骤含完整代码与命令。
- **类型一致**：`buildExamLayout` / `ExamLayoutPaperItem` / `ExamLayoutSection`（Task 2）在 Task 6 一致引用；`sections[{type,count,pointsPerItem}]`（router, Task 4）vs `sections[{type,count}]`（AI 契约, Task 3）—— 故意不同（pointsPerItem 不进 AI，分值由 resolver remap），已在 spec §3 与 Task 4 注明；`TextbookVersion`/`textbookVersionLabel`/`examSectionTitle`/`EXAM_NOTICE`（Task 1）在 Task 5/6 一致引用。
- **签名不变**：`selectBankQuestions`（单题型数组调用）、`persistGeneratedPaper`（points 由 resolver 预先 remap）确认无需改签名。
```
