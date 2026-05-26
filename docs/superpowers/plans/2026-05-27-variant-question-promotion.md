# Plan 12 VariantItem Question Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote each `VariantItem` into an owner-only `Question(source="VARIANT_GENERATED")` so Plan 9 can link variant KP hints to the variant question instead of queuing parent-question review.

**Architecture:** Add nullable unique `VariantItem.questionId` as a two-phase migration bridge, create variant Questions in the existing variant-generation transaction, backfill historical variant items with a CLI-safe script, and teach `reconcileHintsSync` to write promoted variant KP links while retaining the legacy pending path for null `questionId`. Split CLI-safe question helpers out of the current `server-only` question module, and patch Plan 6 deactivation to scrub `VARIANT_GENERATED.createdByUserId`.

**Tech Stack:** pnpm 9 / Turborepo / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 / Vitest 1 / Playwright / PowerShell with `pnpm.cmd`.

---

## Source Of Truth

Spec: `docs/superpowers/specs/2026-05-27-variant-question-promotion-design.md`

This plan assumes commit `bb130aa` is present. If the spec changes, update this plan before implementation.

## Red Lines

1. `variant-backfill-questions.ts` must import from `apps/web/server/lib/question-shared.ts`, not from `question.ts`, because `question.ts` remains `server-only`.
2. Promoted variant reconcile must satisfy: `KpReconcileMatch.questionId === QuestionKPLink.questionId === VariantItem.questionId`.
3. Promoted variant reconcile must not write a `QuestionKPLink` to the parent question.
4. `deactivateUser` must keep `VARIANT_GENERATED Question` rows and scrub `createdByUserId` to `null`; `VariantItem` rows may still be deleted through Plan 6's existing `ErrorBookEntry -> VariantGroup -> VariantItem` cascade.
5. Existing legacy `KpReconcileMatch PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)` rows are not upgraded in this plan.
6. Every task commit must be preceded by `Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'` returning 0 matches.

## File Map

- `packages/db/prisma/schema.prisma`: add `VariantItem.questionId @unique`, relation to `Question`, and `Question.variantItem`.
- `packages/db/prisma/migrations/<timestamp>_plan12_variant_question_promotion/migration.sql`: generated Prisma migration.
- `apps/web/server/lib/question-shared.ts`: new CLI-safe helper module for source constants, stem normalization/hash, and `createVariantQuestion`.
- `apps/web/server/lib/question.ts`: keep `server-only`, re-export shared helpers, retain `upsertUserAdhocQuestion`.
- `apps/web/server/routers/variant.ts`: create one `Question` per generated variant item inside the existing transaction.
- `apps/web/server/lib/kp-reconcile.ts`: split subject question id from linked question id; promoted variant path links to `VariantItem.questionId`.
- `apps/web/server/trpc.ts`: add `VARIANT_GENERATED` to owner-only question access rules.
- `apps/web/server/lib/pii-governance.ts`: scrub `VARIANT_GENERATED.createdByUserId` in `previewDeactivateUser` and `deactivateUser` payloads.
- `apps/web/scripts/variant-backfill-questions.ts`: CLI plus exported `backfillVariantQuestions` test seam.
- `apps/web/package.json`: add `variant:backfill-questions`.
- `apps/web/tests/integration/variant-generate-question-link.test.ts`: generated variant items get linked questions and rollback atomically.
- `apps/web/tests/integration/variant-stem-drift-guard.test.ts`: `VariantItem.stemMd` and `Question.stemMd` stay equal.
- `apps/web/tests/integration/kp-reconcile-sync-variant-promoted.test.ts`: promoted variant hints link to variant question only.
- `apps/web/tests/integration/kp-reconcile-sync-variant-legacy.test.ts`: null `questionId` legacy path still queues review.
- `apps/web/tests/integration/variant-question-access-owner-only.test.ts`: owner-only access for `VARIANT_GENERATED`.
- `apps/web/tests/integration/variant-backfill-questions.test.ts`: backfill happy path, idempotence, dry-run, mixed rows.
- `apps/web/tests/integration/variant-backfill-race.test.ts`: race loser deletes its orphan Question.
- `apps/web/tests/integration/pii-deactivate-variant-questions.test.ts`: Plan 6 deactivation scrub patch.
- `CLAUDE.md`: Plan 12 status and merge probes 42-46.

## Preflight

- [ ] **Step P.1: Confirm branch and workspace**

Run:

```powershell
git status --short --branch
git log --oneline -3
```

Expected:

```text
## master
bb130aa docs(specs): Plan 12 spec — 4 user-review fixes
```

If the worktree is dirty, inspect the dirty files before editing and do not overwrite user changes.

- [ ] **Step P.2: Confirm Postgres and Redis are available**

Run:

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "select 1 as ok;"
docker exec zhijiao-redis redis-cli ping
```

Expected:

```text
 ok
----
  1
PONG
```

- [ ] **Step P.3: Baseline relevant tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-generate-for-entry.test.ts tests/integration/kp-reconcile-sync-variant.test.ts tests/integration/error-diagnose-question-access.test.ts tests/integration/pii-deactivate-user.test.ts
```

Expected: all listed tests pass before Plan 12 changes.

---

### Task 1: Schema And Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_plan12_variant_question_promotion/migration.sql`

- [ ] **Step 1.1: Edit Prisma schema**

In `model VariantItem`, add `questionId` and `question` after `createdAt` / before `group`:

```prisma
  questionId          String?       @unique @map("question_id")

  group               VariantGroup  @relation(fields: [groupId], references: [id], onDelete: Cascade)
  question            Question?     @relation(fields: [questionId], references: [id], onDelete: Restrict)
```

