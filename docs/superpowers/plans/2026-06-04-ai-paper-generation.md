# Plan 17：AI 出卷 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教师按 年级/KP/题型/难度/题量 参数化生成独立练习卷（混合题源：题库 best-effort + AI 补缺），带答案解析与双向细目表，可预览/编辑/打印导出。

**Architecture:** 新增独立 `Paper`/`PaperItem`（教师自有，不绑班级）。复用既有 `PAPER_GEN`（taskKind→`qwen-max`，固定 5 credits）。生成链 `authedProcedure → requireTeacherPersona → requireGuardianConsent → chargeMiddleware("PAPER_GEN") → resolver`（教师门禁在扣费前）。AI 题落 `Question(DRAFT, source="PAPER_GENERATED", owner=teacher)` 并纳入 owner-only 红线。双向细目表渲染时计算。打印友好页即 v1 导出路径。

**Tech Stack:** TypeScript、Prisma 5、tRPC v11、Vitest、Playwright、Next.js（apps/web）、Zod。

参考 spec：`docs/superpowers/specs/2026-06-04-ai-paper-generation-design.md`

---

## 关键既有事实（实现前必读）

- AI 生成范式：`packages/ai/src/router.ts` 的 `generateAssignmentQuestions`（620–668）是模板——`loadPrompt(name, version)` → `ensurePromptInDb` → `prompt.interpolate(...)` → 组 request（`model = TASK_MODEL_MAP[taskKind]`）→ `runJsonTaskWithAudit({ taskKind, promptTemplateId, request, schema, scanForbidden })`。`runJsonTaskWithAudit` 已含 PII 脱敏 + parse 重试 2 次 + 审计 + 返回 `{ ...validated, modelCallId }`。
- `PAPER_GEN` 已登记：`packages/ai/src/tasks.ts`（TaskKind + `TASK_MODEL_MAP.PAPER_GEN="qwen-max"`）、`packages/billing/src/pricing.ts`（`PAPER_GEN: 5`）、`packages/domain/src/rbac.ts`（Permission，且在 `DEFAULT_LOGGED_IN_PERMS`——**人人有，不能用 `permissionProcedure` 限教师**）。**但无生成方法/prompt/schema**，本 plan 补。
- mock 派发：`packages/ai/src/adapters/mock.ts` 的 `pickDefault(sys)` 按 **system message 关键词** 返回 `DEFAULT_*`（如 `sys.includes("assignment question generation assistant")`）。
- 持久化范式：`apps/web/server/lib/assignment-generation.ts` 的 `persistGeneratedAssignment`——`$transaction` 建 Assignment+items+`Question(DRAFT, source=...)`，事务外 `reconcileHintsSync`。
- owner-only：`apps/web/server/trpc.ts:480` `OWNER_ONLY_QUESTION_SOURCES = new Set(["USER_ADHOC","VARIANT_GENERATED"])`；`validateQuestionAccess`（499–533）用它判跨用户。
- teacher gating 现状：assignment 用 `requireTeacherClassroom`（资源归属）在 `.use()` 内、charge 前；Paper 无班级，需 persona 级 `requireTeacherPersona`。
- `ctx.auth`（`AuthCtx = AccessClaims & {isMinor, guardianConsentStatus}`）含 `persona`、`roles`（来自 JWT claims），零 DB 查询可读 `ctx.auth.persona`。
- `QuestionType`：`SINGLE_CHOICE|MULTI_CHOICE|FILL_BLANK|CALCULATION|PROOF|ESSAY`。
- 测试 harness：`@zhijiao/db/test-utils` 的 `prisma`/`resetDb`；`apps/web/tests/integration/_helpers/error-book-fixtures` 的 `makeCtx(userId)`/`seedUserWithBalance(balance, {gradeLevel})`（默认 persona STUDENT——教师 fixture 见各任务）。
- Windows migrate：`pnpm db:migrate` 卡壳走 README docker-exec 绕过。

---

## Task 1: Schema —— Paper / PaperItem / 枚举 / Question.cognitiveLevel

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Migration: 新建

- [ ] **Step 1: 加枚举（放近 Question 区）**

```prisma
enum CognitiveLevel { REMEMBER UNDERSTAND APPLY ANALYZE }
enum PaperStatus { DRAFT READY }
enum PaperItemSource { BANK AI_GENERATED }
```

- [ ] **Step 2: `Question` 加 cognitiveLevel + relation**

```prisma
model Question {
  // ... 现有字段 ...
  cognitiveLevel CognitiveLevel? @map("cognitive_level")   // Plan 17
  // ... 现有 relations ...
  paperItems     PaperItem[]                                // Plan 17
  @@map("questions")
}
```

- [ ] **Step 3: `User` 加 papers relation**（在 User model relation 区）

```prisma
  papers Paper[] @relation("TeacherPapers")
```

- [ ] **Step 4: 新增 Paper / PaperItem model**

```prisma
model Paper {
  id                 String      @id @default(cuid())
  teacherUserId      String      @map("teacher_user_id")
  subjectId          String      @map("subject_id")
  title              String
  status             PaperStatus @default(DRAFT)
  paramsJson         Json        @map("params_json")
  generationLedgerId String?     @map("generation_ledger_id")
  generationCallId   String?     @map("generation_call_id")
  createdAt          DateTime    @default(now()) @map("created_at")
  updatedAt          DateTime    @updatedAt @map("updated_at")

  teacher User        @relation("TeacherPapers", fields: [teacherUserId], references: [id], onDelete: Restrict)
  subject Subject     @relation(fields: [subjectId], references: [id])
  items   PaperItem[]

  @@index([teacherUserId, status, createdAt])
  @@map("papers")
}

model PaperItem {
  id             String          @id @default(cuid())
  paperId        String          @map("paper_id")
  position       Int
  questionId     String?         @map("question_id")
  source         PaperItemSource
  stemMd         String          @db.Text @map("stem_md")
  type           QuestionType
  optionsJson    Json?           @map("options_json")
  answerMd       String          @db.Text @map("answer_md")
  solutionMd     String          @db.Text @map("solution_md")
  rubricMd       String?         @db.Text @map("rubric_md")
  points         Int             @default(0)
  difficulty     Int             @default(3)
  cognitiveLevel CognitiveLevel  @map("cognitive_level")
  kpHints        String[]        @default([]) @map("kp_hints")
  createdAt      DateTime        @default(now()) @map("created_at")

  paper    Paper     @relation(fields: [paperId], references: [id], onDelete: Cascade)
  question Question? @relation(fields: [questionId], references: [id], onDelete: SetNull)

  @@unique([paperId, position])
  @@index([questionId])
  @@map("paper_items")
}
```

