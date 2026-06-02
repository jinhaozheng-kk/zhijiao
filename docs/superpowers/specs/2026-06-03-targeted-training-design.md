# 靶向训练 (Targeted Training) v1 Design

## 1. Goal

Close the `举一反三 → 靶向训练 → 错题本 → 学情` product loop with a free, weak-point-driven
practice surface. 靶向训练 assembles a short practice session from the student's own
existing error-book questions and already-generated variants, prioritized by their weak
(FOCUS) knowledge points, lets the student self-check hint-first, and writes a lightweight
result back into the learning portrait so the loop visibly closes.

This is the next MVP-closing item (phase 2: 提升留存), not blocked on ICP or on the
(near-empty) PUBLISHED question bank.

## 2. Positioning and non-goals

靶向训练 is a **reuse-first session orchestrator**, not a content generator.

- **No new AI calls** and **no new paid SKU**; the surface is free (`consentGatedProcedure`).
- **No per-KP AI generation** (that overlaps 举一反三 / `variant.generateForEntry` and is
  punted). 举一反三 remains the paid fresh-content path, reached from the error book.
- **No reliance on a PUBLISHED bank** (it is ~3 fixtures, hit-rate ≈0; content supply is
  blocked).
- **No new teacher/parent surface**; v1 is student-only.

## 3. Item pool and ordering

Source the student's FOCUS (and, if too few, weakest PROGRESSING) KPs from
`analytics.profileForStudent` (reuses the existing 5-min-cached profile).

Per target KP, gather from two owner-scoped pools:

1. ACTIVE `ErrorBookEntry` whose `question.knowledgePoints` include the KP (the same join
   `queries.ts:56-59` already uses for the weak-error signal).
2. `VariantItem` under that student whose promoted `Question.knowledgePoints` include the KP
   (Plan 12 made variants real Questions with KP links).

Ordering: weakest KP first; within a KP, the original error question, then its variants
L1 → L2 → L3. Session size is capped (target ~6–10 items across ~2–3 KPs).

**Cold-start fallback (load-bearing):** the pool is bootstrapped from the student's own
error book + variants and can be thin, and `USER_ADHOC`/variant questions may lack a
`QuestionKPLink` (the Plan 9 reconciler only links on a sync EXACT/ALIAS hit; the rest wait
for a manually-run CLI). So when the targeted pool is below the session floor, fill the
remainder from the existing `error.dueForReview` queue (ordered by `nextReviewAt`). When the
student has no practicable items at all, return an `INSUFFICIENT_DATA` session (reuse the
existing data-insufficient UX pattern) — never an empty screen and never a paywall.

## 4. Data model

New table `TrainingAttempt` (one row per answered item):

```
model TrainingAttempt {
  id            String                @id @default(cuid())
  sessionId     String                @map("session_id")     // server-minted cuid, groups a session
  studentUserId String                @map("student_user_id")
  questionId    String                @map("question_id")
  source        TrainingItemSource                            // ERROR_BOOK | VARIANT
  gradeStatus   AssignmentGradeStatus                         // self-check: CORRECT | WRONG (reuse enum)
  kpIds         String[]              @default([]) @map("kp_ids")  // snapshot of the session's target KP(s)
  createdAt     DateTime              @default(now()) @map("created_at")

  @@index([studentUserId, createdAt])
  @@map("training_attempts")
}

enum TrainingItemSource { ERROR_BOOK VARIANT }
```

Notes:
- Reuses `AssignmentGradeStatus` (self-check maps 会→CORRECT / 不会→WRONG; PARTIAL unused in v1).
- **No `TrainingSession` parent table** in v1 (YAGNI); `sessionId` is a grouping id only.
- `kpIds` is **snapshotted from the session's target KP**, not resolved from the question's
  own links — this credits the right KP for write-back even when the question's
  `QuestionKPLink` is sparse.
- Does **not** overload `AssignmentPerformance` (that table is keyed to the classroom
  assignment lifecycle and scanned by teacher `classDiagnosis`; mixing self-practice rows
  would corrupt those semantics).

## 5. Mastery write-back

Extend the analytics core's `PerfSample` with an optional `sourceWeight` (default `1.0`),
multiplied into the existing decay weight:

```
const w = decayWeight(s.ageDays, halfLifeDays) * (s.sourceWeight ?? 1);
```

`core.ts` stays pure; this is the only core change.

In `queries.ts::profileForStudent`, after the `AssignmentPerformance` query, add a parallel
`trainingAttempt` query (same `studentUserId` + `cutoff` filter) and map each row to a
`PerfSample` exactly like the `AssignmentPerformance` block (lines 61-67) but with
`sourceWeight = TRAINING_SOURCE_WEIGHT` (`0.5` — self-report is softer than teacher grading),
then concat into `samples`. No other call site changes; `classDiagnosis` is untouched
(self-practice does not feed class diagnosis).

Effect: a "会" on a FOCUS KP nudges its score up (down-weighted), a "不会" nudges it down,
and the `靶向训练 → 学情` loop visibly closes after the 5-min cache TTL (the same staleness
contract assignment grading already accepts).