In `model Question`, add the reverse relation near the other relation fields:

```prisma
  variantItem         VariantItem?
```

Keep `@@unique([groupId, level])` and `@@index([groupId, position])` unchanged. Do not add `@@index([questionId])`; `@unique` already creates the usable index.

- [ ] **Step 1.2: Create migration with Prisma**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --create-only --name plan12_variant_question_promotion
```

Expected: Prisma creates a migration directory under `packages/db/prisma/migrations`.

- [ ] **Step 1.3: Inspect migration SQL**

Open the new `migration.sql`. It should contain only these DDL shapes:

```sql
ALTER TABLE "variant_items" ADD COLUMN "question_id" TEXT;
CREATE UNIQUE INDEX "variant_items_question_id_key" ON "variant_items"("question_id");
ALTER TABLE "variant_items" ADD CONSTRAINT "variant_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

If Prisma emits equivalent quoted SQL with line wrapping, keep it. If it emits a duplicate non-unique index on `question_id`, remove the schema cause before continuing.

- [ ] **Step 1.4: Apply migration to dev DB**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev
```

Expected: migration applies successfully.

- [ ] **Step 1.5: Apply migration to test DBs**

Run:

```powershell
pnpm.cmd test:setup
```

Expected: all per-package test databases are created or migrated successfully.

- [ ] **Step 1.6: Generate Prisma client**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
```

Expected: Prisma Client generated without errors.

- [ ] **Step 1.7: Verify schema via psql**

Run:

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d variant_items"
```

Expected output contains:

```text
question_id
variant_items_question_id_key
variant_items_question_id_fkey
ON DELETE RESTRICT
```

- [ ] **Step 1.8: Run typecheck for schema consumers**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db typecheck
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: both pass.

- [ ] **Step 1.9: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

- [ ] **Step 1.10: Commit schema task**

Run:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add variant item question link"
```

---

### Task 2: CLI-Safe Question Shared Module

**Files:**
- Create: `apps/web/server/lib/question-shared.ts`
- Modify: `apps/web/server/lib/question.ts`
- Test: `apps/web/tests/unit/question-lib.test.ts`

- [ ] **Step 2.1: Move shared constants and helpers into a new CLI-safe module**

Create `apps/web/server/lib/question-shared.ts`:

```ts
import crypto from "node:crypto";
import { type Prisma, type Question } from "@prisma/client";

export const QUESTION_SOURCE_USER_ADHOC = "USER_ADHOC";
export const QUESTION_SOURCE_VARIANT_GENERATED = "VARIANT_GENERATED";

export function normalizeStem(stem: string): string {
  return stem.trim().replace(/\s+/g, " ");
}

export function stemHashHex(stem: string): string {
  return crypto.createHash("sha256").update(normalizeStem(stem)).digest("hex").slice(0, 32);
}

export interface CreateVariantQuestionArgs {
  stemMd: string;
  userId: string;
  subjectId: string;
}

export async function createVariantQuestion(
  tx: Prisma.TransactionClient,
  args: CreateVariantQuestionArgs,
): Promise<Question> {
  return tx.question.create({
    data: {
      subjectId: args.subjectId,
      stemMd: args.stemMd,
      type: "ESSAY",
      status: "DRAFT",
      source: QUESTION_SOURCE_VARIANT_GENERATED,
      createdByUserId: args.userId,
      normalizedStemHash: stemHashHex(args.stemMd),
    },
  });
}
```

This file must not import `"server-only"`.

- [ ] **Step 2.2: Update `question.ts` imports and re-exports**

At the top of `apps/web/server/lib/question.ts`, replace the direct `crypto` import and local helper definitions with:

```ts
import "server-only";
import { Prisma, type PrismaClient, type Question } from "@prisma/client";
import {
  QUESTION_SOURCE_USER_ADHOC,
  QUESTION_SOURCE_VARIANT_GENERATED,
  normalizeStem,
  stemHashHex,
} from "./question-shared.js";

export {
  QUESTION_SOURCE_USER_ADHOC,
  QUESTION_SOURCE_VARIANT_GENERATED,
  createVariantQuestion,
  normalizeStem,
  stemHashHex,
} from "./question-shared.js";
```

Delete the old local definitions of `QUESTION_SOURCE_USER_ADHOC`, `normalizeStem`, and `stemHashHex` from `question.ts`. Leave `UpsertUserAdhocQuestionArgs` and `upsertUserAdhocQuestion` in `question.ts`.

- [ ] **Step 2.3: Add unit coverage for the new constant**

In `apps/web/tests/unit/question-lib.test.ts`, add:

```ts
import {
  QUESTION_SOURCE_USER_ADHOC,
  QUESTION_SOURCE_VARIANT_GENERATED,
  normalizeStem,
  stemHashHex,
} from "@/server/lib/question-shared";
```

If the file already imports `normalizeStem` and `stemHashHex` from `@/server/lib/question`, change that import to `@/server/lib/question-shared`.

Add this test:

```ts
it("defines stable Question.source literals", () => {
  expect(QUESTION_SOURCE_USER_ADHOC).toBe("USER_ADHOC");
  expect(QUESTION_SOURCE_VARIANT_GENERATED).toBe("VARIANT_GENERATED");
});
```

- [ ] **Step 2.4: Run focused tests and typecheck**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/unit/question-lib.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: both pass.

- [ ] **Step 2.5: Guard CLI-safe import boundary**

Run:

```powershell
Select-String -Path apps/web/server/lib/question-shared.ts -Pattern 'server-only'
```

Expected: no output.

- [ ] **Step 2.6: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

- [ ] **Step 2.7: Commit shared helper task**

