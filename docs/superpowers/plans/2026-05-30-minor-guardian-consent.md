# 未成年人监护人同意（<14 硬门禁）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 可靠识别 <14 用户，在取得监护人同意前对其账号施加 tRPC 层硬门禁；监护人同意经复用 FamilyLink 的绑定流程取得并作为可审计 `GuardianConsent` 行落库，可撤回；PII 治理覆盖新数据。

**Architecture:** `User.birthYear` 自报 + 纯函数 `isUnder14`（保守判龄）推导 `User.guardianConsentStatus`（NOT_REQUIRED/PENDING/GRANTED，承重字段进 `ctx.auth`，不进 JWT）。tRPC 中间件 `requireGuardianConsent` 拦 PENDING（白名单：auth.* / family.*）；同意经 `family.bindByCode` 的 <14 分支写 `GuardianConsent` + 置 GRANTED。enforcement 在 tRPC 层（edge middleware 读不到 DB-only 状态），UX 跳转用客户端 `QueryCache onError`。

**Tech Stack:** Prisma 5、tRPC v11、Next 14 App Router、Vitest、Playwright、TanStack Query。

**Spec:** `docs/superpowers/specs/2026-05-30-minor-guardian-consent-design.md`

> **与 spec §5 的偏差（已确认更正）**：spec 原写"Next 页面 middleware 跳转"。实际 `apps/web/middleware.ts` 是 edge、仅判 cookie 存在，**读不到 DB-only 的 `guardianConsentStatus`**（与 `isMinor` 同理不进 JWT）。故 enforcement 完全落在 tRPC 层（Task 3/6，权威可测）；UX 跳转改用客户端 React Query `QueryCache onError` 捕获 `GUARDIAN_CONSENT_REQUIRED`（Task 8）。`middleware.ts` 不改。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/db/prisma/schema.prisma` | `User.birthYear` / `User.guardianConsentStatus`、`GuardianConsentStatus` enum、`GuardianConsent` 表 |
| `apps/web/server/lib/consent.ts` | 纯函数 `isUnder14` / `initialConsentStatus`（零 Prisma） |
| `apps/web/server/context.ts` | `ctx.auth.guardianConsentStatus`（与 isMinor 同查询） |
| `apps/web/server/trpc.ts` | `requireGuardianConsent` 中间件、`consentGatedProcedure`、把 gate 加进 `chargedProcedure` |
| `apps/web/server/routers/auth.ts` | `RegisterInput.birthYear` + register 写状态 |
| `apps/web/server/routers/family.ts` | `bindByCode` <14 consent 分支 + `revoke` 撤回写 revokedAt 并回 PENDING |
| `apps/web/server/routers/{tutor,error,variant,analytics,assignment,classroom}.ts` | 数据 procedure 改挂 `consentGatedProcedure`（auth/family 不动） |
| `apps/web/server/lib/pii-governance.ts` | 注销删 GuardianConsent + guardian 侧回 PENDING + birthYear scrub；导出含 birthYear/consent |
| `apps/web/app/(student)/guardian-consent/page.tsx` | 童引导页（发码 + 同意声明文案） |
| `apps/web/app/providers.tsx` | QueryCache onError：`GUARDIAN_CONSENT_REQUIRED` → 跳 `/guardian-consent` |

---

## Task 1: Schema — birthYear + guardianConsentStatus + GuardianConsent

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: 加 enum + User 字段 + 新表**

在 `schema.prisma` 加枚举（放在其它 enum 附近）：

```prisma
enum GuardianConsentStatus {
  NOT_REQUIRED
  PENDING
  GRANTED
}
```

在 `model User` 内（`isMinor` 行下方）加：

```prisma
  birthYear            Int?                   @map("birth_year")
  guardianConsentStatus GuardianConsentStatus @default(NOT_REQUIRED) @map("guardian_consent_status")
```

并在 User 的 relations 区加两条反向关系：

```prisma
  childConsents       GuardianConsent[]  @relation("ChildConsents")
  guardianConsents    GuardianConsent[]  @relation("GuardianConsents")
