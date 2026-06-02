# Plan 16 Follow-up: Shell Identity + State Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the Plan 16 §9 (shell identity + role derivation + teacher nav) and §10 (skeleton + AI-generating + retry) residuals, all inside `apps/web`.

**Architecture:** A `server-only` identity resolver reads the session and feeds an async `AppShell` that self-resolves identity/demo-mode (pages stop passing `role`/`demoMode`). Teacher nav collapses to anchors into the existing class workspace. A `Skeleton` primitive + a pure `AiGeneratingPanel` + a retry button cover the §10 states.

**Tech Stack:** Next.js 14 App Router (RSC), tRPC + React Query (client), Prisma/Postgres, Vitest (node env), Playwright. Spec: `docs/superpowers/specs/2026-06-02-plan16-shell-state-followup-design.md`.

**Test note:** Vitest runs in the **node** environment (no jsdom). Pure functions are tested directly; presentational components are tested with `react-dom/server` `renderToStaticMarkup`; the identity resolver is tested against the `zhijiao_test_web` DB with `next/headers` mocked. Interaction state (retry click) is covered by Playwright E2E. The vitest `include` is widened to `*.test.tsx` in Task 4.

---

## File Structure

- Create `apps/web/server/shell-identity.ts` — resolve `{ userId, persona, displayName, primaryClassroomId? }` from the session cookie (Task 1).
- Modify `apps/web/components/shell/RoleNav.tsx` — `navForRole(role, classroomId?)` + teacher anchor hrefs (Task 2).
- Modify `apps/web/app/teacher/classes/[classroomId]/page.tsx` — add `id="assignments"`/`id="students"` anchors (Task 2).
- Modify `apps/web/components/shell/AppShell.tsx` — async, self-resolves identity + demo mode, renders identity, props shrink to `{ title?, children }` (Task 3).
- Modify ~12 pages that call `<AppShell role=… demoMode=…>` — drop both props (Task 3).
- Create `apps/web/components/ui/skeleton.tsx` — `Skeleton` + `SkeletonList` (Task 4).
- Modify the 6 client data views — swap text loading for skeletons (Task 4).
- Create `apps/web/components/ui/ai-generating-panel.tsx` — pure "AI 生成中" panel (Task 5).
- Modify `apps/web/components/TutorForm.tsx` + `apps/web/app/(student)/error-book/entry-actions.tsx` + `.../[entryId]/entry-detail.tsx` — generating panel + retry (Task 5).
- Modify `apps/web/e2e/demo.spec.ts` — identity + teacher-nav anchor assertions (Task 6).

---

### Task 1: Shell identity resolver

**Files:**
- Create: `apps/web/server/shell-identity.ts`
- Test: `apps/web/tests/integration/shell-identity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/integration/shell-identity.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const cookieStore: { value: string | undefined } = { value: undefined };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      cookieStore.value ? { name, value: cookieStore.value } : undefined,
  }),
}));

import { prisma } from "@zhijiao/db";
import { signAccess, COOKIE_AT } from "@zhijiao/auth";
import { env } from "@/server/env";
import { getShellIdentity } from "@/server/shell-identity";

async function tokenFor(userId: string, persona: "STUDENT" | "TEACHER" | "PARENT") {
  return signAccess(
    { userId, sessionId: randomUUID(), persona, roles: [] },
    env.ACCESS_JWT_SECRET,
  );
}

describe("getShellIdentity", () => {
  beforeEach(() => {
    cookieStore.value = undefined;
  });

  it("returns null when there is no session cookie", async () => {
    expect(await getShellIdentity()).toBeNull();
  });

  it("returns null for a deactivated user", async () => {
    const id = randomUUID();
    await prisma.user.create({
      data: { id, name: "走了", persona: "STUDENT", deletedAt: new Date() },
    });
    cookieStore.value = await tokenFor(id, "STUDENT");
    expect(await getShellIdentity()).toBeNull();
  });

  it("resolves displayName + persona for a student", async () => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "周予安", persona: "STUDENT" } });
    cookieStore.value = await tokenFor(id, "STUDENT");
    const got = await getShellIdentity();
    expect(got).toMatchObject({ userId: id, persona: "STUDENT", displayName: "周予安" });
    expect(got?.primaryClassroomId).toBeUndefined();
  });

  it("includes the teacher's primaryClassroomId", async () => {
    const tid = randomUUID();
    const cid = randomUUID();
    const subjectId = randomUUID();
    await prisma.user.create({ data: { id: tid, name: "李老师", persona: "TEACHER" } });
    await prisma.subject.create({ data: { id: subjectId, code: `s-${cid}`, name: "数学" } });
    await prisma.classroom.create({
      data: { id: cid, name: "初二 3 班", subjectId, gradeLevel: "G8" },
    });
    await prisma.classroomMember.create({
      data: { classroomId: cid, userId: tid, role: "TEACHER" },
    });
    cookieStore.value = await tokenFor(tid, "TEACHER");
    const got = await getShellIdentity();
    expect(got).toMatchObject({ persona: "TEACHER", primaryClassroomId: cid });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/shell-identity.test.ts`
