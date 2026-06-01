# Plan 16: Demo-ready Product Hardening Design

## 1. Goal

Plan 16 turns the existing MVP from a set of implemented feature flows into a polished, stable, teacher-facing product demo suitable for potential junior-high math teachers.

The target audience is a first-time junior-high math teacher evaluator. The demo must make the product feel simple, trustworthy, and valuable without requiring manual setup, account switching, or empty-state explanation.

Plan 16 focuses on three parallel demo paths:

- Student: AI-guided tutoring, error analysis, error book, and variant practice.
- Teacher: class weak-point overview, tiered assignment generation, publishing, grading, and class feedback.
- Parent: simplified learning portrait and recent consolidation direction.

The three paths must share one coherent data story: an eighth-grade math class working on the relationship between linear functions, equations, and inequalities.

## 2. Scope

Plan 16 includes:

- A gated `/demo` entry page with quick entry into student, teacher, and parent demo identities.
- Demo reset and verification scripts that produce deterministic data.
- A near-release UI pass across the main student, teacher, and parent paths.
- A unified role-aware app shell.
- Apple-like interaction and visual polish: simple, quiet, premium, fast, and restrained.
- Demo-specific copy and action guidance so first-time teachers know what to do next.
- Loading, empty, error, forbidden, insufficient-balance, AI-pending, and AI-failure states on the demo paths.
- Route cards or preview entries for future AI paper generation and AI courseware generation.
- Demo E2E coverage for the role entry points and critical path navigation.

Plan 16 excludes:

- Production AI paper generation.
- Production AI courseware generation.
- Real SMS, real WeChat OAuth, or real WeChat Pay activation.
- New roster management UI.
- Major database redesign.
- A marketing landing page.
- Student ranking, score guarantees, exam-question prediction language, or fear-based copy.

Production AI paper generation should be Plan 17. Production AI courseware generation should be Plan 18.

## 3. Demo Entry and Identity

Add a `/demo` page enabled only when demo mode is explicitly allowed by environment configuration.

The page presents three quick-entry identities:

- Student: enters the learning and error-book loop.
- Teacher: enters the class and assignment workflow.
- Parent: enters a linked child's simplified learning portrait.

The quick-entry mechanism must not replace real authentication. Normal login remains available. Demo entry may create a real session for fixed seeded demo users, but it must be gated so it cannot be accidentally exposed in a future production environment.

The `/demo` page should say, in short copy, that the demo uses eighth-grade math to show the student, teacher, and parent learning loop.

## 4. Demo Data Story

The deterministic demo data should include:

- One class: 初二 3 班.
- One teacher demo user.
- One parent demo user linked to one student.
- Three to five student demo users:
  - one stable learner,
  - one learner currently consolidating,
  - one learner needing focused support.
- One central topic: 一次函数与方程/不等式的关系.
- Several knowledge points:
  - 函数图像交点,
  - 待定系数法,
  - 一次函数与一元一次方程关系.
- Common root causes:
  - 概念混淆,
  - 读题失误,
  - 公式误用,
  - 计算疏漏,
  - 迁移不足.
- At least one published tiered assignment.
- At least one submitted assignment ready for grading.
- Several error-book entries and variant groups.
- Enough assignment-performance data for student, class, and parent learning portraits.
- Teacher wallet state sufficient for demo actions.

The demo reset must be idempotent. Re-running it must not duplicate classes, users, questions, assignments, family links, error-book entries, or ledgers.

## 5. Student Path

The student path should demonstrate:

1. Enter from `/demo` as the student.
2. Open the tutoring page with a prepared eighth-grade math question.
3. Receive hint-first explanation that emphasizes method rather than answer copying.
4. Submit or view a mistaken answer.
5. Run error analysis.
6. Save or view the result in the error book.
7. Open an error-book detail and see L1/L2/L3 variant practice.
8. Visit the learning portrait to see current consolidation direction.

The page should guide the next action at each step. The student should not land on a blank page or have to invent demo content manually.

## 6. Teacher Path

The teacher path should demonstrate:

1. Enter from `/demo` as the teacher.
2. See the 初二 3 班 class overview.
3. Understand weak knowledge points, common root causes, and recent assignment status quickly.
4. Generate or open a tiered assignment from weak-point context.
5. Review and edit the draft.
6. Publish the assignment.
7. Open grading for a submitted student assignment.
8. Grade at least one answer and trigger error-book writeback for wrong or partial work.
9. See class feedback or an individual student portrait.