```

新增 model（放在 FamilyLink 附近）：

```prisma
model GuardianConsent {
  id             String    @id @default(cuid())
  childUserId    String    @map("child_user_id")
  guardianUserId String    @map("guardian_user_id")
  consentScope   String    @map("consent_scope")
  method         String
  consentedAt    DateTime  @default(now()) @map("consented_at")
  revokedAt      DateTime? @map("revoked_at")
  createdAt      DateTime  @default(now()) @map("created_at")

  child    User @relation("ChildConsents",    fields: [childUserId],    references: [id], onDelete: Cascade)
  guardian User @relation("GuardianConsents", fields: [guardianUserId], references: [id], onDelete: Cascade)

  @@index([childUserId])
  @@index([guardianUserId])
  @@map("guardian_consents")
}
```

- [ ] **Step 2: 生成 client + 建 migration**

Run（Windows：若 `db:migrate` 直连失败，按 README 用 docker-exec 绕过）：
```
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --name guardian_consent
```
Expected: migration 文件生成，client 重新生成，无错误。

- [ ] **Step 3: 重建 test DB schema**

Run: `pnpm.cmd test:setup`
Expected: 6 个 test DB 迁移到最新（含新表/字段）。

- [ ] **Step 4: 提交**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): GuardianConsent model + User.birthYear/guardianConsentStatus"
```

---

## Task 2: 纯函数 isUnder14 / initialConsentStatus

**Files:**
- Create: `apps/web/server/lib/consent.ts`
- Test: `apps/web/tests/unit/consent.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/tests/unit/consent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isUnder14, initialConsentStatus } from "@/server/lib/consent";

const NOW = new Date("2026-06-01T00:00:00Z");

describe("isUnder14（保守：当前年−birthYear ≤ 14）", () => {
  it("2014 → true（≤14）", () => expect(isUnder14(2014, NOW)).toBe(true));
  it("2012 → true（=14，保守仍触发）", () => expect(isUnder14(2012, NOW)).toBe(true));
  it("2011 → false（=15）", () => expect(isUnder14(2011, NOW)).toBe(false));
});

describe("initialConsentStatus", () => {
  it("STUDENT + <14 → PENDING", () =>
    expect(initialConsentStatus("STUDENT", 2014, NOW)).toBe("PENDING"));
  it("STUDENT + ≥14 → NOT_REQUIRED", () =>
    expect(initialConsentStatus("STUDENT", 2011, NOW)).toBe("NOT_REQUIRED"));
  it("STUDENT + birthYear null → NOT_REQUIRED（grandfather）", () =>
    expect(initialConsentStatus("STUDENT", null, NOW)).toBe("NOT_REQUIRED"));
  it("TEACHER → NOT_REQUIRED", () =>
    expect(initialConsentStatus("TEACHER", 2014, NOW)).toBe("NOT_REQUIRED"));
  it("PARENT → NOT_REQUIRED", () =>
    expect(initialConsentStatus("PARENT", 2014, NOW)).toBe("NOT_REQUIRED"));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/consent.test.ts`
Expected: FAIL — Cannot find module '@/server/lib/consent'

- [ ] **Step 3: 实现 consent.ts**

```ts
import type { Persona, GuardianConsentStatus } from "@prisma/client";

// 保守判龄：出生年使「最小可能年龄」< 14 即触发。年份粗粒度宁可多触发同意门禁。
// 例（2026）：2012 → 2026-2012=14 → true；2011 → 15 → false。
export function isUnder14(birthYear: number, now: Date = new Date()): boolean {
  return now.getFullYear() - birthYear <= 14;
}

// 注册期初始状态：STUDENT 且 <14 → PENDING；否则 NOT_REQUIRED（含 birthYear 缺失的 grandfather）。
export function initialConsentStatus(
  persona: Persona,
  birthYear: number | null,
  now: Date = new Date(),
): GuardianConsentStatus {
  if (persona === "STUDENT" && birthYear != null && isUnder14(birthYear, now)) {
    return "PENDING";
  }
  return "NOT_REQUIRED";
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/consent.test.ts`
Expected: PASS（8/8）

- [ ] **Step 5: 提交**

```bash
git add apps/web/server/lib/consent.ts apps/web/tests/unit/consent.test.ts
git commit -m "feat(web): isUnder14 + initialConsentStatus pure functions"
```

---

## Task 3: ctx.auth.guardianConsentStatus + 硬门禁中间件

**Files:**
- Modify: `apps/web/server/context.ts`（AuthCtx + user 查询 select）
- Modify: `apps/web/server/trpc.ts`（requireGuardianConsent + consentGatedProcedure + chargedProcedure 加 gate）
- Test: `apps/web/tests/integration/guardian-consent-gate.test.ts`

