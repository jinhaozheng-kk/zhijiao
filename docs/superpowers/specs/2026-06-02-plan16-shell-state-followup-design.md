# Plan 16 Follow-up: Shell Identity + State Handling Design

## 1. Goal

Close out the two residual items flagged in the Plan 16 demo-hardening review that
were deferred from the agreed blocker set:

- **§9 (App Shell / Navigation)**: the shell hardcodes `role` per page, shows no
  current identity, and the teacher nav has three identical `/teacher` hrefs (plus two
  dead `#ai-paper`/`#ai-courseware` preview links that point at the wrong route).
- **§10 (State Handling)**: loading is plain `加载中…` text (no skeleton); the two AI
  flows (`tutor.ask`, `variant.generateForEntry`) lack an explicit "AI 生成中" panel and
  a discoverable "重试" affordance on failure.

These are polish-only changes inside `apps/web`. No schema, migration, or AI-routing
changes. Compliance posture (hint-first, no score promise, calm parent view, no rankings)
is preserved unchanged.

## 2. Scope

In scope:

- A server-side identity resolver for protected product pages.
- `AppShell` self-resolves identity + demo mode; pages stop passing `role`/`demoMode`.
- Role is derived from the session `persona`, not hardcoded per page.
- Teacher nav collapses to anchors into the real class workspace; no new routes.
- A `Skeleton` UI primitive applied to the main client data views.
- Explicit AI-generating panel + retry affordance on the two AI flows.

Out of scope:

- New teacher-level `/teacher/assignments` or `/teacher/students` list routes (no
  cross-classroom query helper exists; over-built for a single-classroom demo).
- AI paper / courseware production (Plan 17 / Plan 18).
- Any backend/router/schema change.

## 3. Shell Identity (§9)

Add `apps/web/server/shell-identity.ts` (`server-only`):

```
getShellIdentity(): Promise<ShellIdentity | null>
ShellIdentity = { userId, persona, displayName, primaryClassroomId?: string }
```

It reads the access-token cookie via `next/headers` `cookies()`, runs
`verifyAccess(token, env.ACCESS_JWT_SECRET)` (the same primitive `server/context.ts`
uses), and on success looks up `User.name` (the JWT carries `persona`/`userId`/`roles`
but **not** the display name). For `persona === "TEACHER"` it also resolves the first
classroom id (most-recent `Classroom` the teacher belongs to, or the global first in the
demo's single-classroom case) for nav deep-links. Returns `null` when there is no/invalid
session, a revoked session, or a deactivated user — mirroring `context.ts` fail-safe rules
at the depth needed for display (it does not need to reproduce refresh logic; a null
identity just degrades the shell to a brand-only header).

`displayName` is shown verbatim from `User.name`; if absent, fall back to a role-based
label (学生 / 老师 / 家长). No PII beyond the existing display name is surfaced.

## 4. AppShell + RoleNav (§9)

`AppShell` becomes an **async server component**. It:

- calls `getShellIdentity()` and `isDemoModeEnabled()` itself,
- renders the brand, the current identity (display name + role badge), and `RoleNav`,
- derives `role` from `identity.persona`,
- passes `role` + `primaryClassroomId` to `RoleNav`,
- still shows `DemoModeBanner` when demo mode is on,
- renders a brand-only header (no nav, no identity) when identity is `null`.

Its props shrink to `{ title?, children }`. Every page that wrapped content in
`<AppShell role=… demoMode=…>` (~12 pages under `app/(student)`, `app/teacher`,
`app/parent`) drops both props.

`navForRole` gains a second optional arg `classroomId`. Teacher nav becomes:

| label | href |
|---|---|
| 班级 | `/teacher` |
| 作业 | `/teacher/classes/{cid}#assignments` |
| 学生 | `/teacher/classes/{cid}#students` |
| AI 出卷 (preview) | `/teacher/classes/{cid}#ai-paper` |
| AI 课件 (preview) | `/teacher/classes/{cid}#ai-courseware` |

When `classroomId` is absent, all teacher items fall back to `/teacher`. Student and
parent nav are unchanged. Add `id="assignments"` and `id="students"` to the two existing
sections on `app/teacher/classes/[classroomId]/page.tsx` (the `#ai-paper`/`#ai-courseware`
anchors already exist there).

## 5. State Handling (§10)

Add `apps/web/components/ui/skeleton.tsx`: a `Skeleton` block and a small `SkeletonList`
(animated `bg-slate-200` placeholders matching existing card rhythm). Replace the plain
`加载中…` `StatePanel` loading branches in the client data views with skeletons:
`error-book-list`, `error-book/[entryId]/entry-detail`, `portrait/portrait-view`,
`parent/parent-view`, `parent/children/[childId]/child-portrait`,
`tutor/error-analysis-card`.

AI flows:

- **AI-generating panel**: while `tutor.ask` (`components/TutorForm.tsx`) or
  `variant.generateForEntry` (`app/(student)/error-book/entry-actions.tsx`) is pending,
  render a visible "AI 生成中…" panel (calm copy, animated) in addition to the existing
  disabled button. For variant generation the panel renders in `entry-detail`'s
  `举一反三` section.
- **Retry affordance**: on AI failure, render a `重试` button beside the existing
  compliant error copy that re-invokes the same mutation. Idempotency keys keep the
  existing behavior (a retry mints a fresh `clientRequestId`, same as re-clicking the
  primary button today) — no double-charge regression.

Error copy continues to route through `lib/error-copy.ts`; no raw tRPC/stack text is
exposed. `INSUFFICIENT_BALANCE` keeps its existing `去充值` deep-link.

## 6. Testing

TDD, red-before-green per task.

- Unit: `getShellIdentity` (mock `cookies()` + `verifyAccess`, assert identity/null
  branches); `navForRole("TEACHER", cid)` href assertions incl. fallback; `Skeleton`
  render; AI-state + retry render in `TutorForm` / `entry-actions` via the existing
  component test setup.
- Integration: existing `demo-entry` / page-render paths must stay green with the
  async `AppShell`.
- E2E: extend `e2e/demo.spec.ts` to assert (a) the shell shows the demo identity, and
  (b) the teacher nav 作业/学生 links resolve to the class workspace anchors. Then the
  **full** `@zhijiao/web` E2E suite must pass (not just `demo.spec.ts`).
- `pnpm typecheck` + `pnpm test` green across all 8 packages.

## 7. Acceptance Criteria

- The shell shows the current authenticated/demo identity (name + role badge) on
  student, teacher, and parent product pages.
- Role is derived from the session; no page passes a hardcoded `role`.
- Teacher nav has no duplicate `/teacher` hrefs; 作业/学生/AI-cards resolve to real class
  workspace anchors; the previously-dead AI preview links work.
- Main client data views show a skeleton while loading.
- The two AI flows show an explicit "AI 生成中" state and a "重试" button on failure.
- Compliance posture unchanged; no schema/migration change.
- Full web E2E + typecheck + all unit/integration suites pass.
