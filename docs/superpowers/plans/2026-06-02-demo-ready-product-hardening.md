# Plan 16 Demo-ready Product Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a gated, polished, deterministic three-role demo experience for junior-high math teachers, with Apple-like visual refinement across the main student, teacher, and parent flows.

**Architecture:** Add a demo-mode gate, deterministic demo data services, and a demo identity entry route on top of the existing auth/session system. Then layer a shared role-aware product shell and focused UI polish over the existing student, teacher, and parent paths without changing the core business model. Keep production AI paper generation and AI courseware generation out of Plan 16; expose them only as preview cards for Plan 17 and Plan 18.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind CSS, tRPC, Prisma, PostgreSQL, Redis, Vitest, Playwright, pnpm/Turborepo.

---

## File Structure

Create:

- `apps/web/server/demo/config.ts` - demo-mode constants, user ids, class id, and enabled checks.
- `apps/web/server/demo/seed.ts` - idempotent demo data reset and verification helpers.
- `apps/web/server/demo/session.ts` - issue demo sessions for fixed demo identities.
- `apps/web/app/api/demo/enter/route.ts` - gated quick-entry route.
- `apps/web/app/demo/page.tsx` - polished three-role demo center.
- `apps/web/components/shell/AppShell.tsx` - shared polished app shell.
- `apps/web/components/shell/RoleNav.tsx` - role-aware navigation model.
- `apps/web/components/shell/DemoModeBanner.tsx` - demo identity and return-to-demo affordance.
- `apps/web/components/ui/action-card.tsx` - reusable premium action card.
- `apps/web/components/ui/state-panel.tsx` - reusable loading/empty/error/forbidden state container.
- `apps/web/components/ui/status-pill.tsx` - consistent status tags.
- `apps/web/components/ui/page-header.tsx` - consistent title, subtitle, and primary action layout.
- `apps/web/scripts/demo-reset.ts` - CLI reset entry.
- `apps/web/scripts/demo-verify.ts` - CLI verification entry.
- `apps/web/tests/integration/demo-entry.test.ts` - route/auth integration coverage.
- `apps/web/tests/integration/demo-seed.test.ts` - demo reset idempotency and verification coverage.
- `apps/web/tests/unit/role-nav.test.ts` - navigation model coverage.
- `apps/web/e2e/demo.spec.ts` - Playwright demo journey coverage.

Modify:

- `package.json` - add root `demo:reset` and `verify:demo` scripts.
- `apps/web/package.json` - add web-local demo script aliases if useful.
- `.env.example` - document demo mode variables.
- `apps/web/server/env.ts` - validate `DEMO_MODE`.
- `apps/web/app/layout.tsx` - apply global polished foundation metadata/body classes.
- `apps/web/app/page.tsx` - make home route point clearly to `/demo` in demo mode and login otherwise.
- `apps/web/app/globals.css` - add design tokens and base interaction styles.
- `apps/web/app/(student)/tutor/page.tsx` - polished student tutoring entry.
- `apps/web/components/TutorForm.tsx` - demo prefill, improved states, and refined layout.
- `apps/web/app/(student)/error-book/page.tsx` and child components - polished error-book list/detail states.
- `apps/web/app/(student)/portrait/page.tsx` and `portrait-view.tsx` - polished student learning portrait.
- `apps/web/app/teacher/page.tsx` - polished teacher dashboard.
- `apps/web/app/teacher/classes/[classroomId]/page.tsx` - polished class page plus Plan 17/18 preview cards.
- `apps/web/app/teacher/classes/[classroomId]/assignments/new/page.tsx` and `generation-form.tsx` - polished generation workflow.
- `apps/web/app/teacher/assignments/[assignmentId]/edit/page.tsx` and `draft-editor.tsx` - polished draft review.
- `apps/web/app/teacher/assignments/[assignmentId]/page.tsx` and `grading-panel.tsx` - polished grading flow.
- `apps/web/app/parent/page.tsx`, `parent-view.tsx`, `parent/children/[childId]/page.tsx`, and `child-portrait.tsx` - polished parent journey.
- `apps/web/e2e/global-setup.ts` - call demo reset or verify fixtures when demo E2E runs.
- `docs/claude/implementation-state.md` - append Plan 16 implementation notes after completion.
- `docs/claude/merge-verification.md` - append demo regression probes after completion.

---

### Task 1: Demo Mode Configuration

**Files:**
- Modify: `apps/web/server/env.ts`
- Create: `apps/web/server/demo/config.ts`
- Modify: `.env.example`
- Test: `apps/web/tests/server/env.test.ts`

- [ ] **Step 1: Add failing env tests**

Add these cases to `apps/web/tests/server/env.test.ts`:

```ts
it("accepts DEMO_MODE=1", async () => {
  vi.resetModules();
  const oldEnv = process.env;
  process.env = {
    ...oldEnv,
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/zhijiao_test",
    REDIS_URL: "redis://localhost:6379",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    ACCESS_JWT_SECRET: "test-access-secret-at-least-32-bytes",
    OTP_PEPPER: "test-otp-pepper-16+",
    AI_USE_MOCK: "true",
    SMS_USE_MOCK: "true",
    WECHAT_OAUTH_USE_MOCK: "true",
    WECHAT_PAY_USE_MOCK: "true",
    MOCK_WECHAT_PAY_SECRET: "mock-pay-secret-at-least-16",
    WECHAT_PAY_APPID: "wx-demo",
    WECHAT_PAY_MCHID: "1900000000",
    DEMO_MODE: "1",
  };
  const { env } = await import("../../server/env");
  expect(env.DEMO_MODE).toBe("1");
  process.env = oldEnv;
});

it("defaults DEMO_MODE to 0", async () => {
  vi.resetModules();
  const oldEnv = process.env;
  process.env = {
    ...oldEnv,
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/zhijiao_test",
    REDIS_URL: "redis://localhost:6379",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    ACCESS_JWT_SECRET: "test-access-secret-at-least-32-bytes",
    OTP_PEPPER: "test-otp-pepper-16+",
    AI_USE_MOCK: "true",
    SMS_USE_MOCK: "true",
    WECHAT_OAUTH_USE_MOCK: "true",
    WECHAT_PAY_USE_MOCK: "true",
    MOCK_WECHAT_PAY_SECRET: "mock-pay-secret-at-least-16",
    WECHAT_PAY_APPID: "wx-demo",
    WECHAT_PAY_MCHID: "1900000000",
  };
  const { env } = await import("../../server/env");
  expect(env.DEMO_MODE).toBe("0");
  process.env = oldEnv;
});
```

- [ ] **Step 2: Run env tests and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts`

Expected: FAIL because `env.DEMO_MODE` does not exist.

- [ ] **Step 3: Add env schema field**

In `apps/web/server/env.ts`, add this field near `E2E_TEST_HOOKS`:

```ts
DEMO_MODE: z.enum(["0", "1"]).default("0"),
```

Also add `DEMO_MODE: "0"` to the build-phase safeParse object.

- [ ] **Step 4: Add demo config module**

Create `apps/web/server/demo/config.ts`:

```ts
import "server-only";
import { env } from "../env.js";

