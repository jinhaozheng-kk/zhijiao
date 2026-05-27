# Teacher Tiered Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Plan 10: a complete teacher assignment lifecycle with AI question generation, tiered whole-class publishing, student submission, manual teacher grading, error-book writeback, and lightweight assignment performance records.

**Architecture:** Add seeded classroom membership, assignment lifecycle tables, variable-credit AI generation, assignment tRPC APIs, teacher/student UIs, and feedback-loop services. AI creates draft private assignment questions; teachers edit and publish; students only see their assigned tier; teacher grading writes assignment performance and wrong/partial answers back to the existing error-book flow.

**Tech Stack:** Next.js App Router, React client components, tRPC v11, Prisma/Postgres, Vitest, Playwright, existing `@zhijiao/ai`, `@zhijiao/billing`, `@zhijiao/db`, `@zhijiao/auth`.

---

## File Map

Create:

- `apps/web/server/routers/assignment.ts` — assignment tRPC procedures.
- `apps/web/server/lib/assignment-access.ts` — teacher/student assignment access helpers.
- `apps/web/server/lib/assignment-dashboard.ts` — class KP/root-cause heat aggregation.
- `apps/web/server/lib/assignment-generation.ts` — AI output persistence, tier suggestions, KP reconcile calls.
- `apps/web/server/lib/assignment-writeback.ts` — grading, performance upsert, error-book writeback.
- `packages/ai/src/prompts/assignment-question-gen/v1.md` — AI assignment generation prompt.
- `apps/web/app/teacher/classes/[classroomId]/page.tsx`
- `apps/web/app/teacher/classes/[classroomId]/assignments/new/page.tsx`
- `apps/web/app/teacher/classes/[classroomId]/assignments/new/generation-form.tsx`
- `apps/web/app/teacher/assignments/[assignmentId]/edit/page.tsx`
- `apps/web/app/teacher/assignments/[assignmentId]/edit/draft-editor.tsx`
- `apps/web/app/teacher/assignments/[assignmentId]/page.tsx`
- `apps/web/app/teacher/assignments/[assignmentId]/grading-panel.tsx`
- `apps/web/app/assignments/page.tsx`
- `apps/web/app/assignments/assignment-list.tsx`
- `apps/web/app/assignments/[studentAssignmentId]/page.tsx`
- `apps/web/app/assignments/[studentAssignmentId]/submit-form.tsx`
- `apps/web/app/assignments/[studentAssignmentId]/result/page.tsx`
- `apps/web/tests/integration/assignment-generate-billing.test.ts`
- `apps/web/tests/integration/assignment-permissions.test.ts`
- `apps/web/tests/integration/assignment-state-machine.test.ts`
- `apps/web/tests/integration/assignment-error-book-writeback.test.ts`
- `apps/web/e2e/assignment-lifecycle.spec.ts`

Modify:

- `packages/db/prisma/schema.prisma` — classroom and assignment models/enums plus back-relations.
- `packages/db/prisma/migrations/<timestamp>_plan10_teacher_assignments/migration.sql` — generated migration plus any hand-written indexes needed.
- `packages/db/prisma/seed/1_test_users.ts` — ensure teacher/student fixtures have wallets.
- `packages/db/prisma/seed/index.ts` — call classroom seed.
- `packages/db/prisma/seed/4_classroom.ts` — create seeded classroom and memberships.
- `packages/db/src/test-utils.ts` — reset assignment tables in FK-safe order.
- `packages/billing/src/pricing.ts` — add `ASSIGNMENT_QUESTION_GEN`.
- `apps/web/server/trpc.ts` — add variable charge middleware.
- `packages/ai/src/tasks.ts` — add `ASSIGNMENT_QUESTION_GEN`.
- `packages/ai/src/schemas.ts` — add assignment generation input/output schemas.
- `packages/ai/src/router.ts` — add `generateAssignmentQuestions`.
- `apps/web/server/root.ts` — mount `assignmentRouter`.
- `apps/web/app/teacher/page.tsx` — replace stub dashboard.
- `apps/web/server/lib/pii-governance.ts` — assignment data deactivation/export handling.
- `apps/web/tests/unit/pii-ops-action-log-payload.test.ts` — allow new non-PII assignment counts if payload expands.
- `CLAUDE.md` — Plan 10 status and merge probes.

---

## Task 1: Schema, Migration, Test Reset, Seeded Classroom

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/seed/4_classroom.ts`
- Modify: `packages/db/prisma/seed/index.ts`
- Modify: `packages/db/src/test-utils.ts`
- Test: `packages/db/prisma/migrations/<timestamp>_plan10_teacher_assignments/migration.sql`

- [x] **Step 1: Add Prisma enums and models**

Add the enums and models from the design spec to `packages/db/prisma/schema.prisma`. Add these back-relations to existing models:

```prisma
model User {
  classroomMemberships ClassroomMember[]
  teacherAssignments   Assignment[]        @relation("TeacherAssignments")
  studentAssignments   StudentAssignment[] @relation("StudentAssignments")
}

model Subject {
  classrooms Classroom[]
}

model Question {
  assignmentItems AssignmentItem[]
}

model ErrorBookEntry {
  assignmentAnswers AssignmentAnswer[]
}
```

Use `onDelete: Restrict` for user-owned assignment relations and `onDelete: Cascade` for assignment-owned child rows.

- [x] **Step 2: Create the migration**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db db:migrate --name plan10_teacher_assignments
```

Expected: Prisma creates a new migration directory and applies it to the dev DB. If the wrapper script does not accept `--name`, run the repo's existing migration command documented in `README.md` and keep the generated migration name ending in `plan10_teacher_assignments`.

- [x] **Step 3: Generate Prisma client**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
```

Expected: Prisma client generation succeeds with no schema validation errors.

- [x] **Step 4: Add classroom seed**

Create `packages/db/prisma/seed/4_classroom.ts`:

```ts
import { ClassroomMemberRole, PrismaClient } from "@prisma/client";

export async function seedClassroom(prisma: PrismaClient) {
  const math = await prisma.subject.findUniqueOrThrow({
    where: { code: "math" },
  });

  const classroom = await prisma.classroom.upsert({
    where: { id: "dev-classroom-math-g8-01" },
    update: {
      name: "八年级数学 1 班",
      subjectId: math.id,
      gradeLevel: "G8",
    },
    create: {
      id: "dev-classroom-math-g8-01",
      name: "八年级数学 1 班",
      subjectId: math.id,
      gradeLevel: "G8",
    },
  });

  const members = [
    { userId: "dev-teacher-01", role: ClassroomMemberRole.TEACHER },
    { userId: "dev-student-01", role: ClassroomMemberRole.STUDENT },
    { userId: "dev-student-02", role: ClassroomMemberRole.STUDENT },
    { userId: "dev-student-03", role: ClassroomMemberRole.STUDENT },
  ];

  for (const member of members) {
    await prisma.classroomMember.upsert({
      where: {
        classroomId_userId: {
          classroomId: classroom.id,
          userId: member.userId,
        },
      },
      update: { role: member.role },
      create: {
        classroomId: classroom.id,
        userId: member.userId,
        role: member.role,
      },
    });
  }
}
```

- [x] **Step 5: Wire the seed**

Modify `packages/db/prisma/seed/index.ts`:

```ts
import { seedClassroom } from "./4_classroom.js";

await seedClassroom(prisma);
```

Place it after test users, subjects, questions, and KP aliases have been seeded.

- [x] **Step 6: Update reset order**

Modify `packages/db/src/test-utils.ts` so the truncation list starts with assignment children before parents:

```ts
const TABLES = [
  "assignment_performance",
  "assignment_answers",
  "student_assignments",
  "assignment_items",
  "assignment_tiers",
  "assignments",
  "classroom_members",
  "classrooms",
  "kp_reconcile_matches",
  "kp_aliases",
  "variant_items",
  "variant_groups",
  "error_book_entries",
  "question_kp_links",
  "question_answers",
  "questions",
  "model_calls",
  "prompt_templates",
  "credit_ledger",
  "wallets",
  "wechat_pay_events",
  "topup_orders",
  "sessions",
  "auth_identities",
  "otp_requests",
  "user_roles",
  "users",
  "knowledge_points",
  "subjects",
];
```

Keep any existing repo-specific tables in their current relative positions after assignment tables.

- [x] **Step 7: Verify schema**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd --filter @zhijiao/db db:seed
pnpm.cmd --filter @zhijiao/db exec tsx scripts/setup-test-dbs.ts
```

