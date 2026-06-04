# Plan 18：AI 课件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教师按 学科/知识点/年级/(可选)教学目标 生成结构化课件（五段：导入/讲解/例题/易错点/课堂练习），可预览、分段编辑、打印导出。

**Architecture:** 独立 `Courseware`/`CoursewareSection`（教师自有，不绑班级，例题/练习仅作段 markdown 不落 Question）。复用既有 `LESSON_PLAN_GEN`（billing 3 credits + rbac），补 AI TaskKind + prompt + schema + 方法。生成链 `authedProcedure.input(GenInput).use(requireTeacherPersona).use(requireGuardianConsent).use(chargeMiddleware("LESSON_PLAN_GEN"))`（input + 教师门禁在扣费前）。AI 输出强校验恰好五段、五类型各一，落库按固定 type 顺序 position 1..5。

**Tech Stack:** TypeScript、Prisma 5、tRPC v11、Vitest、Playwright、Next.js（apps/web）、Zod。

参考 spec：`docs/superpowers/specs/2026-06-04-ai-courseware-generation-design.md`

**依赖：** 复用 Plan 17 的 `requireTeacherPersona` 中间件（`apps/web/server/trpc.ts`）。若 Plan 18 先于 Plan 17 执行，则本 plan Task 4 需先补 `requireTeacherPersona`（见 Plan 17 plan Task 4 Step 2）。

---

## 关键既有事实（实现前必读）

- 与 Plan 17 同套范式：AI 生成 = `loadPrompt → ensurePromptInDb → interpolate → request(model=TASK_MODEL_MAP[taskKind]) → runJsonTaskWithAudit`（`packages/ai/src/router.ts` 的 `generatePaper`/`generateAssignmentQuestions`）。
- `LESSON_PLAN_GEN`：`packages/billing/src/pricing.ts`（3 credits）+ `packages/domain/src/rbac.ts`（Permission，`DEFAULT_LOGGED_IN_PERMS` 人人有 → 不能用 `permissionProcedure` 限教师）。AI `tasks.ts` 无 TaskKind（本 plan 补）。
- mock 派发：`packages/ai/src/adapters/mock.ts` 的 `pickDefault(sys)` 按 system message 关键词。
- 持久化范式：`apps/web/server/lib/paper-generation.ts`（Plan 17）/ `assignment-generation.ts`——`$transaction` 建主体 + 子行。
- 教师门禁：`requireTeacherPersona`（Plan 17，读 `ctx.auth.persona`）；KP 校验范式 `assignment.generateDraftFromCriteria`（`kps.length !== kpIds.length` → BAD_REQUEST）。
- `ctx.auth` 含 `persona`；`GradeLevel`=G5..G12；`KnowledgePoint` 有 `subjectId_code` 复合唯一 + `name`。
- 测试 harness 同 Plan 17（`@zhijiao/db/test-utils`、`_helpers/error-book-fixtures`）。
- Windows migrate：`pnpm db:migrate` 卡壳走 docker-exec。

---

## Task 1: Schema —— Courseware / CoursewareSection / 枚举

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Migration: 新建

- [ ] **Step 1: 加枚举**

```prisma
enum CoursewareStatus { DRAFT READY }
enum CoursewareSectionType { INTRO EXPLANATION EXAMPLE PITFALL EXERCISE }
```

- [ ] **Step 2: `User` 加 relation**（relation 区）

```prisma
  teacherCoursewares Courseware[] @relation("TeacherCoursewares")
```

- [ ] **Step 3: `Subject` 加 relation**

```prisma
  coursewares Courseware[]
```

- [ ] **Step 4: 新增 model**

```prisma
model Courseware {
  id                 String           @id @default(cuid())
  teacherUserId      String           @map("teacher_user_id")
  subjectId          String           @map("subject_id")
  title              String
  gradeLevel         GradeLevel?      @map("grade_level")
  status             CoursewareStatus @default(DRAFT)
  paramsJson         Json             @map("params_json")
  generationLedgerId String?          @map("generation_ledger_id")
  generationCallId   String?          @map("generation_call_id")
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @updatedAt @map("updated_at")

  teacher  User                @relation("TeacherCoursewares", fields: [teacherUserId], references: [id], onDelete: Restrict)
  subject  Subject             @relation(fields: [subjectId], references: [id])
  sections CoursewareSection[]

  @@index([teacherUserId, status, createdAt])
  @@map("coursewares")
}

model CoursewareSection {
  id           String                @id @default(cuid())
  coursewareId String                @map("courseware_id")
  position     Int
  type         CoursewareSectionType
  title        String
  contentMd    String                @db.Text @map("content_md")
  createdAt    DateTime              @default(now()) @map("created_at")
  updatedAt    DateTime              @updatedAt @map("updated_at")

  courseware Courseware @relation(fields: [coursewareId], references: [id], onDelete: Cascade)

  @@unique([coursewareId, position])
  @@map("courseware_sections")
}
```