- [ ] **Step 1: ctx 带 guardianConsentStatus**

`apps/web/server/context.ts`：把 `AuthCtx` 改为：

```ts
export type AuthCtx = AccessClaims & {
  isMinor: boolean;
  guardianConsentStatus: import("@prisma/client").GuardianConsentStatus;
};
```

把查询 user 的 select 加字段，并填入 auth（在现有 `select: { isMinor: true, deletedAt: true }` 处）：

```ts
        const user = await prisma.user.findUnique({
          where: { id: v.claims.userId },
          select: { isMinor: true, deletedAt: true, guardianConsentStatus: true },
        });
        if (user?.deletedAt != null) {
          authError = "USER_DEACTIVATED";
        } else {
          auth = {
            ...v.claims,
            isMinor: user?.isMinor ?? true,
            guardianConsentStatus: user?.guardianConsentStatus ?? "NOT_REQUIRED",
          };
        }
```

- [ ] **Step 2: 写失败测试**

`apps/web/tests/integration/guardian-consent-gate.test.ts`（用真 procedure 验证门禁；构造 PENDING / NOT_REQUIRED 两种 ctx）。先建一个被 `consentGatedProcedure` 守的探针 router 不现实——改为断言**既有受保护 procedure**行为。这里直接单元测中间件逻辑：

```ts
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { requireGuardianConsent } from "@/server/trpc";

// requireGuardianConsent 是 t.middleware；用最小 fake 调用其内部逻辑。
// 我们导出一个可单测的纯断言 helper assertConsentOk(status) 供中间件复用。
import { assertConsentOk } from "@/server/trpc";

describe("guardian consent gate", () => {
  it("PENDING → throw GUARDIAN_CONSENT_REQUIRED", () => {
    expect(() => assertConsentOk("PENDING")).toThrowError(TRPCError);
    try { assertConsentOk("PENDING"); } catch (e) {
      expect((e as TRPCError).code).toBe("FORBIDDEN");
      expect(((e as TRPCError).cause as { reason?: string }).reason).toBe("GUARDIAN_CONSENT_REQUIRED");
    }
  });
  it("NOT_REQUIRED → 放行", () => expect(() => assertConsentOk("NOT_REQUIRED")).not.toThrow());
  it("GRANTED → 放行", () => expect(() => assertConsentOk("GRANTED")).not.toThrow());
});
```

> 注：`requireGuardianConsent` 仍用于实际挂载，但把判定抽成可单测的 `assertConsentOk(status)` 纯函数，避免在测试里造 tRPC middleware 运行环境。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/guardian-consent-gate.test.ts`
Expected: FAIL — `assertConsentOk` / `requireGuardianConsent` 未导出

- [ ] **Step 4: 实现中间件**

`apps/web/server/trpc.ts`，在 `authedProcedure` 定义之后加：

```ts
import type { GuardianConsentStatus } from "@prisma/client";

// <14 监护人同意硬门禁判定（抽成纯函数便于单测）。
export function assertConsentOk(status: GuardianConsentStatus): void {
  if (status === "PENDING") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "需监护人同意后才能使用",
      cause: { reason: "GUARDIAN_CONSENT_REQUIRED" },
    });
  }
}

// 必须挂在 authedProcedure 之后（依赖 ctx.auth）。
export const requireGuardianConsent = t.middleware(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录", cause: { reason: ctx.authError ?? "NO_SESSION" } });
  }
  assertConsentOk(ctx.auth.guardianConsentStatus);
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

// 受同意门禁保护的 authed procedure（数据读写用它，白名单 auth/family 继续用 authedProcedure）。
export const consentGatedProcedure = authedProcedure.use(requireGuardianConsent);
```

并把 `chargedProcedure` 改为带门禁（一处覆盖所有付费动作）：

```ts
export const chargedProcedure = (kind: ActionKind) =>
  authedProcedure.use(requireGuardianConsent).use(chargeMiddleware(kind));
```

- [ ] **Step 5: 运行确认通过 + typecheck**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/guardian-consent-gate.test.ts`
Expected: PASS（3/3）
Run: `pnpm.cmd --filter @zhijiao/web typecheck`
Expected: PASS（AuthCtx 新字段处处编译通过）

- [ ] **Step 6: 提交**

```bash
git add apps/web/server/context.ts apps/web/server/trpc.ts apps/web/tests/integration/guardian-consent-gate.test.ts
git commit -m "feat(web): guardian consent gate middleware + chargedProcedure gating + ctx.auth status"
```

