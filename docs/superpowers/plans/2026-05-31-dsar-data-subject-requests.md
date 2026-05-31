# DSAR 数据主体请求 + SLA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让登录用户在站内自助导出数据副本(EXPORT)+ 经 OTP 重验发起可撤销的注销请求(DELETION),由 OPS CLI 审核履行,全程工单化并带 15 工作日 SLA 时钟。

**Architecture:** 新增 `DsarRequest` 表作为数据主体请求真源;纯函数/Prisma service 落在 `apps/web/server/lib/dsar.ts`,被 `dsar` tRPC router(用户侧)与三个 OPS CLI 脚本共用。复用 Plan 6 的 `exportUserData`/`deactivateUser` 履行原语、复用既有 OTP 与限频基建。`dsar.*` 走裸 `authedProcedure`(监护人门禁白名单)。

**Tech Stack:** TypeScript、Prisma 5、tRPC v11、Next.js App Router、Vitest、Playwright、`@zhijiao/auth`(OTP + ratelimit)、`@zhijiao/db`。

**Spec:** `docs/superpowers/specs/2026-05-31-dsar-data-subject-requests-design.md`

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/db/prisma/schema.prisma` | `DsarRequest` 模型 + `DsarRequestType`/`DsarRequestStatus` 枚举;`OtpPurpose` += `DSAR_DELETION`;`User.dsarRequests` 反向关系 |
| `packages/auth/src/otp.ts` | `IssueOtpInput.purpose` += `DSAR_DELETION`;`verifyOtp` 加可选 `purpose` 过滤 |
| `packages/auth/tests/otp.test.ts`(或新建) | verifyOtp purpose 隔离单测 |
| `packages/auth/src/ratelimit/rules.ts` | `RULE_DSAR_EXPORT`(fail-open) |
| `apps/web/server/lib/dsar.ts` | service:`addWorkingDays` + create/cancel/list/fulfill/reject |
| `apps/web/tests/unit/dsar-working-days.test.ts` | `addWorkingDays` 纯单测 |
| `apps/web/server/routers/dsar.ts` | 5 个 procedure |
| `apps/web/server/routers/_root.ts` | 注册 `dsar` |
| `apps/web/tests/integration/dsar-router.test.ts` | router 集成测试 |
| `apps/web/server/lib/pii-governance.ts` | scrub `reason`;export 加 `dsarRequests` 段;schemaVersion 升版 |
| `apps/web/tests/unit/pii-ops-action-log-payload.test.ts` | 守词集加 `dsar_reason`/`resolution_note` |
| `apps/web/tests/integration/pii-deactivate-user.test.ts` / `pii-export-user-data.test.ts` | 扩 DSAR 断言 |
| `apps/web/scripts/dsar-{list,fulfill,reject}.ts` + `apps/web/package.json` | OPS CLI |
| `apps/web/tests/integration/dsar-cli.test.ts` | CLI service 履行集成测试 |
| `apps/web/app/account/privacy/{page,privacy-view}.tsx` | 用户侧三块 UI |
| `apps/web/middleware.ts` | `PROTECTED_PREFIXES` + `matcher` 加 `/account` |
| `apps/web/app/support/deactivate/page.tsx` | 加一句指向 `/account/privacy` |
| `apps/web/e2e/dsar.spec.ts` | E2E 闭环 |
| `CLAUDE.md` | 落地记录 + 红线 |

---

## Task 1: Schema —— DsarRequest 表 + OtpPurpose 扩展

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: 加枚举值到 OtpPurpose**

把 `schema.prisma:44-47` 的枚举改为:
```prisma
enum OtpPurpose {
  LOGIN
  BIND_PHONE
  DSAR_DELETION
}
```

- [ ] **Step 2: 新增 DSAR 枚举 + 模型**

在 `schema.prisma` 末尾(其它 model 之后)追加:
```prisma
// === Plan 14b: DSAR 数据主体请求 ===

enum DsarRequestType {
  EXPORT
  DELETION
}

enum DsarRequestStatus {
  PENDING
  COMPLETED
  REJECTED
  CANCELED
}

model DsarRequest {
  id             String            @id @default(cuid())
  userId         String            @map("user_id")
  type           DsarRequestType
  status         DsarRequestStatus @default(PENDING)
  isMinor        Boolean           @default(false) @map("is_minor")
  reason         String?
  requestedAt    DateTime          @default(now()) @map("requested_at")
  dueAt          DateTime          @map("due_at")
  resolvedAt     DateTime?         @map("resolved_at")
  resolvedByRef  String?           @map("resolved_by_ref")
  resolutionNote String?           @map("resolution_note")
  createdAt      DateTime          @default(now()) @map("created_at")

  user           User              @relation("UserDsarRequests", fields: [userId], references: [id], onDelete: Cascade)

  @@index([status, dueAt])
  @@index([userId])
  @@map("dsar_requests")
}
```

- [ ] **Step 3: User 加反向关系**

在 `model User` 体内(其它关系字段旁,例如 `guardianConsents` 附近)加一行:
```prisma
  dsarRequests       DsarRequest[]      @relation("UserDsarRequests")
```

- [ ] **Step 4: 建 migration + regenerate client**

Run(Windows 上若 `db:migrate` 失败按 README 用 docker-exec 绕过):
```
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --name plan14b_dsar_requests
pnpm.cmd --filter @zhijiao/db db:generate
```
Expected: migration 应用成功;`dsar_requests` 表 + 两个 enum + `otp_requests.purpose` 新增 `DSAR_DELETION` 值落库。

- [ ] **Step 5: 验证 schema + 提交**

Run: `pnpm.cmd --filter @zhijiao/db typecheck` → PASS
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): DsarRequest table + DSAR_DELETION OtpPurpose (Plan 14b)"
```

---

## Task 2: addWorkingDays 纯函数 + 单测

**Files:**
- Create: `apps/web/server/lib/dsar.ts`
- Test: `apps/web/tests/unit/dsar-working-days.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/tests/unit/dsar-working-days.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { addWorkingDays } from "@/server/lib/dsar";

describe("addWorkingDays", () => {
  it("周一 + 5 工作日 = 下周一", () => {
    // 2026-06-01 是周一
    const mon = new Date("2026-06-01T00:00:00.000Z");
    const r = addWorkingDays(mon, 5);
    expect(r.toISOString().slice(0, 10)).toBe("2026-06-08"); // 下周一
  });
  it("跳过周六周日", () => {
    // 2026-06-05 周五 + 1 工作日 = 2026-06-08 周一
    const fri = new Date("2026-06-05T00:00:00.000Z");
    expect(addWorkingDays(fri, 1).toISOString().slice(0, 10)).toBe("2026-06-08");
  });
  it("15 工作日 = 3 周(跨 2 个周末)", () => {
    const mon = new Date("2026-06-01T00:00:00.000Z");
    expect(addWorkingDays(mon, 15).toISOString().slice(0, 10)).toBe("2026-06-22");
  });
  it("0 工作日返回原值副本", () => {
    const d = new Date("2026-06-03T08:30:00.000Z");
    expect(addWorkingDays(d, 0).getTime()).toBe(d.getTime());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/dsar-working-days.test.ts`