- [ ] **Step 5: migrate + generate + test DB**

Run: `pnpm db:migrate`（名 `plan18_courseware`）→ `pnpm --filter @zhijiao/db prisma generate` → `pnpm test:setup`
Expected: client 含 `Courseware`/`CoursewareSection`/`CoursewareStatus`/`CoursewareSectionType`

- [ ] **Step 6: typecheck + Commit**

Run: `pnpm --filter @zhijiao/db typecheck`
```bash
git add packages/db/prisma
git commit -m "feat(db): Courseware/CoursewareSection (Plan 18)"
```

---

## Task 2: AI LESSON_PLAN_GEN —— taskKind + schema（五段强校验）+ prompt + mock

**Files:**
- Modify: `packages/ai/src/tasks.ts`（TaskKind + 模型映射）
- Modify: `packages/ai/src/schemas.ts`（schema + scanForbidden）
- Create: `packages/ai/src/prompts/lesson-plan-gen/v1.md`
- Modify: `packages/ai/src/adapters/mock.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/tests/lesson-plan-schema.test.ts`

- [ ] **Step 1: 加 TaskKind + 模型映射**（`tasks.ts`）

`TaskKind` union 加 `| "LESSON_PLAN_GEN"`；`TASK_MODEL_MAP` 加 `LESSON_PLAN_GEN: "qwen-max",`。

- [ ] **Step 2: 写 schema 失败测试** `lesson-plan-schema.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { LessonPlanGenerationOutputSchema } from "../src/schemas.js";

const sec = (type: string) => ({ type, title: type, contentMd: "内容" });
const five = ["INTRO","EXPLANATION","EXAMPLE","PITFALL","EXERCISE"].map(sec);

describe("LessonPlanGenerationOutputSchema", () => {
  it("五段齐全过", () => { expect(() => LessonPlanGenerationOutputSchema.parse({ title: "课件", sections: five })).not.toThrow(); });
  it("缺段拒", () => { expect(() => LessonPlanGenerationOutputSchema.parse({ title: "x", sections: five.slice(0,4) })).toThrow(); });
  it("重复段拒", () => { expect(() => LessonPlanGenerationOutputSchema.parse({ title: "x", sections: [sec("INTRO"),sec("INTRO"),sec("EXPLANATION"),sec("EXAMPLE"),sec("PITFALL")] })).toThrow(); });
  it("六段拒", () => { expect(() => LessonPlanGenerationOutputSchema.parse({ title: "x", sections: [...five, sec("INTRO")] })).toThrow(); });
});
```

- [ ] **Step 3: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/ai test -- tests/lesson-plan-schema.test.ts`
Expected: FAIL

- [ ] **Step 4: 在 `schemas.ts` 末尾加**

```ts
// === LessonPlanGeneration / Courseware (Plan 18) ===
export const CoursewareSectionTypeEnum = z.enum(["INTRO","EXPLANATION","EXAMPLE","PITFALL","EXERCISE"]);
export const LESSON_SECTION_ORDER = ["INTRO","EXPLANATION","EXAMPLE","PITFALL","EXERCISE"] as const;

export const LessonPlanGenerationInputSchema = z.object({
  gradeLevel: z.string(),
  kpNames: z.array(z.string()).min(1),
  teachingGoal: z.string().optional(),
});
export type LessonPlanGenerationInput = z.infer<typeof LessonPlanGenerationInputSchema>;