---

## Task 4: 注册采集 birthYear + 写状态

**Files:**
- Modify: `apps/web/server/routers/auth.ts`
- Test: `apps/web/tests/integration/auth-register-birthyear.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/tests/integration/auth-register-birthyear.test.ts`：复用既有 register 测试套路（参考 `tests/integration/auth-register-race.test.ts` 的 ctx/redis 构造）。核心三断言：

```ts
// 伪代码骨架——按既有 register 测试的 ctx 构造方式补全 redis payload / cookie nonce。
// 1) STUDENT + birthYear 2014（<14）→ 注册成功，user.guardianConsentStatus === "PENDING" 且 birthYear 入库。
// 2) STUDENT + birthYear 2009（≥14）→ guardianConsentStatus === "NOT_REQUIRED"。
// 3) STUDENT 缺 birthYear → BAD_REQUEST / REGISTER_BIRTHYEAR_REQUIRED，且 register cookie 未清。
```

> 实现者：以 `tests/integration/auth-register-race.test.ts` 为模板，补 `birthYear` 入参与三条断言。断言查 `prisma.user.findФirst` 的 `guardianConsentStatus` / `birthYear`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/auth-register-birthyear.test.ts`
Expected: FAIL（birthYear 未入 schema 输入 / 状态未写）

- [ ] **Step 3: 改 register**

`apps/web/server/routers/auth.ts`：

`RegisterInput` 加字段：
```ts
  birthYear: z.number().int().min(1990).max(new Date().getFullYear()).optional().nullable(),
```

import 纯函数：
```ts
import { initialConsentStatus } from "../lib/consent.js";
```

在 `gradeLevel` 缺失校验之后，加 birthYear 必填校验（STUDENT）：
```ts
      if (input.persona === "STUDENT" && input.birthYear == null) {
        toTRPCError("REGISTER_BIRTHYEAR_REQUIRED", "BAD_REQUEST");
      }
```

计算状态并写入 user.create.data：
```ts
      const guardianConsentStatus = initialConsentStatus(
        input.persona as Persona,
        input.birthYear ?? null,
      );
```
在 `tx.user.create({ data: { ... } })` 的 data 里加：
```ts
              birthYear: input.birthYear ?? undefined,
              guardianConsentStatus,
```

> `toTRPCError("REGISTER_BIRTHYEAR_REQUIRED", ...)` 走既有 toTRPCError 机制（与 REGISTER_GRADE_REQUIRED 同款，不清 register cookie）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/auth-register-birthyear.test.ts`
Expected: PASS（3/3）

- [ ] **Step 5: 提交**

```bash
git add apps/web/server/routers/auth.ts apps/web/tests/integration/auth-register-birthyear.test.ts
git commit -m "feat(web): register captures birthYear + sets guardianConsentStatus"
```

---

## Task 5: bindByCode <14 同意分支 + revoke 回 PENDING

**Files:**
- Modify: `apps/web/server/routers/family.ts`
- Test: `apps/web/tests/integration/family-guardian-consent.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/tests/integration/family-guardian-consent.test.ts`（参考既有 `tests/integration/family-router.test.ts` 的 caller/ctx 构造）。用例：

```ts
// 1) child = STUDENT PENDING（birthYear<14）；parent bindByCode 不带 guardianConsent
//    → BAD_REQUEST / GUARDIAN_CONSENT_NOT_PROVIDED；不写 GuardianConsent、不建 FamilyLink、child 仍 PENDING。
// 2) parent bindByCode { code, guardianConsent: true }
//    → 写 1 行 GuardianConsent(revokedAt=null, method="FAMILY_LINK_BIND")、FamilyLink ACTIVE、child guardianConsentStatus="GRANTED"。
// 3) child = NOT_REQUIRED（≥14）；bindByCode 不带 guardianConsent → 正常绑定（Plan 11 回归），不写 GuardianConsent、child 状态不变。
// 4) 撤回：GRANTED child 的唯一 link 被 revoke → 对应 GuardianConsent.revokedAt 落、child 回 PENDING。
// 5) 多监护人：两 parent 各自带 consent 绑同一 child → 撤其一，child 仍 GRANTED（另一行有效）。
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/family-guardian-consent.test.ts`
Expected: FAIL

- [ ] **Step 3: 改 bindByCode**

`apps/web/server/routers/family.ts`，`bindByCode` 的 input 加可选 consent 标记并扩展逻辑：