- [ ] **Step 5: 加 `Subject.papers` 反向关系**（Subject model 内）

```prisma
  papers Paper[]
```

- [ ] **Step 6: migrate + generate + test DB**

Run: `pnpm db:migrate`（名 `plan17_paper`）→ `pnpm --filter @zhijiao/db prisma generate` → `pnpm test:setup`
Expected: 迁移成功，client 含 `Paper`/`PaperItem`/`CognitiveLevel`/`PaperStatus`/`PaperItemSource`

- [ ] **Step 7: typecheck + Commit**

Run: `pnpm --filter @zhijiao/db typecheck`
```bash
git add packages/db/prisma
git commit -m "feat(db): Paper/PaperItem + CognitiveLevel + Question.cognitiveLevel (Plan 17)"
```

---

## Task 2: AI PAPER_GEN schema + prompt + mock

**Files:**
- Modify: `packages/ai/src/schemas.ts`（加 input/output schema + scanForbidden）
- Create: `packages/ai/src/prompts/paper-gen/v1.md`
- Modify: `packages/ai/src/adapters/mock.ts`（DEFAULT_PAPER + dispatch）
- Modify: `packages/ai/src/index.ts`（导出）
- Test: `packages/ai/tests/paper-gen-schema.test.ts`

- [ ] **Step 1: 写 schema 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { PaperGenerationOutputSchema, scanPaperGenerationForForbidden } from "../src/schemas.js";

const valid = {
  title: "一次函数练习卷",
  items: [{
    stemMd: "求 y=2x+1 当 x=3 时的值", type: "CALCULATION", answerMd: "7",
    solutionMd: "代入 x=3：y=2*3+1=7", difficulty: 2, cognitiveLevel: "APPLY",
    points: 5, knowledgePointHints: ["一次函数求值"],
  }],
};