export const LessonPlanGenerationOutputSchema = z.object({
  title: z.string().min(1),
  sections: z.array(z.object({
    type: CoursewareSectionTypeEnum,
    title: z.string().min(1),
    contentMd: z.string().min(1),
  })).length(5),
}).superRefine((v, ctx) => {
  const set = new Set(v.sections.map((s) => s.type));
  if (set.size !== 5 || !LESSON_SECTION_ORDER.every((t) => set.has(t))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sections 必须恰好五段且 INTRO/EXPLANATION/EXAMPLE/PITFALL/EXERCISE 各一" });
  }
});
export type LessonPlanGenerationOutput = z.infer<typeof LessonPlanGenerationOutputSchema>;

export function scanLessonPlanForForbidden(out: LessonPlanGenerationOutput): string[] {
  const text = [out.title, ...out.sections.flatMap((s) => [s.title, s.contentMd])].join("\n");
  return scanTextForForbidden(text);   // 与 paper/assignment 共用同一禁词扫描（DRY）
}
```

- [ ] **Step 5: 写 prompt `prompts/lesson-plan-gen/v1.md`**

```markdown
你是严谨的 K12 数学课件生成助手。根据参数生成一份结构化课件，只输出 JSON。

- 年级：{{gradeLevel}}
- 知识点：{{kpNames}}
- 教学目标：{{teachingGoal}}

要求：
- 必须恰好输出五段，type 分别为 INTRO（课堂导入）、EXPLANATION（讲解结构）、EXAMPLE（例题）、PITFALL（易错点）、EXERCISE（课堂练习），每类一段。
- 每段给 title 与 contentMd（Markdown，可含公式 LaTeX）。
- 按学段调整表达：小学=生活类比 / 初中=题型归类 / 高中=方法迁移。
- 易错点段聚焦概念辨析，不制造焦虑。
- 严禁"提分/涨分/必考/保过/通过保证/分数承诺"等措辞。
- 只输出 JSON：{ "title": string, "sections": [{ "type","title","contentMd" }] }
```

- [ ] **Step 6: mock `DEFAULT_LESSON_PLAN` + dispatch**（`adapters/mock.ts`）

```ts
const DEFAULT_LESSON_PLAN = {
  title: "Mock 一次函数课件",
  sections: [
    { type: "INTRO", title: "课堂导入", contentMd: "从生活中的匀速行驶引入。" },
    { type: "EXPLANATION", title: "讲解结构", contentMd: "一次函数 y=kx+b 的定义与图象。" },
    { type: "EXAMPLE", title: "例题", contentMd: "例：求 y=2x+1 当 x=2 的值。解：5。" },
    { type: "PITFALL", title: "易错点", contentMd: "混淆 k 与 b 的几何意义。" },
    { type: "EXERCISE", title: "课堂练习", contentMd: "练习：画出 y=-x+3 的图象。" },
  ],
};
// pickDefault(sys) 内，returns DEFAULT_TUTORING 之前加：
if (sys.includes("课件生成助手")) return DEFAULT_LESSON_PLAN;
```

- [ ] **Step 7: 导出**（`index.ts`）：`LessonPlanGenerationInputSchema`/`LessonPlanGenerationOutputSchema`/`LessonPlanGenerationOutput`/`scanLessonPlanForForbidden`/`CoursewareSectionTypeEnum`/`LESSON_SECTION_ORDER`。

- [ ] **Step 8: 跑确认 PASS + Commit**

Run: `pnpm --filter @zhijiao/ai test -- tests/lesson-plan-schema.test.ts`
```bash
git add packages/ai
git commit -m "feat(ai): LESSON_PLAN_GEN taskKind + strict 5-section schema + prompt + mock (Plan 18)"
```

---

## Task 3: `AiRouter.generateLessonPlan`

**Files:**
- Modify: `packages/ai/src/router.ts`
- Test: `packages/ai/tests/generate-lesson-plan.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { makeTestRouter } from "./_helpers/make-router.js"; // 同 Plan 17 Task 3 备注：无则仿既有 router 测试构造