```ts
  bindByCode: authedProcedure
    .input(z.object({ code: z.string().min(4).max(16), guardianConsent: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const studentUserId = await ctx.redis.get(inviteKey(input.code));
      if (!studentUserId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请码无效或已过期", cause: { reason: "INVITE_INVALID" } });
      }
      if (studentUserId === ctx.auth.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能绑定自己", cause: { reason: "CANNOT_BIND_SELF" } });
      }
      const child = await ctx.db.user.findUnique({
        where: { id: studentUserId },
        select: { id: true, name: true, gradeLevel: true, guardianConsentStatus: true },
      });
      if (!child) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请码无效或已过期", cause: { reason: "INVITE_INVALID" } });
      }
      const needsConsent = child.guardianConsentStatus === "PENDING";
      if (needsConsent && input.guardianConsent !== true) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请阅读并确认监护人同意声明",
          cause: { reason: "GUARDIAN_CONSENT_NOT_PROVIDED" },
        });
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.familyLink.upsert({
          where: { parentUserId_studentUserId: { parentUserId: ctx.auth.userId, studentUserId } },
          update: { status: "ACTIVE", revokedAt: null },
          create: { parentUserId: ctx.auth.userId, studentUserId, status: "ACTIVE" },
        });
        if (needsConsent) {
          // 幂等：同一 (child,guardian) 若已有有效 consent 行则不重复写
          const existing = await tx.guardianConsent.findFirst({
            where: { childUserId: studentUserId, guardianUserId: ctx.auth.userId, revokedAt: null },
            select: { id: true },
          });
          if (!existing) {
            await tx.guardianConsent.create({
              data: {
                childUserId: studentUserId,
                guardianUserId: ctx.auth.userId,
                consentScope: "FULL_SERVICE",
                method: "FAMILY_LINK_BIND",
              },
            });
          }
          await tx.user.update({
            where: { id: studentUserId },
            data: { guardianConsentStatus: "GRANTED" },
          });
        }
      });

      await ctx.redis.del(inviteKey(input.code)); // 单次用尽
      return { studentUserId, name: child.name, gradeLevel: child.gradeLevel };
    }),
```

`revoke` 扩展：撤 link 时若涉及 <14 child（曾 GRANTED），同事务撤回 consent 并重算状态：

```ts
  revoke: authedProcedure
    .input(z.object({ linkId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const link = await ctx.db.familyLink.findUnique({ where: { id: input.linkId } });
      if (!link || (link.parentUserId !== ctx.auth.userId && link.studentUserId !== ctx.auth.userId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "绑定不存在", cause: { reason: "LINK_NOT_FOUND" } });
      }
      await ctx.db.$transaction(async (tx) => {
        if (link.status === "ACTIVE") {
          await tx.familyLink.update({ where: { id: link.id }, data: { status: "REVOKED", revokedAt: new Date() } });
        }
        // 撤回该 (parent,child) 的有效监护人同意
        await tx.guardianConsent.updateMany({
          where: { childUserId: link.studentUserId, guardianUserId: link.parentUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // 若 child 已无任何有效 consent → 回 PENDING
        const remaining = await tx.guardianConsent.count({
          where: { childUserId: link.studentUserId, revokedAt: null },
        });
        const childRow = await tx.user.findUnique({
          where: { id: link.studentUserId }, select: { guardianConsentStatus: true },
        });
        if (remaining === 0 && childRow?.guardianConsentStatus === "GRANTED") {
          await tx.user.update({ where: { id: link.studentUserId }, data: { guardianConsentStatus: "PENDING" } });
        }
      });
      return { ok: true as const };
    }),
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/family-guardian-consent.test.ts`
Expected: PASS（5/5）