describe("PaperGenerationOutputSchema", () => {
  it("接受合法输出", () => { expect(() => PaperGenerationOutputSchema.parse(valid)).not.toThrow(); });
  it("拒非法 cognitiveLevel", () => {
    expect(() => PaperGenerationOutputSchema.parse({ ...valid, items: [{ ...valid.items[0], cognitiveLevel: "X" }] })).toThrow();
  });
  it("scanForbidden 命中提分文案", () => {
    const bad = { ...valid, items: [{ ...valid.items[0], solutionMd: "保证提分 30 分" }] };
    expect(scanPaperGenerationForForbidden(PaperGenerationOutputSchema.parse(bad)).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/ai test -- tests/paper-gen-schema.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 `schemas.ts` 末尾加（参考既有 FORBIDDEN 扫描工具，复用同一禁词表）**

```ts
// === PaperGeneration (Plan 17) ===
export const PaperItemTypeEnum = z.enum(["SINGLE_CHOICE","MULTI_CHOICE","FILL_BLANK","CALCULATION","PROOF","ESSAY"]);
export const CognitiveLevelEnum = z.enum(["REMEMBER","UNDERSTAND","APPLY","ANALYZE"]);

export const PaperGenerationInputSchema = z.object({
  subject: z.string(),
  gradeLevel: z.string(),
  kpNames: z.array(z.string()).min(1),
  questionTypes: z.array(PaperItemTypeEnum).min(1),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  count: z.number().int().min(1).max(30),
  excludeStems: z.array(z.string()).default([]),   // BANK 已选题摘要，避免重复
});
export type PaperGenerationInput = z.infer<typeof PaperGenerationInputSchema>;

export const PaperGenItemSchema = z.object({
  stemMd: z.string().min(1),
  type: PaperItemTypeEnum,
  options: z.array(z.string()).optional(),
  answerMd: z.string().min(1),
  solutionMd: z.string().min(1),
  rubricMd: z.string().optional(),
  difficulty: z.number().int().min(1).max(5),
  cognitiveLevel: CognitiveLevelEnum,
  points: z.number().int().min(1).max(100),
  knowledgePointHints: z.array(z.string()).default([]),
});
export const PaperGenerationOutputSchema = z.object({
  title: z.string().min(1),
  items: z.array(PaperGenItemSchema).min(1),
});
export type PaperGenerationOutput = z.infer<typeof PaperGenerationOutputSchema>;

// 复用与 assignment 相同的禁词扫描（提分/分数/通过/恐吓）。
export function scanPaperGenerationForForbidden(out: PaperGenerationOutput): string[] {
  const text = [out.title, ...out.items.flatMap((i) => [i.stemMd, i.answerMd, i.solutionMd, i.rubricMd ?? ""])].join("\n");
  return scanTextForForbidden(text);   // 复用 schemas.ts 既有 scanTextForForbidden；若名不同，对齐 assignment 用的同一函数
}
```

> 实现注意：`scanTextForForbidden` 用 `scanAssignmentQuestionGenerationForForbidden` 内部依赖的同一禁词常量；若该工具未导出独立函数，抽出 `scanTextForForbidden(text: string): string[]` 供两处复用（DRY）。

- [ ] **Step 4: 写 prompt `prompts/paper-gen/v1.md`**

```markdown
你是严谨的 K12 数学练习卷命题助手。根据参数生成一份练习卷，只输出 JSON。

- 学科：{{subject}}
- 年级：{{gradeLevel}}
- 知识点：{{kpNames}}
- 题型（仅用这些）：{{questionTypes}}
- 难度范围（1–5）：{{difficultyRange}}
- 题量：{{count}}
- 需避免与以下题重复（题干摘要）：{{excludeStems}}

要求：
- 覆盖给定知识点，难度落在范围内，题型仅取所列。
- 每题给出标准答案（answerMd）与分步解析（solutionMd）；主观题/证明题给评分标准（rubricMd）。
- 标注每题 cognitiveLevel ∈ {REMEMBER,UNDERSTAND,APPLY,ANALYZE} 与 points（分值，整数）。
- knowledgePointHints 用中文知识点名。
- 严禁出现"提分/涨分/必考/保过/通过保证/分数承诺"等措辞，不得制造焦虑。
- 只输出 JSON：{ "title": string, "items": [{ "stemMd","type","options"?,"answerMd","solutionMd","rubricMd"?,"difficulty","cognitiveLevel","points","knowledgePointHints" }] }
```

- [ ] **Step 5: mock `DEFAULT_PAPER` + dispatch**（`adapters/mock.ts`）

```ts
const DEFAULT_PAPER = {
  title: "Mock 一次函数练习卷",
  items: [
    { stemMd: "求 y=2x+1 当 x=2 的值", type: "CALCULATION", answerMd: "5", solutionMd: "代入得 5", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数求值"] },
    { stemMd: "下列是一次函数的是（ ）", type: "SINGLE_CHOICE", options: ["y=x^2","y=2x+1","y=1/x","y=|x|"], answerMd: "B", solutionMd: "y=2x+1 形如 y=kx+b", difficulty: 1, cognitiveLevel: "UNDERSTAND", points: 5, knowledgePointHints: ["一次函数概念"] },
  ],
};
// pickDefault(sys) 内，returns DEFAULT_TUTORING 之前加：
if (sys.includes("练习卷命题助手")) return DEFAULT_PAPER;
```

- [ ] **Step 6: 导出**（`index.ts`）：`PaperGenerationInputSchema`/`PaperGenerationOutputSchema`/`PaperGenerationOutput`/`scanPaperGenerationForForbidden`/`CognitiveLevelEnum`。

- [ ] **Step 7: 跑测试确认 PASS + Commit**

Run: `pnpm --filter @zhijiao/ai test -- tests/paper-gen-schema.test.ts`
```bash
git add packages/ai
git commit -m "feat(ai): PAPER_GEN schema + prompt + mock (Plan 17)"
```

---

## Task 3: `AiRouter.generatePaper`

**Files:**
- Modify: `packages/ai/src/router.ts`
- Test: `packages/ai/tests/generate-paper.test.ts`

- [ ] **Step 1: 写失败测试**（mock adapter → DEFAULT_PAPER）

```ts
import { describe, it, expect } from "vitest";
import { makeTestRouter } from "./_helpers/make-router.js"; // 若无，仿现有 router 测试构造（mock adapter + 测试 prisma）

describe("AiRouter.generatePaper", () => {
  it("mock 返回合法练习卷 + modelCallId", async () => {
    const router = makeTestRouter();
    const out = await router.generatePaper({
      subject: "数学", gradeLevel: "G8", kpNames: ["一次函数"],
      questionTypes: ["CALCULATION","SINGLE_CHOICE"], difficultyRange: [1,3], count: 2, excludeStems: [],
    });
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.modelCallId).toBeTruthy();
    expect(out.items[0].cognitiveLevel).toBeTruthy();
  });
});
```

> 若仓库无 `makeTestRouter` helper，仿 `packages/ai/tests` 既有 router 测试（如 assignment 生成测试）的构造方式，复用其 mock adapter + 测试 prisma 装配。

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/ai test -- tests/generate-paper.test.ts`
Expected: FAIL（`generatePaper` 未定义）

- [ ] **Step 3: 在 `router.ts` 加方法（镜像 `generateAssignmentQuestions`）**

```ts
async generatePaper(
  input: unknown,
): Promise<PaperGenerationOutput & { modelCallId: string }> {
  const parsed = PaperGenerationInputSchema.parse(input);
  const taskKind: TaskKind = "PAPER_GEN";
  const prompt = await loadPrompt("paper-gen", this.opts.promptVersion ?? "v1");
  const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

  const userContent = prompt.interpolate({
    subject: parsed.subject,
    gradeLevel: parsed.gradeLevel,
    kpNames: parsed.kpNames.join(", "),
    questionTypes: parsed.questionTypes.join(", "),
    difficultyRange: `${parsed.difficultyRange[0]}-${parsed.difficultyRange[1]}`,
    count: String(parsed.count),
    excludeStems: parsed.excludeStems.length ? parsed.excludeStems.join(" / ") : "(无)",
  });

  const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
  const request = {
    model,
    messages: [
      { role: "system" as const, content: "你是严谨的 K12 数学练习卷命题助手。" },
      { role: "user" as const, content: userContent },
    ],
    responseFormat: "json_object" as const,
    temperature: 0.35,
  };

  return this.runJsonTaskWithAudit({
    taskKind,
    promptTemplateId,
    request,
    schema: PaperGenerationOutputSchema,
    scanForbidden: scanPaperGenerationForForbidden,
  });
}
```

> import：`PaperGenerationInputSchema`/`PaperGenerationOutputSchema`/`PaperGenerationOutput`/`scanPaperGenerationForForbidden`（从 `./schemas.js`）。system message 含 "练习卷命题助手" 与 mock dispatch 对齐。

- [ ] **Step 4: 跑确认 PASS + Commit**

Run: `pnpm --filter @zhijiao/ai test -- tests/generate-paper.test.ts`
```bash
git add packages/ai
git commit -m "feat(ai): AiRouter.generatePaper (Plan 17)"
```

---

## Task 4: `requireTeacherPersona` + owner-only PAPER_GENERATED + `validatePaperOwnership`

**Files:**
- Modify: `apps/web/server/trpc.ts`
- Test: `apps/web/tests/integration/paper-owner-only-question.test.ts`

- [ ] **Step 1: `OWNER_ONLY_QUESTION_SOURCES` 加 PAPER_GENERATED**

```ts
const OWNER_ONLY_QUESTION_SOURCES = new Set(["USER_ADHOC", "VARIANT_GENERATED", "PAPER_GENERATED"]);
```

- [ ] **Step 2: 加 `requireTeacherPersona` 中间件**

```ts
// Plan 17: 教师 persona 门禁（zero DB query，读 JWT claims 的 persona）。
// 必须置于 chargeMiddleware 之前——非教师不写 DEBIT。
export const requireTeacherPersona = t.middleware(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录", cause: { reason: ctx.authError ?? "NO_SESSION" } });
  }
  if (ctx.auth.persona !== "TEACHER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅教师可用", cause: { reason: "PERMISSION_DENIED" } });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});
```

- [ ] **Step 3: 加 `validatePaperOwnership` 中间件**（resource 归属，注入 ctx.paper）

```ts
// Plan 17: paper 读写归属校验。跨教师/不存在 → 合并 NOT_FOUND（无存在性侧信道）。
export const validatePaperOwnership = t.middleware(async ({ ctx, next, getRawInput }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录", cause: { reason: ctx.authError ?? "NO_SESSION" } });
  }
  const parsed = z.object({ paperId: z.string().cuid() }).safeParse(await getRawInput());
  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "缺少 paperId", cause: { reason: "PAPER_ID_REQUIRED" } });
  }
  const paper = await ctx.db.paper.findUnique({ where: { id: parsed.data.paperId }, include: { items: { orderBy: { position: "asc" } } } });
  if (!paper || paper.teacherUserId !== ctx.auth.userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "试卷不存在", cause: { reason: "PAPER_NOT_FOUND" } });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth, paper } });
});
```

- [ ] **Step 4: 写 owner-only 回归测试**（他人 PAPER_GENERATED questionId 经 error.diagnose → NOT_FOUND）

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";
vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({ async diagnose() { return {}; } }) }));
const { appRouter } = await import("@/server/routers/_root");

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

it("他人无法经 questionId 探测 PAPER_GENERATED 题", async () => {
  const subject = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  const teacher = await seedUserWithBalance(100);
  const q = await prisma.question.create({ data: { subjectId: subject.id, stemMd: "x", type: "CALCULATION", status: "DRAFT", source: "PAPER_GENERATED", createdByUserId: teacher.id } });
  const other = await seedUserWithBalance(100);
  const caller = appRouter.createCaller(makeCtx(other.id));
  await expect(caller.error.diagnose({ questionId: q.id, actualAnswerMd: "x", clientRequestId: crypto.randomUUID() }))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
});
```