Expected: FAIL — Cannot find module '@/server/lib/dsar'。

- [ ] **Step 3: 实现 addWorkingDays(创建 dsar.ts)**

`apps/web/server/lib/dsar.ts`(本任务只放纯函数,后续 Task 5 在同文件追加 service):
```ts
import "server-only";

// Plan 14b: SLA 截止时间。在 date 基础上前进 n 个工作日(跳过周六/周日)。
// 法定节假日忽略,作为已记录的近似(spec §2)。UTC 维度计算;n=0 返回副本。
export function addWorkingDays(date: Date, n: number): Date {
  const out = new Date(date.getTime());
  let added = 0;
  while (added < n) {
    out.setUTCDate(out.getUTCDate() + 1);
    const day = out.getUTCDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) added++;
  }
  return out;
}
```

> 注:`dsar.ts` 含 `import "server-only"`,但 CLI 脚本(Task 8)只 import `dsar.js` 里的**纯函数与不触发 server-only 副作用的 service**。`server-only` 包在 tsx 下是 no-op 导入(它仅在 webpack client bundle 报错),CLI 用 tsx 跑可正常 import。这点与既有 `pii-governance.ts`(不带 server-only)不同,但 tsx 侧安全 —— 见 Task 8 Step 1 说明,如执行时 tsx 报错则把 `addWorkingDays` 与 service 拆到不带 server-only 的子模块。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/dsar-working-days.test.ts`
Expected: PASS(4 例)。

- [ ] **Step 5: 提交**

```bash
git add apps/web/server/lib/dsar.ts apps/web/tests/unit/dsar-working-days.test.ts
git commit -m "feat(web): addWorkingDays SLA helper (Plan 14b)"
```

---

## Task 3: verifyOtp purpose 过滤 + OtpPurpose union

**Files:**
- Modify: `packages/auth/src/otp.ts`
- Test: `packages/auth/tests/otp-purpose.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/auth/tests/otp-purpose.test.ts`(参考 `packages/auth/tests/` 既有 OTP 测试的 prisma 构造;若无既有则用 `@zhijiao/db/test-utils` 的 `prisma`+`resetDb`):
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { issueOtp, verifyOtp } from "../src/otp.js";

const PEPPER = "test-pepper-min16-bytes";
const PHONE = "13800009999";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("verifyOtp purpose isolation (Plan 14b)", () => {
  it("传 purpose 时只认同 purpose 的码", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "DSAR_DELETION", pepper: PEPPER });
    // 用 DSAR purpose 验证 DSAR 码 → 通过
    await expect(verifyOtp(prisma, PHONE, code, PEPPER, "DSAR_DELETION")).resolves.toBeTruthy();
  });
  it("LOGIN 码不能用 DSAR purpose 验证", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER, "DSAR_DELETION")).rejects.toThrow();
  });
  it("不传 purpose 时行为不变(认最近一条)", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER)).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/auth test -- tests/otp-purpose.test.ts`
Expected: FAIL —— 类型/参数不匹配(verifyOtp 暂无第 5 参)或 LOGIN 码被 DSAR 验证误通过。

- [ ] **Step 3: 改 IssueOtpInput union**

`packages/auth/src/otp.ts:25`:
```ts
  purpose: "LOGIN" | "BIND_PHONE" | "DSAR_DELETION";
```

- [ ] **Step 4: verifyOtp 加可选 purpose 过滤**

把 `packages/auth/src/otp.ts:71-76` 改为:
```ts
export async function verifyOtp(
  prisma: PrismaClient,
  phone: string,
  code: string,
  pepper: string,
  purpose?: "LOGIN" | "BIND_PHONE" | "DSAR_DELETION",
): Promise<{ otpId: string }> {
  const now = new Date();
  const row = await prisma.otpRequest.findFirst({
    where: { phone, consumedAt: null, expiredAt: null, expiresAt: { gt: now }, ...(purpose ? { purpose } : {}) },
    orderBy: { createdAt: "desc" },
  });
```
(函数其余部分不动。)

- [ ] **Step 5: 运行确认通过 + auth 回归**

Run: `pnpm.cmd --filter @zhijiao/auth test -- tests/otp-purpose.test.ts` → PASS
Run: `pnpm.cmd --filter @zhijiao/auth test` → 全 PASS(verifyOtp 不传 purpose 的既有调用零回归)。

- [ ] **Step 6: 提交**

```bash
git add packages/auth/src/otp.ts packages/auth/tests/otp-purpose.test.ts
git commit -m "feat(auth): verifyOtp optional purpose filter + DSAR_DELETION purpose (Plan 14b)"
```

---

## Task 4: RULE_DSAR_EXPORT 限频规则

**Files:**
- Modify: `packages/auth/src/ratelimit/rules.ts`

- [ ] **Step 1: 加规则**

在 `packages/auth/src/ratelimit/rules.ts` 既有规则块末尾加:
```ts
// Plan 14b: 数据副本导出。fail-OPEN —— 导出是数据主体权利,Redis 挂时不该阻断
// (takeRule 在 failMode:"open" 下内部吞 RateLimitBackendDownError 返回 allowed)。
// capacity 5 / refill 1 token 每 ~3min,够正常人用、挡脚本滥刷。
export const RULE_DSAR_EXPORT: RateLimitRule = { prefix: "dsar:export:", capacity: 5, refillPerSec: 5/900, failMode: "open" };
```

- [ ] **Step 2: 确认导出**

确认 `RULE_DSAR_EXPORT` 经 `packages/auth/src/index.ts` 的 `export * from "./ratelimit/rules.js"`(或同款再导出)可被 `@zhijiao/auth` 消费。Run: `pnpm.cmd --filter @zhijiao/auth typecheck` → PASS。

- [ ] **Step 3: 提交**

```bash
git add packages/auth/src/ratelimit/rules.ts
git commit -m "feat(auth): RULE_DSAR_EXPORT fail-open rate limit (Plan 14b)"
```

---

## Task 5: dsar.ts service 函数

**Files:**
- Modify: `apps/web/server/lib/dsar.ts`

> 该层被 router(Task 6)与 CLI(Task 8)共用。所有函数接 `PrismaClient | Prisma.TransactionClient`,不内置 `$transaction`(由调用方决定事务边界),与 `pii-governance.ts` 风格一致。

- [ ] **Step 1: 追加类型与 create/cancel/list**