- [ ] **Step 5: 回归 Plan 11 family 测试**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/family-router.test.ts`
Expected: PASS（≥14 / 无 consent 绑定不受影响）

- [ ] **Step 6: 提交**

```bash
git add apps/web/server/routers/family.ts apps/web/tests/integration/family-guardian-consent.test.ts
git commit -m "feat(web): bindByCode <14 consent branch + revoke re-gates child"
```

---

## Task 6: 数据 router 改挂 consentGatedProcedure

**Files:**
- Modify: `apps/web/server/routers/{tutor,error,variant,analytics,assignment,classroom}.ts`
- Test: `apps/web/tests/integration/guardian-consent-router.test.ts`

> 策略：付费动作已被 Task 3 的 `chargedProcedure` 门禁覆盖（tutor.ask / variant / error.diagnose / assignment 生成 / analytics.generateAdvice / wallet 扣费）。本任务把**非付费的数据读写 procedure**从 `authedProcedure` 改挂 `consentGatedProcedure`。**白名单不动**：`auth.ts` 全部、`family.ts` 全部（同意流程必需）。

- [ ] **Step 1: 写失败测试**

`apps/web/tests/integration/guardian-consent-router.test.ts`：构造一个 PENDING 用户调用代表性受保护 procedure 与白名单 procedure。

```ts
// caller 构造同既有 router 测试。child PENDING。
// 1) consentGated 读 procedure（如 analytics.profile.mine 或 error.list）→ FORBIDDEN / GUARDIAN_CONSENT_REQUIRED。
// 2) 白名单 auth.me → 放行（返回 user）。
// 3) 白名单 family.createInviteCode → 放行（返回 code）。
// 4) 同一用户 guardianConsentStatus 改 GRANTED 后，(1) 的 procedure 放行。
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/guardian-consent-router.test.ts`
Expected: FAIL（读 procedure 当前未门禁，PENDING 也能调）

- [ ] **Step 3: 批量改挂**

对 `tutor.ts / error.ts / variant.ts / analytics.ts / assignment.ts / classroom.ts` 内**非 charged** 的 `authedProcedure.xxx`（query/mutation 读写自身数据的）改为 `consentGatedProcedure`。import 加 `consentGatedProcedure`。**不要**改 `auth.ts` / `family.ts`。charged 的 procedure 已被 Task 3 覆盖，不必改。

逐文件做法：把文件顶部 `import { authedProcedure, ... }` 加上 `consentGatedProcedure`，再把数据 procedure 的 `authedProcedure`（未接 chargeMiddleware 的）替换为 `consentGatedProcedure`。`validateEntryOwnership` / `validateQuestionAccess` 链：把基座 `authedProcedure.use(validateEntryOwnership)...` 改为 `consentGatedProcedure.use(validateEntryOwnership)...`（gate 在 entry 校验之前，PENDING 直接拦）。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/guardian-consent-router.test.ts`
Expected: PASS（4/4）
Run: `pnpm.cmd --filter @zhijiao/web typecheck`
Expected: PASS

- [ ] **Step 5: 验证白名单未被误门禁（grep 守门）**

Run: `pnpm.cmd exec rg -n "authedProcedure" apps/web/server/routers/auth.ts apps/web/server/routers/family.ts`
Expected: 有命中（这两个文件仍用裸 authedProcedure —— 同意流程白名单）。
Run: `pnpm.cmd exec rg -n "consentGatedProcedure" apps/web/server/routers`
Expected: tutor/error/variant/analytics/assignment/classroom 均出现。

- [ ] **Step 6: 提交**

```bash
git add apps/web/server/routers/ apps/web/tests/integration/guardian-consent-router.test.ts
git commit -m "feat(web): gate data routers behind consentGatedProcedure (auth/family whitelisted)"
```

---

## Task 7: PII 治理覆盖 GuardianConsent + birthYear

**Files:**
- Modify: `apps/web/server/lib/pii-governance.ts`
- Test: `apps/web/tests/integration/pii-deactivate-user.test.ts`（扩）、`pii-export-user-data.test.ts`（扩）、`tests/unit/pii-ops-action-log-payload.test.ts`（扩）

- [ ] **Step 1: 写失败测试（扩三处）**