describe("AiRouter.generateLessonPlan", () => {
  it("mock 返回五段课件 + modelCallId", async () => {
    const router = makeTestRouter();
    const out = await router.generateLessonPlan({ gradeLevel: "G8", kpNames: ["一次函数"], teachingGoal: "理解一次函数" });
    expect(out.sections.length).toBe(5);
    expect(new Set(out.sections.map((s) => s.type)).size).toBe(5);
    expect(out.modelCallId).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/ai test -- tests/generate-lesson-plan.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 `router.ts` 加方法（镜像 `generatePaper`）**

```ts
async generateLessonPlan(
  input: unknown,
): Promise<LessonPlanGenerationOutput & { modelCallId: string }> {
  const parsed = LessonPlanGenerationInputSchema.parse(input);
  const taskKind: TaskKind = "LESSON_PLAN_GEN";
  const prompt = await loadPrompt("lesson-plan-gen", this.opts.promptVersion ?? "v1");
  const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

  const userContent = prompt.interpolate({
    gradeLevel: parsed.gradeLevel,
    kpNames: parsed.kpNames.join(", "),
    teachingGoal: parsed.teachingGoal ?? "(未提供)",
  });

  const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
  const request = {
    model,
    messages: [
      { role: "system" as const, content: "你是严谨的 K12 数学课件生成助手。" },
      { role: "user" as const, content: userContent },
    ],
    responseFormat: "json_object" as const,
    temperature: 0.4,
  };

  return this.runJsonTaskWithAudit({
    taskKind, promptTemplateId, request,
    schema: LessonPlanGenerationOutputSchema,
    scanForbidden: scanLessonPlanForForbidden,
  });
}
```

> import `LessonPlanGenerationInputSchema`/`LessonPlanGenerationOutputSchema`/`LessonPlanGenerationOutput`/`scanLessonPlanForForbidden`（`./schemas.js`）。system message 含 "课件生成助手" 对齐 mock。

- [ ] **Step 4: 跑确认 PASS + Commit**

Run: `pnpm --filter @zhijiao/ai test -- tests/generate-lesson-plan.test.ts`
```bash
git add packages/ai
git commit -m "feat(ai): AiRouter.generateLessonPlan (Plan 18)"
```

---

## Task 4: `validateCoursewareOwnership` 中间件

> `requireTeacherPersona` 复用 Plan 17（若未实现见依赖说明）。

**Files:**
- Modify: `apps/web/server/trpc.ts`

- [ ] **Step 1: 加 `validateCoursewareOwnership`**

```ts
// Plan 18: courseware 读写归属校验。跨教师/不存在 → 合并 NOT_FOUND。注入 ctx.courseware（含 sections 按 position）。
export const validateCoursewareOwnership = t.middleware(async ({ ctx, next, getRawInput }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录", cause: { reason: ctx.authError ?? "NO_SESSION" } });
  }
  const parsed = z.object({ coursewareId: z.string().cuid() }).safeParse(await getRawInput());
  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "缺少 coursewareId", cause: { reason: "COURSEWARE_ID_REQUIRED" } });
  }
  const courseware = await ctx.db.courseware.findUnique({ where: { id: parsed.data.coursewareId }, include: { sections: { orderBy: { position: "asc" } } } });
  if (!courseware || courseware.teacherUserId !== ctx.auth.userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "课件不存在", cause: { reason: "COURSEWARE_NOT_FOUND" } });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth, courseware } });
});
```

- [ ] **Step 2: typecheck + Commit**

Run: `pnpm --filter @zhijiao/web typecheck`
```bash
git add apps/web/server/trpc.ts
git commit -m "feat(web): validateCoursewareOwnership middleware (Plan 18)"
```

---

## Task 5: 课件持久化 lib

**Files:**
- Create: `apps/web/server/lib/courseware-generation.ts`
- Test: `apps/web/tests/integration/courseware-generation-lib.test.ts`

- [ ] **Step 1: 写失败测试**（五段按固定 type 顺序落 position 1..5，即使 AI 乱序）

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { persistGeneratedCourseware } from "@/server/lib/courseware-generation";

async function mathId() { const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} }); return s.id; }
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

it("按固定 type 顺序落 position 1..5（不信任 AI 顺序）", async () => {
  const subjectId = await mathId();
  const teacher = await prisma.user.create({ data: { persona: "TEACHER" } });
  // 故意乱序
  const sections = [
    { type: "EXERCISE", title: "练习", contentMd: "c5" },
    { type: "INTRO", title: "导入", contentMd: "c1" },
    { type: "PITFALL", title: "易错", contentMd: "c4" },
    { type: "EXAMPLE", title: "例题", contentMd: "c3" },
    { type: "EXPLANATION", title: "讲解", contentMd: "c2" },
  ];
  const cw = await persistGeneratedCourseware(prisma, {
    teacherUserId: teacher.id, subjectId, title: "课件",
    paramsJson: { gradeLevel: "G8" }, gradeLevel: "G8", debitLedgerId: null, modelCallId: "mc1", sections,
  });
  const rows = await prisma.coursewareSection.findMany({ where: { coursewareId: cw.id }, orderBy: { position: "asc" } });
  expect(rows.map((r) => r.type)).toEqual(["INTRO","EXPLANATION","EXAMPLE","PITFALL","EXERCISE"]);
  expect(rows.map((r) => r.position)).toEqual([1,2,3,4,5]);
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/courseware-generation-lib.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 `courseware-generation.ts`**

```ts
import "server-only";
import type { Prisma, PrismaClient, GradeLevel } from "@prisma/client";
import { LESSON_SECTION_ORDER } from "@zhijiao/ai";

export interface CwSection { type: string; title: string; contentMd: string; }

export async function persistGeneratedCourseware(db: PrismaClient, args: {
  teacherUserId: string; subjectId: string; title: string;
  gradeLevel: GradeLevel | null; paramsJson: Prisma.InputJsonValue;
  debitLedgerId: string | null; modelCallId: string | null; sections: CwSection[];
}) {
  // 按固定 type 顺序重排（不信任 AI 返回顺序）。schema 已保证五类型各一。
  const ordered = LESSON_SECTION_ORDER.map((type) => {
    const s = args.sections.find((x) => x.type === type);
    if (!s) throw new Error(`missing section ${type}`);
    return s;
  });
  return db.courseware.create({
    data: {
      teacherUserId: args.teacherUserId, subjectId: args.subjectId, title: args.title,
      gradeLevel: args.gradeLevel ?? undefined, paramsJson: args.paramsJson,
      generationLedgerId: args.debitLedgerId, generationCallId: args.modelCallId,
      sections: { create: ordered.map((s, i) => ({ position: i + 1, type: s.type as never, title: s.title, contentMd: s.contentMd })) },
    },
  });
}
```

- [ ] **Step 4: 跑确认 PASS + Commit**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/courseware-generation-lib.test.ts`
```bash
git add apps/web/server/lib/courseware-generation.ts apps/web/tests/integration/courseware-generation-lib.test.ts
git commit -m "feat(web): courseware-generation persist lib (fixed section order) (Plan 18)"
```

---

## Task 6: courseware 路由（generate/list/get/markReady/updateSection）

**Files:**
- Create: `apps/web/server/routers/courseware.ts`
- Modify: `apps/web/server/routers/_root.ts`
- Test: `apps/web/tests/integration/courseware-generate.test.ts`

- [ ] **Step 1: 写失败测试**（生成扣 3 / 非教师扣费前拒 / KP mismatch 补偿 / markReady / updateSection / 跨教师 NOT_FOUND）

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({
  async generateLessonPlan() {
    return { title: "课件", modelCallId: "mc1", sections: [
      { type: "INTRO", title: "导入", contentMd: "c1" }, { type: "EXPLANATION", title: "讲解", contentMd: "c2" },
      { type: "EXAMPLE", title: "例题", contentMd: "c3" }, { type: "PITFALL", title: "易错", contentMd: "c4" },
      { type: "EXERCISE", title: "练习", contentMd: "c5" },
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
    create: { subjectId: subject.id, code: "math-g8-linear-eq-solve", name: "一次方程求解" }, update: {},
  });
  return { id: u.id, subjectId: subject.id, kpId: kp.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("courseware.generate", () => {
  it("教师生成：落 Courseware + 5 段、扣 3", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id));
    const r = await caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() });
    expect(await prisma.coursewareSection.count({ where: { coursewareId: r.coursewareId } })).toBe(5);
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } });
    expect(w.balance).toBe(97);
  });

  it("非教师：扣费前 FORBIDDEN、不写 DEBIT", async () => {
    const t = await seedTeacher(100);
    const student = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(student.id));
    await expect(caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.creditLedger.count({ where: { wallet: { userId: student.id } } })).toBe(0);
  });

  it("kpIds 不属于 subject：写 DEBIT 后补偿（净零）、不落 Courseware", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id));
    await expect(caller.courseware.generate({ subjectId: t.subjectId, kpIds: ["clxnonexistentkp00000000"], gradeLevel: "G8", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.courseware.count({ where: { teacherUserId: t.id } })).toBe(0);
    expect((await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } })).balance).toBe(100);
  });

  it("updateSection 改内容；markReady；跨教师 NOT_FOUND", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id));
    const r = await caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() });
    const sec = await prisma.coursewareSection.findFirstOrThrow({ where: { coursewareId: r.coursewareId, type: "INTRO" } });
    await caller.courseware.updateSection({ coursewareId: r.coursewareId, sectionId: sec.id, contentMd: "改后的导入" });
    expect((await prisma.coursewareSection.findUniqueOrThrow({ where: { id: sec.id } })).contentMd).toBe("改后的导入");
    await caller.courseware.markReady({ coursewareId: r.coursewareId });
    expect((await prisma.courseware.findUniqueOrThrow({ where: { id: r.coursewareId } })).status).toBe("READY");
    const other = await seedTeacher(100);
    await expect(appRouter.createCaller(makeCtx(other.id)).courseware.markReady({ coursewareId: r.coursewareId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/courseware-generate.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 `courseware.ts`**

```ts
import "server-only";
import { z } from "zod";
import {
  authedProcedure, requireTeacherPersona, requireGuardianConsent,
  chargeMiddleware, validateCoursewareOwnership, router,
} from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { persistGeneratedCourseware } from "../lib/courseware-generation.js";

const GenInput = z.object({
  subjectId: z.string().cuid(),
  kpIds: z.array(z.string().cuid()).min(1),
  gradeLevel: z.enum(["G5","G6","G7","G8","G9","G10","G11","G12"]),
  teachingGoal: z.string().max(500).optional(),
  clientRequestId: z.string().uuid(),
});

export const coursewareRouter = router({
  generate: authedProcedure
    .input(GenInput)                          // 校验在中间件前
    .use(requireTeacherPersona)               // 扣费前教师门禁
    .use(requireGuardianConsent)
    .use(chargeMiddleware("LESSON_PLAN_GEN"))  // 固定 3 credits
    .mutation(async ({ ctx, input }) => {
      const kps = await ctx.db.knowledgePoint.findMany({
        where: { id: { in: input.kpIds }, subjectId: input.subjectId },
        select: { id: true, name: true },
      });
      if (kps.length !== input.kpIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "知识点与学科不匹配", cause: { reason: "KP_SUBJECT_MISMATCH" } });
      }
      const kpNames = kps.map((k) => k.name);
      let ai;
      try {
        ai = await getAiRouter(ctx.auth.userId).generateLessonPlan({ gradeLevel: input.gradeLevel, kpNames, teachingGoal: input.teachingGoal });
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "生成内容未通过合规检查，请调整参数重试。", cause: { reason: "COMPLIANCE_REJECTED", original: e } });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "课件生成失败，请稍后再试。", cause: { reason: "COURSEWARE_INTERNAL" } });
      }
      const cw = await persistGeneratedCourseware(ctx.db, {
        teacherUserId: ctx.auth.userId, subjectId: input.subjectId, title: ai.title,
        gradeLevel: input.gradeLevel, paramsJson: { subjectId: input.subjectId, kpIds: input.kpIds, gradeLevel: input.gradeLevel, teachingGoal: input.teachingGoal ?? null },
        debitLedgerId: ctx.debit.ledgerId, modelCallId: ai.modelCallId, sections: ai.sections,
      });
      return { coursewareId: cw.id };
    }),

  list: authedProcedure.use(requireTeacherPersona).query(async ({ ctx }) => {
    return ctx.db.courseware.findMany({
      where: { teacherUserId: ctx.auth.userId }, orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, gradeLevel: true, createdAt: true },
    });
  }),

  get: authedProcedure.use(requireTeacherPersona).use(validateCoursewareOwnership)
    .input(z.object({ coursewareId: z.string().cuid() }))
    .query(async ({ ctx }) => ({ courseware: ctx.courseware })),

  markReady: authedProcedure.use(requireTeacherPersona).use(validateCoursewareOwnership)
    .input(z.object({ coursewareId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
      await ctx.db.courseware.update({ where: { id: ctx.courseware.id }, data: { status: "READY" } });
      return { ok: true };
    }),

  updateSection: authedProcedure.use(requireTeacherPersona).use(validateCoursewareOwnership)
    .input(z.object({ coursewareId: z.string().cuid(), sectionId: z.string().cuid(), title: z.string().min(1).max(200).optional(), contentMd: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const sec = ctx.courseware.sections.find((s) => s.id === input.sectionId);
      if (!sec) throw new TRPCError({ code: "NOT_FOUND", message: "段落不存在", cause: { reason: "SECTION_NOT_FOUND" } });
      await ctx.db.coursewareSection.update({ where: { id: input.sectionId }, data: { title: input.title ?? undefined, contentMd: input.contentMd ?? undefined } });
      return { ok: true };
    }),
});
```

- [ ] **Step 4: 挂进 `_root.ts`**

```ts
import { coursewareRouter } from "./courseware.js";
// appRouter 内：
courseware: coursewareRouter,
```

- [ ] **Step 5: 跑测试 PASS + typecheck + Commit**

Run: `pnpm --filter @zhijiao/web typecheck && pnpm --filter @zhijiao/web test -- tests/integration/courseware-generate.test.ts`
```bash
git add apps/web/server/routers/courseware.ts apps/web/server/routers/_root.ts apps/web/tests/integration/courseware-generate.test.ts
git commit -m "feat(web): courseware router (generate/list/get/markReady/updateSection) (Plan 18)"
```

---

## Task 7: 教师 UI（列表 / 新建 / 预览编辑 / 打印）

**Files:**
- Create: `apps/web/app/teacher/coursewares/page.tsx`（列表）
- Create: `apps/web/app/teacher/coursewares/new/page.tsx`（参数表单 + 生成）
- Create: `apps/web/app/teacher/coursewares/[id]/page.tsx`（预览 + 分段编辑 + markReady）
- Create: `apps/web/app/teacher/coursewares/[id]/print/page.tsx`（打印页）
- Modify: `apps/web/app/teacher/classes/[classroomId]/page.tsx`（`id="ai-courseware"` Plan 18 占位段换"去做课件"入口）
- Modify: `apps/web/components/shell/RoleNav.tsx`（加"AI 课件"锚点 → `/teacher/coursewares`）

- [ ] **Step 1: 列表页**：`courseware.list` 渲染（标题/年级/状态徽标/时间 + 新建按钮 + 行链接）。空态文案。

- [ ] **Step 2: 新建页**：参数表单（年级 select / KP 多选 → `kpIds`+`subjectId` / 可选教学目标），提交调 `courseware.generate`（`clientRequestId=crypto.randomUUID()`），`ui/ai-generating-panel` + 重试，成功 push 到 `/teacher/coursewares/[id]`。

- [ ] **Step 3: 预览页**：`courseware.get` 渲染五段（按 position；标题 + Markdown 内容）+ DRAFT/READY 徽标；每段"编辑"切换 textarea 调 `courseware.updateSection`；"确认完成" → `courseware.markReady`；"打印/导出"链接 `./[id]/print`。`useSearchParams` 客户端组件 `<Suspense>` 包裹；JSX `"` 用 `&quot;`。

