# 靶向训练 (Targeted Training) v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, weak-point-driven practice session that reuses the student's own error-book questions + variants, ordered by FOCUS KPs, with self-check and a lightweight mastery write-back that closes the `靶向训练 → 学情` loop.

**Architecture:** A new `TrainingAttempt` table records self-checked attempts; the analytics core gains one additive `sourceWeight` field so `profileForStudent` can blend (down-weighted) training attempts with teacher-graded `AssignmentPerformance`. A free `training.*` tRPC router assembles sessions from existing error/variant pools (falling back to the due-review queue) and records attempts, reusing the spaced-review ladder. A `/training` student page drives the session.

**Tech Stack:** Next.js 14 App Router, tRPC + React Query, Prisma/Postgres, Vitest (node env; `.tsx` render tests via `react-dom/server`), Playwright. Spec: `docs/superpowers/specs/2026-06-03-targeted-training-design.md`.

**Test notes:** Vitest runs in node env (no jsdom). Pure functions tested directly; DB-backed logic tested via `apps/web/tests/integration/*` using the `zhijiao_test_web` DB through `appRouter.createCaller(makeCtx(userId))`. After Task 1's migration, **re-run `pnpm test:setup`** so the test DBs gain `training_attempts` before integration tests.

---

## File Structure

- Modify `packages/db/prisma/schema.prisma` — add `TrainingAttempt` model + `TrainingItemSource` enum (Task 1).
- Create `packages/db/prisma/migrations/<ts>_training_attempt/migration.sql` (Task 1, via `prisma migrate`).
- Modify `packages/analytics/src/types.ts` — add `PerfSample.sourceWeight?` (Task 2).
- Modify `packages/analytics/src/core.ts` — multiply `sourceWeight` into the decay weight (Task 2).
- Modify `packages/analytics/src/queries.ts` — blend `TrainingAttempt` rows into `profileForStudent` samples (Task 3).
- Modify `apps/web/server/lib/error-book.ts` — extract `advanceReviewLadder` helper (Task 4).
- Modify `apps/web/server/routers/error.ts` — `markReviewed` uses the helper (Task 4).
- Create `apps/web/server/lib/training.ts` — session assembly + ownership helpers (Task 5).
- Create `apps/web/server/routers/training.ts` — `training.startSession` / `submitAttempt` (Task 5).
- Modify `apps/web/server/routers/_root.ts` — register `training` (Task 5).
- Create `apps/web/app/(student)/training/page.tsx` + `session-view.tsx` (Task 6).
- Modify `apps/web/components/shell/RoleNav.tsx` — add 训练 nav (Task 6).
- Modify `apps/web/app/(student)/portrait/portrait-view.tsx` — CTA to `/training` (Task 6).
- Create `apps/web/e2e/targeted-training.spec.ts` (Task 7).

---

### Task 1: TrainingAttempt schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration via `prisma migrate dev`

- [ ] **Step 1: Add the model + enum**

Append to `packages/db/prisma/schema.prisma` (near the other student-facing models; place the enum with the other enums):

```prisma
enum TrainingItemSource {
  ERROR_BOOK
  VARIANT
}

model TrainingAttempt {
  id            String                @id @default(cuid())
  sessionId     String                @map("session_id")
  studentUserId String                @map("student_user_id")
  questionId    String                @map("question_id")
  source        TrainingItemSource
  gradeStatus   AssignmentGradeStatus
  kpIds         String[]              @default([]) @map("kp_ids")
  createdAt     DateTime              @default(now()) @map("created_at")

  @@index([studentUserId, createdAt])
  @@map("training_attempts")
}
```

(`AssignmentGradeStatus` is the existing enum with `CORRECT/PARTIAL/WRONG/UNGRADED`; v1 writes only `CORRECT`/`WRONG`.)

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @zhijiao/db exec prisma migrate dev --name training_attempt --create-only`
Then apply: `pnpm db:migrate` (on Windows use the docker-exec path from README if `migrate dev` can't reach the container).
Expected: a new `migrations/<ts>_training_attempt/migration.sql` creating `training_attempts` + the enum.

- [ ] **Step 3: Regenerate client + typecheck**

Run: `pnpm --filter @zhijiao/db exec prisma generate` then `pnpm --filter @zhijiao/db typecheck`
Expected: PASS; `prisma.trainingAttempt` is now available on the client.

- [ ] **Step 4: Re-migrate the test DBs**

Run: `pnpm test:setup`
Expected: all 6 per-package test DBs (incl. `zhijiao_test_web`) gain `training_attempts`. Required before any integration test in later tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): TrainingAttempt table + TrainingItemSource enum"
```