在 `apps/web/server/lib/dsar.ts`(addWorkingDays 之下)追加:
```ts
import { type Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const SLA_WORKING_DAYS = 15;

export interface DsarRequestView {
  id: string;
  type: "EXPORT" | "DELETION";
  status: "PENDING" | "COMPLETED" | "REJECTED" | "CANCELED";
  isMinor: boolean;
  requestedAt: Date;
  dueAt: Date;
  resolvedAt: Date | null;
}

function toView(r: {
  id: string; type: string; status: string; isMinor: boolean;
  requestedAt: Date; dueAt: Date; resolvedAt: Date | null;
}): DsarRequestView {
  return {
    id: r.id,
    type: r.type as DsarRequestView["type"],
    status: r.status as DsarRequestView["status"],
    isMinor: r.isMinor,
    requestedAt: r.requestedAt,
    dueAt: r.dueAt,
    resolvedAt: r.resolvedAt,
  };
}

// EXPORT: 自助即时,出生即 COMPLETED。requestedAt=dueAt=resolvedAt=now。
export async function recordExportRequest(
  db: DbClient,
  args: { userId: string; isMinor: boolean; now?: Date },
): Promise<{ id: string }> {
  const now = args.now ?? new Date();
  const row = await db.dsarRequest.create({
    data: {
      userId: args.userId,
      type: "EXPORT",
      status: "COMPLETED",
      isMinor: args.isMinor,
      requestedAt: now,
      dueAt: now,
      resolvedAt: now,
      resolvedByRef: "self",
    },
    select: { id: true },
  });
  return row;
}

// DELETION: 幂等 —— 已有 open PENDING 直接返回它。否则建 PENDING。
export async function createDeletionRequest(
  db: DbClient,
  args: { userId: string; isMinor: boolean; reason?: string | null; now?: Date },
): Promise<{ request: DsarRequestView; alreadyOpen: boolean }> {
  const existing = await db.dsarRequest.findFirst({
    where: { userId: args.userId, type: "DELETION", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { request: toView(existing), alreadyOpen: true };

  const now = args.now ?? new Date();
  const created = await db.dsarRequest.create({
    data: {
      userId: args.userId,
      type: "DELETION",
      status: "PENDING",
      isMinor: args.isMinor,
      reason: args.reason ?? null,
      requestedAt: now,
      dueAt: addWorkingDays(now, SLA_WORKING_DAYS),
    },
  });
  return { request: toView(created), alreadyOpen: false };
}

// 用户自撤:本人 open PENDING DELETION → CANCELED。无 open → null(调用方映射 NOT_FOUND)。
export async function cancelDeletionRequest(
  db: DbClient,
  args: { userId: string; now?: Date },
): Promise<DsarRequestView | null> {
  const open = await db.dsarRequest.findFirst({
    where: { userId: args.userId, type: "DELETION", status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!open) return null;
  const updated = await db.dsarRequest.update({
    where: { id: open.id },
    data: { status: "CANCELED", resolvedAt: args.now ?? new Date(), resolvedByRef: "self" },
  });
  return toView(updated);
}

export async function listOwnRequests(db: DbClient, userId: string): Promise<DsarRequestView[]> {
  const rows = await db.dsarRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}
```

- [ ] **Step 2: 追加 OPS 侧 list/fulfill/reject**

继续在 `dsar.ts` 追加(`deactivateUser` 从 `pii-governance.js` import):
```ts
import { deactivateUser, previewDeactivateUser } from "./pii-governance.js";

export interface OpsDsarRow {
  id: string; userId: string; type: string; status: string;
  isMinor: boolean; requestedAt: Date; dueAt: Date; overdue: boolean;
}

// OPS 队列视图。默认只列 PENDING DELETION;overdue 标记 now>dueAt。
export async function listForOps(
  prisma: PrismaClient,
  args: { status?: "pending" | "all"; type?: "export" | "deletion"; overdueOnly?: boolean; now?: Date },
): Promise<OpsDsarRow[]> {
  const now = args.now ?? new Date();
  const where: Prisma.DsarRequestWhereInput = {};
  if ((args.status ?? "pending") === "pending") where.status = "PENDING";
  if (args.type) where.type = args.type === "export" ? "EXPORT" : "DELETION";
  if (args.overdueOnly) where.dueAt = { lt: now };
  const rows = await prisma.dsarRequest.findMany({ where, orderBy: { dueAt: "asc" } });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, type: r.type, status: r.status,
    isMinor: r.isMinor, requestedAt: r.requestedAt, dueAt: r.dueAt,
    overdue: r.status === "PENDING" && r.dueAt < now,
  }));
}

export class DsarFulfillError extends Error {}

// 履行注销:工单须 PENDING+DELETION;未成年须 guardianVerified。$transaction 内
// 调 deactivateUser(写它自己的 OpsActionLog)+ 置工单 COMPLETED。
export async function fulfillDeletion(
  prisma: PrismaClient,
  args: { requestId: string; operatorId: string | null; initiatorRef: string; guardianVerified: boolean; dryRun?: boolean },
) {
  const req = await prisma.dsarRequest.findUnique({ where: { id: args.requestId } });
  if (!req) throw new DsarFulfillError(`DSAR request not found: ${args.requestId}`);
  if (req.type !== "DELETION") throw new DsarFulfillError(`not a DELETION request: ${args.requestId}`);
  if (req.status !== "PENDING") throw new DsarFulfillError(`request not PENDING (is ${req.status}): ${args.requestId}`);
  if (req.isMinor && !args.guardianVerified) {
    throw new DsarFulfillError(`minor account requires --guardian-verified before fulfilling ${args.requestId}`);
  }

  if (args.dryRun) {
    const preview = await previewDeactivateUser(prisma, req.userId);
    return { dryRun: true, preview, requestId: req.id };
  }

  return prisma.$transaction(async (tx) => {
    const result = await deactivateUser(tx as unknown as PrismaClient, {
      userId: req.userId,
      operatorId: args.operatorId,
      initiatorRef: args.initiatorRef,
      reason: "DSAR_DELETION_REQUEST",
    });
    await tx.dsarRequest.update({
      where: { id: req.id },
      data: { status: "COMPLETED", resolvedAt: new Date(), resolvedByRef: args.initiatorRef },
    });
    return { dryRun: false, deactivate: result, requestId: req.id };
  });
}

export async function rejectDeletion(
  prisma: PrismaClient,
  args: { requestId: string; note: string; initiatorRef: string },
): Promise<OpsDsarRow> {
  const req = await prisma.dsarRequest.findUnique({ where: { id: args.requestId } });
  if (!req) throw new DsarFulfillError(`DSAR request not found: ${args.requestId}`);
  if (req.status !== "PENDING") throw new DsarFulfillError(`request not PENDING (is ${req.status})`);
  const updated = await prisma.dsarRequest.update({
    where: { id: req.id },
    data: { status: "REJECTED", resolvedAt: new Date(), resolvedByRef: args.initiatorRef, resolutionNote: args.note },
  });
  return {
    id: updated.id, userId: updated.userId, type: updated.type, status: updated.status,
    isMinor: updated.isMinor, requestedAt: updated.requestedAt, dueAt: updated.dueAt, overdue: false,
  };
}
```

