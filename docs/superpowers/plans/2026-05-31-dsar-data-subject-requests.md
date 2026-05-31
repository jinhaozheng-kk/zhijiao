# DSAR 数据主体请求 + SLA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **修订说明（2026-05-31，经 4-subagent 评审）**：已修四个会破坏执行的点(server-only/嵌套事务/env 路径/makeCtx 类型)、export 改 fail-close、`<14` 注销改"绑定监护人站内审批"、REJECTED 回显理由、partial-unique 幂等、悬挂工单收口、SLA 30 日封顶。

**Goal:** 登录用户自助导出数据副本(EXPORT)+ 经 OTP 重验发起注销(DELETION);成年直接 PENDING、`<14` 经绑定监护人站内审批后 PENDING,OPS CLI 审核履行,全程工单化 + 15 工作日/30 自然日封顶 SLA。

**Architecture:** `DsarRequest` 表为请求真源;service `apps/web/server/lib/dsar.ts`(**不带 server-only**,被 tsx CLI import)被 `dsar` tRPC router 与三个 CLI 脚本共用。复用 Plan 6 `exportUserData`/`deactivateUser`、Plan 11 FamilyLink、既有 OTP/限频。`dsar.*` 走裸 `authedProcedure`(监护人门禁白名单)。

**Tech Stack:** TypeScript、Prisma 5、tRPC v11、Next 14、Vitest、Playwright、`@zhijiao/auth`、`@zhijiao/db`。

**Spec:** `docs/superpowers/specs/2026-05-31-dsar-data-subject-requests-design.md`

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/db/prisma/schema.prisma` + migration | `DsarRequest` + 枚举(含 `AWAITING_GUARDIAN`)+ guardian 审批字段;`OtpPurpose` += `DSAR_DELETION`;`User.dsarRequests`;partial unique idx(raw SQL) |
| `packages/auth/src/otp.ts` | `IssueOtpInput.purpose` += `DSAR_DELETION`;`verifyOtp` 加可选 `purpose` |
| `packages/auth/tests/otp-purpose.test.ts` | purpose 隔离单测 |
| `packages/auth/src/ratelimit/rules.ts` | `RULE_DSAR_EXPORT`(fail-close)+ `RULE_DSAR_VERIFY_PH`(fail-close) |
| `apps/web/server/lib/dsar.ts` | service(无 server-only):helpers + create/approve/cancel/list + ops fulfill/reject |
| `apps/web/tests/unit/dsar-working-days.test.ts` | `addWorkingDays`/`dueAtFor` 纯单测 |
| `apps/web/server/routers/dsar.ts` | 7 个 procedure |
| `apps/web/server/routers/_root.ts` | 注册 `dsar` |
| `apps/web/tests/integration/_helpers/error-book-fixtures.ts` | `makeCtx` 加 `guardianConsentStatus` override |
| `apps/web/tests/integration/dsar-router.test.ts` | router 集成测试 |
| `apps/web/server/lib/pii-governance.ts` | scrub reason + 悬挂工单收口 + export 段 + schemaVersion |
| `apps/web/tests/{unit,integration}/pii-*.test.ts` | 守词 + deactivate/export 断言 |
| `apps/web/scripts/dsar-{list,fulfill,reject}.ts` + `package.json` | OPS CLI |
| `apps/web/tests/integration/dsar-cli.test.ts` | CLI service 测试 |
| `apps/web/app/account/privacy/{page,privacy-view}.tsx` | 用户侧 UI |
| `apps/web/app/(parent or wherever)/parent/children/[childId]/...` | 家长端审批块 |
| `apps/web/middleware.ts` | `PROTECTED_PREFIXES` + `matcher` 加 `/account` |
| `apps/web/app/support/deactivate/page.tsx` | 指向 `/account/privacy` |
| `apps/web/e2e/dsar.spec.ts` | E2E(成年闭环) |
| `CLAUDE.md` | 落地记录 + 红线 |

---

## Task 1: Schema —— DsarRequest 表 + 枚举 + partial unique idx

**Files:** Modify `packages/db/prisma/schema.prisma` (+ migration)

- [ ] **Step 1: OtpPurpose 加值**
```prisma
enum OtpPurpose { LOGIN  BIND_PHONE  DSAR_DELETION }
```

- [ ] **Step 2: 新增 DSAR 枚举 + 模型**(schema 末尾)
```prisma
// === Plan 14b: DSAR 数据主体请求 ===
enum DsarRequestType { EXPORT  DELETION }
enum DsarRequestStatus { AWAITING_GUARDIAN  PENDING  COMPLETED  REJECTED  CANCELED }

model DsarRequest {
  id                       String            @id @default(cuid())
  userId                   String            @map("user_id")
  type                     DsarRequestType
  status                   DsarRequestStatus @default(PENDING)
  isMinor                  Boolean           @default(false) @map("is_minor")
  reason                   String?
  requestedAt              DateTime          @default(now()) @map("requested_at")
  dueAt                    DateTime          @map("due_at")
  resolvedAt               DateTime?         @map("resolved_at")
  resolvedByRef            String?           @map("resolved_by_ref")
  resolutionNote           String?           @map("resolution_note")
  guardianApprovedByUserId String?           @map("guardian_approved_by_user_id")
  guardianApprovedAt       DateTime?         @map("guardian_approved_at")
  createdAt                DateTime          @default(now()) @map("created_at")
  user                     User              @relation("UserDsarRequests", fields: [userId], references: [id], onDelete: Cascade)
  @@index([status, dueAt])
  @@index([userId])
  @@map("dsar_requests")
}
```

- [ ] **Step 3: User 反向关系**(`model User` 内)
```prisma
  dsarRequests       DsarRequest[]      @relation("UserDsarRequests")
```

- [ ] **Step 4: 建 migration**

Run: `pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --name plan14b_dsar_requests`

- [ ] **Step 5: 追加 partial unique idx 到 migration 末尾**

编辑刚生成的 migration `.sql`,在末尾追加(Prisma 5 schema 不支持 partial index,raw SQL,沿用 Plan 4/8 做法):
```sql
CREATE UNIQUE INDEX "dsar_one_open_deletion_idx" ON "dsar_requests"("user_id")
  WHERE "type" = 'DELETION' AND "status" IN ('AWAITING_GUARDIAN', 'PENDING');
```
重新应用:`pnpm.cmd --filter @zhijiao/db exec prisma migrate reset --force`(dev 库)或手动 `psql` 执行该 idx。

- [ ] **Step 6: regenerate + typecheck + 提交**

Run: `pnpm.cmd --filter @zhijiao/db db:generate` 然后 `pnpm.cmd --filter @zhijiao/db typecheck` → PASS
```bash
git add packages/db/prisma
git commit -m "feat(db): DsarRequest table + AWAITING_GUARDIAN + one-open-deletion idx (Plan 14b)"
```

---

## Task 2: addWorkingDays + dueAtFor 纯函数

**Files:** Create `apps/web/server/lib/dsar.ts`;Test `apps/web/tests/unit/dsar-working-days.test.ts`

- [ ] **Step 1: 写失败测试**
```ts
import { describe, it, expect } from "vitest";
import { addWorkingDays, dueAtFor } from "@/server/lib/dsar";