Run:

```powershell
git add apps/web/server/lib/question-shared.ts apps/web/server/lib/question.ts apps/web/tests/unit/question-lib.test.ts
git commit -m "refactor(web): split CLI-safe question helpers"
```

---

### Task 3: Generate Variant Questions In The Variant Transaction

**Files:**
- Modify: `apps/web/server/routers/variant.ts`
- Test: `apps/web/tests/integration/variant-generate-question-link.test.ts`
- Test: `apps/web/tests/integration/variant-stem-drift-guard.test.ts`

- [ ] **Step 3.1: Write failing integration test for linked variant questions**

Create `apps/web/tests/integration/variant-generate-question-link.test.ts` with tests that:

1. Seed a user, wallet, subject, parent question, answer, error book entry, and a valid debit context using existing helpers from nearby variant tests.
2. Call `variant.generateForEntry`.
3. Load `VariantItem` rows with `question`.
4. Assert each item has a non-null `questionId`.
5. Assert each linked question has:
   - `source === "VARIANT_GENERATED"`
   - `createdByUserId === user.id`
   - `subjectId === parentQuestion.subjectId`
   - `status === "DRAFT"`
   - `normalizedStemHash === stemHashHex(item.stemMd)`

The core assertions should look like:

```ts
for (const item of items) {
  expect(item.questionId).toEqual(expect.any(String));
  expect(item.question).toMatchObject({
    id: item.questionId,
    source: "VARIANT_GENERATED",
    createdByUserId: user.id,
    subjectId: parentQuestion.subjectId,
    status: "DRAFT",
    normalizedStemHash: stemHashHex(item.stemMd),
  });
}
```

Add a rollback test that uses the AI mock path to return duplicate variant levels so `VariantItem @@unique([groupId, level])` fails with a real P2002. After the mutation fails, assert:

```ts
await expect(prisma.variantGroup.count()).resolves.toBe(0);
await expect(prisma.variantItem.count()).resolves.toBe(0);
await expect(prisma.question.count({ where: { source: "VARIANT_GENERATED" } })).resolves.toBe(0);
```

Use the existing test setup style from `apps/web/tests/integration/variant-generate-for-entry.test.ts`.

- [ ] **Step 3.2: Write failing drift guard test**

Create `apps/web/tests/integration/variant-stem-drift-guard.test.ts`. Generate one variant group and assert:

```ts
for (const item of items) {
  expect(item.question).not.toBeNull();
  expect(item.stemMd).toBe(item.question!.stemMd);
  expect(item.question!.normalizedStemHash).toBe(stemHashHex(item.stemMd));
}
```

This is red line R1.

- [ ] **Step 3.3: Run new tests to verify they fail**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-generate-question-link.test.ts tests/integration/variant-stem-drift-guard.test.ts
```

Expected: fail because `VariantItem.questionId` is not populated by `variant.generateForEntry`.

- [ ] **Step 3.4: Import `createVariantQuestion` in variant router**

In `apps/web/server/routers/variant.ts`, add:

```ts
import { createVariantQuestion } from "@/server/lib/question-shared";
```

- [ ] **Step 3.5: Replace `createMany` with sequential Question plus VariantItem creation**

Inside the existing `ctx.db.$transaction`, replace `tx.variantItem.createMany` with:

```ts
for (let idx = 0; idx < ai.items.length; idx++) {
  const it = ai.items[idx]!;
  const question = await createVariantQuestion(tx, {
    stemMd: it.stemMd,
    userId: ctx.auth.userId,
    subjectId: ctx.entry.question.subjectId,
  });
  await tx.variantItem.create({
    data: {
      groupId: group.id,
      level: it.level,
      position: idx + 1,
      stemMd: it.stemMd,
      solutionMd: it.solutionMd,
      knowledgePointHints: it.knowledgePointHints ?? [],
      questionId: question.id,
    },
  });
}
```

Keep the existing `findUniqueOrThrow({ include: { items: { orderBy } } })` return path. Do not change `toVariantGroupView`.

- [ ] **Step 3.6: Update reconcile comment in variant router**

Change the comment above the post-transaction reconcile loop to state:

```ts
// Plan 12: sourceRefType=VARIANT_ITEM still passes the parent entry questionId
// as subject context. reconcileHintsSync internally uses item.questionId when
// present so promoted variant KP links land on the variant Question.
```

Do not change the caller payload; it still passes `questionId: ctx.entry.questionId`.

- [ ] **Step 3.7: Run focused tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-generate-question-link.test.ts tests/integration/variant-stem-drift-guard.test.ts tests/integration/variant-generate-for-entry.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: all pass.

- [ ] **Step 3.8: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

- [ ] **Step 3.9: Commit variant generation task**

Run:

```powershell
git add apps/web/server/routers/variant.ts apps/web/tests/integration/variant-generate-question-link.test.ts apps/web/tests/integration/variant-stem-drift-guard.test.ts
git commit -m "feat(web): create questions for generated variants"
```

---

### Task 4: Reconcile Variant KP Hints To Promoted Questions

**Files:**
- Modify: `apps/web/server/lib/kp-reconcile.ts`
- Test: `apps/web/tests/integration/kp-reconcile-sync-variant-promoted.test.ts`
- Test: `apps/web/tests/integration/kp-reconcile-sync-variant-legacy.test.ts`

- [ ] **Step 4.1: Write failing promoted-path test**

Create `apps/web/tests/integration/kp-reconcile-sync-variant-promoted.test.ts`.

Seed:
- one subject and KP with exact or alias hint
- parent `Question`
- `ErrorBookEntry`
- `VariantGroup`
- promoted `Question(source="VARIANT_GENERATED")`
- `VariantItem(questionId=variantQuestion.id, knowledgePointHints=[kp.name])`

Call:

```ts
const result = await reconcileHintsSync(prisma, {
  questionId: parentQuestion.id,
  hints: [kp.name],
  source: "VARIANT_ITEM",
  sourceRefType: "VARIANT_ITEM",
  sourceRefId: variantItem.id,
});
```

Assert:

```ts
expect(result).toMatchObject({ linked: 1, queued: 0, alreadySeen: 0 });