- `pii-deactivate-user.test.ts` 加：注销 child → 其作 child 的 GuardianConsent 行被删 + payload `deleted.guardianConsents` 计数；注销 guardian → 其作 guardian 的 consent 删 + 受影响 child（失去全部有效 consent）`guardianConsentStatus` 回 PENDING；注销后 `user.birthYear` 为 null。
- `pii-export-user-data.test.ts` 加：导出含本人 `birthYear` 与本人作 child 的 `guardianConsents`（仅 `guardianUserId` masked / `consentedAt` / `revokedAt` / `consentScope`，不含对方 PII）。
- `pii-ops-action-log-payload.test.ts` 加：禁词集含 `birth_year` / `birthYear` / `guardian_user_id` / `child_user_id`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts tests/unit/pii-ops-action-log-payload.test.ts`
Expected: FAIL

- [ ] **Step 3: 改 deactivateUser**

在 `deactivateUser` 事务里，`familyLink.deleteMany` 之后加：

```ts
    // <14 监护人同意（Plan 14a）。先处理 guardian 侧再删本人行。
    // 1) 找出本人作为 guardian、且对方 child 当前 GRANTED 的关系，删 consent 后重算 child 状态。
    const guardianOfChildren = await tx.guardianConsent.findMany({
      where: { guardianUserId: args.userId, revokedAt: null },
      select: { childUserId: true },
    });
    const childConsentsAsGuardian = await tx.guardianConsent.deleteMany({
      where: { guardianUserId: args.userId },
    });
    const affectedChildIds = [...new Set(guardianOfChildren.map((g) => g.childUserId))];
    for (const childId of affectedChildIds) {
      if (childId === args.userId) continue;
      const remaining = await tx.guardianConsent.count({ where: { childUserId: childId, revokedAt: null } });
      if (remaining === 0) {
        await tx.user.updateMany({
          where: { id: childId, guardianConsentStatus: "GRANTED" },
          data: { guardianConsentStatus: "PENDING" },
        });
      }
    }
    // 2) 删本人作为 child 的 consent 行。
    const consentsAsChild = await tx.guardianConsent.deleteMany({
      where: { childUserId: args.userId },
    });
```

在最后的 `tx.user.update({ data: { name: null, ... } })` 的 data 里加 `birthYear: null`。

在 payload 的 `deleted` 块加：
```ts
        guardianConsentsAsChild: consentsAsChild.count,
        guardianConsentsAsGuardian: childConsentsAsGuardian.count,
```

并在 `DeactivatePayload` 类型（buildDeactivatePlan 处的同结构）补这两个 key（preview 计数可在 buildDeactivatePlan 里 count，或 dry-run 置 0；与既有 familyLinks 计数同款处理）。

- [ ] **Step 4: 改 exportUserData**

user select 加 `birthYear: true`。在并行查询数组加：
```ts
    prisma.guardianConsent.findMany({
      where: { childUserId: userId },
      orderBy: { createdAt: "asc" },
      select: { guardianUserId: true, consentScope: true, method: true, consentedAt: true, revokedAt: true },
    }),
```
解构变量 `guardianConsents`，输出时 `guardianUserId` 走既有 mask helper（同 familyLinks 的 counterpart mask 方式），其余原样。导出对象加 `guardianConsents`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts tests/unit/pii-ops-action-log-payload.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/web/server/lib/pii-governance.ts apps/web/tests/
git commit -m "feat(web): PII coverage for GuardianConsent + birthYear (deactivate/export/payload guard)"
```

---

## Task 8: 童引导页 + 客户端门禁跳转

**Files:**
- Create: `apps/web/app/(student)/guardian-consent/page.tsx`
- Modify: `apps/web/app/providers.tsx`

- [ ] **Step 1: 读 providers.tsx 现状**

Run: 阅读 `apps/web/app/providers.tsx` 与 `apps/web/lib/trpc-client.ts`，确认 QueryClient / trpc Provider 的构造点。

- [ ] **Step 2: 加 QueryCache onError 跳转**

在 `providers.tsx` 构造 `QueryClient` 处，挂 `QueryCache`/`MutationCache` 的 `onError`：当错误的 `data.reason === "GUARDIAN_CONSENT_REQUIRED"`（tRPC errorFormatter 已把 reason 放进 `error.data.reason`）且当前不在 `/guardian-consent` 时，`window.location.href = "/guardian-consent"`。

```tsx
// 在 providers.tsx：
import { QueryCache, MutationCache, QueryClient } from "@tanstack/react-query";

function isConsentRequired(err: unknown): boolean {
  const reason = (err as { data?: { reason?: string } } | null)?.data?.reason;
  return reason === "GUARDIAN_CONSENT_REQUIRED";
}
function redirectToConsent() {
  if (typeof window !== "undefined" && window.location.pathname !== "/guardian-consent") {
    window.location.href = "/guardian-consent";
  }
}
// QueryClient 构造时：
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (e) => { if (isConsentRequired(e)) redirectToConsent(); } }),
  mutationCache: new MutationCache({ onError: (e) => { if (isConsentRequired(e)) redirectToConsent(); } }),
});
```

> 若 providers.tsx 已有 QueryClient 配置，合并 onError，不要新建第二个 client。

- [ ] **Step 3: 写引导页**