describe("addWorkingDays", () => {
  it("周五 + 1 工作日 = 下周一", () => {
    const fri = new Date("2026-06-05T00:00:00.000Z");
    expect(addWorkingDays(fri, 1).toISOString().slice(0, 10)).toBe("2026-06-08");
  });
  it("周一 + 15 工作日 = 三周后周一(跨 3 个周末)", () => {
    const mon = new Date("2026-06-01T00:00:00.000Z");
    expect(addWorkingDays(mon, 15).toISOString().slice(0, 10)).toBe("2026-06-22");
  });
  it("0 工作日返回副本", () => {
    const d = new Date("2026-06-03T08:30:00.000Z");
    expect(addWorkingDays(d, 0).getTime()).toBe(d.getTime());
  });
});

describe("dueAtFor (15 工作日, 30 自然日封顶)", () => {
  it("普通情形取 15 工作日", () => {
    const mon = new Date("2026-06-01T00:00:00.000Z");
    // 15 工作日 = +21 自然日 < 30,取 15 工作日
    expect(dueAtFor(mon).toISOString().slice(0, 10)).toBe("2026-06-22");
  });
  it("永不超过 +30 自然日", () => {
    const d = new Date("2026-06-01T00:00:00.000Z");
    const cap = new Date(d.getTime() + 30 * 86400000);
    expect(dueAtFor(d).getTime()).toBeLessThanOrEqual(cap.getTime());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/dsar-working-days.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 创建 dsar.ts(纯函数;注意无 `server-only`)**
```ts
// Plan 14b: DSAR service. 注意:本文件【不】import "server-only" —— 它被 tsx CLI
// (dsar:list/fulfill/reject)直接 import,server-only 的 default 导出会 throw(见
// kp-reconcile.ts / pii-governance.ts 同款先例)。server-only 只加在 routers/dsar.ts。

const SLA_WORKING_DAYS = 15;
const SLA_CALENDAR_CAP_DAYS = 30;

// 前进 n 个工作日(跳周六周日,法定节假日忽略)。UTC 维度;n=0 返回副本。
export function addWorkingDays(date: Date, n: number): Date {
  const out = new Date(date.getTime());
  let added = 0;
  while (added < n) {
    out.setUTCDate(out.getUTCDate() + 1);
    const day = out.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return out;
}

// SLA 截止:15 工作日,但永不超过 +30 自然日(防长假把工作日推过 PIPL ~30 日预期)。
export function dueAtFor(requestedAt: Date): Date {
  const working = addWorkingDays(requestedAt, SLA_WORKING_DAYS);
  const cap = new Date(requestedAt.getTime() + SLA_CALENDAR_CAP_DAYS * 86_400_000);
  return working.getTime() < cap.getTime() ? working : cap;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/dsar-working-days.test.ts` → PASS。

- [ ] **Step 5: 提交**
```bash
git add apps/web/server/lib/dsar.ts apps/web/tests/unit/dsar-working-days.test.ts
git commit -m "feat(web): addWorkingDays + dueAtFor SLA helpers (Plan 14b)"
```

---

## Task 3: verifyOtp purpose 过滤 + OtpPurpose union

**Files:** Modify `packages/auth/src/otp.ts`;Test `packages/auth/tests/otp-purpose.test.ts`

- [ ] **Step 1: 写失败测试**
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { issueOtp, verifyOtp } from "../src/otp.js";

const PEPPER = "test-pepper-min16-bytes";
const PHONE = "13800009999";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("verifyOtp purpose isolation (Plan 14b)", () => {
  it("DSAR 码用 DSAR purpose 验证 → 通过", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "DSAR_DELETION", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER, "DSAR_DELETION")).resolves.toBeTruthy();
  });
  it("LOGIN 码不能用 DSAR purpose 验证", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER, "DSAR_DELETION")).rejects.toThrow();
  });
  it("不传 purpose 时行为不变(LOGIN 码可验)", async () => {
    const { code } = await issueOtp(prisma, { phone: PHONE, purpose: "LOGIN", pepper: PEPPER });
    await expect(verifyOtp(prisma, PHONE, code, PEPPER)).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/auth test -- tests/otp-purpose.test.ts` → FAIL。

- [ ] **Step 3: 改 union(`otp.ts:25`)**
```ts
  purpose: "LOGIN" | "BIND_PHONE" | "DSAR_DELETION";
```

- [ ] **Step 4: verifyOtp 加可选 purpose**(`otp.ts:71-76`)
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
(其余不动。)

- [ ] **Step 5: 运行 + auth 回归**

Run: `pnpm.cmd --filter @zhijiao/auth test -- tests/otp-purpose.test.ts` → PASS;`pnpm.cmd --filter @zhijiao/auth test` → 全 PASS。

- [ ] **Step 6: 提交**
```bash
git add packages/auth/src/otp.ts packages/auth/tests/otp-purpose.test.ts
git commit -m "feat(auth): verifyOtp optional purpose filter + DSAR_DELETION (Plan 14b)"
```

---

## Task 4: 限频规则(fail-close)

**Files:** Modify `packages/auth/src/ratelimit/rules.ts`

- [ ] **Step 1: 加两条规则**(规则块末尾)
```ts
// Plan 14b: 全量 PII 导出是高敏端点 —— fail-CLOSE(Redis 挂宁可短暂拒,也不放任
// stolen-session 无限 dump)。cap 2 / refill 1 token 每天:正常人极少导出,挡滥刷。
export const RULE_DSAR_EXPORT: RateLimitRule = { prefix: "dsar:export:", capacity: 2, refillPerSec: 1/86400, failMode: "close" };
// DSAR 验码专用桶,不与 LOGIN 的 RULE_OTP_VERIFY_PH 共用暴破预算。
export const RULE_DSAR_VERIFY_PH: RateLimitRule = { prefix: "dsar:verify:phone:", capacity: 5, refillPerSec: 5/60, failMode: "close" };
```

- [ ] **Step 2: typecheck + 提交**

Run: `pnpm.cmd --filter @zhijiao/auth typecheck` → PASS
```bash
git add packages/auth/src/ratelimit/rules.ts
git commit -m "feat(auth): RULE_DSAR_EXPORT (fail-close) + RULE_DSAR_VERIFY_PH (Plan 14b)"
```

---

## Task 5: dsar.ts service 函数

**Files:** Modify `apps/web/server/lib/dsar.ts`

> 接 `PrismaClient | Prisma.TransactionClient`,不内置 `$transaction`(由调用方决定边界)。**fulfillDeletion 顺序调用 deactivateUser,不嵌套 `$transaction`**(Prisma 5 不支持嵌套交互事务)。

- [ ] **Step 1: 追加 view 类型与 create/approve/cancel/list**
```ts
import { type Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface DsarRequestView {
  id: string;
  type: "EXPORT" | "DELETION";
  status: "AWAITING_GUARDIAN" | "PENDING" | "COMPLETED" | "REJECTED" | "CANCELED";
  isMinor: boolean;
  requestedAt: Date;
  dueAt: Date;
  resolvedAt: Date | null;
  rejectionReason: string | null; // 仅 REJECTED 回显 resolutionNote;其它为 null
}

function toView(r: {
  id: string; type: string; status: string; isMinor: boolean;
  requestedAt: Date; dueAt: Date; resolvedAt: Date | null; resolutionNote: string | null;
}): DsarRequestView {
  return {
    id: r.id,
    type: r.type as DsarRequestView["type"],
    status: r.status as DsarRequestView["status"],
    isMinor: r.isMinor,
    requestedAt: r.requestedAt,
    dueAt: r.dueAt,
    resolvedAt: r.resolvedAt,
    rejectionReason: r.status === "REJECTED" ? r.resolutionNote : null,
  };
}

const OPEN_DELETION = ["AWAITING_GUARDIAN", "PENDING"] as const;

export async function recordExportRequest(
  db: DbClient,
  args: { userId: string; isMinor: boolean; now?: Date },
): Promise<{ id: string }> {
  const now = args.now ?? new Date();
  return db.dsarRequest.create({
    data: { userId: args.userId, type: "EXPORT", status: "COMPLETED", isMinor: args.isMinor, requestedAt: now, dueAt: now, resolvedAt: now, resolvedByRef: "self" },
    select: { id: true },
  });
}

// 注销:成年→PENDING;<14 有监护人→AWAITING_GUARDIAN;<14 无监护人→抛 NeedsGuardianError。幂等。
export class NeedsGuardianError extends Error {}

export async function createDeletionRequest(
  db: DbClient,
  args: { userId: string; needsGuardian: boolean; hasActiveGuardian: boolean; reason?: string | null; now?: Date },
): Promise<{ request: DsarRequestView; alreadyOpen: boolean }> {
  const existing = await db.dsarRequest.findFirst({
    where: { userId: args.userId, type: "DELETION", status: { in: [...OPEN_DELETION] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { request: toView(existing), alreadyOpen: true };

  if (args.needsGuardian && !args.hasActiveGuardian) throw new NeedsGuardianError("guardian required");

  const now = args.now ?? new Date();
  const created = await db.dsarRequest.create({
    data: {
      userId: args.userId,
      type: "DELETION",
      status: args.needsGuardian ? "AWAITING_GUARDIAN" : "PENDING",
      isMinor: args.needsGuardian,
      reason: args.reason ?? null,
      requestedAt: now,
      dueAt: dueAtFor(now),
    },
  });
  return { request: toView(created), alreadyOpen: false };
}

// 监护人审批:child 的 AWAITING_GUARDIAN → PENDING + 留痕。无 awaiting → null。
export async function approveChildDeletion(
  db: DbClient,
  args: { childUserId: string; guardianUserId: string; now?: Date },
): Promise<DsarRequestView | null> {
  const awaiting = await db.dsarRequest.findFirst({
    where: { userId: args.childUserId, type: "DELETION", status: "AWAITING_GUARDIAN" },
    orderBy: { createdAt: "desc" },
  });
  if (!awaiting) return null;
  const updated = await db.dsarRequest.update({
    where: { id: awaiting.id },
    data: { status: "PENDING", guardianApprovedByUserId: args.guardianUserId, guardianApprovedAt: args.now ?? new Date() },
  });
  return toView(updated);
}

export async function cancelDeletionRequest(
  db: DbClient,
  args: { userId: string; now?: Date },
): Promise<DsarRequestView | null> {
  const open = await db.dsarRequest.findFirst({
    where: { userId: args.userId, type: "DELETION", status: { in: [...OPEN_DELETION] } },
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
  const rows = await db.dsarRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(toView);
}

// 监护人列其 ACTIVE 子女的 AWAITING_GUARDIAN 注销申请。
export async function listPendingChildApprovals(
  db: DbClient,
  guardianUserId: string,
): Promise<Array<{ childUserId: string; request: DsarRequestView }>> {
  const links = await db.familyLink.findMany({
    where: { parentUserId: guardianUserId, status: "ACTIVE" },
    select: { studentUserId: true },
  });
  const childIds = links.map((l) => l.studentUserId);
  if (childIds.length === 0) return [];
  const rows = await db.dsarRequest.findMany({
    where: { userId: { in: childIds }, type: "DELETION", status: "AWAITING_GUARDIAN" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ childUserId: r.userId, request: toView(r) }));
}
```

- [ ] **Step 2: 追加 OPS list/fulfill/reject**
```ts
import { deactivateUser, previewDeactivateUser } from "./pii-governance.js";

export interface OpsDsarRow {
  id: string; userId: string; type: string; status: string;
  isMinor: boolean; guardianApproved: boolean; requestedAt: Date; dueAt: Date; overdue: boolean;
}

export async function listForOps(
  prisma: PrismaClient,
  args: { status?: "pending" | "all"; type?: "export" | "deletion"; overdueOnly?: boolean; now?: Date },
): Promise<OpsDsarRow[]> {
  const now = args.now ?? new Date();
  const where: Prisma.DsarRequestWhereInput = {};
  if ((args.status ?? "pending") === "pending") where.status = { in: ["AWAITING_GUARDIAN", "PENDING"] };
  if (args.type) where.type = args.type === "export" ? "EXPORT" : "DELETION";
  if (args.overdueOnly) where.dueAt = { lt: now };
  const rows = await prisma.dsarRequest.findMany({ where, orderBy: { dueAt: "asc" } });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, type: r.type, status: r.status, isMinor: r.isMinor,
    guardianApproved: r.guardianApprovedByUserId != null,
    requestedAt: r.requestedAt, dueAt: r.dueAt,
    overdue: (r.status === "PENDING" || r.status === "AWAITING_GUARDIAN") && r.dueAt < now,
  }));
}

export class DsarFulfillError extends Error {}

// 履行注销:须 PENDING+DELETION;未成年须有 guardianApprovedByUserId(站内审批留痕)+ 复核 live isMinor。
// 顺序调用(不嵌套 $transaction);predicate-on-update 防并发双 fulfill。
export async function fulfillDeletion(
  prisma: PrismaClient,
  args: { requestId: string; operatorId: string | null; initiatorRef: string; dryRun?: boolean },
) {
  const req = await prisma.dsarRequest.findUnique({ where: { id: args.requestId } });
  if (!req) throw new DsarFulfillError(`DSAR request not found: ${args.requestId}`);
  if (req.type !== "DELETION") throw new DsarFulfillError(`not a DELETION request`);
  if (req.status !== "PENDING") throw new DsarFulfillError(`request not PENDING (is ${req.status})`);

  // 未成年闸门:数据可验证(站内监护人审批),非 CLI 荣誉旗标。
  const liveUser = await prisma.user.findUnique({ where: { id: req.userId }, select: { isMinor: true } });
  const isMinor = req.isMinor || liveUser?.isMinor === true; // 快照 OR live,任一为真即按未成年处理
  if (isMinor && req.guardianApprovedByUserId == null) {
    throw new DsarFulfillError(`minor account requires in-app guardian approval before fulfilling ${args.requestId}`);
  }

  if (args.dryRun) {
    const preview = await previewDeactivateUser(prisma, req.userId);
    return { dryRun: true, preview, requestId: req.id };
  }

  // deactivateUser 自带原子 $transaction;此处顺序调用,再 predicate-on-update 工单状态。
  const result = await deactivateUser(prisma, {
    userId: req.userId, operatorId: args.operatorId, initiatorRef: args.initiatorRef, reason: "DSAR_DELETION_REQUEST",
  });
  const flip = await prisma.dsarRequest.updateMany({
    where: { id: req.id, status: "PENDING" },
    data: { status: "COMPLETED", resolvedAt: new Date(), resolvedByRef: args.initiatorRef },
  });
  if (flip.count === 0) throw new DsarFulfillError(`request was concurrently resolved: ${args.requestId}`);
  return { dryRun: false, deactivate: result, requestId: req.id };
}

export async function rejectDeletion(
  prisma: PrismaClient,
  args: { requestId: string; note: string; initiatorRef: string },
): Promise<OpsDsarRow> {
  const req = await prisma.dsarRequest.findUnique({ where: { id: args.requestId } });
  if (!req) throw new DsarFulfillError(`DSAR request not found`);
  if (req.status !== "PENDING" && req.status !== "AWAITING_GUARDIAN") throw new DsarFulfillError(`request not open (is ${req.status})`);
  const updated = await prisma.dsarRequest.update({
    where: { id: req.id },
    data: { status: "REJECTED", resolvedAt: new Date(), resolvedByRef: args.initiatorRef, resolutionNote: args.note },
  });
  return {
    id: updated.id, userId: updated.userId, type: updated.type, status: updated.status, isMinor: updated.isMinor,
    guardianApproved: updated.guardianApprovedByUserId != null, requestedAt: updated.requestedAt, dueAt: updated.dueAt, overdue: false,
  };
}
```

- [ ] **Step 3: typecheck + 提交**

Run: `pnpm.cmd --filter @zhijiao/web typecheck` → PASS
```bash
git add apps/web/server/lib/dsar.ts
git commit -m "feat(web): dsar service (create/approve/cancel/list + ops fulfill/reject) (Plan 14b)"
```

---

## Task 6: dsar tRPC router + makeCtx 扩展 + 集成测试

**Files:** Create `apps/web/server/routers/dsar.ts`;Modify `_root.ts`、`tests/integration/_helpers/error-book-fixtures.ts`;Test `tests/integration/dsar-router.test.ts`

- [ ] **Step 1: 扩 makeCtx override 类型**

`tests/integration/_helpers/error-book-fixtures.ts` 的 `makeCtx`:override 类型加 `guardianConsentStatus`,并去掉 `as const`:
```ts
export function makeCtx(
  userId: string,
  overrides: Partial<{ requestId: string; isMinor: boolean; guardianConsentStatus: "NOT_REQUIRED" | "PENDING" | "GRANTED" }> = {},
) {
  return {
    db: prisma, redis,
    auth: {
      userId, sessionId: "test-session", persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor: overrides.isMinor ?? false,
      guardianConsentStatus: overrides.guardianConsentStatus ?? "NOT_REQUIRED",
    },
    authError: null, ip: "127.0.0.1", ua: "vitest",
    requestId: overrides.requestId ?? "test-req-error",
    resHeaders: new Headers(), cookies: {},
  };
}
```

- [ ] **Step 2: 写失败测试**
```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { issueOtp } from "@zhijiao/auth";
import { redis, makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

const { appRouter } = await import("@/server/routers/_root");
const PEPPER = process.env.OTP_PEPPER ?? "test-otp-pepper-min16-bytes";

async function seedPhone(userId: string, phone: string) {
  await prisma.authIdentity.create({ data: { userId, provider: "PHONE", providerScope: "GLOBAL", providerUserId: phone } });
}
async function seedGuardian(childId: string): Promise<string> {
  const g = await prisma.user.create({ data: { persona: "PARENT", isMinor: false } });
  await prisma.familyLink.create({ data: { parentUserId: g.id, studentUserId: childId, status: "ACTIVE" } });
  return g.id;
}

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

describe("dsar.exportMine", () => {
  it("返数据 + COMPLETED 工单", async () => {
    const u = await seedUserWithBalance(5);
    const r = await appRouter.createCaller(makeCtx(u.id)).dsar.exportMine();
    expect(r.requestId).toBeTruthy();
    expect(r.export.userId).toBe(u.id);
    expect((await prisma.dsarRequest.findFirstOrThrow({ where: { userId: u.id, type: "EXPORT" } })).status).toBe("COMPLETED");
  });
  it("限频超额 → TOO_MANY_REQUESTS(cap 2)", async () => {
    const u = await seedUserWithBalance(5);
    const c = appRouter.createCaller(makeCtx(u.id));
    await c.dsar.exportMine();
    await c.dsar.exportMine();
    await expect(c.dsar.exportMine()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("dsar.requestDeletion", () => {
  it("成年有效 OTP → PENDING + dueAt 未来且 ≤30 天", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007777");
    const { code } = await issueOtp(prisma, { phone: "13800007777", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r = await appRouter.createCaller(makeCtx(u.id)).dsar.requestDeletion({ otpCode: code, reason: "不想用了" });
    expect(r.request.status).toBe("PENDING");
    const due = new Date(r.request.dueAt).getTime();
    expect(due).toBeGreaterThan(Date.now());
    expect(due).toBeLessThanOrEqual(Date.now() + 30 * 86400000 + 1000);
  });
  it("无效 OTP → 拒 + 不建工单", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007778");
    await expect(appRouter.createCaller(makeCtx(u.id)).dsar.requestDeletion({ otpCode: "000000" })).rejects.toBeInstanceOf(TRPCError);
    expect(await prisma.dsarRequest.count({ where: { userId: u.id, type: "DELETION" } })).toBe(0);
  });
  it("<14 有监护人 → AWAITING_GUARDIAN", async () => {
    const u = await seedUserWithBalance(5, { isMinor: true });
    await prisma.user.update({ where: { id: u.id }, data: { guardianConsentStatus: "GRANTED" } });
    await seedPhone(u.id, "13800007780");
    await seedGuardian(u.id);
    const { code } = await issueOtp(prisma, { phone: "13800007780", purpose: "DSAR_DELETION", pepper: PEPPER });
    const ctx = makeCtx(u.id, { isMinor: true, guardianConsentStatus: "GRANTED" });
    const r = await appRouter.createCaller(ctx).dsar.requestDeletion({ otpCode: code });
    expect(r.request.status).toBe("AWAITING_GUARDIAN");
  });
  it("<14 无监护人 → DSAR_GUARDIAN_REQUIRED + 不建工单", async () => {
    const u = await seedUserWithBalance(5, { isMinor: true });
    await prisma.user.update({ where: { id: u.id }, data: { guardianConsentStatus: "PENDING" } });
    await seedPhone(u.id, "13800007781");
    const { code } = await issueOtp(prisma, { phone: "13800007781", purpose: "DSAR_DELETION", pepper: PEPPER });
    const ctx = makeCtx(u.id, { isMinor: true, guardianConsentStatus: "PENDING" });
    await expect(appRouter.createCaller(ctx).dsar.requestDeletion({ otpCode: code })).rejects.toMatchObject({ cause: { reason: "DSAR_GUARDIAN_REQUIRED" } });
    expect(await prisma.dsarRequest.count({ where: { userId: u.id } })).toBe(0);
  });
  it("幂等:二次发起返同一条", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007782");
    const c = appRouter.createCaller(makeCtx(u.id));
    const { code: a } = await issueOtp(prisma, { phone: "13800007782", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r1 = await c.dsar.requestDeletion({ otpCode: a });
    const { code: b } = await issueOtp(prisma, { phone: "13800007782", purpose: "DSAR_DELETION", pepper: PEPPER });
    const r2 = await c.dsar.requestDeletion({ otpCode: b });
    expect(r2.request.id).toBe(r1.request.id);
  });
});

describe("dsar.approveChildDeletion", () => {
  it("监护人 ACTIVE → AWAITING_GUARDIAN 转 PENDING + 留痕", async () => {
    const child = await seedUserWithBalance(5, { isMinor: true });
    await prisma.user.update({ where: { id: child.id }, data: { guardianConsentStatus: "GRANTED" } });
    await seedPhone(child.id, "13800007783");
    const guardianId = await seedGuardian(child.id);
    const { code } = await issueOtp(prisma, { phone: "13800007783", purpose: "DSAR_DELETION", pepper: PEPPER });
    await appRouter.createCaller(makeCtx(child.id, { isMinor: true, guardianConsentStatus: "GRANTED" })).dsar.requestDeletion({ otpCode: code });
    const approved = await appRouter.createCaller(makeCtx(guardianId)).dsar.approveChildDeletion({ childUserId: child.id });
    expect(approved.status).toBe("PENDING");
    const row = await prisma.dsarRequest.findFirstOrThrow({ where: { userId: child.id, type: "DELETION" } });
    expect(row.guardianApprovedByUserId).toBe(guardianId);
  });
  it("非监护人 → NOT_FOUND", async () => {
    const child = await seedUserWithBalance(5, { isMinor: true });
    const stranger = await seedUserWithBalance(5);
    await expect(appRouter.createCaller(makeCtx(stranger.id)).dsar.approveChildDeletion({ childUserId: child.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("dsar.cancelDeletion + myRequests + sendDeletionOtp", () => {
  it("PENDING → CANCELED;无 open → NOT_FOUND", async () => {
    const u = await seedUserWithBalance(5);
    await seedPhone(u.id, "13800007784");
    const c = appRouter.createCaller(makeCtx(u.id));
    const { code } = await issueOtp(prisma, { phone: "13800007784", purpose: "DSAR_DELETION", pepper: PEPPER });
    await c.dsar.requestDeletion({ otpCode: code });
    expect((await c.dsar.cancelDeletion()).status).toBe("CANCELED");
    await expect(c.dsar.cancelDeletion()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("myRequests:REJECTED 回显 rejectionReason", async () => {
    const u = await seedUserWithBalance(5);
    await prisma.dsarRequest.create({ data: { userId: u.id, type: "DELETION", status: "REJECTED", isMinor: false, requestedAt: new Date(), dueAt: new Date(), resolutionNote: "经核验非本人" } });
    const r = await appRouter.createCaller(makeCtx(u.id)).dsar.myRequests();
    expect(r.requests[0]!.rejectionReason).toBe("经核验非本人");
  });
  it("无手机号 → DSAR_NO_PHONE", async () => {
    const u = await seedUserWithBalance(5);
    await expect(appRouter.createCaller(makeCtx(u.id)).dsar.sendDeletionOtp()).rejects.toMatchObject({ cause: { reason: "DSAR_NO_PHONE" } });
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/dsar-router.test.ts` → FAIL(`caller.dsar` 不存在)。

- [ ] **Step 4: 实现 router**

`apps/web/server/routers/dsar.ts`:
```ts
import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, router } from "../trpc.js";
import {
  takeRule, RedisRateLimitStore, RULE_DSAR_EXPORT, RULE_DSAR_VERIFY_PH,
  RULE_OTP_SEND_PHONE, RULE_OTP_SEND_IP, RateLimitBackendDownError, issueOtp, verifyOtp, AuthError,
} from "@zhijiao/auth";
import { env } from "../env.js"; // 注意:不是 @/lib/env(不存在);与 auth.ts 一致
import { exportUserData } from "../lib/pii-governance.js";
import {
  recordExportRequest, createDeletionRequest, approveChildDeletion, cancelDeletionRequest,
  listOwnRequests, listPendingChildApprovals, NeedsGuardianError,
} from "../lib/dsar.js";

const store = (redis: import("ioredis").default) => new RedisRateLimitStore(redis);

async function ownPhone(db: typeof import("@zhijiao/db").prisma, userId: string): Promise<string | null> {
  const id = await db.authIdentity.findFirst({ where: { userId, provider: "PHONE", providerScope: "GLOBAL" }, select: { providerUserId: true } });
  return id?.providerUserId ?? null;
}
function ratelimitGuard(fn: () => Promise<void>) { return fn; }

export const dsarRouter = router({
  exportMine: authedProcedure.mutation(async ({ ctx }) => {
    // fail-CLOSE:Redis 挂 → RateLimitBackendDownError → 500(不放任无限 dump)
    try {
      const a = await takeRule(store(ctx.redis), RULE_DSAR_EXPORT, ctx.auth.userId);
      if (!a.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "导出过于频繁,请稍后再试", cause: { reason: "DSAR_EXPORT_TOO_FREQUENT" } });
      const b = await takeRule(store(ctx.redis), RULE_DSAR_EXPORT, ctx.ip);
      if (!b.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "导出过于频繁,请稍后再试", cause: { reason: "DSAR_EXPORT_TOO_FREQUENT" } });
    } catch (e) {
      if (e instanceof RateLimitBackendDownError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "服务暂时不可用", cause: { reason: "RATELIMIT_BACKEND_DOWN" } });
      throw e;
    }
    // 同事务:导出 + 审计原子
    return ctx.db.$transaction(async (tx) => {
      const data = await exportUserData(tx, ctx.auth.userId);
      const rec = await recordExportRequest(tx, { userId: ctx.auth.userId, isMinor: ctx.auth.isMinor });
      return { export: data, requestId: rec.id };
    });
  }),

  sendDeletionOtp: authedProcedure.mutation(async ({ ctx }) => {
    const phone = await ownPhone(ctx.db, ctx.auth.userId);
    if (!phone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未绑定手机号,请通过客服渠道办理注销", cause: { reason: "DSAR_NO_PHONE" } });
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
    if (process.env.E2E_TEST_HOOKS === "1") await ctx.redis.set(`e2e:last-otp:${phone}`, code, "EX", 300);
    return { ok: true as const };
  }),

  requestDeletion: authedProcedure
    .input(z.object({ otpCode: z.string().min(4).max(8), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const phone = await ownPhone(ctx.db, ctx.auth.userId);
      if (!phone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未绑定手机号", cause: { reason: "DSAR_NO_PHONE" } });
      try {
        const v = await takeRule(store(ctx.redis), RULE_DSAR_VERIFY_PH, phone);
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
      const needsGuardian = ctx.auth.isMinor || ctx.auth.guardianConsentStatus !== "NOT_REQUIRED";
      const hasActiveGuardian = needsGuardian
        ? (await ctx.db.familyLink.count({ where: { studentUserId: ctx.auth.userId, status: "ACTIVE" } })) > 0
        : false;
      try {
        const { request } = await createDeletionRequest(ctx.db, { userId: ctx.auth.userId, needsGuardian, hasActiveGuardian, reason: input.reason ?? null });
        return { request };
      } catch (e) {
        if (e instanceof NeedsGuardianError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未成年人注销需由已绑定的监护人在站内确认,请先绑定监护人或通过客服渠道办理", cause: { reason: "DSAR_GUARDIAN_REQUIRED" } });
        throw e;
      }
    }),

  approveChildDeletion: authedProcedure
    .input(z.object({ childUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // 须 ACTIVE FamilyLink(parent 侧)。无关系 → NOT_FOUND(不泄露存在性)。
      const link = await ctx.db.familyLink.findFirst({ where: { parentUserId: ctx.auth.userId, studentUserId: input.childUserId, status: "ACTIVE" } });
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "未找到可审批的注销申请", cause: { reason: "DSAR_NOT_FOUND" } });
      const approved = await approveChildDeletion(ctx.db, { childUserId: input.childUserId, guardianUserId: ctx.auth.userId });
      if (!approved) throw new TRPCError({ code: "NOT_FOUND", message: "未找到可审批的注销申请", cause: { reason: "DSAR_NOT_FOUND" } });
      return approved;
    }),

  cancelDeletion: authedProcedure.mutation(async ({ ctx }) => {
    const cancelled = await cancelDeletionRequest(ctx.db, { userId: ctx.auth.userId });
    if (!cancelled) throw new TRPCError({ code: "NOT_FOUND", message: "没有进行中的注销申请", cause: { reason: "DSAR_NOT_FOUND" } });
    return cancelled;
  }),

  myRequests: authedProcedure.query(async ({ ctx }) => ({ requests: await listOwnRequests(ctx.db, ctx.auth.userId) })),

  pendingChildApprovals: authedProcedure.query(async ({ ctx }) => ({ items: await listPendingChildApprovals(ctx.db, ctx.auth.userId) })),
});
```

> 注:`exportUserData` 现接 `DbClient`(含 `Prisma.TransactionClient`),故可在 `$transaction` 内调。确认 `@zhijiao/auth` 已导出全部所需符号(Explore 评审确认 index.ts `export *` 全覆盖,含新加的两条 rule)。`env` 从 `../env.js`(评审代码契合 Item 3)。删掉无用的 `ratelimitGuard`(占位,实现时不要留)。

- [ ] **Step 5: 注册 _root + 运行**

`_root.ts`:`import { dsarRouter } from "./dsar.js";` + `dsar: dsarRouter,`。
Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/dsar-router.test.ts` → PASS。

- [ ] **Step 6: 提交**
```bash
git add apps/web/server/routers/dsar.ts apps/web/server/routers/_root.ts apps/web/tests/integration/_helpers/error-book-fixtures.ts apps/web/tests/integration/dsar-router.test.ts
git commit -m "feat(web): dsar tRPC router + guardian approval + makeCtx consent override (Plan 14b)"
```

---

## Task 7: PII 治理扩展

**Files:** Modify `pii-governance.ts`、`tests/unit/pii-ops-action-log-payload.test.ts`、`tests/integration/pii-deactivate-user.test.ts`、`pii-export-user-data.test.ts`

- [ ] **Step 1: 守词测试加禁词(失败先行)**

`pii-ops-action-log-payload.test.ts` 的 `FORBIDDEN_TEXT` 正则追加 `|dsar_reason|resolution_note`。

- [ ] **Step 2: deactivate 测试加断言(失败先行)**

`pii-deactivate-user.test.ts`:fixture 加该用户一条 PENDING DELETION(`reason: "我的手机 13800138000 想删"`)。断言:
```ts
const dsarAfter = await prisma.dsarRequest.findFirstOrThrow({ where: { userId: user.id, type: "DELETION" } });
expect(dsarAfter.reason).toBeNull();          // scrub
expect(dsarAfter.status).toBe("COMPLETED");   // 悬挂工单收口
expect(result.payload.scrubbed.dsarRequests).toBe(1);
```

- [ ] **Step 3: export 测试加断言(失败先行)**

`pii-export-user-data.test.ts`:fixture 加一条 EXPORT + 一条带 reason 的 DELETION。断言:
```ts
expect(data.schemaVersion).toBe("2026-05-31");
expect(data.dsarRequests.length).toBe(2);
expect(JSON.stringify(data.dsarRequests)).not.toContain("我的手机");
```

- [ ] **Step 4: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/pii-ops-action-log-payload.test.ts tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts` → FAIL。

- [ ] **Step 5: 实现 —— payload 字段 + scrub + 悬挂收口**

`pii-governance.ts`:
- `DeactivatePayload.scrubbed` 加 `dsarRequests: number;`;`buildDeactivatePlan` 的 empty + 计数加 `prisma.dsarRequest.count({ where: { userId } })`(放 scrubbed)。
- `deactivateUser` 事务内加:
```ts
const dsarReasonScrub = await tx.dsarRequest.updateMany({ where: { userId: args.userId, reason: { not: null } }, data: { reason: null } });
// 悬挂工单收口:未结 DELETION → COMPLETED(避免 dsar:list 永久残留)
await tx.dsarRequest.updateMany({
  where: { userId: args.userId, type: "DELETION", status: { in: ["AWAITING_GUARDIAN", "PENDING"] } },
  data: { status: "COMPLETED", resolvedAt: now, resolvedByRef: args.initiatorRef },
});
```
把 `dsarRequests: dsarReasonScrub.count` 放进 payload `scrubbed`(注:计数口径=有 reason 被 scrub 的行数,与 plan empty 计数一致即可;若测试期望"全部 DSAR 行数"则改用 plan 的 count 值——以 Step 2 断言为准,这里用 scrub count=1)。

- [ ] **Step 6: 实现 —— export 加段 + schemaVersion**

`UserDataExport`:`schemaVersion` 两处 `"2026-05-26"`→`"2026-05-31"`;接口加 `dsarRequests: Array<{ type: string; status: string; requestedAt: Date; dueAt: Date; resolvedAt: Date | null }>`;`exportUserData` 的 `Promise.all` 数组**加一项** `prisma.dsarRequest.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { type: true, status: true, requestedAt: true, dueAt: true, resolvedAt: true } })`(**不** select reason/resolutionNote),解构绑定到 `dsarRequests`,返回对象加 `dsarRequests`。

- [ ] **Step 7: 运行确认通过**

Run 同 Step 4 → PASS。

- [ ] **Step 8: 提交**
```bash
git add apps/web/server/lib/pii-governance.ts apps/web/tests
git commit -m "feat(web): DSAR PII coverage — scrub reason, close dangling, export section, schema v2026-05-31 (Plan 14b)"
```

---

## Task 8: OPS CLI 脚本

**Files:** Create `scripts/dsar-{list,fulfill,reject}.ts`;Modify `package.json`;Test `tests/integration/dsar-cli.test.ts`

- [ ] **Step 1: 写 service 履行集成测试(失败先行)**
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { fulfillDeletion, rejectDeletion, listForOps } from "@/server/lib/dsar";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

async function seedPending(opts: { isMinor?: boolean; guardianApproved?: boolean; status?: "PENDING" | "AWAITING_GUARDIAN" } = {}) {
  const u = await prisma.user.create({ data: { persona: "STUDENT", isMinor: opts.isMinor ?? false, gradeLevel: "G7" } });
  const req = await prisma.dsarRequest.create({
    data: {
      userId: u.id, type: "DELETION", status: opts.status ?? "PENDING", isMinor: opts.isMinor ?? false,
      requestedAt: new Date(), dueAt: new Date(Date.now() - 86400000),
      guardianApprovedByUserId: opts.guardianApproved ? u.id : null,
    },
  });
  return { userId: u.id, requestId: req.id };
}

describe("dsar CLI service", () => {
  it("成年 fulfill → deactivate + COMPLETED + ref", async () => {
    const { userId, requestId } = await seedPending();
    const r = await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" });
    expect(r.dryRun).toBe(false);
    const req = await prisma.dsarRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(req.status).toBe("COMPLETED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).not.toBeNull();
  });
  it("AWAITING_GUARDIAN 不可 fulfill", async () => {
    const { requestId } = await seedPending({ isMinor: true, status: "AWAITING_GUARDIAN" });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" })).rejects.toThrow(/not PENDING/);
  });
  it("未成年 PENDING 无 guardianApprovedByUserId → 拒", async () => {
    const { requestId } = await seedPending({ isMinor: true, guardianApproved: false });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" })).rejects.toThrow(/guardian approval/);
  });
  it("未成年 PENDING 有 guardianApprovedByUserId → 放行", async () => {
    const { requestId } = await seedPending({ isMinor: true, guardianApproved: true });
    const r = await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" });
    expect(r.dryRun).toBe(false);
  });
  it("二次 fulfill 已 COMPLETED → 拒", async () => {
    const { requestId } = await seedPending();
    await fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" });
    await expect(fulfillDeletion(prisma, { requestId, operatorId: null, initiatorRef: "cli:test:op" })).rejects.toThrow(/not PENDING/);
  });
  it("reject 必填 note → REJECTED", async () => {
    const { requestId } = await seedPending();
    expect((await rejectDeletion(prisma, { requestId, note: "非本人核验失败", initiatorRef: "cli:test:op" })).status).toBe("REJECTED");
  });
  it("list --overdue 只列逾期未结", async () => {
    await seedPending();
    const rows = await listForOps(prisma, { status: "pending", overdueOnly: true });
    expect(rows.length).toBe(1);
    expect(rows[0]!.overdue).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认(service 已在 Task 5 实现 → 应 PASS)**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/dsar-cli.test.ts` → PASS(若 FAIL 修 Task 5 service)。

- [ ] **Step 3: 写三脚本**

`scripts/dsar-list.ts`:
```ts
#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { listForOps } from "../server/lib/dsar.js";
import { loadCliEnv } from "./load-cli-env.js";
loadCliEnv();
function parseArgs(argv: string[]) {
  let status: "pending" | "all" = "pending"; let type: "export" | "deletion" | undefined; let overdueOnly = false;
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
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

`scripts/dsar-fulfill.ts`:
```ts
#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { fulfillDeletion } from "../server/lib/dsar.js";
import { buildInitiatorRef, resolveOperatorUserId } from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";
loadCliEnv();
function parseArgs(argv: string[]) {
  let requestId: string | undefined; let dryRun = false;
  for (const a of argv) { if (a === "--dry-run") dryRun = true; else if (!a.startsWith("--")) requestId = a; }
  if (!requestId) throw new Error("Usage: dsar:fulfill <requestId> [--dry-run]");
  return { requestId, dryRun };
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const r = await fulfillDeletion(prisma, { requestId: args.requestId, operatorId, initiatorRef: buildInitiatorRef(), dryRun: args.dryRun });
    console.log(JSON.stringify(r, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

`scripts/dsar-reject.ts`:
```ts
#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { rejectDeletion } from "../server/lib/dsar.js";
import { buildInitiatorRef } from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";
loadCliEnv();
function parseArgs(argv: string[]) {
  let requestId: string | undefined; let note: string | undefined;
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === "--note") note = argv[++i]; else if (!a.startsWith("--")) requestId = a; }
  if (!requestId || !note) throw new Error('Usage: dsar:reject <requestId> --note "..."');
  return { requestId, note };
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const r = await rejectDeletion(prisma, { requestId: args.requestId, note: args.note, initiatorRef: buildInitiatorRef() });
    console.log(JSON.stringify(r, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: package.json 加 scripts**(`pii:gc-sweep` 行补逗号后)
```json
    "dsar:list": "tsx scripts/dsar-list.ts",
    "dsar:fulfill": "tsx scripts/dsar-fulfill.ts",
    "dsar:reject": "tsx scripts/dsar-reject.ts"
```

- [ ] **Step 5: CLI smoke**

Run: `pnpm.cmd --filter @zhijiao/web dsar:list --status all` → exit 0,打印 JSON。

- [ ] **Step 6: 提交**
```bash
git add apps/web/scripts/dsar-list.ts apps/web/scripts/dsar-fulfill.ts apps/web/scripts/dsar-reject.ts apps/web/package.json apps/web/tests/integration/dsar-cli.test.ts
git commit -m "feat(web): dsar OPS CLI (list/fulfill/reject) (Plan 14b)"
```

---

## Task 9: 用户侧 UI + 家长审批 + middleware

**Files:** Create `app/account/privacy/{page,privacy-view}.tsx`;Modify `middleware.ts`、家长子女页、`support/deactivate/page.tsx`

- [ ] **Step 1: middleware 两处都加 /account**

`middleware.ts`:`PROTECTED_PREFIXES` 加 `"/account"`;`config.matcher` 加 `"/account/:path*"`。

- [ ] **Step 2: page.tsx**
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

- [ ] **Step 3: privacy-view.tsx**(下载 Blob + 注销发码/填码/提交 + 处理中/撤销 + 请求记录含 REJECTED 理由)
```tsx
"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function PrivacyView() {
  const utils = trpc.useUtils();
  const my = trpc.dsar.myRequests.useQuery();
  const open = my.data?.requests.find((r) => r.type === "DELETION" && (r.status === "PENDING" || r.status === "AWAITING_GUARDIAN"));
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const exportMine = trpc.dsar.exportMine.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `zhijiao-data-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
      void utils.dsar.myRequests.invalidate();
    },
    onError: (e) => setErr(e.message),
  });
  const sendOtp = trpc.dsar.sendDeletionOtp.useMutation({
    onSuccess: () => { setOtpSent(true); setErr(null); },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setErr(reason === "DSAR_NO_PHONE" ? "未绑定手机号,请通过客服渠道办理注销。" : reason === "DSAR_GUARDIAN_REQUIRED" ? "未成年人注销需由监护人确认。" : e.message);
    },
  });
  const requestDeletion = trpc.dsar.requestDeletion.useMutation({
    onSuccess: () => { setOtpSent(false); setCode(""); setReason(""); void utils.dsar.myRequests.invalidate(); },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setErr(reason === "DSAR_GUARDIAN_REQUIRED" ? "未成年人注销需由已绑定的监护人在站内确认,请先绑定监护人。" : e.message);
    },
  });
  const cancel = trpc.dsar.cancelDeletion.useMutation({ onSuccess: () => void utils.dsar.myRequests.invalidate(), onError: (e) => setErr(e.message) });

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">下载我的数据副本</h2>
        <p className="text-sm text-slate-600">依据《个人信息保护法》第 45 条,您可获取个人信息副本(JSON)。</p>
        <button data-testid="dsar-export" disabled={exportMine.isPending} onClick={() => { setErr(null); exportMine.mutate(); }}
          className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50">{exportMine.isPending ? "生成中..." : "下载数据副本"}</button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">申请注销账号</h2>
        <p className="text-sm text-slate-600">依据《个人信息保护法》第 47 条。注销不可恢复,我们在 15 个工作日内处理,处理前可随时撤销。未成年人需由已绑定的监护人在站内确认。</p>
        {open ? (
          <div className="space-y-2" data-testid="dsar-pending">
            <p className="text-sm">{open.status === "AWAITING_GUARDIAN" ? "等待监护人确认" : "注销申请处理中"},预计完成:{new Date(open.dueAt).toLocaleDateString("zh-CN")}</p>
            <button data-testid="dsar-delete-cancel" disabled={cancel.isPending} onClick={() => { setErr(null); cancel.mutate(); }} className="rounded border px-4 py-2">撤销申请</button>
          </div>
        ) : !otpSent ? (
          <button data-testid="dsar-send-otp" disabled={sendOtp.isPending} onClick={() => { setErr(null); sendOtp.mutate(); }} className="rounded border px-4 py-2">发送验证码以申请注销</button>
        ) : (
          <div className="space-y-2">
            <input data-testid="dsar-otp-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="验证码" className="border rounded px-3 py-2 w-full" />
            <textarea data-testid="dsar-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="注销原因(可选)" className="border rounded px-3 py-2 w-full" />
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
            <li key={r.id}>
              {r.type === "EXPORT" ? "数据副本" : "注销"} · {r.status} · {new Date(r.requestedAt).toLocaleDateString("zh-CN")}
              {r.rejectionReason && <span className="text-red-600">（驳回理由：{r.rejectionReason}）</span>}
            </li>
          ))}
        </ul>
      </section>

      {err && <p className="text-red-600 text-sm" data-testid="dsar-error">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 4: 家长端审批块**

在既有家长子女页(Plan 11 `/parent/children/[childId]` 的 client view)加一块:`trpc.dsar.pendingChildApprovals.useQuery()` 过滤本 child 的 awaiting 项,有则渲染"子女注销申请 + 同意按钮 `data-testid="dsar-approve-child"`",`trpc.dsar.approveChildDeletion.useMutation({ childUserId })`,成功后 invalidate。若该页结构不便,退而在 `/parent`(家长首页)列全部 `pendingChildApprovals`。

- [ ] **Step 5: support 页加指引**

`support/deactivate/page.tsx` 加一句:`<p>{"已登录用户可在「数据与隐私」(/account/privacy)自助下载数据副本或发起注销申请。"}</p>`。

- [ ] **Step 6: next build 验证**

Run: `pnpm.cmd --filter @zhijiao/web exec next build` → 成功(无 Suspense/转义报错)。

- [ ] **Step 7: 提交**
```bash
git add apps/web/app/account apps/web/middleware.ts apps/web/app/support/deactivate/page.tsx apps/web/app/**/parent/**
git commit -m "feat(web): /account/privacy DSAR UI + parent approval + middleware /account (Plan 14b)"
```

---

## Task 10: E2E 闭环(成年)

**Files:** Create `apps/web/e2e/dsar.spec.ts`(+ seed 用户)

- [ ] **Step 1: 确认/新增独占成年 seed 用户**

在 `packages/db/prisma/seed/1_test_users.ts` 加 `dev-student-06`(persona STUDENT,**成年** birthYear、PHONE/GLOBAL `13800000012`、100 credits)。Run `pnpm.cmd --filter @zhijiao/db db:seed`。

- [ ] **Step 2: 写 E2E**
```ts
import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

const PHONE = "13800000012"; // dev-student-06,成年独占(注销会销号)

test("DSAR: 下载副本 + 发起注销 + 撤销", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/account/privacy");

  const [download] = await Promise.all([ page.waitForEvent("download"), page.getByTestId("dsar-export").click() ]);
  expect(download.suggestedFilename()).toContain("zhijiao-data");

  await page.getByTestId("dsar-send-otp").click();
  const res = await request.get(`/api/e2e-hooks/last-otp?phone=${PHONE}`);
  const { code } = await res.json();
  await page.getByTestId("dsar-otp-code").fill(code);
  await page.getByTestId("dsar-delete-submit").click();

  await expect(page.getByTestId("dsar-pending")).toBeVisible();
  await page.getByTestId("dsar-delete-cancel").click();
  await expect(page.getByTestId("dsar-send-otp")).toBeVisible();
});
```

- [ ] **Step 3: 跑 E2E(单独)**

Run: `pnpm.cmd --filter @zhijiao/web exec playwright test dsar.spec.ts` → 1 passed。

- [ ] **Step 4: 提交**
```bash
git add apps/web/e2e/dsar.spec.ts packages/db/prisma/seed
git commit -m "test(e2e): DSAR export + deletion request + cancel loop (Plan 14b)"
```

---

## Task 11: 全量验证 + CLAUDE.md

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: regenerate + 全量 typecheck/test**

Run:
```
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck test --force
```
Expected: 全 PASS。

- [ ] **Step 2: E2E 全量(单独跑)**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e` → 全绿(含 dsar.spec)。

- [ ] **Step 3: 更新 CLAUDE.md**

「已落地」加 Plan 14b;加「DSAR 现状(Plan 14b)」段(hybrid;`DsarRequest` + AWAITING_GUARDIAN + partial-unique one-open-deletion;SLA 15 工作日/30 自然日封顶;`dsar.*` 监护人门禁白名单;export fail-CLOSE cap 2;`<14` 注销经绑定监护人 `approveChildDeletion` 站内审批,CLI fulfill 凭 `guardianApprovedByUserId` 数据闸门 + live isMinor 复核 + predicate-on-update;REJECTED 回显 resolutionNote;verifyOtp purpose 隔离 + `RULE_DSAR_VERIFY_PH`;export schemaVersion 2026-05-31 + dsarRequests 段;注销 scrub reason 保留行 + 悬挂工单收口;无手机号走人工渠道);「Merge 后必跑」加红线:
- `dsar.*` 白名单:`Select-String -Path apps/web/server/routers/dsar.ts -Pattern "consentGatedProcedure"` 应 0 命中;`dsar-router.test` 全绿(含 `<14` 白名单 + AWAITING_GUARDIAN + guardian approval)。
- export fail-close + cap:`Select-String packages/auth/src/ratelimit/rules.ts -Pattern "RULE_DSAR_EXPORT.*failMode.*close"` 命中。
- 未成年注销数据闸门:`dsar-cli.test` 的"无 guardianApprovedByUserId → 拒"用例全绿。
- verifyOtp purpose 隔离:`pnpm.cmd --filter @zhijiao/auth test -- tests/otp-purpose.test.ts` 全绿。
- service 无 server-only:`Select-String apps/web/server/lib/dsar.ts -Pattern "server-only"` 应 0 命中。
从「下一步候选 Plan」移除 Plan 14b。

- [ ] **Step 4: 提交**
```bash
git add CLAUDE.md
git commit -m "docs(claude): Plan 14b DSAR data-subject requests landed"
```

---

## Self-Review 记录

- **Spec coverage**:§1 hybrid→T5/6;§2 模型+AWAITING_GUARDIAN+partial-unique+SLA 封顶→T1/2;§3 OTP purpose+RULE_DSAR_VERIFY→T3/4;§4 七 procedure(含 approveChildDeletion/pendingChildApprovals)→T6;§5 UI+家长审批+middleware→T9;§6 CLI 数据闸门→T8;§7 PII scrub+悬挂收口+export 段→T7;§8 测试→各 T;§10 punt 不建 task。无缺口。
- **评审修复对账**:代码契合 Item1(嵌套事务→T5 顺序调用)/Item3(env→`../env.js` T6)/Item4(server-only 移除 T2/5)；plan-quality B1(makeCtx 类型→T6 Step1)；安全 B1(export fail-close T4)/S2(RULE_DSAR_VERIFY_PH T4)/N5(predicate-on-update T5)；合规 B1(REJECTED 回显 T5 toView+T6 测试)/B2(监护人站内审批 T5/6/9)/S1(30 日封顶 T2);N1 悬挂收口 T7;并发幂等 partial-unique T1。
- **Type consistency**:`DsarRequestView`(含 `rejectionReason`)/`OpsDsarRow`(含 `guardianApproved`)跨 T5→6→8 一致;`recordExportRequest`/`createDeletionRequest`/`approveChildDeletion`/`cancelDeletionRequest`/`listOwnRequests`/`listPendingChildApprovals`/`listForOps`/`fulfillDeletion`/`rejectDeletion`/`NeedsGuardianError`/`DsarFulfillError` 命名跨 service/router/CLI 一致;`AWAITING_GUARDIAN` 状态、`schemaVersion "2026-05-31"`、testids、OtpPurpose union 跨任务一致。
- **Placeholder scan**:所有 code step 完整;`ratelimitGuard` 占位已在 T6 注明删除。无 TBD。