export type DemoRole = "student" | "teacher" | "parent";

export const DEMO_IDS = {
  classroomId: "demo-classroom-g8-math-01",
  teacherUserId: "demo-teacher-math-01",
  studentUserId: "demo-student-focus-01",
  stableStudentUserId: "demo-student-stable-01",
  consolidatingStudentUserId: "demo-student-consolidating-01",
  parentUserId: "demo-parent-01",
} as const;

export const DEMO_TARGETS: Record<DemoRole, string> = {
  student: "/tutor?demo=1",
  teacher: `/teacher/classes/${DEMO_IDS.classroomId}`,
  parent: "/parent",
};

export function isDemoModeEnabled(): boolean {
  return env.DEMO_MODE === "1";
}

export function userIdForDemoRole(role: DemoRole): string {
  if (role === "student") return DEMO_IDS.studentUserId;
  if (role === "teacher") return DEMO_IDS.teacherUserId;
  return DEMO_IDS.parentUserId;
}
```

- [ ] **Step 5: Document env**

Add this to `.env.example` under App:

```dotenv
# Demo center (Plan 16). Keep disabled outside local/demo environments.
DEMO_MODE=0
```

- [ ] **Step 6: Verify tests pass**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/server/env.ts apps/web/server/demo/config.ts apps/web/tests/server/env.test.ts .env.example
git commit -m "feat(web): add gated demo mode config"
```

---

### Task 2: Deterministic Demo Data Reset and Verification

**Files:**
- Create: `apps/web/server/demo/seed.ts`
- Create: `apps/web/scripts/demo-reset.ts`
- Create: `apps/web/scripts/demo-verify.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Test: `apps/web/tests/integration/demo-seed.test.ts`

- [ ] **Step 1: Write failing demo seed test**

Create `apps/web/tests/integration/demo-seed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prisma } from "@zhijiao/db";
import { resetDemoData, verifyDemoData } from "@/server/demo/seed";
import { DEMO_IDS } from "@/server/demo/config";