`apps/web/app/(student)/guardian-consent/page.tsx`（client component）：调 `trpc.family.createInviteCode`（白名单放行）展示邀请码 + 监护人同意声明文案 + 操作指引（让监护人用 PARENT 账号绑定并勾选同意）。文案合规（不恐吓、面向未成年友好）。用 `<Suspense>` 包裹任何 `useSearchParams()`（红线 #20）。

- [ ] **Step 4: build 验证（next build 类隐式失败）**

Run: `pnpm.cmd --filter @zhijiao/web exec next build`
Expected: 成功（无 missing-suspense / unescaped-entities）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/app/providers.tsx "apps/web/app/(student)/guardian-consent/page.tsx"
git commit -m "feat(web): guardian-consent page + client redirect on GUARDIAN_CONSENT_REQUIRED"
```

---

## Task 9: 全量验证 + E2E + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`
- Test: `apps/web/e2e/guardian-consent.spec.ts`

- [ ] **Step 1: regenerate + 全量 typecheck/test**

Run:
```
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck test --force
```
Expected: 全 PASS。

- [ ] **Step 2: 写 E2E 闭环**

`apps/web/e2e/guardian-consent.spec.ts`：`<14 学生注册（自报出生年份）→ 登录被导向 /guardian-consent → 发码 → 家长 PARENT 账号绑定并勾选同意 → 学生刷新后可访问受保护功能`。用 per-run 唯一手机号/stem 避免重跑撞数据（红线 #28）。E2E hook 若需预置 <14 用户，走 `E2E_TEST_HOOKS=1`。

- [ ] **Step 3: 跑 E2E**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/guardian-consent.spec.ts`
Expected: PASS。

- [ ] **Step 4: 更新 CLAUDE.md**

在「已落地」列表加 Plan 14a 条目；加「未成年同意现状（Plan 14a）」段（birthYear 自报 + isUnder14 保守判龄、guardianConsentStatus 承重字段进 ctx.auth、GuardianConsent 审计表、chargedProcedure + consentGatedProcedure 双门禁、bindByCode <14 分支、revoke 回 PENDING、PII 覆盖、grandfather 旧账号 / birthYear 仅 STUDENT 必填两默认）；「Merge 后必跑」加红线：
- 门禁在付费 + 数据 procedure 生效，auth/family 白名单：`guardian-consent-gate.test.ts` / `guardian-consent-router.test.ts` 全绿。
- bind <14 必带 consent 才写行：`family-guardian-consent.test.ts` 全绿。
- PII 覆盖 GuardianConsent + birthYear：三件套测试全绿。

从「下一步候选 Plan」把 Plan 14 拆分注记更新（14a 落地，14b/14c 待做）。

- [ ] **Step 5: 提交**

```bash
git add CLAUDE.md apps/web/e2e/guardian-consent.spec.ts
git commit -m "docs(claude): Plan 14a minor guardian consent landed"
```

---

## Self-Review 记录

- **Spec coverage**：§2 数据模型→Task 1；isUnder14/initialConsentStatus→Task 2；§5 门禁+ctx→Task 3/6；§3 注册→Task 4；§4 同意获取+§7 撤回→Task 5；§6 PII→Task 7；UX（spec §5 偏差更正）→Task 8；§8 测试/E2E/红线→各 Task + Task 9。无缺口。
- **Placeholder scan**：Task 4/5/6 的测试以"参考既有 X 测试的 ctx 构造"指引而非贴全 caller boilerplate —— 因为 register/family/router 测试的 ctx/redis/cookie 构造是既有大段样板，复制全文反而易过时；已给出确切断言清单 + 模板文件名，属"指向单一真源"而非占位。其余步骤含完整代码/命令/期望。
- **Type consistency**：`guardianConsentStatus` / `GuardianConsentStatus` / `isUnder14` / `initialConsentStatus` / `assertConsentOk` / `requireGuardianConsent` / `consentGatedProcedure` 跨 Task 命名一致；`GuardianConsent` 字段（childUserId/guardianUserId/consentScope/method/consentedAt/revokedAt）跨 Task 1/5/7 一致；`method="FAMILY_LINK_BIND"` / `consentScope="FULL_SERVICE"` 字面值一致。
- **偏差记录**：spec §5「Next middleware 跳转」→ 改 tRPC 层 enforcement + 客户端 QueryCache 跳转（edge 读不到 DB 状态），已在 header 与 Task 8 显式说明。