const match = await prisma.kpReconcileMatch.findFirstOrThrow({
  where: {
    sourceRefType: "VARIANT_ITEM",
    sourceRefId: variantItem.id,
    normalizedHint: normalizeKpHint(kp.name),
  },
});
const link = await prisma.questionKPLink.findUniqueOrThrow({
  where: {
    questionId_kpId: {
      questionId: variantQuestion.id,
      kpId: kp.id,
    },
  },
});

expect(match.status).toBe("LINKED");
expect(match.questionId).toBe(variantQuestion.id);
expect(link.questionId).toBe(variantQuestion.id);
expect(match.questionId).toBe(link.questionId);
await expect(
  prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } }),
).resolves.toBe(0);
```

This is red lines R2 and R5.

- [ ] **Step 4.2: Write failing legacy-path test**

Create `apps/web/tests/integration/kp-reconcile-sync-variant-legacy.test.ts`.

Seed the same shape, but leave `VariantItem.questionId = null`. Call `reconcileHintsSync` with `sourceRefType: "VARIANT_ITEM"`.

Assert:

```ts
expect(result).toMatchObject({ linked: 0, queued: 1, alreadySeen: 0 });

const match = await prisma.kpReconcileMatch.findFirstOrThrow({
  where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
});
expect(match.status).toBe("PENDING_REVIEW");
expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
expect(match.questionId).toBe(parentQuestion.id);
await expect(prisma.questionKPLink.count()).resolves.toBe(0);
```

- [ ] **Step 4.3: Run new tests to verify they fail**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant-promoted.test.ts tests/integration/kp-reconcile-sync-variant-legacy.test.ts
```

Expected: promoted-path test fails because current code queues `VARIANT_ITEM` hints as `PENDING_REVIEW`.

- [ ] **Step 4.4: Update top-level reconcile comment**

In `apps/web/server/lib/kp-reconcile.ts`, change the behavior comment to:

```ts
// - VARIANT_ITEM EXACT/ALIAS 命中：
//   - VariantItem.questionId 非空 → LINKED + upsert variant QuestionKPLink
//   - VariantItem.questionId 为空 → PENDING_REVIEW + reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW
```

- [ ] **Step 4.5: Add variant path lookup before candidate loading**

Near the start of `reconcileHintsSync`, before the `question.findUniqueOrThrow`, add:

```ts
let effectiveQuestionId: string | null = null;
let isVariantPath = false;
let isVariantPendingLegacy = false;

if (args.sourceRefType === "VARIANT_ITEM") {
  const variantItem = await prisma.variantItem.findUnique({
    where: { id: args.sourceRefId },
    select: { questionId: true },
  });
  if (!variantItem) {
    _logger.warn({ event: "kp_reconcile_variant_item_missing", sourceRefId: args.sourceRefId });
    isVariantPendingLegacy = true;
  } else if (variantItem.questionId != null) {
    isVariantPath = true;
    effectiveQuestionId = variantItem.questionId;
  } else {
    isVariantPendingLegacy = true;
  }
}

const subjectQuestionId = args.questionId;
const linkedQuestionId = effectiveQuestionId ?? args.questionId;
```

Change the existing `question.findUniqueOrThrow` to use `subjectQuestionId`.

Delete:

```ts
const writesToParent = args.sourceRefType !== "VARIANT_ITEM";
```

- [ ] **Step 4.6: Replace linked/pending write branch**

Replace the current branch that checks `writesToParent` inside `if (matchedKpId && matchVia)` with:

```ts
if (isVariantPath) {
  await prisma.$transaction(async (tx) => {
    await upsertReconcileMatch(tx, {
      ...args,
      questionId: linkedQuestionId,
      normalizedHint: normalized,
      rawHint,
      kpId: matchedKpId,
      matchVia,
      confidence: 1.0,
      status: "LINKED",
      reviewReason: null,
    });
    await upsertQuestionKpLink(tx, linkedQuestionId, matchedKpId!, 1.0);
  });
  result.linked++;
} else if (isVariantPendingLegacy) {
  await upsertReconcileMatch(prisma, {
    ...args,
    normalizedHint: normalized,
    rawHint,
    kpId: matchedKpId,
    matchVia,
    confidence: 1.0,
    status: "PENDING_REVIEW",
    reviewReason: "VARIANT_TO_PARENT_NEEDS_REVIEW",
  });
  result.queued++;
} else {
  await prisma.$transaction(async (tx) => {
    await upsertReconcileMatch(tx, {
      ...args,
      normalizedHint: normalized,
      rawHint,
      kpId: matchedKpId,
      matchVia,
      confidence: 1.0,
      status: "LINKED",
      reviewReason: null,
    });
    await upsertQuestionKpLink(tx, args.questionId, matchedKpId!, 1.0);
  });
  result.linked++;
}
```

- [ ] **Step 4.7: Run focused tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant-promoted.test.ts tests/integration/kp-reconcile-sync-variant-legacy.test.ts tests/integration/kp-reconcile-sync-variant.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: all pass. The existing `kp-reconcile-sync-variant.test.ts` may need assertion updates if it assumed every variant item always queues; keep its historical null-`questionId` coverage or replace with the new legacy test.