> 注:`deactivateUser` 现签名接 `PrismaClient` 并内部开 `$transaction`。本处在外层已开 `tx`,把 `tx` 当 `PrismaClient` 传入会**嵌套事务**。实现时确认 `deactivateUser` 是否能接受 tx;若不能(Prisma 不支持嵌套交互事务),改为:**不**在 `fulfillDeletion` 内开 `$transaction`,直接顺序调用 `deactivateUser(prisma, ...)` 再 `prisma.dsarRequest.update(...)`(deactivateUser 自带原子事务;工单状态更新紧随其后,失败可由 OPS 重跑——`deactivateUser` 对已 deactivated 用户幂等返回 alreadyDeactivated)。Task 8 的 CLI 测试需覆盖"二次 fulfill 同一已 COMPLETED 工单被 status 守卫拒绝"。

- [ ] **Step 3: typecheck**

Run: `pnpm.cmd --filter @zhijiao/web typecheck` → PASS。(无独立测试;service 行为由 Task 6/8 集成测试覆盖。)

- [ ] **Step 4: 提交**

```bash
git add apps/web/server/lib/dsar.ts
git commit -m "feat(web): dsar service (create/cancel/list + ops fulfill/reject) (Plan 14b)"
```

---

## Task 6: dsar tRPC router + 集成测试

**Files:**
- Create: `apps/web/server/routers/dsar.ts`
- Modify: `apps/web/server/routers/_root.ts`
- Test: `apps/web/tests/integration/dsar-router.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/tests/integration/dsar-router.test.ts`(参考 `tests/integration/error-diagnose-question-access.test.ts` 的 `makeCtx`/`seedUserWithBalance`/`appRouter.createCaller`;OTP 用 `@zhijiao/db/test-utils` prisma 直接造行或调 issueOtp):
```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { issueOtp } from "@zhijiao/auth";
import { redis, makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

const { appRouter } = await import("@/server/routers/_root");
const PEPPER = process.env.OTP_PEPPER ?? "test-otp-pepper-min16-bytes";

async function seedPhoneIdentity(userId: string, phone: string) {
  await prisma.authIdentity.create({
    data: { userId, provider: "PHONE", providerScope: "GLOBAL", providerUserId: phone },
  });
}

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

describe("dsar.exportMine", () => {
  it("返回数据 + 建 COMPLETED EXPORT 工单", async () => {
    const u = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.dsar.exportMine();
    expect(r.requestId).toBeTruthy();
    expect(r.export.userId).toBe(u.id);
    const row = await prisma.dsarRequest.findFirstOrThrow({ where: { userId: u.id, type: "EXPORT" } });
    expect(row.status).toBe("COMPLETED");
  });
});

describe("dsar.requestDeletion", () => {
  it("有效 OTP → PENDING 工单 + dueAt 在未来", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhoneIdentity(u.id, "13800007777");
    const { code } = await issueOtp(prisma, { phone: "13800007777", purpose: "DSAR_DELETION", pepper: PEPPER });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.dsar.requestDeletion({ otpCode: code, reason: "不想用了" });
    expect(r.request.status).toBe("PENDING");
    expect(new Date(r.request.dueAt).getTime()).toBeGreaterThan(Date.now());
  });
  it("无效 OTP → 拒 + 不建工单", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhoneIdentity(u.id, "13800007778");
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(caller.dsar.requestDeletion({ otpCode: "000000" })).rejects.toBeInstanceOf(TRPCError);
    expect(await prisma.dsarRequest.count({ where: { userId: u.id, type: "DELETION" } })).toBe(0);
  });
  it("幂等:二次发起返回同一条", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhoneIdentity(u.id, "13800007779");
    const c = appRouter.createCaller(makeCtx(u.id));
    const { code: c1 } = await issueOtp(prisma, { phone: "13800007779", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r1 = await c.dsar.requestDeletion({ otpCode: c1 });
    const { code: c2 } = await issueOtp(prisma, { phone: "13800007779", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r2 = await c.dsar.requestDeletion({ otpCode: c2 });
    expect(r2.request.id).toBe(r1.request.id);
    expect(await prisma.dsarRequest.count({ where: { userId: u.id, type: "DELETION" } })).toBe(1);
  });
  it("<14 PENDING-consent 仍可发起(白名单)", async () => {
    const u = await seedUserWithBalance(5, { isMinor: true });
    await prisma.user.update({ where: { id: u.id }, data: { guardianConsentStatus: "PENDING" } });
    await seedPhoneIdentity(u.id, "13800007780");
    const { code } = await issueOtp(prisma, { phone: "13800007780", purpose: "DSAR_DELETION", pepper: PEPPER });
    const ctx = makeCtx(u.id, { isMinor: true });
    ctx.auth.guardianConsentStatus = "PENDING";
    const r = await appRouter.createCaller(ctx).dsar.requestDeletion({ otpCode: code });
    expect(r.request.isMinor).toBe(true);
  });
});

describe("dsar.cancelDeletion", () => {
  it("PENDING → CANCELED;无 open → NOT_FOUND", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhoneIdentity(u.id, "13800007781");
    const c = appRouter.createCaller(makeCtx(u.id));
    const { code } = await issueOtp(prisma, { phone: "13800007781", purpose: "DSAR_DELETION", pepper: PEPPER });
    await c.dsar.requestDeletion({ otpCode: code });
    const cancelled = await c.dsar.cancelDeletion();
    expect(cancelled.status).toBe("CANCELED");
    await expect(c.dsar.cancelDeletion()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("dsar.sendDeletionOtp", () => {
  it("无手机号 → DSAR_NO_PHONE", async () => {
    const u = await seedUserWithBalance(5); // 不 seed phone identity
    const c = appRouter.createCaller(makeCtx(u.id));
    await expect(c.dsar.sendDeletionOtp()).rejects.toMatchObject({
      cause: { reason: "DSAR_NO_PHONE" },
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/dsar-router.test.ts`
Expected: FAIL —— `caller.dsar` 不存在。

- [ ] **Step 3: 实现 router**