## 6. Spaced-review interaction

When an answered item's source is `ERROR_BOOK` and its entry is still ACTIVE:
- **会 (CORRECT):** advance that entry's review ladder — increment `reviewCount`, set
  `lastReviewedAt = now`, `nextReviewAt = nextReviewAtAfter(reviewCount+1, now)` — reusing the
  exact logic `error.markReviewed` uses (extract a shared `advanceReviewLadder` helper in
  `apps/web/server/lib/error-book.ts` and call it from both).
- **不会 (WRONG):** leave the entry due (no ladder change).

Variant-source items have no review ladder; they only record a `TrainingAttempt`.

## 7. tRPC surface

New router `training.*` on `consentGatedProcedure` (matches the error/analytics minor-consent
posture; **not** `chargedProcedure` — free):

- `training.startSession(input: { window?: AnalyticsWindow })`: resolves target KPs via
  `profileForStudent`, builds the ordered item pool (with `dueForReview` fallback), mints a
  `sessionId`, and returns `{ sessionId, items: [{ questionId, source, kpId, stemMd,
  solutionMd, level? }], targetKpNames: string[] }` or an `INSUFFICIENT_DATA` marker. Read-only
  (no writes on start).
- `training.submitAttempt(input: { sessionId, questionId, source, kpIds, selfResult: "KNOW"|"UNSURE" })`:
  writes one `TrainingAttempt`; on a `KNOW` for an ACTIVE error entry, advances the review
  ladder. Idempotent on `(sessionId, questionId)` is not required for v1 (re-submits append;
  acceptable), but the client submits each item once.

Access/ownership: `startSession` only reads the caller's own data; `submitAttempt` validates
that the `questionId` belongs to the caller's error book / variants before writing (reuse the
ownership posture of `validateEntryOwnership` — no cross-user writes).

## 8. UI

New student route `/training` under `app/(student)`, inside `AppShell`:

- Session view: one item at a time, hint-first (stem shown; solution behind a "查看解析"
  reveal, reusing the error-detail render); two self-check buttons 会 / 不会; progress
  "第 N/M 题"; methodology framing ("针对你的重点巩固方向" / "把一道题变成一类题").
- Completion: a short, calm summary ("完成 N 题，已记入学情") with a link to `/portrait`.
  No score readout, no 提分/percentage/pressure copy.
- Empty/insufficient: reuse the `StatePanel` "还没有足够的训练材料" with a next action (去答疑/做作业积累).
- Add a "训练" item to the student `RoleNav`, and a CTA on `/portrait` FOCUS areas → `/training`.

## 9. Compliance

- Hint-first reveal; self-check only; no scores, no 提分/分数/通过, no streak/pressure gamification.
- "重点巩固方向" wording (reuse `apps/web/lib/mastery-copy.ts`); 初中 题型归类 framing carried
  by the L1/L2/L3 ladder.
- Minor-consent gate via `consentGatedProcedure`; no PII beyond what error book/analytics
  already handle. `TrainingAttempt` holds no free-text, so no new PII surface.

## 10. Testing

- **analytics core unit:** `sourceWeight` multiplies decay weight; a down-weighted sample
  moves score less than a full-weight one; default `1.0` preserves existing behavior.
- **queries integration:** `profileForStudent` reads `TrainingAttempt` rows and blends them
  (down-weighted) with `AssignmentPerformance`.
- **training router integration:** `startSession` orders by FOCUS, caps size, falls back to
  `dueForReview` when targeted pool is thin, returns `INSUFFICIENT_DATA` when empty;
  `submitAttempt` writes a `TrainingAttempt` and advances the review ladder on KNOW for an
  ACTIVE error entry; rejects cross-user `questionId`.
- **E2E:** seed a student with FOCUS material → `/training` → answer 会/不会 → completion →
  portrait reflects the attempt (or assert the attempt row via an E2E hook). Then the full
  `@zhijiao/web` E2E suite + `pnpm typecheck` + `pnpm test` stay green.
- **migration:** `TrainingAttempt` + `TrainingItemSource` enum (Windows docker-exec migrate
  path per README if needed).

## 11. Acceptance criteria

- A student with FOCUS weak points can open `/training`, get a short session prioritized by
  those KPs (assembled from their own error book + variants, falling back to due review),
  self-check each item hint-first, and finish.
- Completed attempts persist as `TrainingAttempt` rows and measurably move the student's KP
  mastery in `/portrait` (down-weighted) after cache TTL.
- The session is never empty for a student with any practicable item, and never a paywall.
- Free, no AI calls, no new paid action; compliance posture preserved.
- No change to teacher `classDiagnosis`; `core.ts` stays pure (one additive field).
- Full web E2E + typecheck + all unit/integration suites pass.

## 12. Out of scope (follow-ups)

- Scheduling the Plan 9 KP reconciler (would enrich the targeted pool); tracked separately.
- Per-KP fresh AI generation; teacher-assigned targeted training; a `TrainingSession` history
  table / resume; image/OCR input (next MVP item).