Expected: FAIL — `Cannot find module '@/server/shell-identity'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/server/shell-identity.ts
import "server-only";
import { cookies } from "next/headers";
import type { Persona } from "@prisma/client";
import { prisma } from "@zhijiao/db";
import { verifyAccess, COOKIE_AT } from "@zhijiao/auth";
import { env } from "./env.js";

export interface ShellIdentity {
  userId: string;
  persona: Persona;
  displayName: string;
  primaryClassroomId?: string;
}

export function roleBadgeLabel(persona: Persona): string {
  if (persona === "STUDENT") return "学生";
  if (persona === "TEACHER") return "教师";
  return "家长";
}

export async function getShellIdentity(): Promise<ShellIdentity | null> {
  const token = cookies().get(COOKIE_AT)?.value;
  if (!token) return null;

  const v = await verifyAccess(token, env.ACCESS_JWT_SECRET);
  if (!v.ok) return null;

  const user = await prisma.user.findUnique({
    where: { id: v.claims.userId },
    select: { name: true, deletedAt: true },
  });
  if (!user || user.deletedAt != null) return null;

  let primaryClassroomId: string | undefined;
  if (v.claims.persona === "TEACHER") {
    const member = await prisma.classroomMember.findFirst({
      where: { userId: v.claims.userId, role: "TEACHER" },
      orderBy: { createdAt: "desc" },
      select: { classroomId: true },
    });
    primaryClassroomId = member?.classroomId ?? undefined;
  }

  return {
    userId: v.claims.userId,
    persona: v.claims.persona,
    displayName: user.name ?? roleBadgeLabel(v.claims.persona),
    primaryClassroomId,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/shell-identity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/shell-identity.ts apps/web/tests/integration/shell-identity.test.ts
git commit -m "feat(web): shell identity resolver from session"
```

---

### Task 2: Teacher nav anchors + classroom-aware navForRole

**Files:**
- Modify: `apps/web/components/shell/RoleNav.tsx`
- Modify: `apps/web/app/teacher/classes/[classroomId]/page.tsx` (add section anchors)
- Test: `apps/web/tests/unit/role-nav.test.ts`

- [ ] **Step 1: Update the failing test**

Replace the teacher case and add an href assertion in `apps/web/tests/unit/role-nav.test.ts`:

```ts
  it("returns teacher nav with Plan 17 and 18 preview entries", () => {
    expect(navForRole("TEACHER").map((item) => item.label)).toEqual([
      "班级",
      "作业",
      "学生",
      "AI 出卷",
      "AI 课件",
    ]);
  });

  it("teacher nav anchors into the class workspace when a classroom is known", () => {
    const items = navForRole("TEACHER", "cls-1");
    expect(items.find((i) => i.label === "作业")?.href).toBe(
      "/teacher/classes/cls-1#assignments",
    );
    expect(items.find((i) => i.label === "学生")?.href).toBe(
      "/teacher/classes/cls-1#students",
    );
    expect(items.find((i) => i.label === "AI 出卷")?.href).toBe(
      "/teacher/classes/cls-1#ai-paper",
    );
  });

  it("teacher nav falls back to /teacher with no classroom", () => {
    expect(navForRole("TEACHER").every((i) => i.href.startsWith("/teacher"))).toBe(true);
    expect(navForRole("TEACHER").find((i) => i.label === "作业")?.href).toBe("/teacher");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/role-nav.test.ts`