The teacher interface should include future-module entry cards for:

- AI 出卷: planned production paper generation by grade, subject, knowledge point, difficulty, question type, and count.
- AI 课件: planned production courseware generation by knowledge point, lesson structure, examples, mistakes, and practice.

In Plan 16, these cards are navigation/roadmap previews only. They must not imply production availability.

## 7. Parent Path

The parent path should demonstrate:

1. Enter from `/demo` as the parent.
2. See the linked child.
3. Open the child's simplified learning portrait.
4. See grouped learning state:
   - 掌握较稳,
   - 正在巩固,
   - 重点关注.
5. Read a short recent recommendation.

The parent view must avoid rankings, pressure language, exact score promises, or excessive diagnostic detail. It should feel calm and useful.

## 8. UI Direction

Plan 16 should move the product toward a polished platform shell with an Apple-like product feel:

- Simple, quiet, premium, and restrained.
- Clear hierarchy, with one primary action per page.
- More whitespace and rhythm.
- Short Chinese copy.
- Subtle interaction feedback.
- Consistent rounded corners, shadows, spacing, inputs, buttons, tags, and states.
- No busy gradient-orb background, no decorative clutter, and no marketing-heavy landing page.

The style should not copy Apple branding or assets. It should borrow the design discipline: less noise, clearer focus, smoother interaction.

Teacher pages must remain efficient. The goal is not empty minimalism; it is high-signal information shown calmly.

## 9. App Shell and Navigation

Add or refactor a shared shell for protected product pages:

- Brand area.
- Role-aware navigation.
- Current demo identity or current authenticated user.
- Back to demo center when demo mode is active.
- Clear primary section navigation for each role.

The shell should support:

- Student sections: Tutor, Error Book, Assignments, Portrait.
- Teacher sections: Class, Assignments, Students, Future AI Paper, Future AI Courseware.
- Parent sections: Children, Learning Portrait, Privacy.

The shell should not hide real product routes behind demo-only logic. Demo mode adds quick entry and helper navigation, but the underlying app remains real.

## 10. State Handling

Plan 16 should add polished states on the main demo paths:

- Loading and skeleton states.
- Empty states with one clear next action.
- Error states with recoverable language.
- Unauthorized and forbidden states.
- Insufficient balance state.
- Guardian-consent gate state.
- AI generating state.
- AI failure and retry state.
- Demo-mode disabled state for `/demo`.

These states must use compliant wording and avoid exposing internal stack traces or raw tRPC errors to users.

## 11. Scripts and Verification

Add scripts for demo preparation and validation:

- `pnpm demo:reset`: restores deterministic demo data.
- `pnpm verify:demo`: verifies required users, class, assignments, error-book entries, family links, wallet state, and learning portrait inputs.

The exact script names can be adjusted to match existing package conventions, but the result must be discoverable from the root `package.json`.

Testing expectations:

- Unit tests for demo seed helpers where practical.
- Integration tests for demo identity entry and gated access.
- Verification around idempotent demo reset.
- Playwright E2E for `/demo` role entries and critical navigation.
- Existing `typecheck` and relevant test suites must remain green.

## 12. Compliance and Safety

Plan 16 must preserve the product's existing compliance posture:

- Do not market the product as answer-copying.
- Do not promise score improvement.
- Do not imply exam-question prediction or leaked exam insight.
- Do not rank students in the parent view.
- Keep minor-protection and guardian-consent gates intact.
- Keep PII redaction and DSAR flows intact.
- Gate demo entry so it cannot become a production backdoor.

## 13. Acceptance Criteria

Plan 16 is complete when:

- `/demo` is available in demo mode and hidden or blocked outside demo mode.
- Student, teacher, and parent demo identities can be entered without manual OTP or WeChat flow.
- The three demo paths share the same eighth-grade math data story.
- Teacher users can understand class weak points and the tiered-assignment workflow within 30 seconds.
- Student users can complete or observe tutoring, error analysis, error-book, and variant-practice flow.
- Parent users can see a simplified, calm learning portrait.
- Main demo pages have polished Apple-like visual treatment and no obvious layout breakage.
- Demo reset is idempotent.
- Demo verification catches missing core data.
- Demo E2E passes.
- No production-only credentials are required.
- No AI paper or AI courseware production workflow is implemented in Plan 16; those remain explicit Plan 17 and Plan 18 work.