`apps/web/server/routers/dsar.ts`:
```ts
import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, router } from "../trpc.js";
import {
  takeRule, RedisRateLimitStore, RULE_DSAR_EXPORT,
  RULE_OTP_SEND_PHONE, RULE_OTP_SEND_IP, RULE_OTP_VERIFY_PH,
  RateLimitBackendDownError, issueOtp, verifyOtp, AuthError,
} from "@zhijiao/auth";
import { env } from "@/lib/env";
import { exportUserData } from "../lib/pii-governance.js";
import { recordExportRequest, createDeletionRequest, cancelDeletionRequest, listOwnRequests } from "../lib/dsar.js";

const store = (redis: import("ioredis").default) => new RedisRateLimitStore(redis);

async function ownPhone(db: typeof import("@zhijiao/db").prisma, userId: string): Promise<string | null> {
  const id = await db.authIdentity.findFirst({
    where: { userId, provider: "PHONE", providerScope: "GLOBAL" },
    select: { providerUserId: true },
  });
  return id?.providerUserId ?? null;
}

export const dsarRouter = router({
  // 数据副本:限频 fail-open → exportUserData → 记 COMPLETED 工单 → 返回 JSON
  exportMine: authedProcedure.mutation(async ({ ctx }) => {
    // fail-open:takeRule 在 RULE_DSAR_EXPORT(failMode:open)下,Redis 挂时内部返回 allowed。
    const r1 = await takeRule(store(ctx.redis), RULE_DSAR_EXPORT, ctx.auth.userId);
    const r2 = await takeRule(store(ctx.redis), RULE_DSAR_EXPORT, ctx.ip);
    if (!r1.allowed || !r2.allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "导出过于频繁,请稍后再试", cause: { reason: "DSAR_EXPORT_TOO_FREQUENT" } });
    }
    const data = await exportUserData(ctx.db, ctx.auth.userId);
    const rec = await recordExportRequest(ctx.db, { userId: ctx.auth.userId, isMinor: ctx.auth.isMinor });
    return { export: data, requestId: rec.id };
  }),

  // 发注销 OTP(purpose=DSAR_DELETION),fail-close 限频;无手机号引导人工渠道
  sendDeletionOtp: authedProcedure.mutation(async ({ ctx }) => {
    const phone = await ownPhone(ctx.db, ctx.auth.userId);
    if (!phone) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未绑定手机号,请通过客服渠道办理注销", cause: { reason: "DSAR_NO_PHONE" } });
    }
    try {
      const a = await takeRule(store(ctx.redis), RULE_OTP_SEND_PHONE, phone);
      if (!a.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证码发送过于频繁", cause: { reason: "OTP_SEND_TOO_FREQUENT" } });
      const b = await takeRule(store(ctx.redis), RULE_OTP_SEND_IP, ctx.ip);
      if (!b.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证码发送过于频繁", cause: { reason: "OTP_SEND_TOO_FREQUENT" } });
    } catch (e) {
      if (e instanceof RateLimitBackendDownError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "服务暂时不可用", cause: { reason: "RATELIMIT_BACKEND_DOWN" } });
      throw e;
    }
    const { code } = await issueOtp(ctx.db, { phone, purpose: "DSAR_DELETION", pepper: env.OTP_PEPPER, ipCreated: ctx.ip, userAgent: ctx.ua });
    if (process.env.E2E_TEST_HOOKS === "1") {
      await ctx.redis.set(`e2e:last-otp:${phone}`, code, "EX", 300);
    }
    return { ok: true as const };
  }),

  // 验码 → 建 PENDING DELETION(幂等)
  requestDeletion: authedProcedure
    .input(z.object({ otpCode: z.string().min(4).max(8), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const phone = await ownPhone(ctx.db, ctx.auth.userId);
      if (!phone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未绑定手机号", cause: { reason: "DSAR_NO_PHONE" } });
      try {
        const v = await takeRule(store(ctx.redis), RULE_OTP_VERIFY_PH, phone);
        if (!v.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证过于频繁", cause: { reason: "OTP_VERIFY_TOO_FREQUENT" } });
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "服务暂时不可用", cause: { reason: "RATELIMIT_BACKEND_DOWN" } });
        throw e;
      }
      try {
        await verifyOtp(ctx.db, phone, input.otpCode, env.OTP_PEPPER, "DSAR_DELETION");
      } catch (e) {
        if (e instanceof AuthError) throw new TRPCError({ code: "BAD_REQUEST", message: "验证码无效或已过期", cause: { reason: e.reason } });
        throw e;
      }
      const needsConsent = ctx.auth.isMinor || ctx.auth.guardianConsentStatus !== "NOT_REQUIRED";
      const { request } = await createDeletionRequest(ctx.db, { userId: ctx.auth.userId, isMinor: needsConsent, reason: input.reason ?? null });
      return { request };
    }),

  cancelDeletion: authedProcedure.mutation(async ({ ctx }) => {
    const cancelled = await cancelDeletionRequest(ctx.db, { userId: ctx.auth.userId });
    if (!cancelled) throw new TRPCError({ code: "NOT_FOUND", message: "没有进行中的注销申请", cause: { reason: "DSAR_NOT_FOUND" } });
    return cancelled;
  }),

  myRequests: authedProcedure.query(async ({ ctx }) => {
    return { requests: await listOwnRequests(ctx.db, ctx.auth.userId) };
  }),
});
```

> 注:`issueOtp`/`verifyOtp`/`AuthError`/`takeRule`/`RedisRateLimitStore`/`RateLimitBackendDownError`/`RULE_*` 均需经 `@zhijiao/auth` 的 index 再导出;若某个未导出,实现时补 `export` 到 `packages/auth/src/index.ts`(参考 `auth.ts` 已 import 的同款符号)。`env` 来源参考 `auth.ts` 里 `env.OTP_PEPPER` 的 import 路径。

- [ ] **Step 4: 注册进 _root**

`apps/web/server/routers/_root.ts`:import `import { dsarRouter } from "./dsar.js";` 并在 `appRouter` 对象加 `dsar: dsarRouter,`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/dsar-router.test.ts`
Expected: PASS(全部用例)。

- [ ] **Step 6: 提交**

```bash
git add apps/web/server/routers/dsar.ts apps/web/server/routers/_root.ts apps/web/tests/integration/dsar-router.test.ts packages/auth/src/index.ts
git commit -m "feat(web): dsar tRPC router (export/delete request/cancel/list) (Plan 14b)"
```

---

## Task 7: PII 治理扩展(scrub reason + export 加段 + schemaVersion 升版)

**Files:**
- Modify: `apps/web/server/lib/pii-governance.ts`
- Modify: `apps/web/tests/unit/pii-ops-action-log-payload.test.ts`
- Modify: `apps/web/tests/integration/pii-deactivate-user.test.ts`
- Modify: `apps/web/tests/integration/pii-export-user-data.test.ts`

- [ ] **Step 1: 改 payload 守词测试(失败先行)**

`apps/web/tests/unit/pii-ops-action-log-payload.test.ts`:在 `FORBIDDEN_TEXT` 正则里追加 `|dsar_reason|resolution_note`(放在 `birthYear` 等词之后、闭合括号之前)。这一步先让"守词存在性"由测试钉死。

- [ ] **Step 2: deactivate 测试加 DSAR 断言(失败先行)**

`apps/web/tests/integration/pii-deactivate-user.test.ts`:在 Alice 的 fixture 里加一条注销工单:
```ts
await prisma.dsarRequest.create({
  data: { userId: user.id, type: "DELETION", status: "PENDING", isMinor: false, reason: "我的手机 13800138000 想删", requestedAt: new Date(), dueAt: new Date(Date.now() + 86400000) },
});
```
并在断言段加:
```ts
const dsarAfter = await prisma.dsarRequest.findFirstOrThrow({ where: { userId: user.id, type: "DELETION" } });
expect(dsarAfter.reason).toBeNull();            // reason 被 scrub
expect(result.payload.scrubbed.dsarRequests).toBe(1); // 计数
```

- [ ] **Step 3: export 测试加 DSAR 断言 + schemaVersion(失败先行)**

`apps/web/tests/integration/pii-export-user-data.test.ts`:fixture 加一条 EXPORT + 一条 DELETION 工单(带 reason),断言:
```ts
expect(data.schemaVersion).toBe("2026-05-31");
expect(data.dsarRequests.length).toBe(2);
expect(JSON.stringify(data.dsarRequests)).not.toContain("我的手机"); // 不含 reason/note 自由文本
```

- [ ] **Step 4: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/pii-ops-action-log-payload.test.ts tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts`
Expected: FAIL(reason 未 scrub / 无 dsarRequests 段 / schemaVersion 仍是旧值)。