- [ ] **Step 4.8: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

- [ ] **Step 4.9: Commit reconciler task**

Run:

```powershell
git add apps/web/server/lib/kp-reconcile.ts apps/web/tests/integration/kp-reconcile-sync-variant-promoted.test.ts apps/web/tests/integration/kp-reconcile-sync-variant-legacy.test.ts apps/web/tests/integration/kp-reconcile-sync-variant.test.ts
git commit -m "feat(web): link promoted variant KP hints"
```

---

### Task 5: Owner-Only Access For VARIANT_GENERATED Questions

**Files:**
- Modify: `apps/web/server/trpc.ts`
- Test: `apps/web/tests/integration/variant-question-access-owner-only.test.ts`

- [ ] **Step 5.1: Write failing access test**

Create `apps/web/tests/integration/variant-question-access-owner-only.test.ts`.

Use `createCaller` style from `error-diagnose-question-access.test.ts`. Seed:
- owner user with wallet balance
- other user with wallet balance
- `VARIANT_GENERATED Question(createdByUserId=owner.id)`
- `PUBLISHED` or seed `"自有"` question

Assert four cases:

```ts
await expect(ownerCaller.error.diagnose({ questionId: variantQuestion.id, actualAnswerMd: "x" }))
  .resolves.toMatchObject({ entryId: expect.any(String) });

await expect(otherCaller.error.diagnose({ questionId: variantQuestion.id, actualAnswerMd: "x" }))
  .rejects.toMatchObject({
    code: "NOT_FOUND",
    cause: { reason: "QUESTION_NOT_FOUND" },
  });

await expect(otherWalletLedgerDebitCount()).resolves.toBe(0);

await expect(ownerCaller.error.diagnose({ questionId: "cmissing000000000000000000", actualAnswerMd: "x" }))
  .rejects.toMatchObject({
    code: "NOT_FOUND",
    cause: { reason: "QUESTION_NOT_FOUND" },
  });

await expect(otherCaller.error.diagnose({ questionId: publishedQuestion.id, actualAnswerMd: "x" }))
  .resolves.toMatchObject({ entryId: expect.any(String) });
```

Use a valid cuid-shaped missing id already accepted by the existing tests; if the zod CUID check rejects the string, copy the missing-id pattern from `error-diagnose-question-access.test.ts`.

- [ ] **Step 5.2: Run test to verify it fails**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-question-access-owner-only.test.ts
```

Expected: cross-user variant access currently succeeds or fails with the wrong behavior.

- [ ] **Step 5.3: Add owner-only source set**

In `apps/web/server/trpc.ts`, near `validateQuestionAccess`, add:

```ts
const OWNER_ONLY_QUESTION_SOURCES = new Set(["USER_ADHOC", "VARIANT_GENERATED"]);
```

Do not export this set.

- [ ] **Step 5.4: Update access guard**

Replace the current USER_ADHOC-only check with:

```ts
if (
  !question ||
  (question.source != null &&
    OWNER_ONLY_QUESTION_SOURCES.has(question.source) &&
    question.createdByUserId !== ctx.auth.userId)
) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "题目不存在",
    cause: { reason: "QUESTION_NOT_FOUND" },
  });
}
```

Update the comment above the middleware to state:

```ts
// 访问规则：
//   USER_ADHOC / VARIANT_GENERATED: createdByUserId === ctx.auth.userId → 允许；否则 NOT_FOUND
//   其它 source（含 null / "自有" / PUBLISHED 等）：允许（题库公共题）
//   missing questionId / 不存在的 id → BAD_REQUEST / NOT_FOUND
```

- [ ] **Step 5.5: Run focused tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-question-access-owner-only.test.ts tests/integration/error-diagnose-question-access.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: all pass.

- [ ] **Step 5.6: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

- [ ] **Step 5.7: Commit access guard task**

Run:

```powershell
git add apps/web/server/trpc.ts apps/web/tests/integration/variant-question-access-owner-only.test.ts
git commit -m "feat(web): guard generated variant questions by owner"
```

---

### Task 6: Variant Question Backfill CLI

**Files:**
- Create: `apps/web/scripts/variant-backfill-questions.ts`
- Modify: `apps/web/package.json`
- Test: `apps/web/tests/integration/variant-backfill-questions.test.ts`
- Test: `apps/web/tests/integration/variant-backfill-race.test.ts`

- [ ] **Step 6.1: Write failing backfill tests**

Create `apps/web/tests/integration/variant-backfill-questions.test.ts`.

Import:

```ts
import { backfillVariantQuestions } from "@/scripts/variant-backfill-questions";
```

Tests:

1. Seed 5 `VariantItem` rows with `questionId: null`. Run:

```ts
const result = await backfillVariantQuestions(prisma, { limit: 1000, dryRun: false });
expect(result).toEqual({ processed: 5, created: 5, alreadySeen: 0, dryRun: false });
```

Assert all 5 rows have non-null `questionId` and linked questions have `source="VARIANT_GENERATED"`, `createdByUserId=group.userId`, `subjectId=parent.question.subjectId`, `status="DRAFT"`.

2. Run backfill again:

```ts
const second = await backfillVariantQuestions(prisma, { limit: 1000, dryRun: false });
expect(second).toEqual({ processed: 0, created: 0, alreadySeen: 0, dryRun: false });
```

Assert `Question(source="VARIANT_GENERATED")` count remains 5. This is R3.

3. Dry-run:

```ts
const dryRun = await backfillVariantQuestions(prisma, { limit: 1000, dryRun: true });
expect(dryRun.created).toBe(5);
await expect(prisma.question.count({ where: { source: "VARIANT_GENERATED" } })).resolves.toBe(0);
```

4. Mixed rows: one row already linked, two rows null. Backfill creates only two new questions.

- [ ] **Step 6.2: Write failing race test**

Create `apps/web/tests/integration/variant-backfill-race.test.ts`.

Use the exported hook seam:

```ts
const result = await backfillVariantQuestions(prisma, {
  limit: 1000,
  dryRun: false,
  afterCreateBeforeUpdate: async ({ prisma, itemId }) => {
    const competingQuestion = await prisma.question.create({
      data: {
        subjectId,
        stemMd: "competing variant question",
        type: "ESSAY",
        status: "DRAFT",
        source: "VARIANT_GENERATED",
        createdByUserId: user.id,
        normalizedStemHash: stemHashHex("competing variant question"),
      },
    });
    await prisma.variantItem.update({
      where: { id: itemId },
      data: { questionId: competingQuestion.id },
    });
  },
});