Expected: FAIL — `navForRole` takes one arg / hrefs are all `/teacher`.

- [ ] **Step 3: Update navForRole**

Replace the teacher branch in `apps/web/components/shell/RoleNav.tsx`:

```tsx
export function navForRole(role: Persona, classroomId?: string): NavItem[] {
  if (role === "STUDENT") {
    return [
      { label: "答疑", href: "/tutor" },
      { label: "错题本", href: "/error-book" },
      { label: "作业", href: "/assignments" },
      { label: "学情", href: "/portrait" },
    ];
  }

  if (role === "TEACHER") {
    const base = classroomId ? `/teacher/classes/${classroomId}` : "/teacher";
    const anchor = (frag: string) => (classroomId ? `${base}#${frag}` : "/teacher");
    return [
      { label: "班级", href: "/teacher" },
      { label: "作业", href: anchor("assignments") },
      { label: "学生", href: anchor("students") },
      { label: "AI 出卷", href: anchor("ai-paper"), preview: true },
      { label: "AI 课件", href: anchor("ai-courseware"), preview: true },
    ];
  }

  return [
    { label: "孩子", href: "/parent" },
    { label: "学情", href: "/parent" },
    { label: "隐私", href: "/account/privacy" },
  ];
}

export function RoleNav({ role, classroomId }: { role: Persona; classroomId?: string }) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200">
      {navForRole(role, classroomId).map((item) => (
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

- [ ] **Step 4: Add section anchors on the class page**

In `apps/web/app/teacher/classes/[classroomId]/page.tsx`, add `id="assignments"` to the 分层作业 `<section>` and `id="students"` to the 学生 `<section>` (the `#ai-paper`/`#ai-courseware` anchors already exist). Locate the two `<section …>` wrappers for the assignment list and the student list and add the `id` attribute to each.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/role-nav.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/shell/RoleNav.tsx apps/web/app/teacher/classes/[classroomId]/page.tsx apps/web/tests/unit/role-nav.test.ts
git commit -m "feat(web): teacher nav anchors into class workspace"
```

---

### Task 3: Async AppShell self-resolves identity; pages drop role/demoMode

**Files:**
- Modify: `apps/web/components/shell/AppShell.tsx`
- Modify: all pages calling `<AppShell role=… demoMode=…>` (see grep below)
- Test: none new (covered by typecheck + Task 6 E2E); relies on Task 1/2 units.

- [ ] **Step 1: Rewrite AppShell as an async server component**

```tsx
// apps/web/components/shell/AppShell.tsx
import type { ReactNode } from "react";
import { isDemoModeEnabled } from "@/server/demo/config";
import { getShellIdentity, roleBadgeLabel } from "@/server/shell-identity";
import { DemoModeBanner } from "./DemoModeBanner";
import { RoleNav } from "./RoleNav";

export async function AppShell({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const identity = await getShellIdentity();
  const demoMode = isDemoModeEnabled();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <a href="/" className="text-lg font-semibold tracking-tight">
            智教
          </a>
          {identity ? (
            <div className="flex flex-wrap items-center gap-4">
              <RoleNav role={identity.persona} classroomId={identity.primaryClassroomId} />
              <span
                className="flex items-center gap-2 text-sm text-slate-600"
                data-testid="shell-identity"
              >
                <span className="font-medium text-slate-950">{identity.displayName}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                  {roleBadgeLabel(identity.persona)}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </header>
      {demoMode ? <DemoModeBanner /> : null}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {title ? (
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">{title}</h1>
        ) : null}
        {children}
      </main>
    </div>
  );
}
```

(`<a href="/">` replaces `<Link>` so the shell needs no client import; identity block is server-rendered.)

- [ ] **Step 2: Find every call site**

Run: `pnpm.cmd --% exec rg -n "<AppShell" apps/web/app` (or use editor search). Expected ~12 matches across `app/(student)/*`, `app/teacher/*`, `app/parent/*`.

- [ ] **Step 3: Drop role/demoMode props at each call site**

For each page, change `<AppShell role="…" demoMode={…}>` to `<AppShell>` (keep `title=…` if present), and remove the now-unused `isDemoModeEnabled` import where it was only used for the shell. Example — `apps/web/app/teacher/page.tsx`:

```tsx
// before:  <AppShell role="TEACHER" demoMode={isDemoModeEnabled()}>
// after:
    <AppShell>
```

Remove `import { isDemoModeEnabled } from "@/server/demo/config";` from pages where it is no longer referenced (some pages also use it elsewhere — keep it there).

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm.cmd --filter @zhijiao/web typecheck`
Expected: PASS — no page passes `role`/`demoMode`; `AppShell` props are `{ title?, children }`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/shell/AppShell.tsx apps/web/app
git commit -m "feat(web): AppShell self-resolves identity; derive role from session"
```

---

### Task 4: Skeleton primitive + apply to client data views

**Files:**
- Create: `apps/web/components/ui/skeleton.tsx`
- Modify: `apps/web/vitest.config.ts` (widen include to `.test.tsx`)
- Modify: `error-book-list.tsx`, `error-book/[entryId]/entry-detail.tsx`, `portrait/portrait-view.tsx`, `parent/parent-view.tsx`, `parent/children/[childId]/child-portrait.tsx`, `tutor/error-analysis-card.tsx`
- Test: `apps/web/tests/unit/skeleton.test.tsx`

- [ ] **Step 1: Widen vitest include**

In `apps/web/vitest.config.ts`, change `include: ["tests/**/*.test.ts"]` to:

```ts
    include: ["tests/**/*.test.{ts,tsx}"],
```

- [ ] **Step 2: Write the failing test**

```tsx
// apps/web/tests/unit/skeleton.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  it("renders an animated placeholder", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain("animate-pulse");
  });

  it("renders N rows", () => {
    const html = renderToStaticMarkup(<SkeletonList rows={3} />);
    expect(html.match(/animate-pulse/g)?.length).toBe(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/skeleton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement Skeleton**

```tsx
// apps/web/components/ui/skeleton.tsx
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="skeleton-list">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/skeleton.test.tsx`
Expected: PASS.

- [ ] **Step 6: Swap text loading for skeletons**

In each client view, replace the `isLoading` branch that renders `<StatePanel title="加载中..." />` (or similar text) with a `SkeletonList` (or `Skeleton`) wrapped to match the surrounding layout. Example — `error-book/[entryId]/entry-detail.tsx`:

```tsx
  if (q.isLoading) {
    return <div className="mt-6"><SkeletonList rows={4} /></div>;
  }
```

Add `import { Skeleton, SkeletonList } from "@/components/ui/skeleton";` to each modified file. Keep all error / empty / not-found branches exactly as they are (those are not loading states). Grep for the loading branches: `pnpm.cmd --% exec rg -n "加载中" apps/web/app apps/web/components`.

- [ ] **Step 7: Verify typecheck + unit pass**

Run: `pnpm.cmd --filter @zhijiao/web typecheck` then `pnpm.cmd --filter @zhijiao/web test -- tests/unit/skeleton.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/ui/skeleton.tsx apps/web/vitest.config.ts apps/web/tests/unit/skeleton.test.tsx apps/web/app apps/web/components
git commit -m "feat(web): skeleton loading states on client data views"
```

---

### Task 5: AI-generating panel + retry on the two AI flows

**Files:**
- Create: `apps/web/components/ui/ai-generating-panel.tsx`
- Modify: `apps/web/components/TutorForm.tsx`
- Modify: `apps/web/app/(student)/error-book/entry-actions.tsx`
- Test: `apps/web/tests/unit/ai-generating-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/unit/ai-generating-panel.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";

describe("AiGeneratingPanel", () => {
  it("shows calm generating copy with an animation", () => {
    const html = renderToStaticMarkup(<AiGeneratingPanel label="AI 生成中…" />);
    expect(html).toContain("AI 生成中");
    expect(html).toContain("animate-pulse");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/ai-generating-panel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

```tsx
// apps/web/components/ui/ai-generating-panel.tsx
export function AiGeneratingPanel({ label = "AI 生成中…" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-600"
      data-testid="ai-generating"
      role="status"
      aria-live="polite"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
      {label}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/ai-generating-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into TutorForm**

In `apps/web/components/TutorForm.tsx`: import the panel; render `{ask.isPending && <AiGeneratingPanel label="AI 讲解生成中…" />}` directly under the submit button; in the `{err && …}` block append a retry button that calls `submit()`:

```tsx
{err && (
  <p data-testid="tutor-error" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
    {err}
    {insufficientBalance && (
      <> <Link href="/wallet" className="underline text-emerald-700" data-testid="tutor-error-recharge-link">去充值</Link></>
    )}
    {!insufficientBalance && (
      <> <button type="button" onClick={submit} className="underline" data-testid="tutor-retry">重试</button></>
    )}
  </p>
)}
```

Add `import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";`.

- [ ] **Step 6: Wire into the variant flow**

In `apps/web/app/(student)/error-book/entry-actions.tsx`: import the panel; render `{variantMutation.isPending && <AiGeneratingPanel label="举一反三生成中…" />}` below the action buttons; in the `{err && …}` block append a retry button calling `onGenerateVariant()` when the error is not an insufficient-balance one:

```tsx
{!insufficientBalance && (
  <> <button type="button" onClick={onGenerateVariant} className="underline" data-testid="entry-actions-retry">重试</button></>
)}
```

Add `import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";`.

- [ ] **Step 7: Verify typecheck + unit pass**

Run: `pnpm.cmd --filter @zhijiao/web typecheck` then `pnpm.cmd --filter @zhijiao/web test -- tests/unit/ai-generating-panel.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/ui/ai-generating-panel.tsx apps/web/components/TutorForm.tsx "apps/web/app/(student)/error-book/entry-actions.tsx" apps/web/tests/unit/ai-generating-panel.test.tsx
git commit -m "feat(web): AI generating panel + retry on tutor and variant flows"
```

---

### Task 6: Demo E2E for identity + nav; full regression

**Files:**
- Modify: `apps/web/e2e/demo.spec.ts`

- [ ] **Step 1: Extend the demo E2E**

In `apps/web/e2e/demo.spec.ts`, in the student demo test assert the shell identity is shown; in the teacher demo test assert the 作业 nav link resolves to a class-workspace anchor. Add to the existing student test (after entering the tutor path):

```ts
  await expect(page.getByTestId("shell-identity")).toContainText("周予安");
```

Add to the teacher test (after landing on the class workspace):

```ts
  await expect(
    page.getByRole("link", { name: "作业" }),
  ).toHaveAttribute("href", /\/teacher\/classes\/.*#assignments/);
```

(Adjust the expected student display name to match the demo seed's student `name`.)

- [ ] **Step 2: Run the demo spec**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e demo.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full web E2E**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e`
Expected: all specs PASS (the §9 rename of nav hrefs + async shell must not break existing flows).

- [ ] **Step 4: Full typecheck + unit/integration**

Run: `pnpm.cmd typecheck` then `pnpm.cmd test`
Expected: 8/8 packages PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/demo.spec.ts
git commit -m "test(e2e): assert shell identity + teacher nav anchors"
```

---

## Implementation Order

1. Task 1 — identity resolver (pure dependency for the shell).
2. Task 2 — nav (independent, unit-tested).
3. Task 3 — async shell wiring + page prop removal (depends on 1 & 2).
4. Task 4 — skeletons.
5. Task 5 — AI generating + retry.
6. Task 6 — E2E + full regression lock.

## Self-Review

- **Spec coverage:** §3 resolver → Task 1; §4 AppShell + nav + anchors → Tasks 2–3; §5 skeleton/AI/retry → Tasks 4–5; §6 testing → Tasks 1,2,4,5 units + Task 6 E2E; §7 acceptance → Task 6 full regression. No gaps.
- **Placeholder scan:** all code steps contain real code; the only descriptive steps (Task 2 Step 4 anchors, Task 3 Step 3 call-site edits, Task 4 Step 6 loading swaps) are mechanical edits guided by an exact grep and a worked example.
- **Type consistency:** `getShellIdentity`/`ShellIdentity`/`roleBadgeLabel` (Task 1) are consumed unchanged by `AppShell` (Task 3); `navForRole(role, classroomId?)` (Task 2) matches the `RoleNav` prop and the `AppShell` call; `Skeleton`/`SkeletonList` (Task 4) and `AiGeneratingPanel` (Task 5) match their tests and call sites.