Expected: all three commands complete without Prisma relation errors, and `dev-classroom-math-g8-01` exists in dev seed.

Verified 2026-05-27:

- `pnpm.cmd --filter @zhijiao/db db:generate`
- `$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/zhijiao'; pnpm.cmd --filter @zhijiao/db db:seed`
- `$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/zhijiao'; $env:DATABASE_URL_TEST='postgresql://postgres:postgres@localhost:5432/zhijiao_test'; pnpm.cmd --filter @zhijiao/db exec tsx scripts/setup-test-dbs.ts`
- `docker exec zhijiao-postgres psql -U postgres -d zhijiao -t -A -c "select c.id, c.name, count(cm.*) as members from classrooms c left join classroom_members cm on cm.classroom_id = c.id where c.id = 'dev-classroom-math-g8-01' group by c.id, c.name;"` returned `dev-classroom-math-g8-01|八年级数学 1 班|4`.

- [x] **Step 8: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/prisma/seed packages/db/src/test-utils.ts
git commit -m "feat(db): add assignment classroom schema"
```

---

## Task 2: AI Assignment Generation Schemas, Prompt, Router

**Files:**

- Modify: `packages/ai/src/tasks.ts`
- Modify: `packages/ai/src/schemas.ts`
- Modify: `packages/ai/src/router.ts`
- Create: `packages/ai/src/prompts/assignment-question-gen/v1.md`
- Test: `packages/ai/tests/assignment-question-generation.test.ts`

- [x] **Step 1: Add failing AI schema tests**

Create `packages/ai/tests/assignment-question-generation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AssignmentQuestionGenerationOutputSchema,
  AssignmentQuestionGenerationInputSchema,
} from "../src/schemas.js";