describe("demo data", () => {
  it("resets idempotently and verifies required records", async () => {
    await resetDemoData(prisma);
    await resetDemoData(prisma);

    const result = await verifyDemoData(prisma);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);

    const classroomCount = await prisma.classroom.count({
      where: { id: DEMO_IDS.classroomId },
    });
    expect(classroomCount).toBe(1);

    const familyLinkCount = await prisma.familyLink.count({
      where: {
        parentUserId: DEMO_IDS.parentUserId,
        studentUserId: DEMO_IDS.studentUserId,
        status: "ACTIVE",
      },
    });
    expect(familyLinkCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/demo-seed.test.ts`

Expected: FAIL because `@/server/demo/seed` does not exist.

- [ ] **Step 3: Implement reset and verify helpers**

Create `apps/web/server/demo/seed.ts`:

```ts
import "server-only";
import type { PrismaClient } from "@prisma/client";
import { DEMO_IDS } from "./config.js";

export type DemoVerifyResult = { ok: boolean; missing: string[] };

const demoPhones = {
  teacher: "13900001001",
  student: "13900001002",
  stable: "13900001003",
  consolidating: "13900001004",
  parent: "13900001005",
};

async function upsertPhoneIdentity(prisma: PrismaClient, userId: string, phone: string) {
  await prisma.authIdentity.upsert({
    where: {
      uniq_identity: {
        provider: "PHONE",
        providerScope: "GLOBAL",
        providerUserId: phone,
      },
    },
    update: { userId },
    create: {
      userId,
      provider: "PHONE",
      providerScope: "GLOBAL",
      providerUserId: phone,
    },
  });
}

async function ensureUser(prisma: PrismaClient, args: {
  id: string;
  name: string;
  persona: "STUDENT" | "TEACHER" | "PARENT";
  phone: string;
  gradeLevel?: "G8";
}) {
  await prisma.user.upsert({
    where: { id: args.id },
    update: {
      name: args.name,
      persona: args.persona,
      gradeLevel: args.gradeLevel ?? null,
      isMinor: args.persona === "STUDENT",
      birthYear: args.persona === "STUDENT" ? 2012 : null,
      guardianConsentStatus: args.persona === "STUDENT" ? "GRANTED" : "NOT_REQUIRED",
      deletedAt: null,
      deactivationReason: null,
    },
    create: {
      id: args.id,
      name: args.name,
      persona: args.persona,
      gradeLevel: args.gradeLevel ?? null,
      isMinor: args.persona === "STUDENT",
      birthYear: args.persona === "STUDENT" ? 2012 : null,
      guardianConsentStatus: args.persona === "STUDENT" ? "GRANTED" : "NOT_REQUIRED",
    },
  });
  await upsertPhoneIdentity(prisma, args.id, args.phone);
}

export async function resetDemoData(prisma: PrismaClient): Promise<void> {
  const math = await prisma.subject.findUniqueOrThrow({ where: { code: "math" } });

  await ensureUser(prisma, {
    id: DEMO_IDS.teacherUserId,
    name: "林老师",
    persona: "TEACHER",
    phone: demoPhones.teacher,
  });
  await ensureUser(prisma, {
    id: DEMO_IDS.studentUserId,
    name: "周同学",
    persona: "STUDENT",
    gradeLevel: "G8",
    phone: demoPhones.student,
  });
  await ensureUser(prisma, {
    id: DEMO_IDS.stableStudentUserId,
    name: "陈同学",
    persona: "STUDENT",
    gradeLevel: "G8",
    phone: demoPhones.stable,
  });
  await ensureUser(prisma, {
    id: DEMO_IDS.consolidatingStudentUserId,
    name: "吴同学",
    persona: "STUDENT",
    gradeLevel: "G8",
    phone: demoPhones.consolidating,
  });
  await ensureUser(prisma, {
    id: DEMO_IDS.parentUserId,
    name: "周同学家长",
    persona: "PARENT",
    phone: demoPhones.parent,
  });

  await prisma.classroom.upsert({
    where: { id: DEMO_IDS.classroomId },
    update: { name: "初二 3 班", subjectId: math.id, gradeLevel: "G8" },
    create: {
      id: DEMO_IDS.classroomId,
      name: "初二 3 班",
      subjectId: math.id,
      gradeLevel: "G8",
    },
  });

  for (const [userId, role] of [
    [DEMO_IDS.teacherUserId, "TEACHER"],
    [DEMO_IDS.studentUserId, "STUDENT"],
    [DEMO_IDS.stableStudentUserId, "STUDENT"],
    [DEMO_IDS.consolidatingStudentUserId, "STUDENT"],
  ] as const) {
    await prisma.classroomMember.upsert({
      where: {
        classroomId_userId: {
          classroomId: DEMO_IDS.classroomId,
          userId,
        },
      },
      update: { role },
      create: { classroomId: DEMO_IDS.classroomId, userId, role },
    });
  }

  await prisma.familyLink.upsert({
    where: {
      parentUserId_studentUserId: {
        parentUserId: DEMO_IDS.parentUserId,
        studentUserId: DEMO_IDS.studentUserId,
      },
    },
    update: { status: "ACTIVE", revokedAt: null },
    create: {
      parentUserId: DEMO_IDS.parentUserId,
      studentUserId: DEMO_IDS.studentUserId,
      status: "ACTIVE",
    },
  });

  const wallet = await prisma.wallet.upsert({
    where: { userId: DEMO_IDS.teacherUserId },
    update: {},
    create: { userId: DEMO_IDS.teacherUserId, balance: 0 },
  });
  await prisma.creditLedger.upsert({
    where: { idemKey: "demo:teacher-wallet:opening" },
    update: {},
    create: {
      walletId: wallet.id,
      kind: "ADJUST_ADD",
      delta: 200,
      balanceAfter: 200,
      idemKey: "demo:teacher-wallet:opening",
      metadata: { source: "demo-reset" },
    },
  });
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { balance: 200 },
  });

  const kp = await prisma.knowledgePoint.findFirstOrThrow({
    where: { subjectId: math.id },
    orderBy: { code: "asc" },
  });
  const question = await prisma.question.upsert({
    where: { id: "demo-question-linear-function-x-axis" },
    update: {
      subjectId: math.id,
      stemMd: "已知一次函数 y = 2x - 3 的图像与 x 轴交于点 A。求点 A 的坐标，并说明这个交点和方程 2x - 3 = 0 的关系。",
      type: "CALCULATION",
      difficulty: 3,
      status: "PUBLISHED",
      source: "DEMO",
    },
    create: {
      id: "demo-question-linear-function-x-axis",
      subjectId: math.id,
      stemMd: "已知一次函数 y = 2x - 3 的图像与 x 轴交于点 A。求点 A 的坐标，并说明这个交点和方程 2x - 3 = 0 的关系。",
      type: "CALCULATION",
      difficulty: 3,
      status: "PUBLISHED",
      source: "DEMO",
    },
  });
  await prisma.questionAnswer.upsert({
    where: { questionId: question.id },
    update: {
      contentMd: "A(3/2, 0)",
      solutionMd: "x 轴上的点满足 y=0，因此令 2x-3=0，解得 x=3/2，所以 A(3/2,0)。",
    },
    create: {
      questionId: question.id,
      contentMd: "A(3/2, 0)",
      solutionMd: "x 轴上的点满足 y=0，因此令 2x-3=0，解得 x=3/2，所以 A(3/2,0)。",
    },
  });
  await prisma.questionKPLink.upsert({
    where: { questionId_kpId: { questionId: question.id, kpId: kp.id } },
    update: { weight: 1 },
    create: { questionId: question.id, kpId: kp.id, weight: 1 },
  });

  const assignment = await prisma.assignment.upsert({
    where: { id: "demo-assignment-linear-function-01" },
    update: {
      classroomId: DEMO_IDS.classroomId,
      teacherUserId: DEMO_IDS.teacherUserId,
      title: "一次函数与方程关系分层练习",
      status: "PUBLISHED",
      source: "DEMO",
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    create: {
      id: "demo-assignment-linear-function-01",
      classroomId: DEMO_IDS.classroomId,
      teacherUserId: DEMO_IDS.teacherUserId,
      title: "一次函数与方程关系分层练习",
      status: "PUBLISHED",
      source: "DEMO",
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
  });
  const tier = await prisma.assignmentTier.upsert({
    where: { assignmentId_level: { assignmentId: assignment.id, level: "CONSOLIDATION" } },
    update: { title: "巩固组", rationaleMd: "聚焦图像交点与方程关系。" },
    create: {
      assignmentId: assignment.id,
      level: "CONSOLIDATION",
      title: "巩固组",
      rationaleMd: "聚焦图像交点与方程关系。",
    },
  });
  const item = await prisma.assignmentItem.upsert({
    where: { tierId_position: { tierId: tier.id, position: 1 } },
    update: {
      questionId: question.id,
      stemMd: question.stemMd,
      type: "CALCULATION",
      answerMd: "A(3/2, 0)",
      solutionMd: "令 y=0，把函数问题转化为一元一次方程。",
      kpHints: [kp.name],
    },
    create: {
      tierId: tier.id,
      questionId: question.id,
      position: 1,
      stemMd: question.stemMd,
      type: "CALCULATION",
      answerMd: "A(3/2, 0)",
      solutionMd: "令 y=0，把函数问题转化为一元一次方程。",
      kpHints: [kp.name],
    },
  });
  const studentAssignment = await prisma.studentAssignment.upsert({
    where: {
      assignmentId_studentUserId: {
        assignmentId: assignment.id,
        studentUserId: DEMO_IDS.studentUserId,
      },
    },
    update: {
      tierId: tier.id,
      status: "SUBMITTED",
      suggestedTier: "CONSOLIDATION",
      submittedAt: new Date("2026-06-01T01:00:00.000Z"),
    },
    create: {
      assignmentId: assignment.id,
      studentUserId: DEMO_IDS.studentUserId,
      tierId: tier.id,
      status: "SUBMITTED",
      suggestedTier: "CONSOLIDATION",
      submittedAt: new Date("2026-06-01T01:00:00.000Z"),
    },
  });
  await prisma.assignmentAnswer.upsert({
    where: { studentAssignmentId_itemId: { studentAssignmentId: studentAssignment.id, itemId: item.id } },
    update: { answerJson: { text: "x=3/2，A(0,3/2)" }, gradeStatus: "UNGRADED" },
    create: {
      studentAssignmentId: studentAssignment.id,
      itemId: item.id,
      answerJson: { text: "x=3/2，A(0,3/2)" },
      gradeStatus: "UNGRADED",
    },
  });
  await prisma.assignmentPerformance.upsert({
    where: {
      assignmentId_studentUserId_itemId: {
        assignmentId: assignment.id,
        studentUserId: DEMO_IDS.stableStudentUserId,
        itemId: item.id,
      },
    },
    update: { gradeStatus: "CORRECT", kpIds: [kp.id] },
    create: {
      assignmentId: assignment.id,
      studentUserId: DEMO_IDS.stableStudentUserId,
      itemId: item.id,
      gradeStatus: "CORRECT",
      kpIds: [kp.id],
    },
  });
  const entry = await prisma.errorBookEntry.upsert({
    where: { id: "demo-error-entry-linear-function-01" },
    update: {
      userId: DEMO_IDS.studentUserId,
      questionId: question.id,
      status: "ACTIVE",
      rootCause: "CONCEPT_CONFUSION",
      rootCauseReasoning: "把 x 轴交点坐标和解方程得到的 x 值混在一起。",
      actualAnswerMd: "x=3/2，A(0,3/2)",
      nextReviewAt: new Date("2026-06-02T00:00:00.000Z"),
    },
    create: {
      id: "demo-error-entry-linear-function-01",
      userId: DEMO_IDS.studentUserId,
      questionId: question.id,
      status: "ACTIVE",
      rootCause: "CONCEPT_CONFUSION",
      rootCauseReasoning: "把 x 轴交点坐标和解方程得到的 x 值混在一起。",
      actualAnswerMd: "x=3/2，A(0,3/2)",
      nextReviewAt: new Date("2026-06-02T00:00:00.000Z"),
    },
  });
  const variantLedger = await prisma.creditLedger.upsert({
    where: { idemKey: "demo:variant-group:linear-function-01" },
    update: {},
    create: {
      walletId: wallet.id,
      kind: "DEBIT",
      delta: -3,
      balanceAfter: 197,
      idemKey: "demo:variant-group:linear-function-01",
      actionKind: "VARIANT_GROUP_GEN",
      metadata: { source: "demo-reset" },
      createdByUserId: DEMO_IDS.studentUserId,
    },
  });
  const variantGroup = await prisma.variantGroup.upsert({
    where: { id: "demo-variant-group-linear-function-01" },
    update: {
      entryId: entry.id,
      userId: DEMO_IDS.studentUserId,
      creditsCost: 3,
      debitLedgerId: variantLedger.id,
    },
    create: {
      id: "demo-variant-group-linear-function-01",
      entryId: entry.id,
      userId: DEMO_IDS.studentUserId,
      creditsCost: 3,
      debitLedgerId: variantLedger.id,
    },
  });
  const variantQuestion = await prisma.question.upsert({
    where: { id: "demo-variant-question-linear-function-l1" },
    update: {
      subjectId: math.id,
      stemMd: "一次函数 y = -x + 4 与 x 轴交于点 B，求 B 的坐标。",
      type: "CALCULATION",
      difficulty: 3,
      status: "DRAFT",
      source: "VARIANT_GENERATED",
      createdByUserId: DEMO_IDS.studentUserId,
    },
    create: {
      id: "demo-variant-question-linear-function-l1",
      subjectId: math.id,
      stemMd: "一次函数 y = -x + 4 与 x 轴交于点 B，求 B 的坐标。",
      type: "CALCULATION",
      difficulty: 3,
      status: "DRAFT",
      source: "VARIANT_GENERATED",
      createdByUserId: DEMO_IDS.studentUserId,
    },
  });
  await prisma.variantItem.upsert({
    where: { questionId: variantQuestion.id },
    update: {
      groupId: variantGroup.id,
      level: "L1",
      position: 1,
      stemMd: variantQuestion.stemMd,
      solutionMd: "令 y=0，得到 -x+4=0，所以 x=4，B(4,0)。",
      knowledgePointHints: [kp.name],
    },
    create: {
      groupId: variantGroup.id,
      questionId: variantQuestion.id,
      level: "L1",
      position: 1,
      stemMd: variantQuestion.stemMd,
      solutionMd: "令 y=0，得到 -x+4=0，所以 x=4，B(4,0)。",
      knowledgePointHints: [kp.name],
    },
  });
}

export async function verifyDemoData(prisma: PrismaClient): Promise<DemoVerifyResult> {
  const checks: Array<[string, Promise<number>]> = [
    ["teacher user", prisma.user.count({ where: { id: DEMO_IDS.teacherUserId, deletedAt: null } })],
    ["student user", prisma.user.count({ where: { id: DEMO_IDS.studentUserId, deletedAt: null } })],
    ["parent user", prisma.user.count({ where: { id: DEMO_IDS.parentUserId, deletedAt: null } })],
    ["classroom", prisma.classroom.count({ where: { id: DEMO_IDS.classroomId } })],
    ["teacher wallet", prisma.wallet.count({ where: { userId: DEMO_IDS.teacherUserId, balance: { gte: 50 } } })],
    ["assignment", prisma.assignment.count({ where: { id: "demo-assignment-linear-function-01", status: "PUBLISHED" } })],
    ["submitted student assignment", prisma.studentAssignment.count({ where: { assignmentId: "demo-assignment-linear-function-01", studentUserId: DEMO_IDS.studentUserId, status: "SUBMITTED" } })],
    ["error book entry", prisma.errorBookEntry.count({ where: { id: "demo-error-entry-linear-function-01", status: "ACTIVE" } })],
    ["variant group", prisma.variantGroup.count({ where: { id: "demo-variant-group-linear-function-01" } })],
    ["assignment performance", prisma.assignmentPerformance.count({ where: { assignmentId: "demo-assignment-linear-function-01" } })],
    ["family link", prisma.familyLink.count({
      where: {
        parentUserId: DEMO_IDS.parentUserId,
        studentUserId: DEMO_IDS.studentUserId,
        status: "ACTIVE",
      },
    })],
  ];

  const missing: string[] = [];
  for (const [name, promise] of checks) {
    if ((await promise) < 1) missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Add CLI scripts**

Create `apps/web/scripts/demo-reset.ts`:

```ts
import { prisma } from "@zhijiao/db";
import { resetDemoData, verifyDemoData } from "../server/demo/seed.js";

await resetDemoData(prisma);
const result = await verifyDemoData(prisma);
await prisma.$disconnect();

if (!result.ok) {
  console.error(`[demo:reset] missing ${result.missing.join(", ")}`);
  process.exit(1);
}
console.log("[demo:reset] ok");
```

Create `apps/web/scripts/demo-verify.ts`:

```ts
import { prisma } from "@zhijiao/db";
import { verifyDemoData } from "../server/demo/seed.js";

const result = await verifyDemoData(prisma);
await prisma.$disconnect();

if (!result.ok) {
  console.error(`[verify:demo] missing ${result.missing.join(", ")}`);
  process.exit(1);
}
console.log("[verify:demo] ok");
```

- [ ] **Step 5: Wire package scripts**

In root `package.json`, add:

```json
"demo:reset": "pnpm --filter @zhijiao/web demo:reset",
"verify:demo": "pnpm --filter @zhijiao/web verify:demo"
```

In `apps/web/package.json`, add:

```json
"demo:reset": "tsx scripts/demo-reset.ts",
"verify:demo": "tsx scripts/demo-verify.ts"
```

- [ ] **Step 6: Verify seed test and scripts**

Run:

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/integration/demo-seed.test.ts
pnpm.cmd demo:reset
pnpm.cmd verify:demo
```

Expected: all PASS / `ok`.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/server/demo/seed.ts apps/web/scripts/demo-reset.ts apps/web/scripts/demo-verify.ts apps/web/tests/integration/demo-seed.test.ts apps/web/package.json package.json
git commit -m "feat(web): add deterministic demo data reset"
```

---

### Task 3: Demo Identity Entry

**Files:**
- Create: `apps/web/server/demo/session.ts`
- Create: `apps/web/app/api/demo/enter/route.ts`
- Test: `apps/web/tests/integration/demo-entry.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `apps/web/tests/integration/demo-entry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("demo entry route", () => {
  it("returns 404 when demo mode is disabled", async () => {
    vi.resetModules();
    process.env.DEMO_MODE = "0";
    const { GET } = await import("@/app/api/demo/enter/route");
    const res = await GET(new NextRequest("http://localhost/api/demo/enter?role=student"));
    expect(res.status).toBe(404);
  });

  it("rejects unknown roles when demo mode is enabled", async () => {
    vi.resetModules();
    process.env.DEMO_MODE = "1";
    const { GET } = await import("@/app/api/demo/enter/route");
    const res = await GET(new NextRequest("http://localhost/api/demo/enter?role=ops"));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/demo-entry.test.ts`

Expected: FAIL because route does not exist.

- [ ] **Step 3: Add session helper**

Create `apps/web/server/demo/session.ts`:

```ts
import "server-only";
import type { PrismaClient } from "@prisma/client";
import { issueSessionAndCookies } from "../auth-service.js";
import { DEMO_TARGETS, type DemoRole, userIdForDemoRole } from "./config.js";

export async function issueDemoSession(opts: {
  prisma: PrismaClient;
  role: DemoRole;
  resHeaders: Headers;
  ip?: string | null;
  ua?: string | null;
}): Promise<{ redirectTo: string }> {
  await issueSessionAndCookies({
    prisma: opts.prisma,
    userId: userIdForDemoRole(opts.role),
    resHeaders: opts.resHeaders,
    ip: opts.ip,
    ua: opts.ua,
  });
  return { redirectTo: DEMO_TARGETS[opts.role] };
}
```

- [ ] **Step 4: Add route**

Create `apps/web/app/api/demo/enter/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import { isDemoModeEnabled, type DemoRole } from "@/server/demo/config";
import { issueDemoSession } from "@/server/demo/session";

const roles = new Set(["student", "teacher", "parent"]);

export async function GET(req: NextRequest) {
  if (!isDemoModeEnabled()) {
    return NextResponse.json({ error: "DEMO_MODE_DISABLED" }, { status: 404 });
  }
  const role = req.nextUrl.searchParams.get("role");
  if (!role || !roles.has(role)) {
    return NextResponse.json({ error: "DEMO_ROLE_INVALID" }, { status: 400 });
  }
  const res = NextResponse.redirect(new URL("/demo", req.url));
  const issued = await issueDemoSession({
    prisma,
    role: role as DemoRole,
    resHeaders: res.headers,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: req.headers.get("user-agent"),
  });
  return NextResponse.redirect(new URL(issued.redirectTo, req.url), {
    headers: res.headers,
  });
}
```

- [ ] **Step 5: Verify tests pass**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/demo-entry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/server/demo/session.ts apps/web/app/api/demo/enter/route.ts apps/web/tests/integration/demo-entry.test.ts
git commit -m "feat(web): add gated demo identity entry"
```

---

### Task 4: Demo Center Page

**Files:**
- Create: `apps/web/app/demo/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Test: `apps/web/e2e/demo.spec.ts`

- [ ] **Step 1: Write failing E2E for demo center gate**

Create `apps/web/e2e/demo.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("demo center shows three role entries", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "智教演示中心" })).toBeVisible();
  await expect(page.getByRole("link", { name: /学生体验/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /教师体验/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /家长体验/ })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts`

Expected: FAIL because `/demo` does not exist.

- [ ] **Step 3: Add demo center page**

Create `apps/web/app/demo/page.tsx`:

```tsx
import Link from "next/link";
import { isDemoModeEnabled } from "@/server/demo/config";

const roles = [
  {
    href: "/api/demo/enter?role=student",
    title: "学生体验",
    eyebrow: "不会题到错题巩固",
    body: "体验提示式讲解、错因分析、错题本和变式训练。",
  },
  {
    href: "/api/demo/enter?role=teacher",
    title: "教师体验",
    eyebrow: "班级薄弱点到分层作业",
    body: "查看初二 3 班诊断，生成分层作业，批改并回流错题。",
  },
  {
    href: "/api/demo/enter?role=parent",
    title: "家长体验",
    eyebrow: "简化学情反馈",
    body: "查看孩子近期掌握情况和巩固方向，不展示排名。",
  },
];

export default function DemoPage() {
  if (!isDemoModeEnabled()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6">
        <section className="rounded-[28px] bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-500">Demo mode</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            演示中心未开启
          </h1>
          <p className="mt-3 text-slate-600">请在本地演示环境启用 DEMO_MODE=1。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#ffffff,transparent_42%),linear-gradient(180deg,#f8fafc,#eef2f7)] px-6 py-12 text-slate-950">
      <section className="mx-auto max-w-6xl">
        <p className="text-sm font-medium text-slate-500">初二数学 · 三端闭环</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight">
          智教演示中心
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
          以一次函数与方程关系为例，体验学生学习、教师教学、家长反馈三端闭环。
        </p>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {roles.map((role) => (
            <Link
              key={role.title}
              href={role.href}
              className="group rounded-[28px] bg-white/85 p-7 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-xl"
            >
              <p className="text-sm font-medium text-slate-500">{role.eyebrow}</p>
              <h2 className="mt-4 text-2xl font-semibold">{role.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{role.body}</p>
              <span className="mt-8 inline-flex text-sm font-medium text-slate-950">
                进入体验 →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Add home link**

Modify `apps/web/app/page.tsx` so the primary CTA links to `/demo` when demo mode is enabled and `/login` otherwise:

```tsx
import Link from "next/link";
import { isDemoModeEnabled } from "@/server/demo/config";

export default function Page() {
  const demo = isDemoModeEnabled();
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-slate-500">AI K12 学教平台</p>
      <h1 className="mt-4 text-5xl font-semibold tracking-tight">智教</h1>
      <p className="mt-5 text-lg leading-8 text-slate-600">一道题，学会一类题。</p>
      <div className="mt-8">
        <Link
          href={demo ? "/demo" : "/login"}
          className="inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          data-testid="cta-primary"
        >
          {demo ? "进入演示中心" : "登录使用"}
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run E2E**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts`

Expected: PASS with `DEMO_MODE=1` configured in E2E setup. If E2E env does not yet set it, add `DEMO_MODE=1` in `apps/web/playwright.config.ts` webServer env.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/app/demo/page.tsx apps/web/app/page.tsx apps/web/e2e/demo.spec.ts apps/web/playwright.config.ts
git commit -m "feat(web): add polished demo center"
```

---

### Task 5: Polished App Shell and Shared UI Components

**Files:**
- Create: `apps/web/components/shell/AppShell.tsx`
- Create: `apps/web/components/shell/RoleNav.tsx`
- Create: `apps/web/components/shell/DemoModeBanner.tsx`
- Create: `apps/web/components/ui/action-card.tsx`
- Create: `apps/web/components/ui/page-header.tsx`
- Create: `apps/web/components/ui/state-panel.tsx`
- Create: `apps/web/components/ui/status-pill.tsx`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/tests/unit/role-nav.test.ts`

- [ ] **Step 1: Write role nav test**

Create `apps/web/tests/unit/role-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { navForRole } from "@/components/shell/RoleNav";

describe("role navigation", () => {
  it("returns student nav", () => {
    expect(navForRole("STUDENT").map((item) => item.label)).toEqual([
      "答疑",
      "错题本",
      "作业",
      "学情",
    ]);
  });

  it("returns teacher nav with Plan 17 and 18 preview entries", () => {
    expect(navForRole("TEACHER").map((item) => item.label)).toEqual([
      "班级",
      "作业",
      "学生",
      "AI 出卷",
      "AI 课件",
    ]);
  });

  it("returns parent nav", () => {
    expect(navForRole("PARENT").map((item) => item.label)).toEqual([
      "孩子",
      "学情",
      "隐私",
    ]);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/role-nav.test.ts`

Expected: FAIL because `RoleNav` does not exist.

- [ ] **Step 3: Create role nav**

Create `apps/web/components/shell/RoleNav.tsx`:

```tsx
import Link from "next/link";
import type { Persona } from "@prisma/client";

export type NavItem = { label: string; href: string; preview?: boolean };

export function navForRole(role: Persona): NavItem[] {
  if (role === "STUDENT") {
    return [
      { label: "答疑", href: "/tutor" },
      { label: "错题本", href: "/error-book" },
      { label: "作业", href: "/assignments" },
      { label: "学情", href: "/portrait" },
    ];
  }
  if (role === "TEACHER") {
    return [
      { label: "班级", href: "/teacher" },
      { label: "作业", href: "/teacher" },
      { label: "学生", href: "/teacher" },
      { label: "AI 出卷", href: "/teacher#ai-paper", preview: true },
      { label: "AI 课件", href: "/teacher#ai-courseware", preview: true },
    ];
  }
  return [
    { label: "孩子", href: "/parent" },
    { label: "学情", href: "/parent" },
    { label: "隐私", href: "/account/privacy" },
  ];
}

export function RoleNav({ role }: { role: Persona }) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-full bg-white/70 p-1 shadow-sm ring-1 ring-slate-200 backdrop-blur">
      {navForRole(role).map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-950 hover:text-white"
        >
          {item.label}
          {item.preview ? <span className="ml-1 text-[10px] opacity-70">预览</span> : null}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Create shell and UI components**

Create `apps/web/components/shell/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import type { Persona } from "@prisma/client";
import Link from "next/link";
import { RoleNav } from "./RoleNav";
import { DemoModeBanner } from "./DemoModeBanner";

export function AppShell({
  role,
  title,
  children,
  demoMode = false,
}: {
  role: Persona;
  title?: string;
  children: ReactNode;
  demoMode?: boolean;
}) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc,#eef2f7)] text-slate-950">
      <header className="sticky top-0 z-20 border-b border-white/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">智教</Link>
          <RoleNav role={role} />
        </div>
      </header>
      {demoMode ? <DemoModeBanner /> : null}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {title ? <h1 className="mb-6 text-3xl font-semibold tracking-tight">{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}
```

Create `apps/web/components/shell/DemoModeBanner.tsx`:

```tsx
import Link from "next/link";

export function DemoModeBanner() {
  return (
    <div className="border-b border-slate-200 bg-white/60">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2 text-sm text-slate-600">
        <span>演示模式 · 初二数学三端闭环</span>
        <Link href="/demo" className="font-medium text-slate-950">返回演示中心</Link>
      </div>
    </div>
  );
}
```

Create `apps/web/components/ui/page-header.tsx`, `action-card.tsx`, `state-panel.tsx`, and `status-pill.tsx` with these exports:

```tsx
// page-header.tsx
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        {eyebrow ? <p className="text-sm font-medium text-slate-500">{eyebrow}</p> : null}
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">{title}</h1>
        {description ? <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
```

```tsx
// action-card.tsx
import Link from "next/link";

export function ActionCard({ href, title, description, label }: {
  href: string;
  title: string;
  description: string;
  label: string;
}) {
  return (
    <Link href={href} className="block rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-xl">
      <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      <span className="mt-6 inline-flex text-sm font-medium">{label} →</span>
    </Link>
  );
}
```

```tsx
// state-panel.tsx
import type { ReactNode } from "react";

export function StatePanel({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-[28px] bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description ? <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </section>
  );
}
```

```tsx
// status-pill.tsx
import type { ReactNode } from "react";

export function StatusPill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "blue" | "amber" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
  }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</span>;
}
```

- [ ] **Step 5: Add global polish tokens**

Append to `apps/web/app/globals.css`:

```css
:root {
  color-scheme: light;
}

* {
  letter-spacing: 0;
}

button,
a,
input,
textarea,
select {
  -webkit-tap-highlight-color: transparent;
}

::selection {
  background: #dbeafe;
  color: #0f172a;
}
```

- [ ] **Step 6: Verify unit test and typecheck**

Run:

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/unit/role-nav.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/components/shell apps/web/components/ui apps/web/app/globals.css apps/web/tests/unit/role-nav.test.ts
git commit -m "feat(web): add polished product shell components"
```

---

### Task 6: Student Path Polish

**Files:**
- Modify: `apps/web/app/(student)/tutor/page.tsx`
- Modify: `apps/web/components/TutorForm.tsx`
- Modify: `apps/web/app/(student)/error-book/page.tsx`
- Modify: `apps/web/app/(student)/error-book/error-book-list.tsx`
- Modify: `apps/web/app/(student)/error-book/[entryId]/entry-detail.tsx`
- Modify: `apps/web/app/(student)/portrait/page.tsx`
- Modify: `apps/web/app/(student)/portrait/portrait-view.tsx`
- Test: `apps/web/e2e/demo.spec.ts`

- [ ] **Step 1: Extend E2E for student entry**

Add to `apps/web/e2e/demo.spec.ts`:

```ts
test("student demo opens tutoring path", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: /学生体验/ }).click();
  await expect(page).toHaveURL(/\/tutor/);
  await expect(page.getByRole("heading", { name: /AI 答疑/ })).toBeVisible();
  await expect(page.getByTestId("tutor-input")).toContainText(/一次函数|函数/);
});
```

- [ ] **Step 2: Run E2E and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts`

Expected: FAIL because the tutor input is not demo-prefilled or the UI heading is still not polished.

- [ ] **Step 3: Polish tutor page**

Update `apps/web/app/(student)/tutor/page.tsx`:

```tsx
import { TutorForm } from "@/components/TutorForm";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { isDemoModeEnabled } from "@/server/demo/config";

export default function TutorPage({ searchParams }: { searchParams?: { demo?: string } }) {
  const demo = isDemoModeEnabled() && searchParams?.demo === "1";
  return (
    <AppShell role="STUDENT" demoMode={demo}>
      <PageHeader
        eyebrow="学生学习"
        title="AI 答疑"
        description="先看提示和方法，再展开完整讲解。适合把一道题变成一类题。"
      />
      <div className="mt-8 max-w-3xl">
        <TutorForm demo={demo} />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Add demo prefill and polished states to TutorForm**

Change `TutorForm` signature and initial state:

```tsx
const demoQuestion =
  "已知一次函数 y = 2x - 3 的图像与 x 轴交于点 A。求点 A 的坐标，并说明这个交点和方程 2x - 3 = 0 的关系。";

export function TutorForm({ demo = false }: { demo?: boolean }) {
  const [questionStem, setQ] = useState(demo ? demoQuestion : "");
```

Replace the outer wrapper class with:

```tsx
<div className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
```

Use button classes:

```tsx
className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
```

For the error block, use a calm state panel style:

```tsx
<div data-testid="tutor-error" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
```

- [ ] **Step 5: Polish error-book and portrait pages**

Apply `AppShell`, `PageHeader`, and `StatePanel` to:

- `apps/web/app/(student)/error-book/page.tsx`
- `apps/web/app/(student)/error-book/[entryId]/entry-detail.tsx`
- `apps/web/app/(student)/portrait/page.tsx`

When an error-book list is empty, show:

```tsx
<StatePanel
  title="还没有错题"
  description="完成一次错因分析后，系统会把需要巩固的题目放到这里。"
  action={<Link href="/tutor" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white">去答疑</Link>}}
/>
```

- [ ] **Step 6: Verify student path**

Run:

```bash
pnpm.cmd --filter @zhijiao/web typecheck
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/app/\(student\)/tutor apps/web/components/TutorForm.tsx apps/web/app/\(student\)/error-book apps/web/app/\(student\)/portrait apps/web/e2e/demo.spec.ts
git commit -m "feat(web): polish student demo path"
```

---

### Task 7: Teacher Path Polish

**Files:**
- Modify: `apps/web/app/teacher/page.tsx`
- Modify: `apps/web/app/teacher/classes/[classroomId]/page.tsx`
- Modify: `apps/web/app/teacher/classes/[classroomId]/assignments/new/page.tsx`
- Modify: `apps/web/app/teacher/classes/[classroomId]/assignments/new/generation-form.tsx`
- Modify: `apps/web/app/teacher/assignments/[assignmentId]/edit/page.tsx`
- Modify: `apps/web/app/teacher/assignments/[assignmentId]/edit/draft-editor.tsx`
- Modify: `apps/web/app/teacher/assignments/[assignmentId]/page.tsx`
- Modify: `apps/web/app/teacher/assignments/[assignmentId]/grading-panel.tsx`
- Test: `apps/web/e2e/demo.spec.ts`

- [ ] **Step 1: Extend E2E for teacher demo**

Add to `apps/web/e2e/demo.spec.ts`:

```ts
test("teacher demo opens class workspace and shows next-stage AI cards", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: /教师体验/ }).click();
  await expect(page).toHaveURL(/\/teacher\/classes\//);
  await expect(page.getByRole("heading", { name: /初二 3 班/ })).toBeVisible();
  await expect(page.getByText("AI 出卷")).toBeVisible();
  await expect(page.getByText("AI 课件")).toBeVisible();
  await expect(page.getByRole("link", { name: /生成分层作业/ })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts`

Expected: FAIL because the teacher page does not show the polished content and preview cards.

- [ ] **Step 3: Polish teacher home**

Wrap `apps/web/app/teacher/page.tsx` in `AppShell role="TEACHER"` and use `PageHeader`. Replace "Teacher Workspace" with "教师工作台". Use `ActionCard` for each classroom. Empty classrooms must use `StatePanel` with:

```tsx
<StatePanel
  title="还没有班级"
  description="演示数据未准备好。请运行 pnpm demo:reset 后再进入教师体验。"
/>
```

- [ ] **Step 4: Polish class page and add Plan 17/18 preview cards**

In `apps/web/app/teacher/classes/[classroomId]/page.tsx`, add these preview cards in the right column or below the class diagnosis:

```tsx
<section id="ai-paper" className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
  <p className="text-sm font-medium text-slate-500">Plan 17</p>
  <h2 className="mt-2 text-xl font-semibold tracking-tight">AI 出卷</h2>
  <p className="mt-3 text-sm leading-6 text-slate-600">
    将支持按年级、知识点、题型、难度和题量生成练习卷，并带答案解析与双向细目表。
  </p>
</section>

<section id="ai-courseware" className="rounded-[28px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
  <p className="text-sm font-medium text-slate-500">Plan 18</p>
  <h2 className="mt-2 text-xl font-semibold tracking-tight">AI 课件</h2>
  <p className="mt-3 text-sm leading-6 text-slate-600">
    将支持按知识点生成课堂导入、讲解结构、例题、易错点和课堂练习。
  </p>
</section>
```

Make the main assignment CTA label "生成分层作业".

- [ ] **Step 5: Polish assignment generation/edit/grading pages**

For each teacher assignment page:

- Use `AppShell role="TEACHER"`.
- Use `PageHeader`.
- Use rounded white panels with `rounded-[28px] bg-white shadow-sm ring-1 ring-slate-200`.
- Use a single primary action per page:
  - generation: "生成草稿",
  - edit: "发布作业",
  - grading: "保存批改".
- Make state conflict errors read: "作业状态已变化，请刷新后再继续。"

- [ ] **Step 6: Verify teacher path**

Run:

```bash
pnpm.cmd --filter @zhijiao/web typecheck
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-state-machine.test.ts tests/integration/assignment-error-book-writeback.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/app/teacher apps/web/e2e/demo.spec.ts
git commit -m "feat(web): polish teacher demo path"
```

---

### Task 8: Parent Path Polish

**Files:**
- Modify: `apps/web/app/parent/page.tsx`
- Modify: `apps/web/app/parent/parent-view.tsx`
- Modify: `apps/web/app/parent/children/[childId]/page.tsx`
- Modify: `apps/web/app/parent/children/[childId]/child-portrait.tsx`
- Test: `apps/web/e2e/demo.spec.ts`

- [ ] **Step 1: Extend E2E for parent demo**

Add to `apps/web/e2e/demo.spec.ts`:

```ts
test("parent demo opens calm learning portrait", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: /家长体验/ }).click();
  await expect(page).toHaveURL(/\/parent/);
  await expect(page.getByRole("heading", { name: /家长/ })).toBeVisible();
  await expect(page.getByText(/掌握较稳|正在巩固|重点关注/)).toBeVisible();
  await expect(page.getByText(/排名/)).toHaveCount(0);
});
```

- [ ] **Step 2: Run E2E and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts`

Expected: FAIL because parent pages are not yet polished or seeded portrait data is incomplete.

- [ ] **Step 3: Polish parent home**

Update `apps/web/app/parent/page.tsx`:

```tsx
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { isDemoModeEnabled } from "@/server/demo/config";
import { ParentView } from "./parent-view";

export default function ParentHome() {
  return (
    <AppShell role="PARENT" demoMode={isDemoModeEnabled()}>
      <PageHeader
        eyebrow="家长视角"
        title="孩子的近期学习"
        description="只呈现必要的巩固方向，不做排名和焦虑化提醒。"
      />
      <div className="mt-8">
        <ParentView />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Polish parent components**

In `parent-view.tsx` and `child-portrait.tsx`:

- Use `ActionCard` for child cards.
- Use calm headings:
  - "掌握较稳",
  - "正在巩固",
  - "重点关注".
- Remove or rewrite any copy that implies ranking, exact scores, or fear.
- Empty child list state:

```tsx
<StatePanel
  title="还没有绑定孩子"
  description="演示环境会自动准备绑定关系。请运行 pnpm demo:reset 后再试一次。"
/>
```

- [ ] **Step 5: Verify parent path**

Run:

```bash
pnpm.cmd --filter @zhijiao/web typecheck
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/family-router.test.ts tests/integration/analytics-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/app/parent apps/web/e2e/demo.spec.ts
git commit -m "feat(web): polish parent demo path"
```

---

### Task 9: Cross-path State Handling and Compliance Copy

**Files:**
- Modify: `apps/web/app/providers.tsx`
- Create: `apps/web/lib/error-copy.ts`
- Modify: main path pages touched in Tasks 6-8
- Test: `apps/web/tests/integration/middleware-guard.test.ts`
- Test: `apps/web/tests/integration/guardian-consent-gate.test.ts`

- [ ] **Step 1: Add client error copy helper test**

Create `apps/web/tests/unit/error-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { copyForReason } from "@/lib/error-copy";

describe("error copy", () => {
  it("maps insufficient balance", () => {
    expect(copyForReason("INSUFFICIENT_BALANCE")).toContain("余额不足");
  });

  it("maps guardian consent", () => {
    expect(copyForReason("GUARDIAN_CONSENT_REQUIRED")).toContain("监护人同意");
  });

  it("uses a recoverable default", () => {
    expect(copyForReason("SOMETHING_UNKNOWN")).toContain("稍后再试");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/error-copy.test.ts`

Expected: FAIL because `copyForReason` does not exist.

- [ ] **Step 3: Add error copy helper**

Create `apps/web/lib/error-copy.ts`:

```ts
export function copyForReason(reason: string | null | undefined): string {
  if (reason === "INSUFFICIENT_BALANCE") return "余额不足，请先为钱包充值后再继续。";
  if (reason === "GUARDIAN_CONSENT_REQUIRED") return "需要监护人同意后才能继续使用。";
  if (reason === "NO_SESSION") return "请先登录后再继续。";
  if (reason === "PERMISSION_DENIED") return "当前账号不能访问这项内容。";
  if (reason === "ASSIGNMENT_STATE_CHANGED") return "作业状态已变化，请刷新后再继续。";
  return "操作没有完成，请稍后再试。";
}
```

- [ ] **Step 4: Apply copy to user-facing states**

Replace raw `e.message` or internal reason output on the main demo paths with `copyForReason(reason)`. Keep detailed internal reasons in tests and logs only.

- [ ] **Step 5: Verify compliance guard tests**

Run:

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/unit/error-copy.test.ts tests/integration/middleware-guard.test.ts tests/integration/guardian-consent-gate.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/lib/error-copy.ts apps/web/tests/unit/error-copy.test.ts apps/web/app apps/web/components
git commit -m "feat(web): polish demo error states and compliant copy"
```

---

### Task 10: Demo E2E, Docs, and Final Regression

**Files:**
- Modify: `apps/web/e2e/demo.spec.ts`
- Modify: `apps/web/e2e/global-setup.ts`
- Modify: `docs/claude/implementation-state.md`
- Modify: `docs/claude/merge-verification.md`

- [ ] **Step 1: Make demo E2E deterministic**

In `apps/web/e2e/global-setup.ts`, ensure demo data exists before tests:

```ts
import { resetDemoData } from "../server/demo/seed";
import { prisma } from "@zhijiao/db";

if (process.env.DEMO_MODE === "1") {
  await resetDemoData(prisma);
}
```

Place it after the existing E2E database reset/seed sequence so demo records are the final state.

- [ ] **Step 2: Complete demo E2E**

Ensure `apps/web/e2e/demo.spec.ts` covers:

- `/demo` shows three role entries.
- Student quick entry reaches tutor with demo content.
- Teacher quick entry reaches class page and shows weak-point/workflow UI.
- Parent quick entry reaches parent view and avoids ranking copy.

Keep each test independent by starting from `/demo`.

- [ ] **Step 3: Update implementation-state docs**

Append to `docs/claude/implementation-state.md`:

```markdown
**Demo-ready product hardening status (Plan 16):**
- `/demo` is gated by `DEMO_MODE=1` and issues real sessions for fixed demo identities.
- Demo data is reset by `pnpm demo:reset` and verified by `pnpm verify:demo`.
- Main student/teacher/parent paths share the 初二数学 demo story and use the polished product shell.
- AI 出卷 and AI 课件 are shown only as Plan 17/18 preview entries; no production workflow is implemented in Plan 16.
```

- [ ] **Step 4: Update merge verification docs**

Append to `docs/claude/merge-verification.md`:

```markdown
## Plan 16 demo probes

- Run `pnpm demo:reset` and `pnpm verify:demo`.
- Open `/demo` with `DEMO_MODE=1` and confirm student, teacher, and parent entries work.
- Confirm `/demo` is blocked when `DEMO_MODE=0`.
- Run `pnpm --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts`.
- Confirm AI 出卷 and AI 课件 are preview-only entries in Plan 16.
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm.cmd demo:reset
pnpm.cmd verify:demo
pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts tests/integration/demo-seed.test.ts tests/integration/demo-entry.test.ts tests/unit/role-nav.test.ts tests/unit/error-copy.test.ts
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/demo.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run full regression**

Run:

```bash
pnpm.cmd typecheck
pnpm.cmd test
```

Expected: PASS. If a pre-existing unrelated test fails, capture the exact failure and stop for review.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/e2e/demo.spec.ts apps/web/e2e/global-setup.ts docs/claude/implementation-state.md docs/claude/merge-verification.md
git commit -m "docs(web): document Plan 16 demo hardening verification"
```

---

## Implementation Order

1. Task 1 gates demo mode safely.
2. Task 2 creates deterministic data.
3. Task 3 enables quick role entry.
4. Task 4 adds `/demo`.
5. Task 5 creates the shared shell and component language.
6. Task 6 polishes the student path.
7. Task 7 polishes the teacher path.
8. Task 8 polishes the parent path.
9. Task 9 unifies state and compliance copy.
10. Task 10 locks the demo with E2E and docs.

Do not start Plan 17 or Plan 18 work inside Plan 16. The only Plan 17/18 surface in Plan 16 is preview cards and navigation labels.