- [ ] **Step 5: 实现 —— DeactivatePayload 加字段**

`pii-governance.ts`:`DeactivatePayload.scrubbed` 接口加 `dsarRequests: number;`。`buildDeactivatePlan` 的 empty + 实际计数里同步加(`prisma.dsarRequest.count({ where: { userId } })`,放进 `scrubbed`)。

- [ ] **Step 6: 实现 —— deactivate 事务内 scrub reason**

在 `deactivateUser` 的 `$transaction` 内(其它 scrub updateMany 旁)加:
```ts
const dsarRequests = await tx.dsarRequest.updateMany({
  where: { userId: args.userId, reason: { not: null } },
  data: { reason: null },
});
```
并把 `dsarRequests: dsarRequests.count` 放进 payload 的 `scrubbed`。注:**只 scrub reason,保留行**(审计)。

- [ ] **Step 7: 实现 —— export 加 dsarRequests 段 + schemaVersion 升版**

`UserDataExport` 接口:`schemaVersion` 字面量从 `"2026-05-26"` 改为 `"2026-05-31"`(接口定义处 + `exportUserData` 返回处两处)。接口加:
```ts
  dsarRequests: Array<{
    type: string; status: string;
    requestedAt: Date; dueAt: Date; resolvedAt: Date | null;
  }>;
```
`exportUserData` 的并行查询加 `prisma.dsarRequest.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { type: true, status: true, requestedAt: true, dueAt: true, resolvedAt: true } })`(**不** select reason/resolutionNote),返回对象加 `dsarRequests`。

- [ ] **Step 8: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/pii-ops-action-log-payload.test.ts tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add apps/web/server/lib/pii-governance.ts apps/web/tests
git commit -m "feat(web): DSAR PII coverage — scrub reason, export section, schema v2026-05-31 (Plan 14b)"
```

---

## Task 8: OPS CLI 脚本

**Files:**
- Create: `apps/web/scripts/dsar-list.ts`, `apps/web/scripts/dsar-fulfill.ts`, `apps/web/scripts/dsar-reject.ts`
- Modify: `apps/web/package.json`
- Test: `apps/web/tests/integration/dsar-cli.test.ts`

- [ ] **Step 1: 写 service 履行集成测试(失败先行)**

`apps/web/tests/integration/dsar-cli.test.ts`(直接测 service 层 `fulfillDeletion`/`rejectDeletion`/`listForOps`,不 spawn 进程):
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { fulfillDeletion, rejectDeletion, listForOps } from "@/server/lib/dsar";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

async function seedPendingDeletion(opts: { isMinor?: boolean } = {}) {
  const u = await prisma.user.create({ data: { persona: "STUDENT", isMinor: opts.isMinor ?? false } });
  const req = await prisma.dsarRequest.create({
    data: { userId: u.id, type: "DELETION", status: "PENDING", isMinor: opts.isMinor ?? false, requestedAt: new Date(), dueAt: new Date(Date.now() - 86400000) /* 逾期 */ },
  });
  return { userId: u.id, requestId: req.id };
}

describe("dsar CLI service", () => {
  it("fulfill 跑 deactivate + 置 COMPLETED + 写 ref", async () => {
    const { userId, requestId } = await seedPendingDeletion();
    const r = await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op", guardianVerified: false });
    expect(r.dryRun).toBe(false);
    const req = await prisma.dsarRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe("COMPLETED");
    expect(req.resolvedByRef).toBe("cli:test:op");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.deletedAt).not.toBeNull();
  });
  it("未成年缺 guardianVerified → 拒", async () => {
    const { requestId } = await seedPendingDeletion({ isMinor: true });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op", guardianVerified: false })).rejects.toThrow(/guardian-verified/);
  });
  it("二次 fulfill 已 COMPLETED 工单被状态守卫拒", async () => {
    const { requestId } = await seedPendingDeletion();
    await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op", guardianVerified: false });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op", guardianVerified: false })).rejects.toThrow(/not PENDING/);
  });
  it("reject 必填 note → REJECTED", async () => {
    const { requestId } = await seedPendingDeletion();
    const r = await rejectDeletion(prisma, { requestId, note: "非本人核验失败", initiatorRef: "cli:test:op" });
    expect(r.status).toBe("REJECTED");
  });
  it("listForOps --overdue 只列逾期 PENDING", async () => {
    await seedPendingDeletion(); // dueAt 在过去 = 逾期
    const rows = await listForOps(prisma, { status: "pending", overdueOnly: true });
    expect(rows.length).toBe(1);
    expect(rows[0]!.overdue).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/dsar-cli.test.ts`
Expected: FAIL(service 已在 Task 5 实现 → 可能直接 PASS;若 PASS 说明 Task 5 已覆盖,跳到 Step 4 仍要建脚本)。若因 `deactivateUser` 嵌套事务报错,按 Task 5 Step 2 的注释改为顺序调用。

- [ ] **Step 3: 确认 service 通过**

Run 同上 → PASS。

- [ ] **Step 4: 写三个 CLI 脚本**

`apps/web/scripts/dsar-list.ts`(骨架照搬 `user-deactivate.ts`):
```ts
#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { listForOps } from "../server/lib/dsar.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  let status: "pending" | "all" = "pending";
  let type: "export" | "deletion" | undefined;
  let overdueOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--status") status = argv[++i] === "all" ? "all" : "pending";
    else if (a === "--type") { const t = argv[++i]; type = t === "export" ? "export" : t === "deletion" ? "deletion" : undefined; }
    else if (a === "--overdue") overdueOnly = true;
  }
  return { status, type, overdueOnly };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const rows = await listForOps(prisma, args);
    console.log(JSON.stringify(rows, null, 2));
    console.log(`\n${rows.length} request(s); overdue: ${rows.filter((r) => r.overdue).length}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