- [ ] **Step 5: 跑测试 + 既有 owner-only 回归 + Commit**

Run: `pnpm --filter @zhijiao/web typecheck && pnpm --filter @zhijiao/web test -- tests/integration/paper-owner-only-question.test.ts tests/integration/variant-question-access-owner-only.test.ts tests/integration/error-diagnose-question-access.test.ts`
Expected: 全 PASS
```bash
git add apps/web/server/trpc.ts apps/web/tests/integration/paper-owner-only-question.test.ts
git commit -m "feat(web): requireTeacherPersona + PAPER_GENERATED owner-only + validatePaperOwnership (Plan 17)"
```

---

## Task 5: `buildSpecTable` 双向细目表纯函数

**Files:**
- Create: `apps/web/server/lib/paper-spec-table.ts`
- Test: `apps/web/tests/unit/paper-spec-table.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { buildSpecTable } from "@/server/lib/paper-spec-table";

const items = [
  { kpHints: ["一次函数"], cognitiveLevel: "APPLY", type: "CALCULATION", difficulty: 2, points: 5 },
  { kpHints: ["一次函数"], cognitiveLevel: "APPLY", type: "CALCULATION", difficulty: 2, points: 5 },
  { kpHints: ["不等式"], cognitiveLevel: "UNDERSTAND", type: "SINGLE_CHOICE", difficulty: 1, points: 4 },
];

describe("buildSpecTable", () => {
  it("按 KP×能力×题型×难度 聚合题数与分值，并给总分", () => {
    const t = buildSpecTable(items as never);
    expect(t.totalPoints).toBe(14);
    expect(t.totalCount).toBe(3);
    const cell = t.rows.find((r) => r.kp === "一次函数" && r.cognitiveLevel === "APPLY" && r.type === "CALCULATION" && r.difficulty === 2);
    expect(cell?.count).toBe(2);
    expect(cell?.points).toBe(10);
  });
  it("空卷返回零", () => {
    const t = buildSpecTable([]);
    expect(t.totalCount).toBe(0); expect(t.totalPoints).toBe(0); expect(t.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-spec-table.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现**

```ts
export interface SpecItem { kpHints: string[]; cognitiveLevel: string; type: string; difficulty: number; points: number; }
export interface SpecRow { kp: string; cognitiveLevel: string; type: string; difficulty: number; count: number; points: number; }
export interface SpecTable { rows: SpecRow[]; totalCount: number; totalPoints: number; }

export function buildSpecTable(items: SpecItem[]): SpecTable {
  const map = new Map<string, SpecRow>();
  let totalCount = 0;
  let totalPoints = 0;
  for (const it of items) {
    const kp = it.kpHints[0] ?? "(未标注)";
    const key = `${kp}|${it.cognitiveLevel}|${it.type}|${it.difficulty}`;
    const row = map.get(key) ?? { kp, cognitiveLevel: it.cognitiveLevel, type: it.type, difficulty: it.difficulty, count: 0, points: 0 };
    row.count += 1;
    row.points += it.points;
    map.set(key, row);
    totalCount += 1;
    totalPoints += it.points;
  }
  return { rows: [...map.values()], totalCount, totalPoints };
}
```

- [ ] **Step 4: 跑确认 PASS + Commit**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-spec-table.test.ts`
```bash
git add apps/web/server/lib/paper-spec-table.ts apps/web/tests/unit/paper-spec-table.test.ts
git commit -m "feat(web): buildSpecTable two-way spec table (Plan 17)"
```

---

## Task 6: BANK 选题（最小）+ Paper 持久化

**Files:**
- Create: `apps/web/server/lib/paper-generation.ts`
- Test: `apps/web/tests/integration/paper-generation-lib.test.ts`

- [ ] **Step 1: 写失败测试**（全 AI 落库 + BANK best-effort）

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { selectBankQuestions, persistGeneratedPaper } from "@/server/lib/paper-generation";