expect(result).toEqual({ processed: 1, created: 0, alreadySeen: 1, dryRun: false });
await expect(prisma.question.count({ where: { source: "VARIANT_GENERATED" } })).resolves.toBe(1);
```

The single remaining generated question is the competing one; the backfill-created orphan was deleted.

- [ ] **Step 6.3: Run tests to verify they fail**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-backfill-questions.test.ts tests/integration/variant-backfill-race.test.ts
```

Expected: module import fails because `variant-backfill-questions.ts` does not exist.

- [ ] **Step 6.4: Implement the CLI module with exported service**

Create `apps/web/scripts/variant-backfill-questions.ts`:

```ts
#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { loadCliEnv } from "./load-cli-env.js";
import { createVariantQuestion } from "../server/lib/question-shared.js";

loadCliEnv();

const BATCH = 200;

export interface BackfillVariantQuestionsArgs {
  limit: number;
  dryRun: boolean;
  afterCreateBeforeUpdate?: (args: {
    prisma: PrismaClient | Prisma.TransactionClient;
    itemId: string;
    questionId: string;
  }) => Promise<void>;
}

export interface BackfillVariantQuestionsResult {
  processed: number;
  created: number;
  alreadySeen: number;
  dryRun: boolean;
}

export function parseArgs(argv: string[]) {
  let limit = 1000;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[++i];
      if (!raw || raw.startsWith("--")) {
        throw new Error("--limit requires a positive integer value");
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit: ${raw}`);
      }
      limit = parsed;
      continue;
    }
    throw new Error(`Unknown arg: ${arg}`);
  }
  return { limit, dryRun };
}