`apps/web/scripts/dsar-fulfill.ts`:
```ts
#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { fulfillDeletion } from "../server/lib/dsar.js";
import { buildInitiatorRef, resolveOperatorUserId } from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  let requestId: string | undefined;
  let dryRun = false;
  let guardianVerified = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--guardian-verified") guardianVerified = true;
    else if (!a.startsWith("--")) requestId = a;
  }
  if (!requestId) throw new Error("Usage: dsar:fulfill <requestId> [--dry-run] [--guardian-verified]");
  return { requestId, dryRun, guardianVerified };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const r = await fulfillDeletion(prisma, { requestId: args.requestId, operatorId, initiatorRef: buildInitiatorRef(), guardianVerified: args.guardianVerified, dryRun: args.dryRun });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

`apps/web/scripts/dsar-reject.ts`:
```ts
#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { rejectDeletion } from "../server/lib/dsar.js";
import { buildInitiatorRef } from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  let requestId: string | undefined;
  let note: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--note") note = argv[++i];
    else if (!a.startsWith("--")) requestId = a;
  }
  if (!requestId || !note) throw new Error('Usage: dsar:reject <requestId> --note "..."');
  return { requestId, note };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const r = await rejectDeletion(prisma, { requestId: args.requestId, note: args.note, initiatorRef: buildInitiatorRef() });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

> 注:`buildInitiatorRef` / `resolveOperatorUserId` 的确切路径与导出名以 `user-deactivate.ts` 的 import 为准(Explore 报告为 `../server/lib/operator.js`)。`load-cli-env.js` 路径同 `user-deactivate.ts`。

- [ ] **Step 5: package.json 加 scripts**

`apps/web/package.json` scripts 段(在 `pii:gc-sweep` 后)加:
```json
    "dsar:list": "tsx scripts/dsar-list.ts",
    "dsar:fulfill": "tsx scripts/dsar-fulfill.ts",
    "dsar:reject": "tsx scripts/dsar-reject.ts"
```
(注意 `pii:gc-sweep` 行尾需补逗号。)

- [ ] **Step 6: CLI smoke**

Run: `pnpm.cmd --filter @zhijiao/web dsar:list --status all` → exit 0,打印 JSON 数组(可能为空)。

- [ ] **Step 7: 提交**

```bash
git add apps/web/scripts/dsar-list.ts apps/web/scripts/dsar-fulfill.ts apps/web/scripts/dsar-reject.ts apps/web/package.json apps/web/tests/integration/dsar-cli.test.ts
git commit -m "feat(web): dsar OPS CLI (list/fulfill/reject) (Plan 14b)"
```

---

## Task 9: 用户侧 UI + middleware

**Files:**
- Create: `apps/web/app/account/privacy/page.tsx`, `apps/web/app/account/privacy/privacy-view.tsx`
- Modify: `apps/web/middleware.ts`
- Modify: `apps/web/app/support/deactivate/page.tsx`

- [ ] **Step 1: middleware 加 /account**

`apps/web/middleware.ts`:
- `PROTECTED_PREFIXES` 数组加 `"/account"`。
- `config.matcher` 数组加 `"/account/:path*"`。

- [ ] **Step 2: page.tsx(server component)**

`apps/web/app/account/privacy/page.tsx`:
```tsx
import { PrivacyView } from "./privacy-view";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-8 text-slate-900">
      <h1 className="text-2xl font-bold">数据与隐私</h1>
      <PrivacyView />
    </main>
  );
}
```

- [ ] **Step 3: privacy-view.tsx(client component)**

`apps/web/app/account/privacy/privacy-view.tsx`(三块:导出下载 / 注销申请 / 请求记录;镜像 `OtpForm.tsx` 与 `family-link-view.tsx` 的 trpc useMutation/useQuery 风格;下载用 Blob+anchor):
```tsx
"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function PrivacyView() {
  const utils = trpc.useUtils();
  const my = trpc.dsar.myRequests.useQuery();
  const pending = my.data?.requests.find((r) => r.type === "DELETION" && r.status === "PENDING");

  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const exportMine = trpc.dsar.exportMine.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zhijiao-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      void utils.dsar.myRequests.invalidate();
    },
    onError: (e) => setErr(e.message),
  });
  const sendOtp = trpc.dsar.sendDeletionOtp.useMutation({
    onSuccess: () => { setOtpSent(true); setErr(null); },
    onError: (e) => setErr((e.data as { reason?: string } | undefined)?.reason === "DSAR_NO_PHONE" ? "未绑定手机号,请通过客服渠道办理注销。" : e.message),
  });
  const requestDeletion = trpc.dsar.requestDeletion.useMutation({
    onSuccess: () => { setOtpSent(false); setCode(""); setReason(""); void utils.dsar.myRequests.invalidate(); },
    onError: (e) => setErr(e.message),
  });
  const cancel = trpc.dsar.cancelDeletion.useMutation({
    onSuccess: () => void utils.dsar.myRequests.invalidate(),
    onError: (e) => setErr(e.message),
  });

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">下载我的数据副本</h2>
        <p className="text-sm text-slate-600">依据《个人信息保护法》第 45 条,您可获取个人信息副本(JSON)。</p>
        <button data-testid="dsar-export" disabled={exportMine.isPending}
          onClick={() => { setErr(null); exportMine.mutate(); }}
          className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50">
          {exportMine.isPending ? "生成中..." : "下载数据副本"}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">申请注销账号</h2>
        <p className="text-sm text-slate-600">依据《个人信息保护法》第 47 条。注销不可恢复,提交后由我们在 15 个工作日内处理,处理前您可随时撤销。</p>
        {pending ? (
          <div className="space-y-2" data-testid="dsar-pending">
            <p className="text-sm">注销申请处理中,预计完成日期:{new Date(pending.dueAt).toLocaleDateString("zh-CN")}</p>
            <button data-testid="dsar-delete-cancel" disabled={cancel.isPending}
              onClick={() => { setErr(null); cancel.mutate(); }}
              className="rounded border px-4 py-2">撤销申请</button>
          </div>
        ) : !otpSent ? (
          <button data-testid="dsar-send-otp" disabled={sendOtp.isPending}
            onClick={() => { setErr(null); sendOtp.mutate(); }}
            className="rounded border px-4 py-2">发送验证码以申请注销</button>
        ) : (
          <div className="space-y-2">
            <input data-testid="dsar-otp-code" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="验证码" className="border rounded px-3 py-2 w-full" />
            <textarea data-testid="dsar-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="注销原因(可选)" className="border rounded px-3 py-2 w-full" />
            <button data-testid="dsar-delete-submit" disabled={requestDeletion.isPending || code.length < 4}
              onClick={() => { setErr(null); requestDeletion.mutate({ otpCode: code, reason: reason || undefined }); }}
              className="rounded bg-red-600 text-white px-4 py-2 disabled:opacity-50">提交注销申请</button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">我的请求记录</h2>
        <ul className="text-sm space-y-1" data-testid="dsar-requests">
          {(my.data?.requests ?? []).map((r) => (
            <li key={r.id}>{r.type === "EXPORT" ? "数据副本" : "注销"} · {r.status} · {new Date(r.requestedAt).toLocaleDateString("zh-CN")}</li>
          ))}
        </ul>
      </section>

      {err && <p className="text-red-600 text-sm" data-testid="dsar-error">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 4: support 页加指引**

`apps/web/app/support/deactivate/page.tsx`:在"如何申请"段落里加一句(用 unicode 转义保持与既有文件一致或直接中文):
```tsx
        <p>{"已登录用户也可在「数据与隐私」(/account/privacy)页面自助下载数据副本或发起注销申请。"}</p>