- [ ] **Step 4: 打印页**：服务端 owner 校验取课件，按五段顺序排版，`@media print` 隐藏导航/按钮。DRAFT/READY 都可访问。

- [ ] **Step 5: 渲染测试**（`.test.tsx`，仿现有客户端组件测试）：列表空态、预览页五段渲染。

Run: `pnpm --filter @zhijiao/web test -- tests/unit/courseware-preview.test.tsx`（按实际命名）
Expected: PASS

- [ ] **Step 6: `next build` 验证**

Run: `pnpm --filter @zhijiao/web build`
Expected: build 成功

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/teacher/coursewares apps/web/app/teacher/classes apps/web/components/shell/RoleNav.tsx apps/web/tests
git commit -m "feat(web): teacher courseware UI (list/new/preview/print) (Plan 18)"
```

---

## Task 8: PII —— 注销教师 / 导出含 Courseware

**Files:**
- Modify: `apps/web/server/lib/pii-governance.ts`
- Test: `apps/web/tests/integration/pii-deactivate-courseware.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { deactivateUser, exportUserData } from "@/server/lib/pii-governance";

async function mathId() { const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} }); return s.id; }
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

it("注销教师：删 Courseware 级联 sections", async () => {
  const subjectId = await mathId();
  const t = await prisma.user.create({ data: { persona: "TEACHER" } });
  const cw = await prisma.courseware.create({ data: { teacherUserId: t.id, subjectId, title: "卷", paramsJson: {}, sections: { create: [{ position: 1, type: "INTRO", title: "导入", contentMd: "c1" }] } } });
  await deactivateUser(prisma, t.id, { reason: "test" });
  expect(await prisma.courseware.count({ where: { id: cw.id } })).toBe(0);
  expect(await prisma.coursewareSection.count({ where: { coursewareId: cw.id } })).toBe(0);
});