async function mathId() { const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} }); return s.id; }
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("paper-generation", () => {
  it("selectBankQuestions 题库空返回空（不报错）", async () => {
    const subjectId = await mathId();
    const r = await selectBankQuestions(prisma, { subjectId, kpIds: ["nonexistent-kp"], questionTypes: ["CALCULATION"], difficultyRange: [1,3], limit: 5 });
    expect(r).toEqual([]);
  });

  it("persistGeneratedPaper 落 Paper + PaperItem + AI Question(PAPER_GENERATED)", async () => {
    const subjectId = await mathId();
    const teacher = await prisma.user.create({ data: { persona: "TEACHER" } });
    const paper = await persistGeneratedPaper(prisma, {
      teacherUserId: teacher.id, subjectId, debitLedgerId: null, modelCallId: "mc1",
      paramsJson: { count: 1 }, title: "卷",
      bankItems: [],
      aiItems: [{ stemMd: "题1", type: "CALCULATION", answerMd: "1", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] }],
    });
    const items = await prisma.paperItem.findMany({ where: { paperId: paper.id }, orderBy: { position: "asc" } });
    expect(items.length).toBe(1);
    expect(items[0].source).toBe("AI_GENERATED");
    const q = await prisma.question.findUniqueOrThrow({ where: { id: items[0].questionId! } });
    expect(q.source).toBe("PAPER_GENERATED");
    expect(q.createdByUserId).toBe(teacher.id);
  });
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generation-lib.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 `paper-generation.ts`**

```ts
import "server-only";
import type { Prisma, PrismaClient, QuestionType } from "@prisma/client";
import { reconcileHintsSync } from "./kp-reconcile.js";

export interface BankSelectArgs { subjectId: string; kpIds: string[]; questionTypes: QuestionType[]; difficultyRange: [number, number]; limit: number; }
export interface BankItem { questionId: string; stemMd: string; type: QuestionType; optionsJson: unknown; answerMd: string; solutionMd: string; rubricMd: string | null; difficulty: number; cognitiveLevel: string; kpHints: string[]; }

// 最小实现：best-effort，无命中/不足直接返回空；不依赖 Plan 15 schema。
// KP 命中按 kpId（不按 name）——上游已校验 kpIds 属于 subject。
export async function selectBankQuestions(db: PrismaClient, args: BankSelectArgs): Promise<BankItem[]> {
  if (args.limit <= 0 || args.kpIds.length === 0) return [];
  const rows = await db.question.findMany({
    where: {
      subjectId: args.subjectId,
      status: "PUBLISHED",
      type: { in: args.questionTypes },
      difficulty: { gte: args.difficultyRange[0], lte: args.difficultyRange[1] },
      knowledgePoints: { some: { kpId: { in: args.kpIds } } },
    },
    include: { answer: true, knowledgePoints: { include: { kp: true } } },
    take: args.limit,
  });
  return rows
    .filter((q) => q.answer)
    .map((q) => ({
      questionId: q.id, stemMd: q.stemMd, type: q.type, optionsJson: null,
      answerMd: q.answer!.contentMd, solutionMd: q.answer!.solutionMd, rubricMd: null,
      difficulty: q.difficulty, cognitiveLevel: q.cognitiveLevel ?? "UNDERSTAND",
      kpHints: q.knowledgePoints.map((l) => l.kp.name),
    }));
}

export interface AiItem { stemMd: string; type: QuestionType; options?: string[]; answerMd: string; solutionMd: string; rubricMd?: string; difficulty: number; cognitiveLevel: string; points: number; knowledgePointHints: string[]; }

export async function persistGeneratedPaper(db: PrismaClient, args: {
  teacherUserId: string; subjectId: string; title: string; paramsJson: Prisma.InputJsonValue;
  debitLedgerId: string | null; modelCallId: string | null;
  bankItems: Array<BankItem & { points: number }>; aiItems: AiItem[];
}) {
  const reconcileTargets: Array<{ questionId: string; hints: string[] }> = [];

  const paper = await db.$transaction(async (tx) => {
    const paper = await tx.paper.create({
      data: {
        teacherUserId: args.teacherUserId, subjectId: args.subjectId, title: args.title,
        paramsJson: args.paramsJson, generationLedgerId: args.debitLedgerId, generationCallId: args.modelCallId,
      },
    });
    let position = 1;
    for (const b of args.bankItems) {
      await tx.paperItem.create({ data: {
        paperId: paper.id, position: position++, questionId: b.questionId, source: "BANK",
        stemMd: b.stemMd, type: b.type, optionsJson: b.optionsJson as Prisma.InputJsonValue | undefined,
        answerMd: b.answerMd, solutionMd: b.solutionMd, rubricMd: b.rubricMd ?? undefined,
        points: b.points, difficulty: b.difficulty, cognitiveLevel: b.cognitiveLevel as never, kpHints: b.kpHints,
      }});
    }
    for (const a of args.aiItems) {
      const q = await tx.question.create({ data: {
        subjectId: args.subjectId, stemMd: a.stemMd, type: a.type, difficulty: a.difficulty,
        status: "DRAFT", source: "PAPER_GENERATED", createdByUserId: args.teacherUserId,
        cognitiveLevel: a.cognitiveLevel as never,
        answer: { create: { contentMd: a.answerMd, solutionMd: a.solutionMd } },
      }});
      await tx.paperItem.create({ data: {
        paperId: paper.id, position: position++, questionId: q.id, source: "AI_GENERATED",
        stemMd: a.stemMd, type: a.type, optionsJson: a.options as Prisma.InputJsonValue | undefined,
        answerMd: a.answerMd, solutionMd: a.solutionMd, rubricMd: a.rubricMd ?? undefined,
        points: a.points, difficulty: a.difficulty, cognitiveLevel: a.cognitiveLevel as never, kpHints: a.knowledgePointHints,
      }});
      reconcileTargets.push({ questionId: q.id, hints: a.knowledgePointHints });
    }
    return paper;
  });

  for (const t of reconcileTargets) {
    await reconcileHintsSync(db, { questionId: t.questionId, hints: t.hints, source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: t.questionId });
  }
  return paper;
}
```

- [ ] **Step 4: 跑确认 PASS + Commit**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generation-lib.test.ts`
```bash
git add apps/web/server/lib/paper-generation.ts apps/web/tests/integration/paper-generation-lib.test.ts
git commit -m "feat(web): paper-generation lib (minimal BANK select + persist) (Plan 17)"
```

---

## Task 7: paper 路由（generate/list/get/markReady/removeItem/updateItemPoints）

**Files:**
- Create: `apps/web/server/routers/paper.ts`
- Modify: `apps/web/server/routers/_root.ts`（挂 paperRouter）
- Test: `apps/web/tests/integration/paper-generate.test.ts`

- [ ] **Step 1: 写失败测试**（生成扣费 / 非教师扣费前拒 / markReady / 跨教师 NOT_FOUND）

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({
  async generatePaper() {
    return { title: "卷", modelCallId: "mc1", items: [
      { stemMd: "题1", type: "CALCULATION", answerMd: "1", solutionMd: "s", difficulty: 2, cognitiveLevel: "APPLY", points: 5, knowledgePointHints: ["一次函数"] },
    ] };
  },
}) }));
const { appRouter } = await import("@/server/routers/_root");

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

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("paper.generate", () => {
  it("教师全 AI 出卷：落 Paper + Question(PAPER_GENERATED)、扣 5", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id));
    const r = await caller.paper.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", questionTypes: ["CALCULATION"], difficultyRange: [1,3], count: 1, clientRequestId: crypto.randomUUID() });
    expect(r.paperId).toBeTruthy();
    const items = await prisma.paperItem.count({ where: { paperId: r.paperId } });
    expect(items).toBe(1);
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } });
    expect(w.balance).toBe(95);
  });

  it("非教师调用：扣费前 FORBIDDEN、不写 DEBIT", async () => {
    const t = await seedTeacher(100);   // 借其 subjectId/kpId 组合法参数
    const student = await seedUserWithBalance(100); // persona STUDENT
    const caller = appRouter.createCaller(makeCtx(student.id));
    await expect(caller.paper.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", questionTypes: ["CALCULATION"], difficultyRange: [1,3], count: 1, clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const ledgers = await prisma.creditLedger.count({ where: { wallet: { userId: student.id } } });
    expect(ledgers).toBe(0);
  });

  it("kpIds 不属于 subject：写 DEBIT 后补偿（净零）、不落 Paper", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id));
    await expect(caller.paper.generate({ subjectId: t.subjectId, kpIds: ["clxnonexistentkp00000000"], gradeLevel: "G8", questionTypes: ["CALCULATION"], difficultyRange: [1,3], count: 1, clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.paper.count({ where: { teacherUserId: t.id } })).toBe(0);
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } });
    expect(w.balance).toBe(100); // DEBIT+COMPENSATION 净零
  });

  it("markReady DRAFT→READY；跨教师 NOT_FOUND", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id));
    const r = await caller.paper.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", questionTypes: ["CALCULATION"], difficultyRange: [1,3], count: 1, clientRequestId: crypto.randomUUID() });
    await caller.paper.markReady({ paperId: r.paperId });
    expect((await prisma.paper.findUniqueOrThrow({ where: { id: r.paperId } })).status).toBe("READY");
    const other = await seedTeacher(100);
    const otherCaller = appRouter.createCaller(makeCtx(other.id));
    await expect(otherCaller.paper.markReady({ paperId: r.paperId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/paper-generate.test.ts`
Expected: FAIL（paper 路由不存在）

- [ ] **Step 3: 写 `paper.ts`**

```ts
import "server-only";
import { z } from "zod";
import {
  authedProcedure, requireTeacherPersona, requireGuardianConsent,
  chargeMiddleware, validatePaperOwnership, router,
} from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { selectBankQuestions, persistGeneratedPaper } from "../lib/paper-generation.js";
import { buildSpecTable } from "../lib/paper-spec-table.js";
import { logger } from "../logger.js";

const QType = z.enum(["SINGLE_CHOICE","MULTI_CHOICE","FILL_BLANK","CALCULATION","PROOF","ESSAY"]);
const GenInput = z.object({
  subjectId: z.string().cuid(),
  kpIds: z.array(z.string().cuid()).min(1),
  gradeLevel: z.enum(["G5","G6","G7","G8","G9","G10","G11","G12"]),
  questionTypes: z.array(QType).min(1),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  count: z.number().int().min(1).max(30),
  clientRequestId: z.string().uuid(),
});

export const paperRouter = router({
  generate: authedProcedure
    .input(GenInput)                           // 先校验参数——畸形参数在扣费前失败（见 assignment.generateDraftFromCriteria 范式）
    .use(requireTeacherPersona)               // 扣费前教师门禁
    .use(requireGuardianConsent)
    .use(chargeMiddleware("PAPER_GEN"))        // 固定 5 credits
    .mutation(async ({ ctx, input }) => {
      // KP 校验 + 派生 kpNames（不信任客户端 kpNames）。已过 charge → 失败由既有补偿退 5。
      const kps = await ctx.db.knowledgePoint.findMany({
        where: { id: { in: input.kpIds }, subjectId: input.subjectId },
        select: { id: true, name: true },
      });
      if (kps.length !== input.kpIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "知识点与学科不匹配", cause: { reason: "KP_SUBJECT_MISMATCH" } });
      }
      const kpNames = kps.map((k) => k.name);
      const bank = await selectBankQuestions(ctx.db, {
        subjectId: input.subjectId, kpIds: input.kpIds, questionTypes: input.questionTypes,
        difficultyRange: input.difficultyRange, limit: input.count,
      });
      const gap = input.count - bank.length;
      let aiItems: PaperGenerationOutput["items"] = [];   // import type { PaperGenerationOutput } from "@zhijiao/ai"
      let title = "练习卷";
      let modelCallId: string | null = null;
      if (gap > 0) {
        let ai;
        try {
          ai = await getAiRouter(ctx.auth.userId).generatePaper({
            subject: "数学", gradeLevel: input.gradeLevel, kpNames,
            questionTypes: input.questionTypes, difficultyRange: input.difficultyRange,
            count: gap, excludeStems: bank.map((b) => b.stemMd.slice(0, 40)),
          });
        } catch (e) {
          if (e instanceof ComplianceRejectedError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "生成内容未通过合规检查，请调整参数重试。", cause: { reason: "COMPLIANCE_REJECTED", original: e } });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "出卷失败，请稍后再试。", cause: { reason: "PAPER_INTERNAL" } });
        }
        aiItems = ai.items;
        title = ai.title;
        modelCallId = ai.modelCallId;
      }
      const paper = await persistGeneratedPaper(ctx.db, {
        teacherUserId: ctx.auth.userId, subjectId: input.subjectId, title,
        paramsJson: input as unknown as Record<string, unknown>,
        debitLedgerId: ctx.debit.ledgerId, modelCallId,
        bankItems: bank.map((b) => ({ ...b, points: 5 })),   // v1 默认每题 5 分，可在预览页调
        aiItems,
      });
      return { paperId: paper.id };
    }),

  list: authedProcedure.use(requireTeacherPersona).query(async ({ ctx }) => {
    return ctx.db.paper.findMany({
      where: { teacherUserId: ctx.auth.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, createdAt: true, _count: { select: { items: true } } },
    });
  }),

  get: authedProcedure.use(requireTeacherPersona).use(validatePaperOwnership)
    .input(z.object({ paperId: z.string().cuid() }))
    .query(async ({ ctx }) => {
      const specTable = buildSpecTable(ctx.paper.items.map((i) => ({ kpHints: i.kpHints, cognitiveLevel: i.cognitiveLevel, type: i.type, difficulty: i.difficulty, points: i.points })));
      return { paper: ctx.paper, specTable };
    }),

  markReady: authedProcedure.use(requireTeacherPersona).use(validatePaperOwnership)
    .input(z.object({ paperId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
      await ctx.db.paper.update({ where: { id: ctx.paper.id }, data: { status: "READY" } });
      return { ok: true };
    }),

  removeItem: authedProcedure.use(requireTeacherPersona).use(validatePaperOwnership)
    .input(z.object({ paperId: z.string().cuid(), itemId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = ctx.paper.items.find((i) => i.id === input.itemId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "题目不存在", cause: { reason: "ITEM_NOT_FOUND" } });
      await ctx.db.paperItem.delete({ where: { id: input.itemId } });
      return { ok: true };
    }),

  updateItemPoints: authedProcedure.use(requireTeacherPersona).use(validatePaperOwnership)
    .input(z.object({ paperId: z.string().cuid(), itemId: z.string().cuid(), points: z.number().int().min(0).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const item = ctx.paper.items.find((i) => i.id === input.itemId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "题目不存在", cause: { reason: "ITEM_NOT_FOUND" } });
      await ctx.db.paperItem.update({ where: { id: input.itemId }, data: { points: input.points } });
      return { ok: true };
    }),
});
```

> 注：`validatePaperOwnership` 用 `getRawInput().paperId`，故 get/markReady/removeItem/updateItemPoints 的 input 都含 `paperId`。`ctx.debit.ledgerId` 由 `chargeMiddleware` 注入。顶部 `import type { PaperGenerationOutput } from "@zhijiao/ai"`。

- [ ] **Step 4: 挂进 `_root.ts`**

```ts
import { paperRouter } from "./paper.js";
// appRouter 内：
paper: paperRouter,
```

- [ ] **Step 5: 跑测试 PASS + typecheck + Commit**

Run: `pnpm --filter @zhijiao/web typecheck && pnpm --filter @zhijiao/web test -- tests/integration/paper-generate.test.ts`
```bash
git add apps/web/server/routers/paper.ts apps/web/server/routers/_root.ts apps/web/tests/integration/paper-generate.test.ts
git commit -m "feat(web): paper router (generate/list/get/markReady/edit) (Plan 17)"
```

---

## Task 8: 教师 UI（列表 / 新建 / 预览 / 打印）

**Files:**
- Create: `apps/web/app/teacher/papers/page.tsx`（列表）
- Create: `apps/web/app/teacher/papers/new/page.tsx`（参数表单 + 生成）
- Create: `apps/web/app/teacher/papers/[id]/page.tsx`（预览 + 编辑 + markReady）
- Create: `apps/web/app/teacher/papers/[id]/print/page.tsx`（打印页）
- Modify: `apps/web/app/teacher/classes/[classroomId]/page.tsx`（把 `id="ai-paper"` 的 Plan 17 占位段换成"去出卷"入口链接 `/teacher/papers`）
- Modify: 教师导航（`components/shell/RoleNav.tsx`）加"AI 出卷"锚点指向 `/teacher/papers`

- [ ] **Step 1: 列表页**：`paper.list` 渲染（标题/题量/状态徽标/时间 + "新建"按钮 + 行链接到 `/teacher/papers/[id]`）。空态："还没有试卷，去新建"。

- [ ] **Step 2: 新建页**：参数表单（年级 select / KP 多选输入 / 题型多选 / 难度范围 / 题量），提交调 `paper.generate`（带 `clientRequestId=crypto.randomUUID()`），生成中用 `ui/ai-generating-panel`，成功 `router.push('/teacher/papers/'+paperId)`，失败显示重试。

- [ ] **Step 3: 预览页**：`paper.get` 渲染题目列表（题干 + 答案解析折叠 + 来源徽标 BANK/AI + 分值可调输入调 `paper.updateItemPoints` + 删题 `paper.removeItem`）；双向细目表用 `specTable` 渲染二维矩阵 + 总分；"确认完成"按钮调 `paper.markReady`；"打印/导出"链接到 `./[id]/print`。`useSearchParams` 客户端组件须 `<Suspense>` 包裹（见 implementation-state Plan 8 next build 注意）。JSX 文本中的 `"` 用 `&quot;`。

- [ ] **Step 4: 打印页**：服务端取 `paper.get`（或直接 prisma owner 校验），渲染纯净打印布局——题卷段（仅题干，答案隐藏）→ 分页 → 答案解析段 → 双向细目表段；`@media print` 隐藏导航/按钮。DRAFT/READY 都可访问。

- [ ] **Step 5: 渲染测试**（vitest `.test.tsx`，仿现有客户端组件测试）：列表空态、预览页 specTable 渲染。

Run: `pnpm --filter @zhijiao/web test -- tests/unit/paper-list.test.tsx`（按实际命名）
Expected: PASS

- [ ] **Step 6: `next build` 验证（抓 Suspense / 转义问题）**

Run: `pnpm --filter @zhijiao/web build`
Expected: build 成功

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/teacher/papers apps/web/app/teacher/classes apps/web/components/shell/RoleNav.tsx apps/web/tests
git commit -m "feat(web): teacher paper UI (list/new/preview/print) (Plan 17)"
```

---

## Task 9: PII —— 注销教师 / 导出含 Paper

**Files:**
- Modify: `apps/web/server/lib/pii-governance.ts`（deactivate + export）
- Test: `apps/web/tests/integration/pii-deactivate-paper.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { deactivateUser, exportUserData } from "@/server/lib/pii-governance";

async function mathId() { const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} }); return s.id; }
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