```

- [ ] **Step 5: next build 验证(Suspense / 转义陷阱)**

Run: `pnpm.cmd --filter @zhijiao/web exec next build`
Expected: build 成功(无 missing-suspense / no-unescaped-entities 报错)。privacy-view 未用 `useSearchParams`,JSX 文本无裸 `"`。

- [ ] **Step 6: 提交**

```bash
git add apps/web/app/account apps/web/middleware.ts apps/web/app/support/deactivate/page.tsx
git commit -m "feat(web): /account/privacy DSAR UI + middleware /account prefix (Plan 14b)"
```

---

## Task 10: E2E 闭环

**Files:**
- Create: `apps/web/e2e/dsar.spec.ts`

> seed 一个专用用户避免与其它 spec 抢 OTP/手机号。沿用 `e2e/helpers/login.ts` 的 stagger login。先确认 `e2e/global-setup` seed 的用户里有可用本测试的手机号;若需新用户,加到 db seed 的测试用户文件(参考既有 `dev-student-0X`)。本 spec 用一个**注销后不影响其它 spec** 的独占用户。

- [ ] **Step 1: 写 E2E**

`apps/web/e2e/dsar.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

// 用独占手机号(注销会销号);需在 db seed 测试用户里存在,例如 dev-student-06。
const PHONE = "13800000012";

test("DSAR: 下载数据副本 + 发起注销 + 撤销", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/account/privacy");

  // 1) 下载数据副本(断言触发下载)
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("dsar-export").click(),
  ]);
  expect(download.suggestedFilename()).toContain("zhijiao-data");

  // 2) 发起注销:发码 → 取码 → 提交
  await page.getByTestId("dsar-send-otp").click();
  const res = await request.get(`/api/e2e-hooks/last-otp?phone=${PHONE}`);
  const { code } = await res.json();
  await page.getByTestId("dsar-otp-code").fill(code);
  await page.getByTestId("dsar-delete-submit").click();

  // 3) 看到处理中 + 撤销
  await expect(page.getByTestId("dsar-pending")).toBeVisible();
  await page.getByTestId("dsar-delete-cancel").click();
  await expect(page.getByTestId("dsar-send-otp")).toBeVisible();
});
```

- [ ] **Step 2: 确认 seed 用户存在**

若 `13800000012` 不在测试 seed,在 `packages/db/prisma/seed/1_test_users.ts`(或 E2E global-setup seed)加 `dev-student-06`(persona STUDENT,birthYear 成年,带 PHONE/GLOBAL identity 13800000012,初始 100 credits)。Run `pnpm.cmd --filter @zhijiao/db db:seed` 后该号可登录。

- [ ] **Step 3: 跑 E2E(单独)**

Run: `pnpm.cmd --filter @zhijiao/web exec playwright test dsar.spec.ts`
Expected: 1 passed。

- [ ] **Step 4: 提交**

```bash
git add apps/web/e2e/dsar.spec.ts packages/db/prisma/seed
git commit -m "test(e2e): DSAR export + deletion request + cancel loop (Plan 14b)"
```

---

## Task 11: 全量验证 + CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: regenerate + 全量 typecheck/test**

Run:
```
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck test --force
```
Expected: 全 PASS。

- [ ] **Step 2: E2E 全量(单独跑)**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e`
Expected: 全绿(含新 dsar.spec)。

- [ ] **Step 3: 更新 CLAUDE.md**

在「已落地」列表加 Plan 14b 条目;加「DSAR 现状(Plan 14b)」段(hybrid:导出自助 / 注销 OPS 工单;`DsarRequest` 表 + SLA `addWorkingDays(_,15)`;`dsar.*` 监护人门禁白名单;`verifyOtp` purpose 隔离;export schemaVersion 2026-05-31 + dsarRequests 段;注销 scrub reason 保留行;OPS CLI `dsar:list/fulfill/reject` + 未成年 `--guardian-verified` 闸门;无手机号走人工渠道);「Merge 后必跑」加红线:
- `dsar.*` 白名单:`Select-String -Path apps/web/server/routers/dsar.ts -Pattern "authedProcedure"` 命中且无 `consentGatedProcedure`;`<14` PENDING-consent 仍可 export/requestDeletion(`dsar-router.test` 守门)。
- `verifyOtp` purpose 隔离:`pnpm.cmd --filter @zhijiao/auth test -- tests/otp-purpose.test.ts` 全绿。
- export schemaVersion 升版 + dsarRequests 不含自由文本:`pii-export-user-data.test` 全绿。
- 未成年注销 CLI 闸门:`dsar-cli.test` 的 `--guardian-verified` 用例全绿。
从「下一步候选 Plan」移除 Plan 14b。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md
git commit -m "docs(claude): Plan 14b DSAR data-subject requests landed"
```

---

## Self-Review 记录

- **Spec coverage**:§1 hybrid→Task 5/6;§2 模型+SLA→Task 1/2;§3 OTP purpose→Task 3;§4 router+白名单→Task 6;§5 UI+middleware→Task 9;§6 CLI→Task 8;§7 PII→Task 7;§8 测试→各 Task;§9 文件结构→全覆盖;§10 punt 未做项不建 task(正确)。无缺口。
- **Placeholder scan**:所有 code step 含完整代码;测试含真实断言。两处显式"实现时确认"(deactivateUser 嵌套事务、auth index 再导出)是对既有代码不确定性的诚实标注 + 给了确切 fallback,非占位。
- **Type consistency**:`DsarRequestView`/`OpsDsarRow` 跨 Task 5→6→8 一致;`recordExportRequest`/`createDeletionRequest`/`cancelDeletionRequest`/`listOwnRequests`/`listForOps`/`fulfillDeletion`/`rejectDeletion` 命名跨 service/router/CLI 一致;`schemaVersion "2026-05-31"`、占位字段名、`reason`/`resolutionNote` scrub 语义跨 Task 7 一致;OTP `purpose` 联合类型跨 Task 3 三处一致。
- **风险点**:Task 5 的 `deactivateUser` 事务嵌套是唯一执行期需决断处,已给顺序调用 fallback + 幂等保证 + Task 8 二次-fulfill 守门测试。