it("导出含本人 courseware", async () => {
  const subjectId = await mathId();
  const t = await prisma.user.create({ data: { persona: "TEACHER" } });
  await prisma.courseware.create({ data: { teacherUserId: t.id, subjectId, title: "我的课件", paramsJson: {} } });
  const data = await exportUserData(prisma, t.id);
  expect(JSON.stringify(data)).toContain("我的课件");
});
```

- [ ] **Step 2: 跑确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/pii-deactivate-courseware.test.ts`
Expected: FAIL

- [ ] **Step 3: 改 `pii-governance.ts`**

`deactivateUser` 事务内：`courseware.deleteMany({ where: { teacherUserId: userId } })`（`CoursewareSection` 经 Cascade 删）；payload 计 `coursewaresDeleted`。
`exportUserData`：加 `coursewares` 段（白名单：title/status/gradeLevel/createdAt + sections 的 type/title/contentMd）。

- [ ] **Step 4: 跑确认 PASS + 既有 PII 回归 + Commit**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/pii-deactivate-courseware.test.ts tests/integration/pii-deactivate-user.test.ts`
Expected: 全 PASS
```bash
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-deactivate-courseware.test.ts
git commit -m "feat(web): PII deactivate/export covers Courseware (Plan 18)"
```

---

## Task 9: 全量回归 + 文档

**Files:**
- Modify: `docs/claude/implementation-state.md`、`docs/claude/merge-verification.md`、`CLAUDE.md`

- [ ] **Step 1: 全量 typecheck + test**

Run: `pnpm typecheck && pnpm test`
Expected: 全 PASS

- [ ] **Step 2: E2E**（加教师课件 spec：登录教师 → 生成课件 → 预览五段 → 编辑一段 → markReady → 打印页 200）

Run: `pnpm --filter @zhijiao/web test:e2e`
Expected: 全绿

- [ ] **Step 3: `implementation-state.md`** 加「Plan 18 现状」段：独立 Courseware/CoursewareSection、复用 LESSON_PLAN_GEN 固定 3 credits、input+教师门禁在扣费前、五段强校验 + 落库按固定 type 顺序、不落 Question、PII 仅 Courseware。

- [ ] **Step 4: `merge-verification.md`** 加探针：非教师扣费前拒 / 五段强校验 PARSE_FAILED 补偿 / KP mismatch 补偿 / 注销级联 Courseware。

- [ ] **Step 5: `CLAUDE.md`** 「已落地汇总」加 Plan 18。

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: record Plan 18 AI courseware landed"
```