export async function backfillVariantQuestions(
  prisma: PrismaClient,
  args: BackfillVariantQuestionsArgs,
): Promise<BackfillVariantQuestionsResult> {
  let cursor: string | undefined;
  let processed = 0;
  let created = 0;
  let alreadySeen = 0;

  while (processed < args.limit) {
    const items = await prisma.variantItem.findMany({
      where: { questionId: null },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: Math.min(BATCH, args.limit - processed),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        group: {
          include: {
            entry: {
              include: {
                question: { select: { subjectId: true } },
              },
            },
          },
        },
      },
    });
    if (items.length === 0) break;

    for (const item of items) {
      processed++;
      if (item.questionId != null) {
        alreadySeen++;
        continue;
      }
      if (args.dryRun) {
        created++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const q = await createVariantQuestion(tx, {
          stemMd: item.stemMd,
          userId: item.group.userId,
          subjectId: item.group.entry.question.subjectId,
        });
        if (args.afterCreateBeforeUpdate) {
          await args.afterCreateBeforeUpdate({ prisma: tx, itemId: item.id, questionId: q.id });
        }
        const updated = await tx.variantItem.updateMany({
          where: { id: item.id, questionId: null },
          data: { questionId: q.id },
        });
        if (updated.count === 0) {
          await tx.question.delete({ where: { id: q.id } });
          alreadySeen++;
        } else {
          created++;
        }
      });
    }

    cursor = items[items.length - 1]!.id;
  }

  return { processed, created, alreadySeen, dryRun: args.dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const result = await backfillVariantQuestions(prisma, args);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 6.5: Add package script**

In `apps/web/package.json`, add:

```json
"variant:backfill-questions": "tsx scripts/variant-backfill-questions.ts"
```

Keep JSON comma placement valid.

- [ ] **Step 6.6: Run focused tests and CLI smoke**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-backfill-questions.test.ts tests/integration/variant-backfill-race.test.ts
pnpm.cmd --filter @zhijiao/web variant:backfill-questions --dry-run
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: tests pass; CLI prints JSON with `dryRun: true`.

- [ ] **Step 6.7: Guard CLI-safe import boundary**

Run:

```powershell
Select-String -Path apps/web/scripts/variant-backfill-questions.ts -Pattern 'server/lib/question\.js|server-only'
```

Expected: no output.

- [ ] **Step 6.8: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

- [ ] **Step 6.9: Commit backfill task**

Run:

```powershell
git add apps/web/scripts/variant-backfill-questions.ts apps/web/package.json apps/web/tests/integration/variant-backfill-questions.test.ts apps/web/tests/integration/variant-backfill-race.test.ts
git commit -m "feat(web): backfill questions for variant items"
```

---

### Task 7: Patch Plan 6 Deactivation For Generated Variant Questions

**Files:**
- Modify: `apps/web/server/lib/pii-governance.ts`
- Test: `apps/web/tests/integration/pii-deactivate-variant-questions.test.ts`

- [ ] **Step 7.1: Write failing deactivation test**

Create `apps/web/tests/integration/pii-deactivate-variant-questions.test.ts`.

Seed:
- user
- parent question
- `ErrorBookEntry`
- `VariantGroup`
- `VARIANT_GENERATED Question(createdByUserId=user.id)`
- `VariantItem(questionId=variantQuestion.id)`

Call `deactivateUser`.

Assert:

```ts
expect(result.payload.scrubbed.variantGeneratedQuestions).toBe(1);

await expect(
  prisma.question.findUniqueOrThrow({ where: { id: variantQuestion.id } }),
).resolves.toMatchObject({
  id: variantQuestion.id,
  source: "VARIANT_GENERATED",
  createdByUserId: null,
});

await expect(prisma.variantItem.findUnique({ where: { id: variantItem.id } })).resolves.toBeNull();
await expect(prisma.variantGroup.findUnique({ where: { id: group.id } })).resolves.toBeNull();
await expect(prisma.errorBookEntry.findUnique({ where: { id: entry.id } })).resolves.toBeNull();
```

This explicitly aligns with Plan 6 cascade: the content rows are deleted, but the generated `Question` remains as scrubbed statistical data.

- [ ] **Step 7.2: Run test to verify it fails**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-variant-questions.test.ts
```

Expected: fail because `variantGeneratedQuestions` is missing and `createdByUserId` remains set.

- [ ] **Step 7.3: Extend `DeactivatePayload.scrubbed`**

In `apps/web/server/lib/pii-governance.ts`, add the field:

```ts
variantGeneratedQuestions: number;
```

to the `DeactivatePayload.scrubbed` interface.

- [ ] **Step 7.4: Update preview counts**

In `buildDeactivatePlan` or the existing preview-count function, add:

```ts
const variantGeneratedQuestions = await prisma.question.count({
  where: { source: "VARIANT_GENERATED", createdByUserId: userId },
});
```

Return it in `payload.scrubbed.variantGeneratedQuestions`.

- [ ] **Step 7.5: Scrub generated variant question owners during deactivation**

Inside the `deactivateUser` transaction, after the existing `KpAlias` / `KpReconcileMatch` SetNull updates and before `User.update`, add:

```ts
const variantGeneratedQuestions = await tx.question.updateMany({
  where: { source: "VARIANT_GENERATED", createdByUserId: args.userId },
  data: { createdByUserId: null },
});
```

Use `variantGeneratedQuestions.count` in the final payload.

- [ ] **Step 7.6: Update any payload construction defaults**

Where `DeactivatePayload` default counts are initialized, add:

```ts
variantGeneratedQuestions: 0,
```

Where the real payload is constructed, add:

```ts
variantGeneratedQuestions: variantGeneratedQuestions.count,
```

- [ ] **Step 7.7: Run focused tests**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-variant-questions.test.ts tests/integration/pii-deactivate-user.test.ts tests/integration/pii-ops-action-log-payload.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

Expected: all pass. If the payload guard test fails because the new key is not whitelisted, update that test to allow `variantGeneratedQuestions` while still rejecting PII.

- [ ] **Step 7.8: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

- [ ] **Step 7.9: Commit deactivation patch**

Run:

```powershell
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-deactivate-variant-questions.test.ts apps/web/tests/unit/pii-ops-action-log-payload.test.ts
git commit -m "feat(web): scrub generated variant questions on deactivation"
```

---

### Task 8: Backfill Dev DB And Verify Plan 12 Probes

**Files:**
- No source edits expected

- [ ] **Step 8.1: Run backfill on dev DB**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web variant:backfill-questions --limit 1000
```

Expected: JSON output with no error. Current dev DB may show `processed: 0` if no historical variant items exist.

- [ ] **Step 8.2: Run probe 1, no null question links**

Run:

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items WHERE question_id IS NULL;"
```

Expected:

```text
 count
-------
     0
```

- [ ] **Step 8.3: Run probe 2, linked Question source is variant generated**

Run:

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items vi JOIN questions q ON q.id = vi.question_id WHERE q.source IS DISTINCT FROM 'VARIANT_GENERATED';"
```

Expected count: `0`.

- [ ] **Step 8.4: Run probe 3, non-scrubbed owner matches group user**

Run:

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items vi JOIN questions q ON q.id = vi.question_id JOIN variant_groups vg ON vg.id = vi.group_id WHERE q.created_by_user_id IS NOT NULL AND q.created_by_user_id != vg.user_id;"
```

Expected count: `0`.

- [ ] **Step 8.5: Confirm migration status**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate status
```

Expected output includes:

```text
Database schema is up to date!
```

- [ ] **Step 8.6: Guard against placeholder tests**

Run:

```powershell
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: no output.

---

### Task 9: CLAUDE.md Plan 12 Status And Merge Probes

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 9.1: Add Plan 12 to landed plan list**

In the "已完成" plan list, add a bullet:

```markdown
- **Plan 12**（VariantItem 升格成独立 Question：VARIANT_GENERATED Question + variant question KP link + backfill CLI + owner-only access）—— 见 `docs/superpowers/plans/2026-05-27-variant-question-promotion.md`，spec 在 `docs/superpowers/specs/2026-05-27-variant-question-promotion-design.md`
```

- [ ] **Step 9.2: Add VariantItem promotion status section**

Add a short section after the Plan 9 status section:

```markdown
**VariantItem 升格现状**（Plan 12）：
- `VariantItem.questionId` nullable 过渡字段指向 `Question(source="VARIANT_GENERATED")`；新生成变式同事务双写 Question + VariantItem。
- `variant:backfill-questions` 负责历史 VariantItem 补 Question；backfill 后 `variant_items.question_id IS NULL` 应为 0。
- `reconcileHintsSync` 对 `sourceRefType=VARIANT_ITEM` 两阶段分流：有 questionId 直接 LINKED 到 variant Question；无 questionId 保留 `PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)` migration safety。
- `VARIANT_GENERATED` 与 `USER_ADHOC` 同为 owner-only；注销时 scrub `createdByUserId=null`，Question 行保留作统计样本。
- 历史 `VARIANT_TO_PARENT_NEEDS_REVIEW` 行升级为 LINKED + 补 QuestionKPLink 显式 punt 到 cleanup plan。
```

- [ ] **Step 9.3: Add merge probes 42-46**

Append after probe 41:

```markdown
42. **VariantItem.questionId FK/unique 已落库**（Plan 12 §2）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d variant_items"` 应见 `question_id`、`variant_items_question_id_key`、`ON DELETE RESTRICT`
43. **VariantItem backfill 0 残留**（Plan 12 §4.4）：三条探针均应 count=0：`variant_items WHERE question_id IS NULL`；`variant_items JOIN questions WHERE q.source IS DISTINCT FROM 'VARIANT_GENERATED'`；`q.created_by_user_id IS NOT NULL AND q.created_by_user_id != vg.user_id`
44. **Promoted variant KP link 不污染 parent**（Plan 12 R2/R5）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant-promoted.test.ts` 应全绿，且断言 `KpReconcileMatch.questionId === QuestionKPLink.questionId === VariantItem.questionId`
45. **VARIANT_GENERATED owner-only**（Plan 12 §6）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-question-access-owner-only.test.ts` 应全绿；cross-user 返回 `NOT_FOUND / QUESTION_NOT_FOUND` 且不写 DEBIT
46. **Backfill CLI smoke**（Plan 12 §4）：`pnpm.cmd --filter @zhijiao/web variant:backfill-questions --dry-run` 应 exit 0；脚本不得 import `server/lib/question.js` 或 `server-only`
```

- [ ] **Step 9.4: Reorder candidate plans**

Remove Plan 12 from next candidates. Add or keep cleanup plan notes:

```markdown
- Plan 12 cleanup: `VariantItem.questionId NOT NULL` + 下线 nullable reconcile 分支 + 处理历史 `VARIANT_TO_PARENT_NEEDS_REVIEW` 行
- Plan 15: USER_ADHOC × PUBLISHED canonical dedup
```

- [ ] **Step 9.5: Inspect doc diff**

Run:

```powershell
git diff -- CLAUDE.md
```

Expected: only Plan 12 status/probes/candidate-plan updates.

- [ ] **Step 9.6: Commit docs**

Run:

```powershell
git add CLAUDE.md
git commit -m "docs(claude): mark Plan 12 landed"
```

---

### Task 10: Full Verification And Final Commit Hygiene

**Files:**
- No source edits expected

- [ ] **Step 10.1: Regenerate Prisma client**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 10.2: Full typecheck**

Run:

```powershell
pnpm.cmd exec turbo typecheck --force
```

Expected: `7 successful, 7 total`.

- [ ] **Step 10.3: Full test suite**

Run:

```powershell
pnpm.cmd exec turbo test --force
```

Expected: all packages pass. Web test output should include the eight Plan 12 integration files.

- [ ] **Step 10.4: Next build**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web build
```

Expected: exit 0. Existing `url.parse` deprecation warnings may appear and do not fail the build.

- [ ] **Step 10.5: Full Playwright E2E**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web exec playwright test
```

Expected: all E2E tests pass.

- [ ] **Step 10.6: CLI and import guard**

Run:

```powershell
pnpm.cmd --filter @zhijiao/web variant:backfill-questions --dry-run
Select-String -Path apps/web/scripts/variant-backfill-questions.ts -Pattern 'server/lib/question\.js|server-only'
Get-ChildItem -Path apps/web/tests,packages/auth/tests -Recurse -File | Select-String -Pattern 'it\.todo'
```

Expected: CLI exits 0; both `Select-String` commands produce no output.

- [ ] **Step 10.7: DB probes**

Run:

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items WHERE question_id IS NULL;"
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items vi JOIN questions q ON q.id = vi.question_id WHERE q.source IS DISTINCT FROM 'VARIANT_GENERATED';"
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items vi JOIN questions q ON q.id = vi.question_id JOIN variant_groups vg ON vg.id = vi.group_id WHERE q.created_by_user_id IS NOT NULL AND q.created_by_user_id != vg.user_id;"
```

Expected: all three counts are 0.

- [ ] **Step 10.8: Migration status**

Run:

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate status
```

Expected:

```text
Database schema is up to date!
```

- [ ] **Step 10.9: Git status**

Run:

```powershell
git status --short --branch
git log --oneline -12
```

Expected: clean worktree on the feature branch or master, with one commit per task.

## Self-Review Checklist

- [ ] Spec §1 scope maps to tasks 1-10.
- [ ] Spec §2 schema maps to Task 1.
- [ ] Spec §3 helper split and variant generation maps to Tasks 2-3.
- [ ] Spec §4 backfill maps to Tasks 6 and 8.
- [ ] Spec §5 reconciler maps to Task 4.
- [ ] Spec §6 access guard maps to Task 5.
- [ ] Spec §7 tests map to Tasks 3-7.
- [ ] Spec §9 Plan 6 patch maps to Task 7.
- [ ] Spec §11 completion conditions map to Tasks 8-10.
- [ ] Plan placeholder scan is clean for the forbidden uppercase markers from the writing-plans skill. The `it\.todo` grep commands are intentional guardrails, not placeholder tests.
- [ ] All commands use `pnpm.cmd` on PowerShell.