it("注销教师：删 Paper 级联、PAPER_GENERATED 题 createdByUserId 置 null 保留", async () => {
  const subjectId = await mathId();
  const t = await prisma.user.create({ data: { persona: "TEACHER" } });
  const q = await prisma.question.create({ data: { subjectId, stemMd: "x", type: "CALCULATION", status: "DRAFT", source: "PAPER_GENERATED", createdByUserId: t.id } });
  const paper = await prisma.paper.create({ data: { teacherUserId: t.id, subjectId, title: "卷", paramsJson: {}, items: { create: [{ position: 1, source: "AI_GENERATED", questionId: q.id, stemMd: "x", type: "CALCULATION", answerMd: "1", solutionMd: "s", points: 5, difficulty: 2, cognitiveLevel: "APPLY" }] } } });

  await deactivateUser(prisma, t.id, { reason: "test" });

  expect(await prisma.paper.count({ where: { id: paper.id } })).toBe(0);             // 级联删
  const qReread = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
  expect(qReread.createdByUserId).toBeNull();                                          // 保留行、抹归属
});

it("导出含本人 Paper", async () => {
  const subjectId = await mathId();
  const t = await prisma.user.create({ data: { persona: "TEACHER" } });
  await prisma.paper.create({ data: { teacherUserId: t.id, subjectId, title: "我的卷", paramsJson: {} } });
  const data = await exportUserData(prisma, t.id);
  expect(JSON.stringify(data)).toContain("我的卷");
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/pii-deactivate-paper.test.ts`
Expected: FAIL

- [ ] **Step 3: 改 `pii-governance.ts`**

`deactivateUser` 内（在事务里，比照 VARIANT_GENERATED 处理）：
- 删除 `paper`（`where teacherUserId=userId`；`PaperItem` 经 `onDelete: Cascade` 自动删）。
- `question.updateMany({ where: { createdByUserId: userId, source: "PAPER_GENERATED" }, data: { createdByUserId: null } })`（与 VARIANT_GENERATED 同一处扩展）。
- payload 计数加 `papersDeleted` / `paperGeneratedQuestionsScrubbed`。

`exportUserData` 内：加 `papers` 段（白名单：title/status/createdAt/items 的 stem/type/answer/solution/points/difficulty/cognitiveLevel/kpHints），不含他人数据。

- [ ] **Step 4: 跑确认 PASS + 既有 PII 回归 + Commit**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/pii-deactivate-paper.test.ts tests/integration/pii-deactivate-variant-questions.test.ts tests/integration/pii-deactivate-user.test.ts`
Expected: 全 PASS
```bash
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-deactivate-paper.test.ts
git commit -m "feat(web): PII deactivate/export covers Paper + PAPER_GENERATED (Plan 17)"
```

---

## Task 10: 全量回归 + 文档

**Files:**
- Modify: `docs/claude/implementation-state.md`、`docs/claude/merge-verification.md`、`CLAUDE.md`

- [ ] **Step 1: 全量 typecheck + test**

Run: `pnpm typecheck && pnpm test`
Expected: 全 PASS

- [ ] **Step 2: E2E**（加教师出卷 spec：登录教师 → 出卷 → 预览见题/解析/细目表 → 打印页 200）

Run: `pnpm --filter @zhijiao/web test:e2e`
Expected: 全绿

- [ ] **Step 3: `implementation-state.md`** 加「Plan 17 现状」段：独立 Paper/PaperItem 不绑班级、复用 PAPER_GEN 固定 5 credits、教师门禁在扣费前（requireTeacherPersona）、PAPER_GENERATED owner-only、混合题源（BANK best-effort 不阻塞）、双向细目表渲染时算、打印页即导出、PII 比照 VARIANT_GENERATED。

- [ ] **Step 4: `merge-verification.md`** 加探针：非教师扣费前拒不写 DEBIT / 全 AI 出卷扣 5 / owner-only PAPER_GENERATED / 注销级联 Paper。

- [ ] **Step 5: `CLAUDE.md`** 产品定位与路线图：标注 2026-06-04 转向教师产品；「已落地汇总」加 Plan 17；学生端闭环标注冻结维护态。

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: record Plan 17 AI paper generation landed + teacher-product pivot"
```

---

## Self-Review 覆盖核对

- spec §2 模型 → Task 1；§3 AI PAPER_GEN（schema/prompt/mock/方法）→ Task 2/3；§4 生成链（教师门禁在扣费前）+ 混合流程 → Task 4/6/7；§4.1 PaperStatus 流 → Task 7（markReady/removeItem/updateItemPoints）；§5 双向细目表 → Task 5 + Task 7 get；§6 owner-only + 归属 → Task 4；§7 PII → Task 9；§8 UI → Task 8；§9 合规 → Task 2 prompt + scanForbidden；§10 schema → Task 1；§11 测试 → 各任务 + Task 10 E2E。
- 类型一致：`generatePaper`/`PaperGenerationOutput`/`selectBankQuestions`/`persistGeneratedPaper`/`buildSpecTable`/`requireTeacherPersona`/`validatePaperOwnership`/`paperRouter` 跨任务命名一致。
- 计费：固定 `chargeMiddleware("PAPER_GEN")`（5 credits），教师门禁在其之前；非教师不写 DEBIT（Task 7 测试守门）。
- 最小 BANK：`selectBankQuestions` 无命中返空、不依赖 Plan 15 schema（Task 6 测试守门）。
- 已知留白（实现时照 spec §12）：变量计费 / 换题重生成 / 服务端 PDF / BANK 智能配比，均 punt。