---

### Task 2: analytics core — sourceWeight

**Files:**
- Modify: `packages/analytics/src/types.ts`
- Modify: `packages/analytics/src/core.ts`
- Test: `packages/analytics/tests/core.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `packages/analytics/tests/core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aggregateMastery } from "../src/core.js";

describe("aggregateMastery sourceWeight", () => {
  const kpMeta = new Map([["kp1", "KP One"]]);

  it("down-weights a sample so it contributes less to the weighted score", () => {
    // One full-weight WRONG + one down-weighted CORRECT. With sourceWeight=0.5
    // on the CORRECT sample, the blended score must stay below the 0.5 a
    // full-weight pair would produce.
    const res = aggregateMastery({
      samples: [
        { kpIds: ["kp1"], gradeStatus: "WRONG", ageDays: 0 },
        { kpIds: ["kp1"], gradeStatus: "CORRECT", ageDays: 0, sourceWeight: 0.5 },
      ],
      errors: [],
      kpMeta,
      halfLifeDays: 30,
    });
    const m = res.masteries.find((x) => x.kpId === "kp1")!;
    // wScore = 0*1 + 1*0.5 = 0.5 ; wSum = 1 + 0.5 = 1.5 ; score = 0.333…
    expect(m.score).toBeLessThan(0.5);
    expect(m.weightedSampleSize).toBeCloseTo(1.5, 4);
  });

  it("defaults sourceWeight to 1 (existing behavior unchanged)", () => {
    const res = aggregateMastery({
      samples: [
        { kpIds: ["kp1"], gradeStatus: "WRONG", ageDays: 0 },
        { kpIds: ["kp1"], gradeStatus: "CORRECT", ageDays: 0 },
      ],
      errors: [],
      kpMeta,
      halfLifeDays: 30,
    });
    const m = res.masteries.find((x) => x.kpId === "kp1")!;
    expect(m.score).toBeCloseTo(0.5, 4);
    expect(m.weightedSampleSize).toBeCloseTo(2, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/analytics test -- tests/core.test.ts`
Expected: FAIL — TS/runtime: `sourceWeight` not on `PerfSample`, and the down-weight assertion fails (currently weighted size would be 2).

- [ ] **Step 3: Add the field**

In `packages/analytics/src/types.ts`, extend `PerfSample`:

```ts
export interface PerfSample {
  kpIds: string[];
  gradeStatus: GradeStatusSignal;
  ageDays: number; // now - createdAt, in days (>= 0)
  sourceWeight?: number; // multiplier on the decay weight; default 1.0 (teacher-graded). Self-practice uses < 1.
}
```

- [ ] **Step 4: Multiply it in**

In `packages/analytics/src/core.ts`, inside `aggregateMastery`'s sample loop, change the weight line:

```ts
  for (const s of args.samples) {
    const w = decayWeight(s.ageDays, args.halfLifeDays) * (s.sourceWeight ?? 1);
    const sc = scoreOf(s.gradeStatus);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zhijiao/analytics test -- tests/core.test.ts`
Expected: PASS (all core tests, incl. the two new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/analytics/src/types.ts packages/analytics/src/core.ts packages/analytics/tests/core.test.ts
git commit -m "feat(analytics): PerfSample.sourceWeight down-weights blended samples"
```

---

### Task 3: analytics queries — blend TrainingAttempt into the profile

**Files:**
- Modify: `packages/analytics/src/queries.ts`
- Test: `apps/web/tests/integration/training-writeback.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/web/tests/integration/training-writeback.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { profileForStudent } from "@zhijiao/analytics";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function makeKp() {
  const subjectId = randomUUID();
  const kpId = randomUUID();
  await prisma.subject.create({ data: { id: subjectId, code: `s-${kpId}`, name: "数学" } });
  await prisma.knowledgePoint.create({
    data: { id: kpId, subjectId, code: `k-${kpId}`, name: "一次函数与一元一次方程关系" },
  });
  return kpId;
}

describe("profileForStudent blends TrainingAttempt", () => {
  it("a CORRECT training attempt raises the KP score (down-weighted)", async () => {
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const kpId = await makeKp();

    // Baseline: one teacher-graded WRONG → score 0, tier FOCUS.
    await prisma.assignment.create({
      data: { id: randomUUID(), classroomId: null as never, teacherUserId: userId, title: "x", status: "PUBLISHED" },
    }).catch(() => {});

    // Simpler: seed a single AssignmentPerformance WRONG directly.
    await prisma.assignmentPerformance.create({
      data: {
        id: randomUUID(),
        assignmentId: randomUUID(),
        studentUserId: userId,
        itemId: randomUUID(),
        gradeStatus: "WRONG",
        kpIds: [kpId],
      },
    });

    const before = await profileForStudent(prisma, { userId, window: "ALL" });
    const beforeScore = before.masteries.find((m) => m.kpId === kpId)?.score ?? 0;

    // Add a CORRECT training attempt on the same KP.
    await prisma.trainingAttempt.create({
      data: {
        sessionId: randomUUID(),
        studentUserId: userId,
        questionId: randomUUID(),
        source: "ERROR_BOOK",
        gradeStatus: "CORRECT",
        kpIds: [kpId],
      },
    });

    const after = await profileForStudent(prisma, { userId, window: "ALL" });
    const afterScore = after.masteries.find((m) => m.kpId === kpId)?.score ?? 0;

    expect(afterScore).toBeGreaterThan(beforeScore);
  });
});
```

(If `assignmentPerformance.create` requires FKs, this test only needs the columns `profileForStudent` reads — `studentUserId`, `kpIds`, `gradeStatus`, `createdAt`; `assignmentId`/`itemId` are plain strings in the schema with no enforced FK to a row, mirroring the demo seed which sets them to free ids. Drop the stray `assignment.create` block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/training-writeback.test.ts`
Expected: FAIL — `afterScore` equals `beforeScore` because `profileForStudent` ignores `TrainingAttempt`.

- [ ] **Step 3: Blend training attempts into the profile**

In `packages/analytics/src/queries.ts`, add a constant and a second query in `profileForStudent`. After the `perf` query (line ~47-53), add:

```ts
  const TRAINING_SOURCE_WEIGHT = 0.5;
  const training = await db.trainingAttempt.findMany({
    where: {
      studentUserId: args.userId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
    },
    select: { kpIds: true, gradeStatus: true, createdAt: true },
  });
```

Then extend the `samples` construction (currently lines ~61-67) to concat the training samples:

```ts
  const samples: PerfSample[] = [
    ...perf
      .filter((p) => p.gradeStatus !== "UNGRADED")
      .map((p) => ({
        kpIds: p.kpIds,
        gradeStatus: p.gradeStatus as PerfSample["gradeStatus"],
        ageDays: ageDays(p.createdAt, now),
      })),
    ...training
      .filter((t) => t.gradeStatus !== "UNGRADED")
      .map((t) => ({
        kpIds: t.kpIds,
        gradeStatus: t.gradeStatus as PerfSample["gradeStatus"],
        ageDays: ageDays(t.createdAt, now),
        sourceWeight: TRAINING_SOURCE_WEIGHT,
      })),
  ];
```

(`classDiagnosis` is intentionally NOT changed — self-practice does not feed class diagnosis.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/training-writeback.test.ts`
Expected: PASS — `afterScore > beforeScore`.

- [ ] **Step 5: Commit**

```bash
git add packages/analytics/src/queries.ts apps/web/tests/integration/training-writeback.test.ts
git commit -m "feat(analytics): blend down-weighted TrainingAttempt into student profile"
```

---

### Task 4: extract shared review-ladder advance

**Files:**
- Modify: `apps/web/server/lib/error-book.ts`
- Modify: `apps/web/server/routers/error.ts`
- Test: existing `apps/web/tests/integration/*error*` suites (regression guard)

- [ ] **Step 1: Add the helper**

In `apps/web/server/lib/error-book.ts`, after `nextReviewAtAfter` (line ~39), add:

```ts
import type { PrismaClient } from "@prisma/client";
// (PrismaClient is already imported at the top of this file; reuse it.)

// Advance an ACTIVE error entry one rung along the fixed 5-step review ladder.
// Shared by error.markReviewed and training.submitAttempt so the spacing logic
// lives in exactly one place.
export async function advanceReviewLadder(
  db: PrismaClient,
  entryId: string,
  reviewCount: number,
  now: Date,
) {
  const reviewCountAfter = reviewCount + 1;
  return db.errorBookEntry.update({
    where: { id: entryId },
    data: {
      reviewCount: reviewCountAfter,
      lastReviewedAt: now,
      nextReviewAt: nextReviewAtAfter(reviewCountAfter, now),
    },
  });
}
```

(`PrismaClient` is already imported in this file — do not add a duplicate import; the comment above is illustrative.)

- [ ] **Step 2: Use it in markReviewed**

In `apps/web/server/routers/error.ts`, replace the inline update in `markReviewed` (lines ~280-289) with:

```ts
      const now = new Date();
      const updated = await advanceReviewLadder(
        ctx.db,
        ctx.entry.id,
        ctx.entry.reviewCount,
        now,
      );
      return { entry: toEntryView(updated) };
```

Add `advanceReviewLadder` to the existing import from `../lib/error-book.js` (alongside `nextReviewAtAfter`, `upsertEntryOnDiagnose`, etc.).

- [ ] **Step 3: Run the error-book regression suites**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/error-book-spaced-review.test.ts`
(or the suite that covers `markReviewed`; if unsure run `pnpm --filter @zhijiao/web test -- error`).
Expected: PASS — behavior unchanged (the helper produces the identical update).

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/lib/error-book.ts apps/web/server/routers/error.ts
git commit -m "refactor(web): extract advanceReviewLadder shared by markReviewed"
```

---

### Task 5: training router (startSession + submitAttempt)

**Files:**
- Create: `apps/web/server/lib/training.ts`
- Create: `apps/web/server/routers/training.ts`
- Modify: `apps/web/server/routers/_root.ts`
- Test: `apps/web/tests/integration/training-router.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/web/tests/integration/training-router.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { makeCtx } from "./_ctx"; // existing helper used by other integration tests

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function seedFocusEntry(userId: string) {
  const subjectId = randomUUID();
  const kpId = randomUUID();
  const questionId = randomUUID();
  await prisma.subject.create({ data: { id: subjectId, code: `s-${kpId}`, name: "数学" } });
  await prisma.knowledgePoint.create({ data: { id: kpId, subjectId, code: `k-${kpId}`, name: "一次函数与一元一次方程关系" } });
  await prisma.question.create({
    data: { id: questionId, subjectId, stemMd: "解方程 2x+1=0 并说明与图像交点关系", type: "CALCULATION", status: "PUBLISHED", source: "USER_ADHOC", createdByUserId: userId },
  });
  await prisma.questionKPLink.create({ data: { questionId, kpId, weight: 1 } });
  // Make the KP FOCUS via a teacher-graded WRONG sample.
  await prisma.assignmentPerformance.create({
    data: { id: randomUUID(), assignmentId: randomUUID(), studentUserId: userId, itemId: randomUUID(), gradeStatus: "WRONG", kpIds: [kpId] },
  });
  // Put the question in the student's ACTIVE error book.
  await prisma.errorBookEntry.create({
    data: { id: randomUUID(), userId, questionId, status: "ACTIVE", rootCause: "CALCULATION_SLIP", rootCauseReasoning: "漏了 y=0", nextReviewAt: new Date() },
  });
  return { kpId, questionId };
}

describe("training router", () => {
  it("startSession returns FOCUS-KP items from the student's error book", async () => {
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const { questionId } = await seedFocusEntry(userId);

    const caller = appRouter.createCaller(makeCtx(userId));
    const session = await caller.training.startSession({ window: "ALL" });

    expect(session.status).toBe("OK");
    expect(session.items.map((i) => i.questionId)).toContain(questionId);
    expect(session.sessionId).toBeTruthy();
  });

  it("submitAttempt records a TrainingAttempt and advances the review ladder on KNOW", async () => {
    const userId = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const { kpId, questionId } = await seedFocusEntry(userId);

    const caller = appRouter.createCaller(makeCtx(userId));
    const session = await caller.training.startSession({ window: "ALL" });
    await caller.training.submitAttempt({
      sessionId: session.sessionId,
      questionId,
      source: "ERROR_BOOK",
      kpIds: [kpId],
      selfResult: "KNOW",
    });

    const attempts = await prisma.trainingAttempt.findMany({ where: { studentUserId: userId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.gradeStatus).toBe("CORRECT");
    const entry = await prisma.errorBookEntry.findFirstOrThrow({ where: { userId, questionId } });
    expect(entry.reviewCount).toBe(1);
    expect(entry.lastReviewedAt).not.toBeNull();
  });

  it("submitAttempt rejects a questionId the caller does not own", async () => {
    const userId = randomUUID();
    const strangerQ = randomUUID();
    await prisma.user.create({ data: { id: userId, name: "学生", persona: "STUDENT" } });
    const caller = appRouter.createCaller(makeCtx(userId));
    await expect(
      caller.training.submitAttempt({
        sessionId: randomUUID(), questionId: strangerQ, source: "ERROR_BOOK", kpIds: [], selfResult: "UNSURE",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

(Check the exact ctx helper name/import path used by neighbors, e.g. `apps/web/tests/integration/analytics-router.test.ts` imports `makeCtx`; match it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/training-router.test.ts`
Expected: FAIL — `caller.training` is undefined.

- [ ] **Step 3: Implement the session-assembly lib**

```ts
// apps/web/server/lib/training.ts
import "server-only";
import type { PrismaClient } from "@prisma/client";
import { profileForStudent } from "@zhijiao/analytics";
import type { AnalyticsWindow } from "@zhijiao/analytics";

export const SESSION_ITEM_CAP = 8;
const MIN_TARGETED = 3; // below this, top up from the due-review queue

export type TrainingItemSourceT = "ERROR_BOOK" | "VARIANT";

export interface TrainingItem {
  questionId: string;
  source: TrainingItemSourceT;
  kpId: string | null;
  stemMd: string;
  solutionMd: string | null;
  level: string | null; // L1/L2/L3 for variants, null for error-book originals
}

export async function buildTrainingSession(
  db: PrismaClient,
  userId: string,
  window: AnalyticsWindow,
): Promise<{ status: "OK" | "INSUFFICIENT_DATA"; items: TrainingItem[]; targetKpNames: string[] }> {
  const profile = await profileForStudent(db, { userId, window });
  const focus = profile.masteries.filter((m) => m.tier === "FOCUS");
  const targets = (focus.length > 0 ? focus : profile.masteries.filter((m) => m.tier === "PROGRESSING")).slice(0, 3);
  const focusKpIds = targets.map((m) => m.kpId);
  const targetKpNames = targets.map((m) => m.kpName);

  const items: TrainingItem[] = [];
  if (focusKpIds.length > 0) {
    const entries = await db.errorBookEntry.findMany({
      where: { userId, status: "ACTIVE", question: { knowledgePoints: { some: { kpId: { in: focusKpIds } } } } },
      include: { question: { include: { answer: true, knowledgePoints: { select: { kpId: true } } } } },
      orderBy: { nextReviewAt: "asc" },
    });
    for (const e of entries) {
      const kpId = e.question.knowledgePoints.find((l) => focusKpIds.includes(l.kpId))?.kpId ?? null;
      items.push({ questionId: e.questionId, source: "ERROR_BOOK", kpId, stemMd: e.question.stemMd, solutionMd: e.question.answer?.solutionMd ?? null, level: null });
    }
    const variants = await db.variantItem.findMany({
      where: { group: { userId }, question: { knowledgePoints: { some: { kpId: { in: focusKpIds } } } } },
      include: { question: { include: { knowledgePoints: { select: { kpId: true } } } } },
      orderBy: [{ groupId: "asc" }, { position: "asc" }],
    });
    for (const v of variants) {
      const kpId = v.question.knowledgePoints.find((l) => focusKpIds.includes(l.kpId))?.kpId ?? null;
      items.push({ questionId: v.questionId, source: "VARIANT", kpId, stemMd: v.stemMd, solutionMd: v.solutionMd, level: v.level });
    }
  }

  // Cold-start fallback: top up from the due-review queue so the session is
  // never a near-empty/paywall screen.
  if (items.length < MIN_TARGETED) {
    const seen = new Set(items.map((i) => i.questionId));
    const due = await db.errorBookEntry.findMany({
      where: { userId, status: "ACTIVE", nextReviewAt: { lte: new Date() } },
      include: { question: { include: { answer: true } } },
      orderBy: { nextReviewAt: "asc" },
      take: SESSION_ITEM_CAP,
    });
    for (const e of due) {
      if (seen.has(e.questionId)) continue;
      items.push({ questionId: e.questionId, source: "ERROR_BOOK", kpId: null, stemMd: e.question.stemMd, solutionMd: e.question.answer?.solutionMd ?? null, level: null });
    }
  }

  const capped = items.slice(0, SESSION_ITEM_CAP);
  return {
    status: capped.length === 0 ? "INSUFFICIENT_DATA" : "OK",
    items: capped,
    targetKpNames,
  };
}

// Ownership: the caller may only attempt a question that is in their own error
// book or among their own variant items.
export async function ownsTrainingQuestion(db: PrismaClient, userId: string, questionId: string): Promise<boolean> {
  const entry = await db.errorBookEntry.findFirst({ where: { userId, questionId }, select: { id: true } });
  if (entry) return true;
  const variant = await db.variantItem.findFirst({ where: { questionId, group: { userId } }, select: { id: true } });
  return variant != null;
}
```

- [ ] **Step 4: Implement the router**

```ts
// apps/web/server/routers/training.ts
import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { consentGatedProcedure, router } from "../trpc.js";
import { advanceReviewLadder } from "../lib/error-book.js";
import { buildTrainingSession, ownsTrainingQuestion } from "../lib/training.js";

const windowSchema = z.enum(["D30", "D90", "ALL"]).default("ALL");

export const trainingRouter = router({
  startSession: consentGatedProcedure
    .input(z.object({ window: windowSchema }).default({ window: "ALL" }))
    .query(async ({ ctx, input }) => {
      const built = await buildTrainingSession(ctx.db, ctx.auth.userId, input.window);
      return { sessionId: randomUUID(), ...built };
    }),

  submitAttempt: consentGatedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        questionId: z.string().min(1),
        source: z.enum(["ERROR_BOOK", "VARIANT"]),
        kpIds: z.array(z.string().min(1)).max(8),
        selfResult: z.enum(["KNOW", "UNSURE"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;
      if (!(await ownsTrainingQuestion(ctx.db, userId, input.questionId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "题目不存在", cause: { reason: "TRAINING_QUESTION_NOT_FOUND" } });
      }
      const gradeStatus = input.selfResult === "KNOW" ? "CORRECT" : "WRONG";
      await ctx.db.trainingAttempt.create({
        data: {
          sessionId: input.sessionId,
          studentUserId: userId,
          questionId: input.questionId,
          source: input.source,
          gradeStatus,
          kpIds: input.kpIds,
        },
      });
      // On KNOW for an ACTIVE error entry, advance its spaced-review ladder.
      if (gradeStatus === "CORRECT" && input.source === "ERROR_BOOK") {
        const entry = await ctx.db.errorBookEntry.findFirst({
          where: { userId, questionId: input.questionId, status: "ACTIVE" },
          select: { id: true, reviewCount: true },
        });
        if (entry) await advanceReviewLadder(ctx.db, entry.id, entry.reviewCount, new Date());
      }
      return { ok: true };
    }),
});
```

- [ ] **Step 5: Register the router**

In `apps/web/server/routers/_root.ts` add the import and key:

```ts
import { trainingRouter } from "./training.js";
// ...
export const appRouter = router({
  // ...existing...
  training: trainingRouter,
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/training-router.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/server/lib/training.ts apps/web/server/routers/training.ts apps/web/server/routers/_root.ts apps/web/tests/integration/training-router.test.ts
git commit -m "feat(web): training.startSession + submitAttempt (free, reuse-first)"
```

---

### Task 6: /training UI + nav + portrait CTA

**Files:**
- Create: `apps/web/app/(student)/training/page.tsx`
- Create: `apps/web/app/(student)/training/session-view.tsx`
- Modify: `apps/web/components/shell/RoleNav.tsx`
- Modify: `apps/web/app/(student)/portrait/portrait-view.tsx`

- [ ] **Step 1: Add the page (server component)**

```tsx
// apps/web/app/(student)/training/page.tsx
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { SessionView } from "./session-view";

export const dynamic = "force-dynamic";

export default function TrainingPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="学生学习"
        title="靶向训练"
        description="围绕你的重点巩固方向，把做错过的题再练成一类题。先想方法，再看解析。"
      />
      <div className="mt-6 max-w-3xl">
        <SessionView />
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Add the session client component**

```tsx
// apps/web/app/(student)/training/session-view.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { SkeletonList } from "@/components/ui/skeleton";

export function SessionView() {
  const session = trpc.training.startSession.useQuery({ window: "ALL" });
  const submit = trpc.training.submitAttempt.useMutation();
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const sessionId = session.data?.sessionId;
  const items = useMemo(() => session.data?.items ?? [], [session.data]);

  if (session.isLoading) return <SkeletonList rows={3} />;
  if (session.isError) return <StatePanel title="加载失败" description="请稍后再试。" />;
  if (!session.data || session.data.status === "INSUFFICIENT_DATA" || items.length === 0) {
    return (
      <StatePanel
        title="还没有足够的训练材料"
        description="先在答疑或作业里积累一些错题，这里会按你的重点巩固方向组成练习。"
        action={<Link href="/tutor" className="text-emerald-700 underline">去答疑</Link>}
      />
    );
  }
  if (done) {
    return (
      <StatePanel
        title={`完成 ${items.length} 题，已记入学情`}
        description="坚持按重点方向练习，掌握情况会在学情里更新。"
        action={<Link href="/portrait" className="text-emerald-700 underline">查看学情</Link>}
      />
    );
  }

  const item = items[idx]!;
  function mark(selfResult: "KNOW" | "UNSURE") {
    if (!sessionId) return;
    submit.mutate({ sessionId, questionId: item.questionId, source: item.source, kpIds: item.kpId ? [item.kpId] : [], selfResult });
    if (idx + 1 >= items.length) setDone(true);
    else { setIdx(idx + 1); setRevealed(false); }
  }

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200" data-testid="training-session">
      <div className="text-sm text-slate-500">第 {idx + 1} / {items.length} 题{item.level ? ` · ${item.level}` : ""}</div>
      <div className="whitespace-pre-wrap text-sm leading-6" data-testid="training-stem">{item.stemMd}</div>
      {!revealed ? (
        <button type="button" onClick={() => setRevealed(true)} className="rounded-full bg-slate-100 px-4 py-2 text-sm" data-testid="training-reveal">
          查看解析
        </button>
      ) : (
        <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm" data-testid="training-solution">
          {item.solutionMd ?? "先按方法独立完成，再对照错题本里的解析。"}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => mark("KNOW")} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white" data-testid="training-know">
          会了
        </button>
        <button type="button" onClick={() => mark("UNSURE")} className="rounded-full border px-5 py-3 text-sm" data-testid="training-unsure">
          还不熟
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the nav entry**

In `apps/web/components/shell/RoleNav.tsx`, add a 训练 item to the STUDENT nav (after 错题本):

```tsx
    return [
      { label: "答疑", href: "/tutor" },
      { label: "错题本", href: "/error-book" },
      { label: "训练", href: "/training" },
      { label: "作业", href: "/assignments" },
      { label: "学情", href: "/portrait" },
    ];
```

Update `apps/web/tests/unit/role-nav.test.ts`'s student-nav assertion to include `"训练"` in the expected label array (between `"错题本"` and `"作业"`).

- [ ] **Step 4: Add the portrait CTA**

In `apps/web/app/(student)/portrait/portrait-view.tsx`, where the FOCUS areas render, add a link to `/training` (place it near the mastery list, e.g. after the tier blocks):

```tsx
        <Link href="/training" className="inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white" data-testid="portrait-training-cta">
          去靶向训练
        </Link>
```

Add `import Link from "next/link";` if not already present.

- [ ] **Step 5: Verify nav unit + typecheck**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/role-nav.test.ts` then `pnpm --filter @zhijiao/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(student)/training" apps/web/components/shell/RoleNav.tsx "apps/web/app/(student)/portrait/portrait-view.tsx" apps/web/tests/unit/role-nav.test.ts
git commit -m "feat(web): /training session UI + nav + portrait CTA"
```

---

### Task 7: E2E + full regression

**Files:**
- Create: `apps/web/e2e/targeted-training.spec.ts`

- [ ] **Step 1: Decide the seed path**

The E2E `global-setup` seeds `zhijiao_test_web`. Reuse the existing learning-portrait E2E student that already has FOCUS material (`dev-student-03` / phone `13800000007`, per `docs/claude/implementation-state.md` Plan 11). Confirm that student has an ACTIVE error-book entry on a FOCUS KP; if not, extend the existing `/api/e2e-hooks/error-book` or analytics hook to ensure one (only under `E2E_TEST_HOOKS=1`).

- [ ] **Step 2: Write the E2E**

```ts
// apps/web/e2e/targeted-training.spec.ts
import { expect, test } from "@playwright/test";
import { loginViaOtp } from "./helpers"; // match the helper neighbors use

test("targeted training: student runs a self-check session", async ({ page, request }) => {
  await loginViaOtp(page, request, "13800000007");
  await page.goto("/training");

  const session = page.getByTestId("training-session");
  const insufficient = page.getByText("还没有足够的训练材料");
  // Either a session renders, or the honest insufficient state — never a crash.
  await expect(session.or(insufficient)).toBeVisible();

  if (await session.isVisible()) {
    await expect(page.getByTestId("training-stem")).toBeVisible();
    await page.getByTestId("training-reveal").click();
    await expect(page.getByTestId("training-solution")).toBeVisible();
    await page.getByTestId("training-know").click();
    // Session advances or completes without error.
    await expect(page.getByTestId("training-session").or(page.getByText(/已记入学情/))).toBeVisible();
  }
});
```

(Match the exact login helper import the other specs use, e.g. `assignment-lifecycle.spec.ts`.)

- [ ] **Step 3: Run the targeted-training E2E**

Run: `pnpm --filter @zhijiao/web test:e2e targeted-training.spec.ts`
Expected: PASS.

- [ ] **Step 4: Full web E2E**

Run: `pnpm --filter @zhijiao/web test:e2e`
Expected: all specs PASS (the new RoleNav 训练 entry and portrait CTA must not break existing flows).

- [ ] **Step 5: Full typecheck + unit/integration**

Run: `pnpm typecheck` then `pnpm test`
Expected: 8/8 packages PASS (web gains training-writeback + training-router integration tests; analytics gains the sourceWeight unit tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/targeted-training.spec.ts apps/web/e2e
git commit -m "test(e2e): targeted training self-check session"
```

---

## Implementation Order

1. Task 1 — schema/migration (everything depends on the table).
2. Task 2 — analytics core sourceWeight (pure).
3. Task 3 — queries blend (depends on 1 + 2).
4. Task 4 — shared review-ladder helper (independent; needed by Task 5).
5. Task 5 — training router (depends on 1, 4).
6. Task 6 — UI (depends on 5).
7. Task 7 — E2E + full regression lock.

## Self-Review

- **Spec coverage:** §3 item pool/ordering/fallback → Task 5 `buildTrainingSession`; §4 data model → Task 1; §5 write-back → Tasks 2+3; §6 spaced-review interaction → Task 4 + Task 5 `submitAttempt`; §7 tRPC surface → Task 5; §8 UI → Task 6; §9 compliance (hint-first reveal, self-check, no scores, 重点巩固方向 wording) → Task 6 copy; §10 testing → Tasks 2,3,5,7; §11 acceptance → Task 7 full regression. No gaps.
- **Placeholder scan:** all code steps contain real code; the only judgment steps (Task 1 migrate path, Task 7 seed-path confirmation) name the exact files/ids to check.
- **Type consistency:** `PerfSample.sourceWeight?` (Task 2) is consumed in `queries.ts` (Task 3) and multiplied in `core.ts`; `TrainingItem`/`buildTrainingSession`/`ownsTrainingQuestion` (Task 5 lib) match the router and the `SessionView` fields (`questionId/source/kpId/stemMd/solutionMd/level`); `advanceReviewLadder(db, entryId, reviewCount, now)` (Task 4) is called identically in `markReviewed` and `submitAttempt`; `selfResult: "KNOW"|"UNSURE"` maps to `CORRECT`/`WRONG` consistently in router + UI.
- **Note for executor:** confirm the integration-test ctx helper import (`makeCtx`) and the E2E login helper import names against neighboring test files before running — they are referenced, not re-defined here.