describe("assignment question generation schemas", () => {
  it("accepts three-tier generated assignments", () => {
    const input = AssignmentQuestionGenerationInputSchema.parse({
      mode: "MANUAL_CRITERIA",
      subject: "数学",
      gradeLevel: "G8",
      tierCounts: { BASIC: 1, CONSOLIDATION: 1, CHALLENGE: 1 },
      questionTypes: ["SINGLE_CHOICE", "CALCULATION"],
      kpNames: ["一元一次方程"],
      difficultyRange: [2, 4],
      teachingGoalMd: "练习移项和合并同类项。",
    });
    expect(input.tierCounts.BASIC).toBe(1);

    const output = AssignmentQuestionGenerationOutputSchema.parse({
      title: "一元一次方程分层练习",
      tiers: [
        {
          level: "BASIC",
          rationaleMd: "巩固基础移项。",
          items: [
            {
              type: "SINGLE_CHOICE",
              stemMd: "解方程 x + 3 = 7。",
              options: [
                { key: "A", text: "x = 4" },
                { key: "B", text: "x = 10" },
              ],
              answerMd: "A",
              solutionMd: "两边同时减 3，x = 4。",
              rubricMd: "能写出移项步骤。",
              knowledgePointHints: ["一元一次方程"],
              difficulty: 2,
            },
          ],
        },
        { level: "CONSOLIDATION", rationaleMd: "变化条件。", items: [] },
        { level: "CHALLENGE", rationaleMd: "迁移应用。", items: [] },
      ],
    });
    expect(output.tiers.map((t) => t.level)).toEqual([
      "BASIC",
      "CONSOLIDATION",
      "CHALLENGE",
    ]);
  });

  it("rejects unsupported question type values", () => {
    expect(() =>
      AssignmentQuestionGenerationOutputSchema.parse({
        title: "bad",
        tiers: [
          {
            level: "BASIC",
            rationaleMd: "bad",
            items: [
              {
                type: "RANDOM",
                stemMd: "bad",
                answerMd: "bad",
                solutionMd: "bad",
                knowledgePointHints: [],
                difficulty: 3,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
```

- [x] **Step 2: Run failing tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/ai test -- tests/assignment-question-generation.test.ts
```

Expected: FAIL because the schemas are not exported yet.

- [x] **Step 3: Add task kind**

Modify `packages/ai/src/tasks.ts`:

```ts
export type TaskKind =
  | "TUTOR_TURN"
  | "ERROR_ANALYSIS"
  | "VARIANT_GROUP_GEN"
  | "ASSIGNMENT_QUESTION_GEN"
  | "PAPER_GEN"
  | "FORECAST_PAPER_GEN"
  | "EMBEDDING"
  | "KP_RECONCILE";

export const TASK_MODEL_MAP: Record<TaskKind, string> = {
  TUTOR_TURN: "qwen-plus",
  ERROR_ANALYSIS: "qwen-plus",
  VARIANT_GROUP_GEN: "qwen-plus",
  ASSIGNMENT_QUESTION_GEN: "qwen-plus",
  PAPER_GEN: "qwen-max",
  FORECAST_PAPER_GEN: "qwen-max",
  EMBEDDING: "text-embedding-v2",
  KP_RECONCILE: "qwen-plus",
};
```

- [x] **Step 4: Add schemas**

Modify `packages/ai/src/schemas.ts`:

```ts
const AssignmentTierLevelSchema = z.enum([
  "BASIC",
  "CONSOLIDATION",
  "CHALLENGE",
]);

const AssignmentQuestionTypeSchema = z.enum([
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "FILL_BLANK",
  "CALCULATION",
  "PROOF",
  "ESSAY",
]);

export const AssignmentQuestionGenerationInputSchema = z.object({
  mode: z.enum(["CLASS_WEAKNESS", "MANUAL_CRITERIA"]),
  subject: z.string().min(1),
  gradeLevel: z.string().min(1),
  tierCounts: z.object({
    BASIC: z.number().int().min(0).max(10),
    CONSOLIDATION: z.number().int().min(0).max(10),
    CHALLENGE: z.number().int().min(0).max(10),
  }),
  questionTypes: z.array(AssignmentQuestionTypeSchema).min(1),
  kpNames: z.array(z.string().min(1)).min(1),
  difficultyRange: z.tuple([
    z.number().int().min(1).max(5),
    z.number().int().min(1).max(5),
  ]),
  teachingGoalMd: z.string().max(2000).optional(),
  classWeaknessSummaryMd: z.string().max(4000).optional(),
});

export const AssignmentQuestionGenerationItemSchema = z.object({
  type: AssignmentQuestionTypeSchema,
  stemMd: z.string().min(1).max(4000),
  options: z
    .array(z.object({ key: z.string().min(1).max(4), text: z.string().min(1) }))
    .optional(),
  answerMd: z.string().min(1).max(4000),
  solutionMd: z.string().min(1).max(6000),
  rubricMd: z.string().max(4000).optional(),
  knowledgePointHints: z.array(z.string().min(1)).max(8),
  difficulty: z.number().int().min(1).max(5),
});

export const AssignmentQuestionGenerationOutputSchema = z.object({
  title: z.string().min(1).max(120),
  tiers: z
    .array(
      z.object({
        level: AssignmentTierLevelSchema,
        rationaleMd: z.string().min(1).max(2000),
        items: z.array(AssignmentQuestionGenerationItemSchema).max(10),
      }),
    )
    .min(1)
    .max(3),
});

export type AssignmentQuestionGenerationOutput = z.infer<
  typeof AssignmentQuestionGenerationOutputSchema
>;
```

- [x] **Step 5: Add prompt**

Create `packages/ai/src/prompts/assignment-question-gen/v1.md`:

```md
你是面向中国 K12 数学教学的作业命题助手。

请基于输入生成一份三层分层作业草稿。输出必须是 JSON object，不要输出 Markdown 代码块。

要求：
- 题目必须用于教学练习，不承诺提分或考试结果。
- BASIC：基础组，强调同结构和核心概念。
- CONSOLIDATION：巩固组，改变条件或表达方式。
- CHALLENGE：挑战组，强调迁移和综合应用。
- 每题必须包含题干、标准答案、解析、评分要点、知识点提示。
- 选择题必须包含 options，key 使用 A/B/C/D。
- 不要输出违法、恐吓、焦虑营销、直接承诺分数提升的内容。

输入：
学科：{{subject}}
年级：{{gradeLevel}}
知识点：{{kpNames}}
题型：{{questionTypes}}
各层题量：{{tierCounts}}
难度范围：{{difficultyRange}}
教学目标：{{teachingGoalMd}}
班级薄弱点摘要：{{classWeaknessSummaryMd}}

输出 schema：
{
  "title": "...",
  "tiers": [
    {
      "level": "BASIC",
      "rationaleMd": "...",
      "items": [
        {
          "type": "SINGLE_CHOICE",
          "stemMd": "...",
          "options": [{"key": "A", "text": "..."}],
          "answerMd": "...",
          "solutionMd": "...",
          "rubricMd": "...",
          "knowledgePointHints": ["..."],
          "difficulty": 2
        }
      ]
    }
  ]
}
```

- [x] **Step 6: Extract audited JSON helper**

Modify `packages/ai/src/router.ts` by extracting the repeated JSON-call/audit loop into a private method on `AiRouter`. Keep `tutor()` returning `TutoringOutput` unchanged.

```ts
private async runJsonTaskWithAudit<T>(args: {
  taskKind: TaskKind;
  promptTemplateId: string;
  request: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    responseFormat: "json_object";
    temperature: number;
  };
  schema: z.ZodType<T>;
  scanForbidden: (output: T) => string[];
}): Promise<T & { modelCallId: string }> {
  const start = Date.now();
  let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
  let parseAttempts = 0;
  let lastError: unknown = null;

  while (parseAttempts < 3) {
    try {
      response = await this.opts.adapter.call(args.request);
      const json = JSON.parse(response.content);
      const validated = args.schema.parse(json);
      const hits = args.scanForbidden(validated);
      if (hits.length > 0) {
        const audit = await writeAudit(this.opts.prisma, {
          taskKind: args.taskKind,
          promptTemplateId: args.promptTemplateId,
          request: args.request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.COMPLIANCE_REJECTED,
          errorMessage: `forbidden phrases: ${hits.join(", ")}`,
          userId: this.opts.userId ?? null,
        });
        const error = new ComplianceRejectedError(hits);
        (error as ComplianceRejectedError & { modelCallId?: string }).modelCallId = audit.id;
        throw error;
      }
      const audit = await writeAudit(this.opts.prisma, {
        taskKind: args.taskKind,
        promptTemplateId: args.promptTemplateId,
        request: args.request,
        response,
        latencyMs: Date.now() - start,
        status: ModelCallStatus.SUCCESS,
        errorMessage: null,
        userId: this.opts.userId ?? null,
      });
      return { ...validated, modelCallId: audit.id };
    } catch (e) {
      if (e instanceof ComplianceRejectedError) throw e;
      lastError = e;
      parseAttempts++;
      if (e instanceof z.ZodError || e instanceof SyntaxError) {
        args.request.messages.push({
          role: "user",
          content: "上次输出不是符合 schema 的 JSON，请重新只输出 JSON。",
        });
        continue;
      }
      await writeAudit(this.opts.prisma, {
        taskKind: args.taskKind,
        promptTemplateId: args.promptTemplateId,
        request: args.request,
        response,
        latencyMs: Date.now() - start,
        status: ModelCallStatus.ADAPTER_ERROR,
        errorMessage: e instanceof Error ? e.message : String(e),
        userId: this.opts.userId ?? null,
      });
      throw e;
    }
  }

  await writeAudit(this.opts.prisma, {
    taskKind: args.taskKind,
    promptTemplateId: args.promptTemplateId,
    request: args.request,
    response,
    latencyMs: Date.now() - start,
    status: ModelCallStatus.PARSE_FAILED,
    errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
    userId: this.opts.userId ?? null,
  });
  throw new Error(`${args.taskKind} failed after ${parseAttempts} attempts`);
}
```

- [x] **Step 7: Add router method**

Modify `packages/ai/src/router.ts` by adding `generateAssignmentQuestions` following the existing `diagnoseError` / `generateVariantGroup` pattern:

```ts
async generateAssignmentQuestions(
  input: unknown,
): Promise<AssignmentQuestionGenerationOutput & { modelCallId: string }> {
  const parsed = AssignmentQuestionGenerationInputSchema.parse(input);
  const taskKind: TaskKind = "ASSIGNMENT_QUESTION_GEN";
  const prompt = await loadPrompt(
    "assignment-question-gen",
    this.opts.promptVersion ?? "v1",
  );
  const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

  const userContent = prompt.interpolate({
    subject: parsed.subject,
    gradeLevel: parsed.gradeLevel,
    kpNames: parsed.kpNames.join("、"),
    questionTypes: parsed.questionTypes.join("、"),
    tierCounts: JSON.stringify(parsed.tierCounts),
    difficultyRange: `${parsed.difficultyRange[0]}-${parsed.difficultyRange[1]}`,
    teachingGoalMd: parsed.teachingGoalMd ?? "（未提供）",
    classWeaknessSummaryMd: parsed.classWeaknessSummaryMd ?? "（未提供）",
  });

  const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
  const request = {
    model,
    messages: [
      { role: "system" as const, content: "你是严谨、面向中国 K12 的数学作业命题助手。" },
      { role: "user" as const, content: userContent },
    ],
    responseFormat: "json_object" as const,
    temperature: 0.35,
  };

  return this.runJsonTaskWithAudit({
    taskKind,
    promptTemplateId,
    request,
    schema: AssignmentQuestionGenerationOutputSchema,
    scanForbidden: scanAssignmentQuestionGenerationForForbidden,
  });
}
```

- [x] **Step 8: Run tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/ai test -- tests/assignment-question-generation.test.ts
pnpm.cmd --filter @zhijiao/ai test -- tests/router.test.ts
```

Expected: both pass.

Verified 2026-05-27:

- RED: `pnpm.cmd --filter @zhijiao/ai test -- tests/assignment-question-generation.test.ts` failed because the new schemas and router method were missing.
- GREEN: `pnpm.cmd --filter @zhijiao/ai test -- tests/assignment-question-generation.test.ts tests/router.test.ts` passed: 2 files, 9 tests.
- `pnpm.cmd --filter @zhijiao/ai typecheck` passed.
- `pnpm.cmd --filter @zhijiao/ai test` passed: 6 files, 36 tests.

- [x] **Step 9: Commit**

```powershell
git add packages/ai/src packages/ai/tests
git commit -m "feat(ai): add assignment question generation"
```

---

## Task 3: Variable Credit Charging

**Files:**

- Modify: `packages/billing/src/pricing.ts`
- Modify: `apps/web/server/trpc.ts`
- Test: `apps/web/tests/integration/assignment-generate-billing.test.ts`

- [x] **Step 1: Add failing variable billing tests**

Create `apps/web/tests/integration/assignment-generate-billing.test.ts` with the first tests focused on middleware behavior:

```ts
import { describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { createCallerForUser } from "./_helpers/trpc.js";

describe("assignment generation billing", () => {
  it("charges one credit per requested generated question", async () => {
    await resetDb();
    const { teacher, classroom } = await seedTeacherClassroomWithWallet({ balance: 20 });
    const caller = createCallerForUser(teacher.id);

    await caller.assignment.generateDraftFromCriteria({
      classroomId: classroom.id,
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      subjectId: classroom.subjectId,
      gradeLevel: "G8",
      kpIds: [await seedKpId()],
      difficultyRange: [2, 4],
      tierCounts: { BASIC: 2, CONSOLIDATION: 2, CHALLENGE: 2 },
      questionTypes: ["SINGLE_CHOICE"],
      teachingGoalMd: "练习一元一次方程。",
    });

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: teacher.id },
    });
    expect(wallet.balance).toBe(14);

    const debit = await prisma.creditLedger.findFirstOrThrow({
      where: { createdByUserId: teacher.id, actionKind: "ASSIGNMENT_QUESTION_GEN" },
    });
    expect(debit.delta).toBe(-6);
  });

  it("does not charge when teacher is not a classroom teacher", async () => {
    await resetDb();
    const { otherTeacher, classroom } = await seedTeacherClassroomWithWallet({ balance: 20 });
    const caller = createCallerForUser(otherTeacher.id);

    await expect(
      caller.assignment.generateDraftFromCriteria({
        classroomId: classroom.id,
        clientRequestId: "22222222-2222-4222-8222-222222222222",
        subjectId: classroom.subjectId,
        gradeLevel: "G8",
        kpIds: [await seedKpId()],
        difficultyRange: [2, 4],
        tierCounts: { BASIC: 1, CONSOLIDATION: 1, CHALLENGE: 1 },
        questionTypes: ["SINGLE_CHOICE"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const ledgerCount = await prisma.creditLedger.count({
      where: { createdByUserId: otherTeacher.id, actionKind: "ASSIGNMENT_QUESTION_GEN" },
    });
    expect(ledgerCount).toBe(0);
  });
});
```

Add helper functions inside the test file if no shared helper exists. Use existing test fixture style from nearby integration tests.

- [x] **Step 2: Run failing test**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts
```

Expected: FAIL because router and action kind do not exist yet.

- [x] **Step 3: Add billing kind**

Modify `packages/billing/src/pricing.ts`:

```ts
export type ActionKind =
  | "TUTOR_ASK"
  | "PAPER_GEN"
  | "LESSON_PLAN_GEN"
  | "PPT_GEN"
  | "VARIANT_GROUP_GEN"
  | "ERROR_ANALYSIS"
  | "ASSIGNMENT_QUESTION_GEN";

export const PRICING: Record<ActionKind, number> = {
  TUTOR_ASK: 1,
  PAPER_GEN: 5,
  LESSON_PLAN_GEN: 3,
  PPT_GEN: 5,
  VARIANT_GROUP_GEN: 3,
  ERROR_ANALYSIS: 1,
  ASSIGNMENT_QUESTION_GEN: 1,
};
```

- [x] **Step 4: Add variable charge middleware**

Modify `apps/web/server/trpc.ts`:

```ts
export const chargeVariableMiddleware = (
  kind: ActionKind,
  getUnits: (rawInput: unknown) => number,
) =>
  t.middleware(async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "请先登录",
        cause: { reason: ctx.authError ?? "NO_SESSION" },
      });
    }

    const rawInput = await getRawInput();
    const units = getUnits(rawInput);
    if (!Number.isInteger(units) || units <= 0 || units > 30) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "生成题量不合法",
        cause: { reason: "ASSIGNMENT_GENERATION_COUNT_INVALID" },
      });
    }

    const cost = priceOf(kind) * units;
    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    const clientRequestId = readClientRequestId(rawInput);
    const idemKey = `debit:${kind}:${ctx.auth.userId}:${clientRequestId}`;

    const debit = await chargeForAction(ctx.db, {
      walletId: wallet.id,
      userId: ctx.auth.userId,
      kind,
      cost,
      idemKey,
      metadata: { units, requestId: ctx.requestId },
    });

    if (debit.kind === "INSUFFICIENT_BALANCE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "余额不足",
        cause: { reason: "INSUFFICIENT_BALANCE", required: cost, balance: debit.balance },
      });
    }

    const result = await next({
      ctx: { ...ctx, auth: ctx.auth, debit: { ledgerId: debit.ledgerId, cost } },
    });

    if (result.ok) return result;

    const e = result.error;
    if (shouldCompensate(e)) {
      await compensate(ctx.db, {
        originalLedgerId: debit.ledgerId,
        walletId: wallet.id,
        cost,
        kind,
        reason: errorReason(e),
      });
    }
    return result;
  });
```

Use the existing private helper names in `trpc.ts`. If `readClientRequestId`, `shouldCompensate`, or `errorReason` are currently local to `chargeMiddleware`, extract them above both middlewares without changing behavior.

- [x] **Step 5: Run focused billing tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts
```

Expected: tests still fail because assignment router is not implemented. The failure should now be a missing router/procedure error, not missing pricing or middleware symbols.

Verified 2026-05-27:

- RED: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts` failed on missing `assignment.generateDraftFromCriteria`.
- `pnpm.cmd --filter @zhijiao/web typecheck` passed.
- `pnpm.cmd --filter @zhijiao/billing typecheck` passed.
- `pnpm.cmd --filter @zhijiao/billing test` passed: 10 files, 38 tests.
- Focused assignment billing test still fails as expected with `No procedure found on path "assignment,generateDraftFromCriteria"`; this is Task 4 scope.

- [x] **Step 6: Commit**

```powershell
git add packages/billing/src/pricing.ts apps/web/server/trpc.ts apps/web/tests/integration/assignment-generate-billing.test.ts
git commit -m "feat(billing): support variable assignment generation charges"
```

---

## Task 4: Assignment Access and Generation Router

**Files:**

- Create: `apps/web/server/lib/assignment-access.ts`
- Create: `apps/web/server/lib/assignment-dashboard.ts`
- Create: `apps/web/server/lib/assignment-generation.ts`
- Create: `apps/web/server/routers/assignment.ts`
- Modify: `apps/web/server/root.ts`
- Test: `apps/web/tests/integration/assignment-generate-billing.test.ts`

- [x] **Step 1: Implement access helpers**

Create `apps/web/server/lib/assignment-access.ts`:

```ts
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@zhijiao/db";

export async function requireTeacherClassroom(
  db: PrismaClient,
  userId: string,
  classroomId: string,
) {
  const member = await db.classroomMember.findUnique({
    where: { classroomId_userId: { classroomId, userId } },
    include: { classroom: true },
  });
  if (!member || member.role !== "TEACHER") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "班级不存在",
      cause: { reason: "CLASSROOM_NOT_FOUND" },
    });
  }
  return member.classroom;
}

export async function requireTeacherAssignment(
  db: PrismaClient,
  userId: string,
  assignmentId: string,
) {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { classroom: true, tiers: { include: { items: true } } },
  });
  if (!assignment || assignment.teacherUserId !== userId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "作业不存在",
      cause: { reason: "ASSIGNMENT_NOT_FOUND" },
    });
  }
  return assignment;
}
```

- [x] **Step 2: Implement generation persistence**

Create `apps/web/server/lib/assignment-generation.ts`:

```ts
import type { PrismaClient } from "@zhijiao/db";
import type { AssignmentQuestionGenerationOutput } from "@zhijiao/ai";
import { reconcileHintsSync } from "./kp-reconcile.js";

export async function persistGeneratedAssignment(
  db: PrismaClient,
  args: {
    teacherUserId: string;
    classroomId: string;
    subjectId: string;
    output: AssignmentQuestionGenerationOutput;
    debitLedgerId: string;
    modelCallId: string;
    source: "WEAKNESS_AI" | "MANUAL_AI";
  },
) {
  return db.$transaction(async (tx) => {
    const assignment = await tx.assignment.create({
      data: {
        classroomId: args.classroomId,
        teacherUserId: args.teacherUserId,
        title: args.output.title,
        source: args.source,
        generationLedgerId: args.debitLedgerId,
        generationCallId: args.modelCallId,
      },
    });

    for (const tierOutput of args.output.tiers) {
      const tier = await tx.assignmentTier.create({
        data: {
          assignmentId: assignment.id,
          level: tierOutput.level,
          title: tierOutput.level,
          rationaleMd: tierOutput.rationaleMd,
        },
      });

      for (const [idx, item] of tierOutput.items.entries()) {
        const question = await tx.question.create({
          data: {
            subjectId: args.subjectId,
            stemMd: item.stemMd,
            type: item.type,
            difficulty: item.difficulty,
            status: "DRAFT",
            source: "ASSIGNMENT_GENERATED",
            createdByUserId: args.teacherUserId,
            answer: {
              create: {
                contentMd: item.answerMd,
                solutionMd: item.solutionMd,
              },
            },
          },
        });

        const assignmentItem = await tx.assignmentItem.create({
          data: {
            tierId: tier.id,
            questionId: question.id,
            position: idx + 1,
            stemMd: item.stemMd,
            type: item.type,
            optionsJson: item.options ?? undefined,
            answerMd: item.answerMd,
            solutionMd: item.solutionMd,
            rubricMd: item.rubricMd,
            kpHints: item.knowledgePointHints,
          },
        });

        await reconcileHintsSync(tx, {
          questionId: question.id,
          hints: item.knowledgePointHints,
          source: "TUTOR_ADHOC",
          sourceRefType: "QUESTION",
          sourceRefId: question.id,
        });
      }
    }

    return assignment;
  });
}
```

If `reconcileHintsSync` expects a full PrismaClient rather than transaction client, keep the transaction write and call reconcile after the transaction per created question ids.

- [x] **Step 3: Implement assignment router generation procedures**

Create `apps/web/server/routers/assignment.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, authedProcedure, chargeVariableMiddleware } from "../trpc.js";
import { aiRouterForUser } from "../ai-client.js";
import { requireTeacherClassroom } from "../lib/assignment-access.js";
import { persistGeneratedAssignment } from "../lib/assignment-generation.js";

const TierCountsSchema = z.object({
  BASIC: z.number().int().min(0).max(10),
  CONSOLIDATION: z.number().int().min(0).max(10),
  CHALLENGE: z.number().int().min(0).max(10),
});

function totalCount(input: unknown) {
  const parsed = z.object({ tierCounts: TierCountsSchema }).parse(input);
  return parsed.tierCounts.BASIC + parsed.tierCounts.CONSOLIDATION + parsed.tierCounts.CHALLENGE;
}

const GenerateCriteriaInput = z.object({
  classroomId: z.string().cuid(),
  clientRequestId: z.string().uuid(),
  subjectId: z.string().cuid(),
  gradeLevel: z.string(),
  kpIds: z.array(z.string().cuid()).min(1).max(8),
  difficultyRange: z.tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)]),
  tierCounts: TierCountsSchema,
  questionTypes: z.array(z.enum(["SINGLE_CHOICE", "MULTI_CHOICE", "FILL_BLANK", "CALCULATION", "PROOF", "ESSAY"])).min(1),
  teachingGoalMd: z.string().max(2000).optional(),
});

export const assignmentRouter = createTRPCRouter({
  generateDraftFromCriteria: authedProcedure
    .input(GenerateCriteriaInput)
    .use(async ({ ctx, next, input }) => {
      await requireTeacherClassroom(ctx.db, ctx.auth.userId, input.classroomId);
      const count = totalCount(input);
      if (count <= 0 || count > 30) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "生成题量不合法",
          cause: { reason: "ASSIGNMENT_GENERATION_COUNT_INVALID" },
        });
      }
      return next();
    })
    .use(chargeVariableMiddleware("ASSIGNMENT_QUESTION_GEN", totalCount))
    .mutation(async ({ ctx, input }) => {
      const kps = await ctx.db.knowledgePoint.findMany({
        where: { id: { in: input.kpIds }, subjectId: input.subjectId },
      });
      if (kps.length !== input.kpIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "知识点不属于该学科",
          cause: { reason: "KP_SUBJECT_MISMATCH" },
        });
      }

      const ai = aiRouterForUser(ctx.auth.userId);
      const output = await ai.generateAssignmentQuestions({
        mode: "MANUAL_CRITERIA",
        subject: "数学",
        gradeLevel: input.gradeLevel,
        tierCounts: input.tierCounts,
        questionTypes: input.questionTypes,
        kpNames: kps.map((kp) => kp.name),
        difficultyRange: input.difficultyRange,
        teachingGoalMd: input.teachingGoalMd,
      });

      const assignment = await persistGeneratedAssignment(ctx.db, {
        teacherUserId: ctx.auth.userId,
        classroomId: input.classroomId,
        subjectId: input.subjectId,
        output,
        debitLedgerId: ctx.debit.ledgerId,
        modelCallId: output.modelCallId,
        source: "MANUAL_AI",
      });

      return { assignmentId: assignment.id };
    }),
});
```

- [x] **Step 4: Mount router**

Modify `apps/web/server/root.ts`:

```ts
import { assignmentRouter } from "./routers/assignment.js";

export const appRouter = createTRPCRouter({
  assignment: assignmentRouter,
  // existing routers
});
```

- [x] **Step 5: Run generation billing tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts
```

Expected: tests pass. Configure the test AI adapter in `assignment-generate-billing.test.ts` to return the valid output object from Task 2 before the first green run.

Verified 2026-05-27:

- `pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts` passed: 2 tests.
- `pnpm.cmd --filter @zhijiao/web typecheck` passed.
- `pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-tutor.test.ts tests/integration/variant-generate-for-entry.test.ts` passed: 15 tests.
- `pnpm.cmd --filter @zhijiao/billing test` passed: 10 files, 38 tests.

- [x] **Step 6: Commit**

```powershell
git add apps/web/server packages/billing/src/pricing.ts apps/web/tests/integration/assignment-generate-billing.test.ts
git commit -m "feat(web): generate charged assignment drafts"
```

---

## Task 5: Draft Edit, Publish, Student Submit State Machine

**Files:**

- Modify: `apps/web/server/routers/assignment.ts`
- Test: `apps/web/tests/integration/assignment-state-machine.test.ts`
- Test: `apps/web/tests/integration/assignment-permissions.test.ts`

- [ ] **Step 1: Add state machine tests**

Create `apps/web/tests/integration/assignment-state-machine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { createCallerForUser } from "./_helpers/trpc.js";

describe("assignment state machine", () => {
  it("publishes a draft and creates student assignments", async () => {
    await resetDb();
    const { teacher, classroom, students, assignment } = await seedDraftAssignment();
    const caller = createCallerForUser(teacher.id);

    await caller.assignment.publish({ assignmentId: assignment.id });

    const reread = await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(reread.status).toBe("PUBLISHED");

    const studentAssignmentCount = await prisma.studentAssignment.count({
      where: { assignmentId: assignment.id },
    });
    expect(studentAssignmentCount).toBe(students.length);
  });

  it("rejects editing after publish", async () => {
    await resetDb();
    const { teacher, assignment } = await seedPublishedAssignment();
    const caller = createCallerForUser(teacher.id);

    await expect(
      caller.assignment.updateDraft({ assignmentId: assignment.id, title: "新标题" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("student can submit only assigned tier items once", async () => {
    await resetDb();
    const { student, studentAssignment, assignedItem, otherTierItem } =
      await seedPublishedStudentAssignment();
    const caller = createCallerForUser(student.id);

    await expect(
      caller.assignment.submit({
        studentAssignmentId: studentAssignment.id,
        answers: [{ itemId: otherTierItem.id, answerJson: { text: "x" } }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.assignment.submit({
      studentAssignmentId: studentAssignment.id,
      answers: [{ itemId: assignedItem.id, answerJson: { text: "x = 4" } }],
    });

    await expect(
      caller.assignment.submit({
        studentAssignmentId: studentAssignment.id,
        answers: [{ itemId: assignedItem.id, answerJson: { text: "x = 4" } }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-state-machine.test.ts
```

Expected: FAIL because `publish`, `updateDraft`, and `submit` are not implemented.

- [ ] **Step 3: Add updateDraft, publish, submit**

Modify `apps/web/server/routers/assignment.ts`:

```ts
updateDraft: authedProcedure
  .input(z.object({
    assignmentId: z.string().cuid(),
    title: z.string().min(1).max(120).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const assignment = await requireTeacherAssignment(ctx.db, ctx.auth.userId, input.assignmentId);
    if (assignment.status !== "DRAFT") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "作业状态已变化",
        cause: { reason: "ASSIGNMENT_STATE_CHANGED" },
      });
    }
    return ctx.db.assignment.update({
      where: { id: input.assignmentId },
      data: { title: input.title },
    });
  }),

publish: authedProcedure
  .input(z.object({ assignmentId: z.string().cuid() }))
  .mutation(async ({ ctx, input }) => {
    const assignment = await requireTeacherAssignment(ctx.db, ctx.auth.userId, input.assignmentId);
    if (assignment.status !== "DRAFT") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "作业状态已变化",
        cause: { reason: "ASSIGNMENT_STATE_CHANGED" },
      });
    }

    const studentMembers = await ctx.db.classroomMember.findMany({
      where: { classroomId: assignment.classroomId, role: "STUDENT" },
    });
    if (studentMembers.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "班级暂无学生",
        cause: { reason: "CLASSROOM_HAS_NO_STUDENTS" },
      });
    }

    const tiers = await ctx.db.assignmentTier.findMany({
      where: { assignmentId: assignment.id },
      include: { items: true },
    });
    if (tiers.some((tier) => tier.items.length === 0)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "每个分层至少需要一道题",
        cause: { reason: "ASSIGNMENT_TIER_EMPTY" },
      });
    }

    return ctx.db.$transaction(async (tx) => {
      await tx.assignment.update({
        where: { id: assignment.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
      const defaultTier = tiers.find((tier) => tier.level === "CONSOLIDATION") ?? tiers[0];
      for (const member of studentMembers) {
        await tx.studentAssignment.upsert({
          where: {
            assignmentId_studentUserId: {
              assignmentId: assignment.id,
              studentUserId: member.userId,
            },
          },
          update: { tierId: defaultTier.id, suggestedTier: defaultTier.level },
          create: {
            assignmentId: assignment.id,
            studentUserId: member.userId,
            tierId: defaultTier.id,
            suggestedTier: defaultTier.level,
          },
        });
      }
      return { assignmentId: assignment.id };
    });
  }),
```

Add `submit` and owner validation following the same pattern; it must check assigned tier item ids before writing `AssignmentAnswer`.

- [ ] **Step 4: Add permission tests**

Create `apps/web/tests/integration/assignment-permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resetDb } from "@zhijiao/db/test-utils";
import { createCallerForUser } from "./_helpers/trpc.js";

describe("assignment permissions", () => {
  it("teacher cannot publish another teacher assignment", async () => {
    await resetDb();
    const { otherTeacher, assignment } = await seedDraftAssignment();
    const caller = createCallerForUser(otherTeacher.id);

    await expect(
      caller.assignment.publish({ assignmentId: assignment.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("student cannot read another student's assignment", async () => {
    await resetDb();
    const { otherStudent, studentAssignment } = await seedPublishedStudentAssignment();
    const caller = createCallerForUser(otherStudent.id);

    await expect(
      caller.assignment.getForStudent({ studentAssignmentId: studentAssignment.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 5: Run tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-state-machine.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-permissions.test.ts
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/server/routers/assignment.ts apps/web/server/lib/assignment-access.ts apps/web/tests/integration/assignment-state-machine.test.ts apps/web/tests/integration/assignment-permissions.test.ts
git commit -m "feat(web): add assignment publish and submit flow"
```

---

## Task 6: Manual Grading, Error-Book Writeback, Performance Records

**Files:**

- Create: `apps/web/server/lib/assignment-writeback.ts`
- Modify: `apps/web/server/routers/assignment.ts`
- Test: `apps/web/tests/integration/assignment-error-book-writeback.test.ts`

- [ ] **Step 1: Add writeback tests**

Create `apps/web/tests/integration/assignment-error-book-writeback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { createCallerForUser } from "./_helpers/trpc.js";

describe("assignment grading error-book writeback", () => {
  it("correct grade writes performance but not error book", async () => {
    await resetDb();
    const { teacher, answer } = await seedSubmittedAssignmentAnswer();
    const caller = createCallerForUser(teacher.id);

    await caller.assignment.gradeAnswer({
      answerId: answer.id,
      gradeStatus: "CORRECT",
      teacherFeedbackMd: "步骤完整。",
    });

    expect(await prisma.assignmentPerformance.count()).toBe(1);
    expect(await prisma.errorBookEntry.count()).toBe(0);
  });

  it("wrong grade requires root cause and writes error book", async () => {
    await resetDb();
    const { teacher, answer } = await seedSubmittedAssignmentAnswer();
    const caller = createCallerForUser(teacher.id);

    await expect(
      caller.assignment.gradeAnswer({
        answerId: answer.id,
        gradeStatus: "WRONG",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.assignment.gradeAnswer({
      answerId: answer.id,
      gradeStatus: "WRONG",
      rootCause: "FORMULA_MISUSE",
      teacherFeedbackMd: "移项时符号处理错误。",
    });

    const reread = await prisma.assignmentAnswer.findUniqueOrThrow({
      where: { id: answer.id },
    });
    expect(reread.errorBookEntryId).toBeTruthy();

    const entry = await prisma.errorBookEntry.findUniqueOrThrow({
      where: { id: reread.errorBookEntryId! },
    });
    expect(entry.rootCause).toBe("FORMULA_MISUSE");
    expect(entry.status).toBe("ACTIVE");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-error-book-writeback.test.ts
```

Expected: FAIL because grading writeback is not implemented.

- [ ] **Step 3: Implement writeback service**

Create `apps/web/server/lib/assignment-writeback.ts`:

```ts
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@zhijiao/db";

export async function gradeAssignmentAnswer(
  db: PrismaClient,
  args: {
    answerId: string;
    gradeStatus: "CORRECT" | "PARTIAL" | "WRONG";
    rootCause?: "CONCEPT_CONFUSION" | "MISREADING" | "FORMULA_MISUSE" | "CALCULATION_SLIP" | "TRANSFER_GAP" | "OTHER";
    teacherFeedbackMd?: string;
  },
) {
  if ((args.gradeStatus === "PARTIAL" || args.gradeStatus === "WRONG") && !args.rootCause) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请为错题选择错因",
      cause: { reason: "ROOT_CAUSE_REQUIRED" },
    });
  }

  return db.$transaction(async (tx) => {
    const answer = await tx.assignmentAnswer.findUniqueOrThrow({
      where: { id: args.answerId },
      include: {
        item: { include: { question: { include: { knowledgePoints: true } } } },
        studentAssignment: true,
      },
    });

    let errorBookEntryId = answer.errorBookEntryId;

    if (args.gradeStatus === "PARTIAL" || args.gradeStatus === "WRONG") {
      const questionId = answer.item.questionId;
      if (!questionId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "作业题缺少题目引用",
          cause: { reason: "ASSIGNMENT_ITEM_QUESTION_MISSING" },
        });
      }

      const existing = await tx.errorBookEntry.findFirst({
        where: {
          userId: answer.studentAssignment.studentUserId,
          questionId,
          status: { in: ["ACTIVE", "ARCHIVED"] },
        },
      });

      const data = {
        rootCause: args.rootCause!,
        rootCauseReasoning: args.teacherFeedbackMd ?? "作业批改回流",
        actualAnswerMd: JSON.stringify(answer.answerJson),
        status: "ACTIVE" as const,
        nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      if (existing) {
        const updated = await tx.errorBookEntry.update({
          where: { id: existing.id },
          data,
        });
        errorBookEntryId = updated.id;
      } else {
        const created = await tx.errorBookEntry.create({
          data: {
            userId: answer.studentAssignment.studentUserId,
            questionId,
            ...data,
          },
        });
        errorBookEntryId = created.id;
      }
    }

    const graded = await tx.assignmentAnswer.update({
      where: { id: args.answerId },
      data: {
        gradeStatus: args.gradeStatus,
        teacherFeedbackMd: args.teacherFeedbackMd,
        errorBookEntryId,
        gradedAt: new Date(),
      },
    });

    const kpIds = answer.item.question?.knowledgePoints.map((l) => l.kpId) ?? [];
    await tx.assignmentPerformance.upsert({
      where: {
        assignmentId_studentUserId_itemId: {
          assignmentId: answer.studentAssignment.assignmentId,
          studentUserId: answer.studentAssignment.studentUserId,
          itemId: answer.itemId,
        },
      },
      update: { gradeStatus: args.gradeStatus, kpIds },
      create: {
        assignmentId: answer.studentAssignment.assignmentId,
        studentUserId: answer.studentAssignment.studentUserId,
        itemId: answer.itemId,
        gradeStatus: args.gradeStatus,
        kpIds,
      },
    });

    return graded;
  });
}
```

Ensure `AssignmentPerformance` has the named unique constraint generated by Prisma. If Prisma's generated unique input name differs, use the generated name.

- [ ] **Step 4: Wire gradeAnswer**

Modify `apps/web/server/routers/assignment.ts`:

```ts
gradeAnswer: authedProcedure
  .input(z.object({
    answerId: z.string().cuid(),
    gradeStatus: z.enum(["CORRECT", "PARTIAL", "WRONG"]),
    rootCause: z.enum([
      "CONCEPT_CONFUSION",
      "MISREADING",
      "FORMULA_MISUSE",
      "CALCULATION_SLIP",
      "TRANSFER_GAP",
      "OTHER",
    ]).optional(),
    teacherFeedbackMd: z.string().max(4000).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    await requireTeacherAnswer(ctx.db, ctx.auth.userId, input.answerId);
    return gradeAssignmentAnswer(ctx.db, input);
  }),
```

- [ ] **Step 5: Run writeback tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-error-book-writeback.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/server/lib/assignment-writeback.ts apps/web/server/routers/assignment.ts apps/web/tests/integration/assignment-error-book-writeback.test.ts
git commit -m "feat(web): write assignment grading back to error book"
```

---

## Task 7: Teacher UI

**Files:**

- Modify: `apps/web/app/teacher/page.tsx`
- Create: `apps/web/app/teacher/classes/[classroomId]/page.tsx`
- Create: `apps/web/app/teacher/classes/[classroomId]/assignments/new/page.tsx`
- Create: `apps/web/app/teacher/classes/[classroomId]/assignments/new/generation-form.tsx`
- Create: `apps/web/app/teacher/assignments/[assignmentId]/edit/page.tsx`
- Create: `apps/web/app/teacher/assignments/[assignmentId]/edit/draft-editor.tsx`
- Create: `apps/web/app/teacher/assignments/[assignmentId]/page.tsx`
- Create: `apps/web/app/teacher/assignments/[assignmentId]/grading-panel.tsx`

- [ ] **Step 1: Add teacher dashboard**

Modify `apps/web/app/teacher/page.tsx`:

```tsx
import Link from "next/link";

export default function TeacherPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">教师工作台</h1>
          <p className="mt-1 text-sm text-slate-600">
            查看班级薄弱点，生成分层作业，批改学生提交。
          </p>
        </div>
        <Link
          href="/teacher/classes/dev-classroom-math-g8-01/assignments/new"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          生成分层作业
        </Link>
      </div>
      <section className="mt-6 rounded border bg-white p-4">
        <h2 className="font-medium">八年级数学 1 班</h2>
        <p className="mt-1 text-sm text-slate-600">基于错题本和知识点命中生成班级诊断。</p>
        <Link
          href="/teacher/classes/dev-classroom-math-g8-01"
          className="mt-3 inline-block text-sm text-emerald-700 underline"
        >
          查看班级诊断
        </Link>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Add generation form**

Create `generation-form.tsx` with tRPC mutation and visible cost:

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/app/_trpc/client";

export function GenerationForm({
  classroomId,
  subjectId,
  defaultKpId,
}: {
  classroomId: string;
  subjectId: string;
  defaultKpId: string;
}) {
  const [basic, setBasic] = useState(2);
  const [consolidation, setConsolidation] = useState(2);
  const [challenge, setChallenge] = useState(2);
  const total = basic + consolidation + challenge;
  const mutation = trpc.assignment.generateDraftFromCriteria.useMutation();

  return (
    <section className="space-y-4">
      <div className="rounded border bg-white p-4">
        <h2 className="font-medium">按条件生成</h2>
        <p className="mt-1 text-sm text-slate-600">
          AI 生成内容会先进入草稿，发布前请检查题目、答案和解析。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            基础
            <input className="mt-1 w-full rounded border px-3 py-2" type="number" value={basic} onChange={(e) => setBasic(Number(e.target.value))} />
          </label>
          <label className="text-sm">
            巩固
            <input className="mt-1 w-full rounded border px-3 py-2" type="number" value={consolidation} onChange={(e) => setConsolidation(Number(e.target.value))} />
          </label>
          <label className="text-sm">
            挑战
            <input className="mt-1 w-full rounded border px-3 py-2" type="number" value={challenge} onChange={(e) => setChallenge(Number(e.target.value))} />
          </label>
        </div>
        <p className="mt-3 text-sm text-slate-600">预计扣费：{total} credits</p>
        <button
          className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              classroomId,
              clientRequestId: crypto.randomUUID(),
              subjectId,
              gradeLevel: "G8",
              kpIds: [defaultKpId],
              difficultyRange: [2, 4],
              tierCounts: { BASIC: basic, CONSOLIDATION: consolidation, CHALLENGE: challenge },
              questionTypes: ["SINGLE_CHOICE", "CALCULATION"],
            })
          }
        >
          {mutation.isPending ? "生成中..." : "生成草稿"}
        </button>
      </div>
    </section>
  );
}
```

Create `apps/web/app/teacher/classes/[classroomId]/assignments/new/page.tsx` so the client receives real ids:

```tsx
import { prisma } from "@zhijiao/db";
import { GenerationForm } from "./generation-form";

export default async function NewAssignmentPage({
  params,
}: {
  params: { classroomId: string };
}) {
  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: params.classroomId },
    include: { subject: { include: { knowledgePoints: true } } },
  });
  const firstKp = classroom.subject.knowledgePoints[0];
  if (!firstKp) {
    return <main className="p-8 text-sm text-red-600">当前学科还没有知识点。</main>;
  }
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold">生成分层作业</h1>
      <GenerationForm
        classroomId={classroom.id}
        subjectId={classroom.subjectId}
        defaultKpId={firstKp.id}
      />
    </main>
  );
}
```

- [ ] **Step 3: Add draft editor and teacher detail**

Implement pages with dense, operational layouts:

```tsx
export default function AssignmentEditPage({ params }: { params: { assignmentId: string } }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">编辑作业草稿</h1>
      <DraftEditor assignmentId={params.assignmentId} />
    </main>
  );
}
```

`DraftEditor` must call `assignment.updateDraft` and `assignment.publish`, show state conflict messages, and not render publish as successful until the mutation returns.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/app/teacher
git commit -m "feat(web): add teacher assignment workflow UI"
```

---

## Task 8: Student Assignment UI, E2E Hook, and E2E

**Files:**

- Create: `apps/web/app/assignments/page.tsx`
- Create: `apps/web/app/assignments/assignment-list.tsx`
- Create: `apps/web/app/assignments/[studentAssignmentId]/page.tsx`
- Create: `apps/web/app/assignments/[studentAssignmentId]/submit-form.tsx`
- Create: `apps/web/app/assignments/[studentAssignmentId]/result/page.tsx`
- Create: `apps/web/app/api/e2e-hooks/assignment/route.ts`
- Test: `apps/web/e2e/assignment-lifecycle.spec.ts`

- [ ] **Step 1: Add student list**

Create `apps/web/app/assignments/page.tsx`:

```tsx
import { Suspense } from "react";
import { AssignmentList } from "./assignment-list";

export default function AssignmentsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">我的作业</h1>
      <Suspense fallback={<p className="mt-4 text-sm text-slate-500">加载中...</p>}>
        <AssignmentList />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 2: Add submit form**

Create `submit-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/app/_trpc/client";

export function SubmitForm({ studentAssignmentId, items }: {
  studentAssignmentId: string;
  items: Array<{ id: string; stemMd: string; type: string; optionsJson: unknown }>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const mutation = trpc.assignment.submit.useMutation();

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({
          studentAssignmentId,
          answers: items.map((item) => ({
            itemId: item.id,
            answerJson: { text: answers[item.id] ?? "" },
          })),
        });
      }}
    >
      {items.map((item, index) => (
        <section key={item.id} className="rounded border bg-white p-4">
          <h2 className="font-medium">第 {index + 1} 题</h2>
          <div className="mt-2 whitespace-pre-wrap text-sm">{item.stemMd}</div>
          <textarea
            className="mt-3 min-h-24 w-full rounded border px-3 py-2 text-sm"
            value={answers[item.id] ?? ""}
            onChange={(event) => setAnswers((prev) => ({ ...prev, [item.id]: event.target.value }))}
          />
        </section>
      ))}
      <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={mutation.isPending}>
        {mutation.isPending ? "提交中..." : "提交作业"}
      </button>
    </form>
  );
}
```

Choice controls can be added in the same component by checking `item.type` and rendering radio/checkbox inputs. Keep text fallback for calculation/proof/essay.

- [ ] **Step 3: Add deterministic E2E hook**

Create `apps/web/app/api/e2e-hooks/assignment/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";

export async function POST() {
  if (process.env.E2E_TEST_HOOKS !== "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const teacher = await prisma.user.findUniqueOrThrow({ where: { id: "dev-teacher-01" } });
  const student = await prisma.user.findUniqueOrThrow({ where: { id: "dev-student-01" } });
  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: "dev-classroom-math-g8-01" },
  });
  const subject = await prisma.subject.findUniqueOrThrow({ where: { code: "math" } });

  const question = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "解方程 x + 3 = 7。",
      type: "CALCULATION",
      difficulty: 2,
      status: "DRAFT",
      source: "ASSIGNMENT_GENERATED",
      createdByUserId: teacher.id,
      answer: {
        create: {
          contentMd: "x = 4",
          solutionMd: "两边同时减 3，得到 x = 4。",
        },
      },
    },
  });

  const assignment = await prisma.assignment.create({
    data: {
      classroomId: classroom.id,
      teacherUserId: teacher.id,
      title: "E2E 分层作业",
      source: "MANUAL_AI",
      status: "PUBLISHED",
      publishedAt: new Date(),
      tiers: {
        create: {
          level: "CONSOLIDATION",
          title: "我的练习",
          items: {
            create: {
              questionId: question.id,
              position: 1,
              stemMd: "解方程 x + 3 = 7。",
              type: "CALCULATION",
              answerMd: "x = 4",
              solutionMd: "两边同时减 3，得到 x = 4。",
              kpHints: ["一元一次方程"],
            },
          },
        },
      },
    },
    include: { tiers: { include: { items: true } } },
  });

  const tier = assignment.tiers[0];
  const studentAssignment = await prisma.studentAssignment.create({
    data: {
      assignmentId: assignment.id,
      studentUserId: student.id,
      tierId: tier.id,
      suggestedTier: "CONSOLIDATION",
    },
  });

  return NextResponse.json({
    assignmentId: assignment.id,
    studentAssignmentId: studentAssignment.id,
    itemId: tier.items[0].id,
  });
}
```

- [ ] **Step 4: Add lifecycle E2E**

Create `apps/web/e2e/assignment-lifecycle.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { loginAsPhone } from "./helpers/login";

test("teacher generates assignment, student submits, teacher grades", async ({ page }) => {
  const setup = await page.request.post("/api/e2e-hooks/assignment");
  expect(setup.ok()).toBeTruthy();
  const ids = await setup.json();

  await loginAsPhone(page, "13800000002");
  await page.goto("/teacher");
  await expect(page.getByRole("heading", { name: "教师工作台" })).toBeVisible();

  await page.goto(`/teacher/assignments/${ids.assignmentId}`);
  await expect(page.getByText("E2E 分层作业")).toBeVisible();

  await loginAsPhone(page, "13800000001");
  await page.goto(`/assignments/${ids.studentAssignmentId}`);
  await page.getByRole("textbox").fill("x = 4");
  await page.getByRole("button", { name: "提交作业" }).click();
  await expect(page.getByText("已提交")).toBeVisible();
});
```

- [ ] **Step 5: Run E2E**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/assignment-lifecycle.spec.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/app/assignments apps/web/app/api/e2e-hooks/assignment/route.ts apps/web/e2e/assignment-lifecycle.spec.ts
git commit -m "feat(web): add student assignment workflow"
```

---

## Task 9: PII Governance Patch

**Files:**

- Modify: `apps/web/server/lib/pii-governance.ts`
- Modify: `apps/web/tests/integration/pii-deactivate-user.test.ts`
- Modify: `apps/web/tests/integration/pii-export-user-data.test.ts`

- [ ] **Step 1: Add PII tests for assignment data**

Extend `pii-deactivate-user.test.ts`:

```ts
it("scrubs assignment answers and performance on student deactivation", async () => {
  const { student, answer } = await seedAssignmentAnswerWithPerformance();

  await deactivateUser(prisma, {
    userId: student.id,
    reason: "test",
    actorUserId: "ops-user",
  });

  const rereadAnswer = await prisma.assignmentAnswer.findUnique({
    where: { id: answer.id },
  });
  expect(rereadAnswer?.answerJson).toEqual({ redacted: true });

  const perfCount = await prisma.assignmentPerformance.count({
    where: { studentUserId: student.id },
  });
  expect(perfCount).toBe(0);
});
```

- [ ] **Step 2: Run failing PII test**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts
```

Expected: FAIL because assignment data is not handled yet.

- [ ] **Step 3: Patch PII service**

Modify `apps/web/server/lib/pii-governance.ts` in the student deactivation path:

```ts
const assignmentAnswers = await tx.assignmentAnswer.updateMany({
  where: {
    studentAssignment: { studentUserId: userId },
  },
  data: {
    answerJson: { redacted: true },
    teacherFeedbackMd: null,
  },
});

const assignmentPerformance = await tx.assignmentPerformance.deleteMany({
  where: { studentUserId: userId },
});

const studentAssignments = await tx.studentAssignment.deleteMany({
  where: { studentUserId: userId },
});
```

Add non-PII counts to the deactivation payload:

```ts
assignmentAnswers: assignmentAnswers.count,
assignmentPerformance: assignmentPerformance.count,
studentAssignments: studentAssignments.count,
```

- [ ] **Step 4: Run PII tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-export-user-data.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/unit/pii-ops-action-log-payload.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-deactivate-user.test.ts apps/web/tests/integration/pii-export-user-data.test.ts apps/web/tests/unit/pii-ops-action-log-payload.test.ts
git commit -m "feat(web): include assignments in pii governance"
```

---

## Task 10: Docs, Merge Probes, Final Regression

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-05-27-teacher-tiered-assignments-design.md` if implementation decisions differ

- [ ] **Step 1: Update CLAUDE.md Plan status**

Add a Plan 10 status section:

```md
**教师分层作业现状**（Plan 10）：
- seeded classroom + membership 已落地；教师端不做 roster 管理 UI。
- `ASSIGNMENT_QUESTION_GEN` 按生成题量扣教师钱包，失败补偿。
- AI 生成题进入 Assignment DRAFT，教师整份审核发布。
- 学生只看到自己的 tier 题组；教师人工批改。
- WRONG/PARTIAL 回流错题本并写 AssignmentPerformance。
```

- [ ] **Step 2: Add merge probes**

Add these probes to `CLAUDE.md`:

```md
47. **Assignment 变量计费不越权扣费**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts` 应全绿；跨班级/不存在 classroom 不写 DEBIT。
48. **Assignment 权限不泄露存在性**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-permissions.test.ts` 应全绿；跨教师/跨学生返回 NOT_FOUND 而非 FORBIDDEN。
49. **Assignment 状态机锁定发布快照**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-state-machine.test.ts` 应全绿；发布后 updateDraft 返回 `ASSIGNMENT_STATE_CHANGED`。
50. **Assignment 批改回流错题本**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-error-book-writeback.test.ts` 应全绿；WRONG/PARTIAL 写回，CORRECT 不写回。
51. **Assignment E2E 闭环**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/assignment-lifecycle.spec.ts` 应全绿。
```

- [ ] **Step 3: Run focused regression**

Run:

```powershell
pnpm.cmd --filter @zhijiao/ai test -- tests/assignment-question-generation.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-permissions.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-state-machine.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-error-book-writeback.test.ts
```

Expected: all pass.

- [ ] **Step 4: Run full verification**

Run:

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/assignment-lifecycle.spec.ts
```

Expected: all pass. If `test:e2e` requires a separate clean run, run it after typecheck/test complete.

- [ ] **Step 5: Commit docs**

```powershell
git add CLAUDE.md docs/superpowers/specs/2026-05-27-teacher-tiered-assignments-design.md
git commit -m "docs(claude): mark Plan 10 assignment lifecycle landed"
```

---

## Implementation Sequence

1. Task 1 schema first; all later tasks depend on generated Prisma types.
2. Task 2 AI schemas/router before assignment generation router.
3. Task 3 variable billing before charged generation endpoint.
4. Task 4 generation endpoint.
5. Task 5 publish/submit state machine.
6. Task 6 grading/writeback.
7. Task 7 teacher UI.
8. Task 8 student UI/E2E.
9. Task 9 PII governance.
10. Task 10 docs/final regression.

Do not parallelize tasks that touch the same files. Safe parallel work after Task 5: teacher UI and student UI can be implemented by separate workers if their file sets remain disjoint.