---

## Self-Review 覆盖核对

- spec §2 模型（含 updatedAt）→ Task 1；§3 AI（taskKind/五段强校验 schema/prompt/mock/方法）→ Task 2/3；§4 链（input+教师门禁扣费前）+ KP 校验派生 kpNames → Task 6；§4.1 状态流 → Task 6（markReady/updateSection）；§5 owner-only + PII → Task 4/8；§6 UI → Task 7；§7 合规 → Task 2 prompt + scanForbidden；§8 schema → Task 1；§9 测试 → 各任务 + Task 9 E2E。
- 类型一致：`generateLessonPlan`/`LessonPlanGenerationOutput`/`LESSON_SECTION_ORDER`/`persistGeneratedCourseware`/`validateCoursewareOwnership`/`coursewareRouter` 跨任务命名一致。
- 复用：`requireTeacherPersona`（Plan 17）、`scanTextForForbidden`（Plan 17/assignment）、AI 生成范式、UI 脚手架。
- 计费：固定 `chargeMiddleware("LESSON_PLAN_GEN")`（3 credits），input+教师门禁在其前；KP mismatch 在 resolver（扣费后）→ 补偿净零（Task 6 测试守门）。
- 不落 Question（§out-of-scope）：persist 只建 Courseware+Section，无 Question 牵连。
- 已知留白（spec §10）：例题落题库 / 增删段 / 服务端 PDF / 出卷联动，均 punt。
