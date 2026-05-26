# 智教 · Plan 6 PII 治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 2/3/4/8/9 累积的 PII（手机号 / openid / IP / UA / 用户产生内容 / 微信支付 rawBody）纳入生命周期管理，落 PIPL Art 45（数据可携权）+ Art 47（删除权），同时保留财务记录走税务永久 bucket。Plan 3 标的 prod ship prereq 由本 plan 收口。

**Architecture:** 1 新表 `OpsActionLog` + 3 个 service 函数（`deactivateUser` / `exportUserData` / `sweepPii`）+ 3 个 OPS CLI + 1 个静态页 + 5 个 GC sweepers + 1 处 onDelete 改动（VariantGroup.entry → Cascade）+ 1 处字段可空化（WechatPayEvent.rawBody）+ 2 处 AuthError union 加 USER_DEACTIVATED。所有 OPS 行为走 CLI（沿用 Plan 9 工艺 + [[zhijiao-single-dev-no-ops-ui]] memory）；外部 scheduler 配方文档化到 `docs/ops/pii-scheduling.md`，不引入 apps/web 内嵌 cron。

**Tech Stack:**（不变）pnpm 9 / Turborepo / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 / Redis 7 / @trpc/server@11 / superjson / Vitest 1 / Testcontainers 10 / pino 8

**Spec:** `docs/superpowers/specs/2026-05-26-pii-governance-design.md`（本 plan 的真理来源；遇到模糊回查 spec）

**Source Audit:** spec 自检 + 4 处 user review fixes（commit `9413b49`）已收口；测试反向断言用 regex 不用 includes；sweeper #5 用 `$queryRaw` + CTE + RETURNING；Session 拆 7.1/7.2 两步去标识化；`sweepOtpRequests` COALESCE 三层兜底；`EXPORT_USER_DATA` payload 不含 outPath。

---

## ⚠️ 关键实现红线

1. **OpsActionLog.payload 严格白名单 + 非 PII**（spec §2.4 / 红线 #1）：永远不写 phone / openid / unionId / rawBody / stemMd / requestJson / actualAnswerMd / outPath / 本地路径前缀；payload 字段按 OpsActionKind 严格枚举：
   - `DEACTIVATE_USER`：`{scrubbed: {...}, deleted: {...}, dryRun: boolean}`
   - `EXPORT_USER_DATA`：`{exportSizeBytes, recordCounts, outputWritten: true}`
   - `GC_SWEEP_*`：`{results: [...], bucket, nowAt}`
   `pii-ops-action-log-payload.test.ts` regex 守门。

2. **dryRun 走纯读路径**（spec §3.2 / 红线 #2）：`deactivateUser({ dryRun: true })` 调 `previewDeactivateUser`（只 count/select，0 写、0 OpsActionLog）；**不**用 tx 内 throw 回滚。两条路径分离实现，共享 `where` 条件。

3. **OtpRequest phone 提取窄化**（spec §3.3 step 2 / 红线 #3）：必须在 `tx.authIdentity.deleteMany` **前**先 `tx.authIdentity.findMany({ where: { userId, provider: "PHONE", providerScope: "GLOBAL" }, select: { providerUserId: true } })` 读出 phones；WECHAT openid/unionid 一律不碰 OtpRequest；不按 User 其他字段猜手机号。

4. **export JSON 不含禁列字段**（spec §4.2 / 红线 #4）：测试用 regex `not.toMatch(/rawBody|requestJson|responseJson|ipCreated|userAgent/)` 守门，**不用** `.includes`（漏判风险）；ModelCall 仅 5 字段摘要 `taskKind / status / tokensIn / tokensOut / createdAt`，**不含** `requestJson / responseJson / errorMessage / promptTemplateId / model`。

5. **GC sweeper COALESCE 三层兜底**（spec §5.2 / 红线 #5）：`sweepOtpRequests` 用 `COALESCE(consumedAt, expiredAt, expiresAt) < cutoff`——三层中任一非空且超期都扫；测试覆盖 4 形态（consumedAt-only / expiredAt-only / expiresAt-only / 全空活跃）。`sweepInactiveSessions` 用 `COALESCE(revokedAt, expiresAt)` 两层。

6. **sweeper #5 用 `$queryRaw` + CTE + RETURNING**（spec §5.2 / 红线 #6）：`$executeRaw` 只返 affected count 不返行集；DELETE 要拿 RETURNING 行集做 count 必须 `$queryRaw`；详见 spec §5.2 sweeper #5 代码块。

7. **Session 拆 7.1 + 7.2 两步**（spec §3.3 step 7）：7.1 仅对 `revokedAt: null` 推进状态字段；7.2 对该用户**所有** session（含历史已 revoked）清 deviceLabel/ipCreated/userAgent。单步 `where: { userId, revokedAt: null }` 会漏掉历史 revoked 行的 PII，与"注销 = 立即去标识化"不一致。

8. **`prisma.user.delete()` 不应再被业务代码调用**（spec §6.3）：注销走 `deactivateUser`，软删 User 行作 tombstone；ErrorBookEntry.user 保持 Restrict 作未来误删护栏。CLAUDE.md 加红线（探针 38）。

9. **`migrate dev --create-only` → 浏览 SQL → `migrate dev` 工艺**（spec §2.7 / 沿用 Plan 4/8/9）：本 plan 无 raw SQL append（`@@unique` / `@@index` 都是 Prisma 5 原生支持的），但仍按 `--create-only` 工艺走便于事后检查。

10. **Vitest `it.todo` / 空 body 测试是假绿防御**（沿用 Plan 9 红线 #13）：每 task commit 前必跑：
    ```powershell
    Select-String -Path apps/web/tests,packages/auth/tests -Pattern "it\.todo" -Recurse
    ```
    期望 0 命中。Vitest `Tests` 行也要确认是 `N passed (N)`、不含 `(M todo)` 计数。

11. **每个 task 一个 commit**，commit message 引用 task 编号。

12. **PowerShell 调 pnpm 必须用 `pnpm.cmd`**（execution policy 拦 `.ps1`）。

13. **静态页 placeholder 探针**（spec §6.1 / 红线 R4 / CLAUDE.md 探针 35）：grep `apps/web/app/(public)/support/deactivate/page.tsx` 找 `XXXXX|\.example|"运营主体：XXXXX"` 任一命中 → prod ship 阻断。

14. **OPS CLI `initiatorRef` 必填**（spec §2.4 / §3.6）：`resolveOperatorUserId()` 返回的 userId 可能 null（env 覆盖），但 `initiatorRef = "cli:" + os.hostname() + ":" + os.userInfo().username` 永远有值，保证审计行可追溯到具体机器与系统账户。

---

## 范围

**本 plan 做**（对应 spec §1 / §2-§7 全部）：

- `packages/db/prisma/schema.prisma`：1 新 model `OpsActionLog` + 1 enum `OpsActionKind` + `User` +2 字段 +1 索引 + `VariantGroup.entry` onDelete: Restrict → Cascade + `WechatPayEvent.rawBody` String → String? + 4 处反向 relation
- 1 个 migration（`migrate dev --create-only` → `migrate dev`；无 raw SQL）
- `packages/auth/src/errors.ts` `AUTH_ERROR_REASONS` + `USER_DEACTIVATED`
- `apps/web/server/context.ts` `AuthError` union + `USER_DEACTIVATED` + `createContext` 扩 `deletedAt` select + auth=null short circuit
- `apps/web/server/env.ts`：4 个新 env + zod refine + 默认值
- `apps/web/server/lib/operator.ts`：新建；从 Plan 9 `kp-reconcile.ts` 抽出 `resolveReviewerUserId` 改名 `resolveOperatorUserId`；Plan 9 callers 更新
- `apps/web/server/lib/pii-governance.ts`：新建；`deactivateUser` / `previewDeactivateUser` / `exportUserData` / `sweepPii`（含 5 个内部 sweeper）+ 类型
- `app/api/auth/refresh/route.ts`：`rotateSession` 后扩 select 加 `deletedAt`；非空 throw `AuthError("USER_DEACTIVATED")` + 清 cookies
- `apps/web/server/auth-service.ts` `issueSessionAndCookies`：入参增 userId deletedAt 校验
- `apps/web/scripts/user-deactivate.ts` / `user-export.ts` / `pii-gc-sweep.ts`：3 个 CLI
- `apps/web/package.json`：3 个新 script
- `apps/web/app/(public)/support/deactivate/page.tsx`：静态页 Server Component
- `docs/ops/pii-scheduling.md`：外部 scheduler 配方
- 14 个测试文件（13 integration/unit + 1 E2E）
- CLAUDE.md：Plan 6 状态条目 + "PII 治理现状" 段 + Merge 探针 35-41 + 候选 Plan 重排

**本 plan 不做**（spec §1 显式 punt）：

- 自助注销 mutation `auth.deactivate` + `/profile/deactivate` 表单 → 真用户上量后开新 plan
- 真用户身份核验自动化（短信 OTP 二次确认）→ 同上
- 未成年人 <14 vs 14-17 精准建模 + guardian linkage → Plan 14
- Web `/ops/pii-actions` 页面（查 OpsActionLog） → 等真有 OPS 角色再做
- cron 自动跑 GC sweep → 外部 scheduler 文档先行
- `FINANCIAL_RECORD_RETENTION_DAYS` 非 null 时的财务 sweeper → 后续真有合规意见再独立 plan

---

## 文件结构（新建 / 修改清单）

```
CLAUDE.md                                                            # 改：Task 11

# === packages/db ===
packages/db/
  prisma/schema.prisma                                               # 改：1 新 model + 1 enum + User +2 字段 +1 索引 + VariantGroup.entry Cascade + WechatPayEvent.rawBody nullable + 4 反向 relation
  prisma/migrations/<ts>_plan6_pii_governance/                       # 新（migrate dev --create-only 生成）
    migration.sql                                                    # 应是纯 ADD TABLE / ALTER COLUMN / DROP CONSTRAINT + ADD CONSTRAINT，无 raw SQL append

# === packages/auth ===
packages/auth/
  src/errors.ts                                                      # 改：AUTH_ERROR_REASONS 加 USER_DEACTIVATED

# === apps/web ===
apps/web/
  server/env.ts                                                      # 改：加 4 env + refine
  server/context.ts                                                  # 改：AuthError union + select deletedAt + auth=null short circuit
  server/auth-service.ts                                             # 改：issueSessionAndCookies 入参增 deletedAt 校验
  server/lib/operator.ts                                             # 新：resolveOperatorUserId（从 Plan 9 kp-reconcile.ts 抽出）
  server/lib/kp-reconcile.ts                                         # 改：删 resolveReviewerUserId（指向 operator.ts 重新 export 兼容；Plan 9 callers 改用 operator.ts）
  server/lib/pii-governance.ts                                       # 新：deactivateUser / previewDeactivateUser / exportUserData / sweepPii
  app/api/auth/refresh/route.ts                                      # 改：rotateSession 后 deletedAt 校验 + 清 cookies
  app/(public)/support/deactivate/page.tsx                           # 新：静态 Server Component
  scripts/user-deactivate.ts                                         # 新
  scripts/user-export.ts                                             # 新
  scripts/pii-gc-sweep.ts                                            # 新
  scripts/kp-review.ts                                               # 改：import 改 operator.ts
  package.json                                                       # 改：加 3 个 scripts
  tests/server/env.test.ts                                           # 改：加 4 env refine 测例
  tests/integration/pii-deactivate-user.test.ts                      # 新
  tests/integration/pii-deactivate-user-tx-atomicity.test.ts         # 新
  tests/integration/pii-deactivate-user-dryrun.test.ts               # 新
  tests/integration/pii-export-user-data.test.ts                     # 新
  tests/integration/pii-deleted-user-auth-guard.test.ts              # 新
  tests/integration/pii-deleted-user-relogin.test.ts                 # 新
  tests/integration/pii-gc-sweep-short.test.ts                       # 新
  tests/integration/pii-gc-sweep-medium.test.ts                      # 新
  tests/integration/pii-gc-sweep-orphan.test.ts                      # 新
  tests/integration/pii-gc-sweep-dryrun.test.ts                      # 新
  tests/integration/pii-gc-sweep-batching.test.ts                    # 新
  tests/unit/pii-ops-action-log-payload.test.ts                      # 新
  tests/integration/kp-reconcile-reviewer-resolution.test.ts         # 改：import 改 operator.ts
  e2e/support-deactivate-page.spec.ts                                # 新

# === docs ===
docs/ops/pii-scheduling.md                                           # 新
```

---

## 前置：环境检查 + 分支

> **Shell 约定**：本 plan 所有命令默认 **PowerShell**。`pnpm` 解析到 `pnpm.ps1` 被 execution policy 拦，**全文一律用 `pnpm.cmd`**。

```powershell
node --version       # >= 20
pnpm.cmd --version   # >= 9
docker --version     # Docker Desktop 在运行
```

- [ ] **步骤 P.1：从 master 起 worktree**

```powershell
git fetch origin                              # 本仓库无 remote，此步报错可跳过
git switch master
git pull --ff-only                            # 同上
git worktree add .claude/worktrees/plan-6-pii-governance -b plan-6-pii-governance master
```

新窗口 `Set-Location .claude/worktrees/plan-6-pii-governance`，后续命令都在 worktree 里跑。

- [ ] **步骤 P.2：起 docker、装依赖、迁主库**

```powershell
docker compose up -d
pnpm.cmd install
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd --filter @zhijiao/db db:migrate:deploy
pnpm.cmd db:seed
```

- [ ] **步骤 P.3：baseline 跑 1 次（确认 master 无 regression）**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望：4 项全绿。若有失败先停，回 master 修，本 plan 暂缓。

---

## Task 1：Prisma schema 1 新表 + User 改 + VariantGroup.entry Cascade + WechatPayEvent.rawBody nullable + migration

> **为什么先做：** 后续所有 task 都依赖新 schema。schema 一落地，env、service、CLI、tests 都能写。

**Files：**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_plan6_pii_governance/migration.sql`

- [ ] **步骤 1.1：改 `schema.prisma` 加新表 + 反向 relation + 字段 + onDelete + nullable**

在 `schema.prisma` 末尾（`@@map("kp_reconcile_matches")` 之后）追加：

```prisma
// === Plan 6: PII Governance ===

enum OpsActionKind {
  DEACTIVATE_USER
  EXPORT_USER_DATA
  GC_SWEEP_SHORT
  GC_SWEEP_MEDIUM
  GC_SWEEP_ORPHAN
}

model OpsActionLog {
  id            String         @id @default(cuid())
  kind          OpsActionKind
  initiatorId   String?        @map("initiator_id")
  initiatorRef  String         @map("initiator_ref")
  targetUserId  String?        @map("target_user_id")
  reason        String?
  payload       Json?
  createdAt     DateTime       @default(now()) @map("created_at")

  initiator     User?          @relation("OpsActionInitiator", fields: [initiatorId], references: [id], onDelete: SetNull)
  target        User?          @relation("OpsActionTarget",    fields: [targetUserId], references: [id], onDelete: SetNull)

  @@index([kind, createdAt])
  @@index([targetUserId])
  @@map("ops_action_logs")
}
```

修改现有 `model User { ... }`，加 2 字段 + 索引 + 2 反向 relation：

```prisma
model User {
  // ... 既有字段保持不变
  deletedAt           DateTime?      @map("deleted_at")             // Plan 6
  deactivationReason  String?        @map("deactivation_reason")    // Plan 6
  // ... 既有 relations 保持不变
  initiatedOpsActions OpsActionLog[] @relation("OpsActionInitiator")
  opsActionLogs       OpsActionLog[] @relation("OpsActionTarget")

  @@index([deletedAt])
  @@map("users")
}
```

修改 `model VariantGroup { ... }`，`entry` 关系 onDelete 改 Cascade：

```prisma
model VariantGroup {
  // ... 其它字段保持不变
  entry           ErrorBookEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)   // Plan 6 改：Restrict → Cascade
  // ... 其它关系保持不变
}
```

修改 `model WechatPayEvent { ... }`，`rawBody` 改可空：

```prisma
model WechatPayEvent {
  // ... 其它字段保持不变
  rawBody       String?               @db.Text @map("raw_body")  // Plan 6 改：原 String 非空
  // ... 其它字段保持不变
}
```

- [ ] **步骤 1.2：`prisma migrate dev --create-only` 生成迁移**

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --create-only --name plan6_pii_governance
```

期望：`packages/db/prisma/migrations/<ts>_plan6_pii_governance/migration.sql` 生成但**未** apply。验证：

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d ops_action_logs"
```

应**未命中**（表未建）。如已建 → 你跑成了 `migrate dev`（没 --create-only），回滚见 Plan 4 Task 1 步骤 1.10 末尾的恢复流程。

打开生成的 `migration.sql` 浏览，应见：
- `CREATE TYPE "OpsActionKind"`
- `CREATE TABLE "ops_action_logs"`
- `ALTER TABLE "users" ADD COLUMN "deleted_at" / "deactivation_reason"`
- `CREATE INDEX "users_deleted_at_idx"`
- `ALTER TABLE "variant_groups" DROP CONSTRAINT "variant_groups_entry_id_fkey"` + `ADD CONSTRAINT ... ON DELETE CASCADE`
- `ALTER TABLE "wechat_pay_events" ALTER COLUMN "raw_body" DROP NOT NULL`
- 各反向 relation 不产生 DDL（Prisma 概念非物理列）

**无**需要手动追加的 raw SQL。

- [ ] **步骤 1.3：apply migration**

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev
```

期望输出含 `Applying migration `<ts>_plan6_pii_governance``。

- [ ] **步骤 1.4：验主库 schema 落地**

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d ops_action_logs"
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d users" | findstr deleted_at
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d variant_groups" | findstr fkey
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d wechat_pay_events" | findstr raw_body
```

期望：
- `ops_action_logs` 表完整字段 + 2 索引
- `users` 表见 `deleted_at` / `deactivation_reason` + `users_deleted_at_idx` 索引
- `variant_groups_entry_id_fkey` 定义带 `ON DELETE CASCADE`
- `raw_body` 行不带 "not null"

并验 checksum：
```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate status
```

期望 `Database schema is up to date!`。

- [ ] **步骤 1.5：把新表复制到 per-pkg test DB**

```powershell
pnpm.cmd test:setup
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_db -c "\d ops_action_logs"
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_web -c "\d ops_action_logs"
```

每库都应见 `ops_action_logs` 表。如未命中 → 看 `packages/db/scripts/setup-test-dbs.ts` 是否走 `migrate deploy`。

- [ ] **步骤 1.6：generate client + typecheck**

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck --force
```

期望全绿。如有 `event.rawBody.length` 之类报 `string | null` 类型错 → 见 spec §6.3 风险表"WechatPayEvent.rawBody 改 nullable 后既有代码假定非空挂掉"——grep 实际位置：

```powershell
Select-String -Path packages/billing/src,apps/web/server -Pattern "rawBody\." -CaseSensitive
```

若命中读取路径，加 `?? ""` 或 `?.length ?? 0` 等防御。Plan 6 实施时预测 0-1 处。

- [ ] **步骤 1.7：commit**

```powershell
git add packages/db/
git commit -m "feat(db): Plan 6 Task 1 — OpsActionLog + User.deletedAt + VariantGroup.entry Cascade + WechatPayEvent.rawBody nullable + migration"
```

---

## Task 2：env 4 个新字段 + zod refine + 测试

> **为什么先做：** Task 4-9 多个 service / CLI 都读这 4 个 env，先落定值。

**Files：**
- Modify: `apps/web/server/env.ts`
- Modify: `apps/web/tests/server/env.test.ts`

- [ ] **步骤 2.1：`env.ts` 加 4 字段**

在 `EnvSchema = z.object({ ... })` 末尾（其它字段之后）加：

```ts
  // Plan 6 PII retention buckets
  PII_RETENTION_SHORT_DAYS:           z.coerce.number().int().min(1).default(30),
  PII_RETENTION_MEDIUM_DAYS:          z.coerce.number().int().min(1).default(90),
  PII_RETENTION_ORPHAN_TOPUP_DAYS:    z.coerce.number().int().min(1).default(180),
  FINANCIAL_RECORD_RETENTION_DAYS:    z.coerce.number().int().min(1).nullable().default(null),
```

在 `.superRefine((env, ctx) => { ... })` 末尾加：

```ts
  if (env.PII_RETENTION_MEDIUM_DAYS <= env.PII_RETENTION_SHORT_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PII_RETENTION_MEDIUM_DAYS"],
      message: "PII_RETENTION_MEDIUM_DAYS must be strictly greater than PII_RETENTION_SHORT_DAYS",
    });
  }
  if (env.PII_RETENTION_ORPHAN_TOPUP_DAYS <= env.PII_RETENTION_MEDIUM_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PII_RETENTION_ORPHAN_TOPUP_DAYS"],
      message: "PII_RETENTION_ORPHAN_TOPUP_DAYS must be strictly greater than PII_RETENTION_MEDIUM_DAYS",
    });
  }
```

注意：`FINANCIAL_RECORD_RETENTION_DAYS` 用 `.nullable().default(null)`——zod 接受 `""` / `"null"` / undefined → null；非空字符串需是 ≥1 整数。

- [ ] **步骤 2.2：`env.test.ts` 加 4 测例**

打开 `apps/web/tests/server/env.test.ts`，在末尾 `describe` 里加：

```ts
  it("PII_RETENTION_MEDIUM_DAYS <= SHORT throws", async () => {
    process.env.PII_RETENTION_SHORT_DAYS = "30";
    process.env.PII_RETENTION_MEDIUM_DAYS = "20";
    await expect(loadEnv()).rejects.toThrow(/MEDIUM_DAYS must be strictly greater/);
  });

  it("PII_RETENTION_ORPHAN_TOPUP_DAYS <= MEDIUM throws", async () => {
    process.env.PII_RETENTION_SHORT_DAYS = "30";
    process.env.PII_RETENTION_MEDIUM_DAYS = "90";
    process.env.PII_RETENTION_ORPHAN_TOPUP_DAYS = "60";
    await expect(loadEnv()).rejects.toThrow(/ORPHAN_TOPUP_DAYS must be strictly greater/);
  });

  it("PII retention defaults: 30 / 90 / 180 / null", async () => {
    delete process.env.PII_RETENTION_SHORT_DAYS;
    delete process.env.PII_RETENTION_MEDIUM_DAYS;
    delete process.env.PII_RETENTION_ORPHAN_TOPUP_DAYS;
    delete process.env.FINANCIAL_RECORD_RETENTION_DAYS;
    const env = await loadEnv();
    expect(env.PII_RETENTION_SHORT_DAYS).toBe(30);
    expect(env.PII_RETENTION_MEDIUM_DAYS).toBe(90);
    expect(env.PII_RETENTION_ORPHAN_TOPUP_DAYS).toBe(180);
    expect(env.FINANCIAL_RECORD_RETENTION_DAYS).toBeNull();
  });

  it("FINANCIAL_RECORD_RETENTION_DAYS accepts integer value", async () => {
    process.env.FINANCIAL_RECORD_RETENTION_DAYS = "3650";
    const env = await loadEnv();
    expect(env.FINANCIAL_RECORD_RETENTION_DAYS).toBe(3650);
  });
```

如 `loadEnv` 是同步函数，把 `await expect(...).rejects` 改成 `expect(() => loadEnv()).toThrow`。

- [ ] **步骤 2.3：跑 env test**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts
```

期望既有 + 新加 4 测例全过。

- [ ] **步骤 2.4：guardrail — 0 个 `it.todo`**

```powershell
Select-String -Path apps/web/tests/server/env.test.ts -Pattern "it\.todo"
```

期望 0 命中。

- [ ] **步骤 2.5：commit**

```powershell
git add apps/web/server/env.ts apps/web/tests/server/env.test.ts
git commit -m "feat(web): Plan 6 Task 2 — env PII_RETENTION_{SHORT,MEDIUM,ORPHAN_TOPUP}_DAYS + FINANCIAL_RECORD_RETENTION_DAYS + refine"
```

---

## Task 3：`resolveOperatorUserId` helper 从 Plan 9 抽出复用

> **为什么先做：** Task 6-9 的 CLI 都需要这个 helper；Plan 9 留下的 `resolveReviewerUserId` 函数恰好是同样的"OPS/ADMIN role 校验 + env override"逻辑，改名重用比写第二份强。

**Files：**
- Create: `apps/web/server/lib/operator.ts`
- Modify: `apps/web/server/lib/kp-reconcile.ts`（删 `resolveReviewerUserId`，从 operator.ts re-export 兼容）
- Modify: `apps/web/scripts/kp-review.ts`（import 改 operator.ts）
- Modify: `apps/web/tests/integration/kp-reconcile-reviewer-resolution.test.ts`（import 改 operator.ts）

- [ ] **步骤 3.1：grep 既有 `resolveReviewerUserId` 调用点 + 实现**

```powershell
Select-String -Path apps/web -Pattern "resolveReviewerUserId" -Recurse
```

预期命中：
- `apps/web/server/lib/kp-reconcile.ts:490` 定义
- `apps/web/scripts/kp-review.ts` import
- `apps/web/tests/integration/kp-reconcile-reviewer-resolution.test.ts` import

读取 `apps/web/server/lib/kp-reconcile.ts:490` 起的实现，整段（含相关 helper / KpReviewerResolutionError 等）需要搬运。

- [ ] **步骤 3.2：新建 `apps/web/server/lib/operator.ts`**

> **设计选择：** 抽 Plan 9 `resolveReviewerUserId` 重命名为 `resolveOperatorUserId`，env 从 `KP_REVIEW_USER_ID` 改名为 `OPERATOR_USER_ID`（更通用）。**保持 plain `throw new Error(...)` 行为**，**不**引入新的 typed error class，以最小化既有 Plan 9 测试改动（test 匹配 regex 在 message string 上）。新加 `buildInitiatorRef()` Plan 6 专属辅助。

```ts
import os from "node:os";
import type { PrismaClient } from "@prisma/client";

// Plan 6 抽出 Plan 9 `resolveReviewerUserId` 重命名为通用 helper。
// 用于 user:deactivate / user:export / pii:gc-sweep / kp:review 等 OPS CLI。
//
// 优先级（spec §2.4 / Plan 9 hotfix 2f094a6）：
//   1. process.env.OPERATOR_USER_ID 显式覆盖（必须仍是 DB 内 OPS/ADMIN）
//   2. 否则 → 首个 OPS role user（deterministic by createdAt asc）
//   3. 都没有 → fail-close with actionable message
//
// 注：env 覆盖也必须是 OPS/ADMIN role —— 防 env 暴露过广导致非 OPS 用户跑写操作。

export async function resolveOperatorUserId(prisma: PrismaClient): Promise<string> {
  const fromEnv = process.env.OPERATOR_USER_ID;
  if (fromEnv) {
    const user = await prisma.user.findUnique({
      where: { id: fromEnv },
      select: { id: true, roles: { select: { role: true } } },
    });
    if (!user) {
      throw new Error(`OPERATOR_USER_ID=${fromEnv} not found in users table`);
    }
    const hasPrivileged = user.roles.some(
      (r) => r.role === "OPS" || r.role === "ADMIN",
    );
    if (!hasPrivileged) {
      throw new Error(
        `OPERATOR_USER_ID=${fromEnv} is not authorized: requires OPS or ADMIN role`,
      );
    }
    return user.id;
  }
  const opsRole = await prisma.userRole.findFirst({
    where: { role: "OPS" },
    orderBy: { createdAt: "asc" },
  });
  if (!opsRole) {
    throw new Error(
      "No OPS-role user found. Set OPERATOR_USER_ID env (must be OPS/ADMIN) or seed an OPS user (pnpm db:seed).",
    );
  }
  return opsRole.userId;
}

// Plan 6 专属：CLI 主机名 + OS 用户名兜底身份串；用于 OpsActionLog.initiatorRef
// resolveOperatorUserId fail-close: CLI must not catch and downgrade to null.
// initiatorRef 仍能给审计追溯到具体机器与系统账户。
export function buildInitiatorRef(): string {
  const hostname = os.hostname() || "unknown-host";
  const username = os.userInfo().username || "unknown-user";
  return `cli:${hostname}:${username}`;
}
```

- [ ] **步骤 3.3：改 `kp-reconcile.ts` 删旧实现**

打开 `apps/web/server/lib/kp-reconcile.ts`，找到 `resolveReviewerUserId` 函数定义（line 490 起到 line 520 结束），整段删除（连同注释段）。文件顶部 import 段加：

```ts
import { resolveOperatorUserId } from "./operator.js";
```

> 注：Plan 9 的 `resolveReviewerUserId` 是 plain `throw new Error(...)` 风格，无 typed error class（已 grep 验证 `apps/web/server/lib/kp-reconcile.ts:490-520`）。删除即可，无 backwards-compat alias 需求；所有 caller（kp-review.ts + 1 个 integration test）在步骤 3.4 / 3.5 同步更新。

- [ ] **步骤 3.4：改 `kp-review.ts` 改用新 import + env 名**

```powershell
Select-String -Path apps/web/scripts/kp-review.ts -Pattern "resolveReviewer|KP_REVIEW_USER_ID"
```

把 `import { resolveReviewerUserId } from "../server/lib/kp-reconcile.js"` 改成：

```ts
import { resolveOperatorUserId } from "../server/lib/operator.js";
```

调用点 `resolveReviewerUserId(...)` 改 `resolveOperatorUserId(...)`。
注释 / 文档字符串里提到 `KP_REVIEW_USER_ID` 的，改 `OPERATOR_USER_ID`。

- [ ] **步骤 3.5：改测试 import + env 名 + 测试名**

`apps/web/tests/integration/kp-reconcile-reviewer-resolution.test.ts` 全文替换：
- `resolveReviewerUserId` → `resolveOperatorUserId`
- `KP_REVIEW_USER_ID` → `OPERATOR_USER_ID`
- import path `"@/server/lib/kp-reconcile"` → `"@/server/lib/operator"`
- 错误消息 regex `/KP_REVIEW_USER_ID=/` → `/OPERATOR_USER_ID=/`（如有）
- describe label `resolveReviewerUserId` → `resolveOperatorUserId`

文件名也可以改名（`kp-reconcile-reviewer-resolution.test.ts` → `operator-resolution.test.ts`）以反映通用性；如不改名亦可（测试覆盖关系不变）。

> 注：env rename 是 breaking change for any local `.env` file 设过 `KP_REVIEW_USER_ID` 的开发者；CLAUDE.md 探针 39 段会加一句"env 改名提示"。

- [ ] **步骤 3.6：跑测试 + 守门 0 残留**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-reviewer-resolution.test.ts
pnpm.cmd exec turbo typecheck --force
Select-String -Path apps/web -Pattern "resolveReviewerUserId|KP_REVIEW_USER_ID" -Recurse
```

期望：测试 + typecheck 全绿；rename 守门 grep **0 命中**（证明 Plan 9 callers 完整迁到新名）—— 证明 Plan 9 行为零回归且无字面值残留。

- [ ] **步骤 3.7：commit**

```powershell
git add apps/web/server/lib/operator.ts apps/web/server/lib/kp-reconcile.ts apps/web/scripts/kp-review.ts apps/web/tests/integration/kp-reconcile-reviewer-resolution.test.ts
git commit -m "refactor(web): Plan 6 Task 3 — extract resolveOperatorUserId to operator.ts + rename env KP_REVIEW_USER_ID → OPERATOR_USER_ID + buildInitiatorRef helper (Plan 9 callers updated)"
```

---

## Task 4：`AuthError` union 加 `USER_DEACTIVATED` + `createContext` 扩 select + refresh route guard + 测试

> **为什么先做：** Task 6 deactivateUser 写完后这些 guard 必须立刻生效，否则注销了 access token 还能用；先把 guard 落定。

**Files：**
- Modify: `packages/auth/src/errors.ts`
- Modify: `apps/web/server/context.ts`
- Modify: `apps/web/app/api/auth/refresh/route.ts`
- Modify: `apps/web/server/auth-service.ts`
- Create: `apps/web/tests/integration/pii-deleted-user-auth-guard.test.ts`

- [ ] **步骤 4.1：`packages/auth/src/errors.ts` 加 `USER_DEACTIVATED`**

```ts
export const AUTH_ERROR_REASONS = [
  // ... 既有
  "REGISTER_TOKEN_MISSING", "REGISTER_GRADE_REQUIRED", "REGISTER_TOO_FREQUENT", "REGISTER_CONFLICT",
  "USER_DEACTIVATED",       // Plan 6
] as const;
```

- [ ] **步骤 4.2：`apps/web/server/context.ts` AuthError union 加 + select 扩 + auth=null short circuit**

文件 line 13 改：

```ts
export type AuthError = "ACCESS_EXPIRED" | "ACCESS_INVALID" | "NO_SESSION" | "SESSION_REVOKED" | "USER_DEACTIVATED";
```

line 88-92 改 `findUnique` select + 添加 deletedAt 短路：

```ts
const user = await prisma.user.findUnique({
  where: { id: v.claims.userId },
  select: { isMinor: true, deletedAt: true },  // Plan 6: deletedAt 加入
});
if (user?.deletedAt != null) {
  authError = "USER_DEACTIVATED";
  // 显式 auth=null —— authedProcedure 自动 throw UNAUTHORIZED
} else {
  auth = { ...v.claims, isMinor: user?.isMinor ?? true };
}
```

- [ ] **步骤 4.3：`refresh/route.ts` rotateSession 后扩 select + deletedAt 校验**

文件 line 55 改：

```ts
const user = await prisma.user.findUniqueOrThrow({
  where: { id: userId },
  include: { roles: true },
  // 注：findUniqueOrThrow 不支持同时 include + select；保留 include roles，
  //     加额外查 deletedAt：
});
if (user.deletedAt != null) {
  // 清 cookies + 抛 USER_DEACTIVATED（沿用既有 AuthError 分支处理）
  const res = json401("USER_DEACTIVATED");
  res.headers.append("Set-Cookie", clearCookie(COOKIE_AT, "/"));
  res.headers.append("Set-Cookie", clearCookie(COOKIE_RT, "/api/auth"));
  return res;
}
```

> 注：`findUniqueOrThrow include` 默认返全字段，user.deletedAt 已可用，不需要额外 select。

- [ ] **步骤 4.4：`auth-service.ts` `issueSessionAndCookies` 入参增 deletedAt 校验（防御性）**

打开 line 13 起函数体，在开头加：

```ts
const user = await opts.prisma.user.findUnique({
  where: { id: opts.userId },
  select: { deletedAt: true },
});
if (user?.deletedAt != null) {
  throw new AuthError("USER_DEACTIVATED");
}
```

注意：`issueSessionAndCookies` 是 register / login 的最后一步。正常流不会到这（AuthIdentity 已删，login 路径找不到该用户）。此校验是 defense-in-depth。

- [ ] **步骤 4.5：写 `pii-deleted-user-auth-guard.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { signAccess } from "@zhijiao/auth";
import { createContext } from "@/server/context";
import { env } from "@/server/env";

async function seedActiveUser() {
  return prisma.user.create({
    data: {
      persona: "STUDENT",
      isMinor: false,
      sessions: { create: { expiresAt: new Date(Date.now() + 3600_000), refreshTokenHash: "rt-hash-" + Math.random() } },
    },
    include: { sessions: true },
  });
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("createContext deletedAt guard", () => {
  it("active user: auth populated, authError null", async () => {
    const user = await seedActiveUser();
    const access = await signAccess({ userId: user.id, sessionId: user.sessions[0]!.id, persona: "STUDENT", roles: [] }, env.ACCESS_JWT_SECRET);
    const req = new Request("http://localhost/api/trpc/auth.me", {
      headers: { cookie: `__Host-zj_at=${access}` },
    });
    const ctx = await createContext({ req, resHeaders: new Headers() });
    expect(ctx.auth).not.toBeNull();
    expect(ctx.authError).toBeNull();
  });

  it("deactivated user: auth=null, authError='USER_DEACTIVATED'", async () => {
    const user = await seedActiveUser();
    const access = await signAccess({ userId: user.id, sessionId: user.sessions[0]!.id, persona: "STUDENT", roles: [] }, env.ACCESS_JWT_SECRET);
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), name: null } });
    const req = new Request("http://localhost/api/trpc/auth.me", {
      headers: { cookie: `__Host-zj_at=${access}` },
    });
    const ctx = await createContext({ req, resHeaders: new Headers() });
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("USER_DEACTIVATED");
  });

  it("deactivated user: still passes through SESSION_REVOKED first (defense in depth)", async () => {
    // Session also revoked → authError 应该是 SESSION_REVOKED（先于 USER_DEACTIVATED 检测）
    const user = await seedActiveUser();
    const sessionId = user.sessions[0]!.id;
    await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" } });
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    const access = await signAccess({ userId: user.id, sessionId, persona: "STUDENT", roles: [] }, env.ACCESS_JWT_SECRET);
    const req = new Request("http://localhost/api/trpc/auth.me", {
      headers: { cookie: `__Host-zj_at=${access}` },
    });
    const ctx = await createContext({ req, resHeaders: new Headers() });
    expect(ctx.auth).toBeNull();
    expect(ctx.authError).toBe("SESSION_REVOKED");  // 先于 USER_DEACTIVATED；createContext 顺序保证
  });
});
```

- [ ] **步骤 4.6：跑测试 + typecheck**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deleted-user-auth-guard.test.ts
pnpm.cmd exec turbo typecheck --force
```

期望 3 测例全过。

- [ ] **步骤 4.7：commit**

```powershell
git add packages/auth/src/errors.ts apps/web/server/context.ts apps/web/app/api/auth/refresh/route.ts apps/web/server/auth-service.ts apps/web/tests/integration/pii-deleted-user-auth-guard.test.ts
git commit -m "feat(auth,web): Plan 6 Task 4 — USER_DEACTIVATED in AuthError union + createContext/refresh/issueSession guards + 3 integration tests"
```

---

## Task 5：`deactivateUser` + `previewDeactivateUser` service core + 3 测试

> **为什么先做：** 注销是 Plan 6 核心；service 一落，CLI（Task 8）只是 thin wrapper。Export / GC 都依赖同一 `OpsActionLog` 模式，先把模式定准。

**Files：**
- Create: `apps/web/server/lib/pii-governance.ts`
- Create: `apps/web/tests/integration/pii-deactivate-user.test.ts`
- Create: `apps/web/tests/integration/pii-deactivate-user-tx-atomicity.test.ts`
- Create: `apps/web/tests/integration/pii-deactivate-user-dryrun.test.ts`

- [ ] **步骤 5.1：新建 `pii-governance.ts` 类型 + `previewDeactivateUser`**

```ts
import { Prisma, type PrismaClient } from "@prisma/client";

// CLI-safe service: avoid Next-only guards and app-level logging imports here.

// ============ Types ============

export interface DeactivatePayload {
  scrubbed: {
    sessions: number;
    topupOrders: number;
    modelCalls: number;
    kpAliases: number;
    kpReconcileMatches: number;
    authIdentities: number;
    otpRequests: number;
  };
  deleted: {
    errorBookEntries: number;
    variantGroups: number;
    variantItems: number;
    userAdhocQuestions: number;
  };
  dryRun: boolean;
}

export interface DeactivateArgs {
  userId: string;
  operatorId: string | null;
  initiatorRef: string;
  reason?: string;
  dryRun?: boolean;
}

export interface DeactivateResult {
  alreadyDeactivated: boolean;
  payload: DeactivatePayload;
}

export class UserNotFoundError extends Error {
  constructor(public userId: string) {
    super(`User not found: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

// ============ previewDeactivateUser（spec §3.2 / 红线 #2）============

// 纯读路径：count() / findMany.select；0 写 / 0 OpsActionLog。
// 共享 where 条件构造，避免预览与执行 predicate 漂移（spec §3.2）。
export async function previewDeactivateUser(
  prisma: PrismaClient,
  userId: string,
): Promise<DeactivatePayload> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new UserNotFoundError(userId);

  const [
    errorBookEntries,
    variantGroups,
    variantItems,
    userAdhocQuestions,
    sessionsTotal,
    topupOrdersWithPii,
    modelCallsWithUserId,
    kpAliasesByUser,
    kpMatchesByUser,
    authIdentities,
    phoneIdentities,
  ] = await prisma.$transaction([
    prisma.errorBookEntry.count({ where: { userId } }),
    prisma.variantGroup.count({ where: { entry: { userId } } }),
    prisma.variantItem.count({ where: { group: { entry: { userId } } } }),
    prisma.question.count({ where: { source: "USER_ADHOC" as never, createdByUserId: userId } }),
    prisma.session.count({ where: { userId } }),
    prisma.topupOrder.count({ where: { userId, OR: [{ ipCreated: { not: null } }, { userAgent: { not: null } }] } }),
    prisma.modelCall.count({ where: { userId } }),
    prisma.kpAlias.count({ where: { createdByUserId: userId } }),
    prisma.kpReconcileMatch.count({ where: { reviewedByUserId: userId } }),
    prisma.authIdentity.count({ where: { userId } }),
    prisma.authIdentity.findMany({ where: { userId, provider: "PHONE", providerScope: "GLOBAL" }, select: { providerUserId: true } }),
  ]);
  const phones = phoneIdentities.map(i => i.providerUserId);
  const otpRequests = phones.length === 0 ? 0 : await prisma.otpRequest.count({ where: { phone: { in: phones } } });

  return {
    scrubbed: { sessions: sessionsTotal, topupOrders: topupOrdersWithPii, modelCalls: modelCallsWithUserId, kpAliases: kpAliasesByUser, kpReconcileMatches: kpMatchesByUser, authIdentities, otpRequests },
    deleted: { errorBookEntries, variantGroups, variantItems, userAdhocQuestions },
    dryRun: true,
  };
}
```

> 注：`source: "USER_ADHOC" as never` 是因为 Plan 8 引入了 `source` 字段但当前可能没建枚举。grep `source.*"USER_ADHOC"` 看现状；如已是 enum 直接用枚举值。

- [ ] **步骤 5.2：在同文件追加 `deactivateUser` 主流程**

```ts
// ============ deactivateUser（spec §3.3）============

export async function deactivateUser(
  prisma: PrismaClient,
  args: DeactivateArgs,
): Promise<DeactivateResult> {
  // dryRun：纯读 + 早返（红线 #2）
  if (args.dryRun) {
    return { alreadyDeactivated: false, payload: await previewDeactivateUser(prisma, args.userId) };
  }

  return prisma.$transaction(async (tx) => {
    // A.1 preconditions
    const user = await tx.user.findUnique({ where: { id: args.userId }, select: { id: true, deletedAt: true } });
    if (!user) throw new UserNotFoundError(args.userId);
    if (user.deletedAt != null) {
      return {
        alreadyDeactivated: true,
        payload: {
          scrubbed: { sessions: 0, topupOrders: 0, modelCalls: 0, kpAliases: 0, kpReconcileMatches: 0, authIdentities: 0, otpRequests: 0 },
          deleted:  { errorBookEntries: 0, variantGroups: 0, variantItems: 0, userAdhocQuestions: 0 },
          dryRun: false,
        },
      };
    }

    // A.2 phone 提取（红线 #3）—— 必须在 step 5 删 AuthIdentity 之前
    const phoneIdentities = await tx.authIdentity.findMany({
      where: { userId: args.userId, provider: "PHONE", providerScope: "GLOBAL" },
      select: { providerUserId: true },
    });
    const phones = phoneIdentities.map(i => i.providerUserId);

    // B. 硬删学习内容
    // 注：deleteMany 不返级联 count；先 count 再 delete 取得准确数字
    const variantItemCount = await tx.variantItem.count({ where: { group: { entry: { userId: args.userId } } } });
    const variantGroupCount = await tx.variantGroup.count({ where: { entry: { userId: args.userId } } });
    const entryDel = await tx.errorBookEntry.deleteMany({ where: { userId: args.userId } });
    const questionDel = await tx.question.deleteMany({ where: { source: "USER_ADHOC" as never, createdByUserId: args.userId } });

    // C. Scrub PII
    const identityDel = await tx.authIdentity.deleteMany({ where: { userId: args.userId } });
    const otpDel = phones.length === 0
      ? { count: 0 }
      : await tx.otpRequest.deleteMany({ where: { phone: { in: phones } } });

    // 7.1 收尾活跃 session（仅 revokedAt=null 推进状态）
    await tx.session.updateMany({
      where: { userId: args.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "ADMIN_REVOKED" },
    });
    // 7.2 该用户所有 session 擦 PII（红线 #7）
    const sessionScrub = await tx.session.updateMany({
      where: { userId: args.userId },
      data: { deviceLabel: null, ipCreated: null, userAgent: null },
    });

    // 8. TopupOrder ip/ua 擦
    const topupScrub = await tx.topupOrder.updateMany({
      where: { userId: args.userId, OR: [{ ipCreated: { not: null } }, { userAgent: { not: null } }] },
      data: { ipCreated: null, userAgent: null },
    });

    // 9. ModelCall userId set null
    const mcScrub = await tx.modelCall.updateMany({
      where: { userId: args.userId },
      data: { userId: null },
    });

    // 10. KpAlias / KpReconcileMatch 显式 SetNull（user.delete 自动 SetNull 但我们不 delete user）
    const aliasScrub = await tx.kpAlias.updateMany({ where: { createdByUserId: args.userId }, data: { createdByUserId: null } });
    const matchScrub = await tx.kpReconcileMatch.updateMany({ where: { reviewedByUserId: args.userId }, data: { reviewedByUserId: null } });

    // 11. User row scrub + tombstone
    await tx.user.update({
      where: { id: args.userId },
      data: { name: null, avatarUrl: null, deletedAt: new Date(), deactivationReason: args.reason ?? null },
    });

    const payload: DeactivatePayload = {
      scrubbed: {
        sessions: sessionScrub.count,
        topupOrders: topupScrub.count,
        modelCalls: mcScrub.count,
        kpAliases: aliasScrub.count,
        kpReconcileMatches: matchScrub.count,
        authIdentities: identityDel.count,
        otpRequests: otpDel.count,
      },
      deleted: {
        errorBookEntries: entryDel.count,
        variantGroups: variantGroupCount,
        variantItems: variantItemCount,
        userAdhocQuestions: questionDel.count,
      },
      dryRun: false,
    };

    // D. 写审计
    await tx.opsActionLog.create({
      data: {
        kind: "DEACTIVATE_USER",
        initiatorId: args.operatorId,
        initiatorRef: args.initiatorRef,
        targetUserId: args.userId,
        reason: args.reason ?? null,
        payload,
      },
    });

    return { alreadyDeactivated: false, payload };
  });
}
```

- [ ] **步骤 5.3：写 happy path test `pii-deactivate-user.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { deactivateUser } from "@/server/lib/pii-governance";

async function seedUserWithFullProfile() {
  const user = await prisma.user.create({
    data: { name: "Alice", avatarUrl: "https://avatar.example/a.png", persona: "STUDENT", isMinor: false },
  });
  // AuthIdentity: 1 PHONE GLOBAL + 1 WECHAT_H5
  await prisma.authIdentity.create({
    data: { userId: user.id, provider: "PHONE", providerScope: "GLOBAL", providerUserId: "13800000001" },
  });
  await prisma.authIdentity.create({
    data: { userId: user.id, provider: "WECHAT_H5", providerScope: "wxAPPID01", providerUserId: "openid_xyz_001", unionId: "union_001" },
  });
  // OtpRequest by phone (must be cleaned via §3.3 step 6)
  await prisma.otpRequest.create({ data: { phone: "13800000001", purpose: "LOGIN", codeHash: "h1", expiresAt: new Date(Date.now() + 600_000) } });
  // OtpRequest by other phone (must NOT be touched)
  await prisma.otpRequest.create({ data: { phone: "13900000002", purpose: "LOGIN", codeHash: "h2", expiresAt: new Date(Date.now() + 600_000) } });
  // Active session
  const activeSession = await prisma.session.create({ data: { userId: user.id, refreshTokenHash: "rt-active", deviceLabel: "iPhone", ipCreated: "1.1.1.1", userAgent: "ios", expiresAt: new Date(Date.now() + 3600_000) } });
  // Historical revoked session (must also be scrubbed - 红线 #7)
  await prisma.session.create({ data: { userId: user.id, refreshTokenHash: "rt-old", deviceLabel: "Android-old", ipCreated: "2.2.2.2", userAgent: "android", expiresAt: new Date(Date.now() - 1000), revokedAt: new Date(Date.now() - 86400_000), revokedReason: "USER_LOGOUT" } });
  // Wallet + Ledger
  const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 50 } });
  await prisma.creditLedger.create({ data: { walletId: wallet.id, kind: "TOPUP", delta: 50, balanceAfter: 50, idemKey: "topup:t1", actionKind: null } });
  // TopupOrder PAID
  await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 500, credits: 50, status: "PAID", outTradeNo: "zj_aaaaa_pii001", transactionId: "wx_tx_001", paidAt: new Date(), expiredAt: new Date(Date.now() + 3600_000), ipCreated: "1.1.1.1", userAgent: "ios" } });
  // ErrorBookEntry + Question + VariantGroup chain
  const subj = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const q = await prisma.question.create({ data: { subjectId: subj.id, stemMd: "Solve x+1=2", type: "ESSAY", status: "PUBLISHED" } });
  const adhoc = await prisma.question.create({ data: { subjectId: subj.id, stemMd: "user typed stem", type: "ESSAY", status: "DRAFT", source: "USER_ADHOC" as never, createdByUserId: user.id, normalizedStemHash: "h_user_001" } });
  const entry = await prisma.errorBookEntry.create({ data: { userId: user.id, questionId: q.id, status: "ACTIVE", rootCause: "OTHER", rootCauseReasoning: "x", actualAnswerMd: "用户作答 PII" } });
  const ledger = await prisma.creditLedger.create({ data: { walletId: wallet.id, kind: "DEBIT", delta: -3, balanceAfter: 47, actionKind: "VARIANT_GROUP_GEN", idemKey: "debit:vg:plan6:t1" } });
  const vg = await prisma.variantGroup.create({ data: { entryId: entry.id, userId: user.id, creditsCost: 3, debitLedgerId: ledger.id } });
  await prisma.variantItem.create({ data: { groupId: vg.id, level: "L1", position: 0, stemMd: "vi", solutionMd: "vs", knowledgePointHints: [] } });
  // ModelCall by user
  await prisma.modelCall.create({ data: { taskKind: "TUTOR_ASK", model: "mock", requestJson: { dummy: 1 }, status: "SUCCESS", userId: user.id } });

  return { userId: user.id, walletId: wallet.id, adhocQuestionId: adhoc.id, publishedQuestionId: q.id, activeSessionId: activeSession.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("deactivateUser happy path", () => {
  it("scrubs PII / hard-deletes user content / writes OpsActionLog / keeps financial rows", async () => {
    const { userId, walletId, adhocQuestionId, publishedQuestionId, activeSessionId } = await seedUserWithFullProfile();

    const r = await deactivateUser(prisma, { userId, operatorId: null, initiatorRef: "cli:test:tester", reason: "test" });

    expect(r.alreadyDeactivated).toBe(false);
    expect(r.payload.deleted.errorBookEntries).toBe(1);
    expect(r.payload.deleted.variantGroups).toBe(1);
    expect(r.payload.deleted.variantItems).toBe(1);
    expect(r.payload.deleted.userAdhocQuestions).toBe(1);
    expect(r.payload.scrubbed.authIdentities).toBe(2);
    expect(r.payload.scrubbed.otpRequests).toBe(1);  // 仅 phone=13800000001 那条；139xxx 不动
    expect(r.payload.scrubbed.sessions).toBe(2);     // active + 历史 revoked 都擦
    expect(r.payload.scrubbed.topupOrders).toBe(1);
    expect(r.payload.scrubbed.modelCalls).toBe(1);

    // User 软删
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.deletedAt).not.toBeNull();
    expect(user.name).toBeNull();
    expect(user.avatarUrl).toBeNull();

    // AuthIdentity 全删
    expect(await prisma.authIdentity.count({ where: { userId } })).toBe(0);

    // 红线 #3：未注销用户 phone=139xxx 的 OtpRequest 不动
    expect(await prisma.otpRequest.count({ where: { phone: "13900000002" } })).toBe(1);

    // 红线 #7：历史 revoked session 的 ipCreated/userAgent/deviceLabel 也被擦
    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(s.deviceLabel).toBeNull();
      expect(s.ipCreated).toBeNull();
      expect(s.userAgent).toBeNull();
      expect(s.revokedAt).not.toBeNull();
    }

    // 财务行保留
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.balance).toBe(47);  // ledger 累计未动
    const orders = await prisma.topupOrder.findMany({ where: { userId } });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.amountCents).toBe(500);
    expect(orders[0]!.transactionId).toBe("wx_tx_001");
    expect(orders[0]!.ipCreated).toBeNull();
    expect(orders[0]!.userAgent).toBeNull();

    // ModelCall 保留行但 userId set null
    const mcCount = await prisma.modelCall.count({ where: { userId: null } });
    expect(mcCount).toBeGreaterThanOrEqual(1);
    expect(await prisma.modelCall.count({ where: { userId } })).toBe(0);

    // USER_ADHOC Question 删除；PUBLISHED Question 保留
    expect(await prisma.question.findUnique({ where: { id: adhocQuestionId } })).toBeNull();
    expect(await prisma.question.findUnique({ where: { id: publishedQuestionId } })).not.toBeNull();

    // OpsActionLog 写入
    const log = await prisma.opsActionLog.findFirstOrThrow({ where: { kind: "DEACTIVATE_USER", targetUserId: userId } });
    expect(log.initiatorRef).toBe("cli:test:tester");
    expect(log.reason).toBe("test");
    const payload = log.payload as { dryRun?: boolean };
    expect(payload.dryRun).toBe(false);
  });

  it("idempotent: second call returns alreadyDeactivated and writes no new OpsActionLog", async () => {
    const { userId } = await seedUserWithFullProfile();
    await deactivateUser(prisma, { userId, operatorId: null, initiatorRef: "cli:t:t", reason: "first" });
    const r = await deactivateUser(prisma, { userId, operatorId: null, initiatorRef: "cli:t:t", reason: "second" });
    expect(r.alreadyDeactivated).toBe(true);
    expect(r.payload.deleted.errorBookEntries).toBe(0);
    expect(await prisma.opsActionLog.count({ where: { kind: "DEACTIVATE_USER", targetUserId: userId } })).toBe(1);
  });

  it("throws UserNotFoundError on bogus userId", async () => {
    await expect(deactivateUser(prisma, { userId: "ckxxxxxx-bogus", operatorId: null, initiatorRef: "cli:t:t" })).rejects.toThrow(/User not found/);
  });
});
```

- [ ] **步骤 5.4：写 tx atomicity test `pii-deactivate-user-tx-atomicity.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { deactivateUser } from "@/server/lib/pii-governance";

// 复用 seedUserWithFullProfile（拷贝或抽到 test-utils）
async function seed() { /* same as pii-deactivate-user.test.ts */ return { userId: "..." }; }

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("deactivateUser tx atomicity", () => {
  it("rollback on opsActionLog.create failure: all prior steps reverted", async () => {
    const { userId } = await seed();
    // mock opsActionLog.create 抛错（模拟 D 步骤失败）
    const spy = vi.spyOn(prisma.opsActionLog, "create").mockRejectedValueOnce(new Error("boom"));
    await expect(deactivateUser(prisma, { userId, operatorId: null, initiatorRef: "cli:t:t" })).rejects.toThrow(/boom/);

    // 全部 B/C 改动应已回滚
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.deletedAt).toBeNull();
    expect(user.name).not.toBeNull();
    expect(await prisma.errorBookEntry.count({ where: { userId } })).toBeGreaterThan(0);
    expect(await prisma.authIdentity.count({ where: { userId } })).toBeGreaterThan(0);
    expect(await prisma.opsActionLog.count({ where: { targetUserId: userId } })).toBe(0);

    spy.mockRestore();
  });
});
```

- [ ] **步骤 5.5：写 dryRun test `pii-deactivate-user-dryrun.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { deactivateUser, previewDeactivateUser } from "@/server/lib/pii-governance";

async function seed() { /* same as happy path */ return { userId: "..." }; }

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("deactivateUser dryRun", () => {
  it("dryRun=true returns counts but writes 0 changes and 0 OpsActionLog", async () => {
    const { userId } = await seed();
    const beforeUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const r = await deactivateUser(prisma, { userId, operatorId: null, initiatorRef: "cli:t:t", dryRun: true });

    expect(r.payload.dryRun).toBe(true);
    expect(r.payload.deleted.errorBookEntries).toBeGreaterThan(0);   // 预估非 0
    expect(r.payload.scrubbed.authIdentities).toBeGreaterThan(0);

    // 但 DB 0 改动
    const afterUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(afterUser.deletedAt).toBeNull();
    expect(afterUser.name).toBe(beforeUser.name);
    expect(await prisma.errorBookEntry.count({ where: { userId } })).toBeGreaterThan(0);

    // 0 OpsActionLog
    expect(await prisma.opsActionLog.count({ where: { targetUserId: userId } })).toBe(0);
  });

  it("previewDeactivateUser directly returns same counts", async () => {
    const { userId } = await seed();
    const preview = await previewDeactivateUser(prisma, userId);
    expect(preview.dryRun).toBe(true);
    expect(preview.deleted.userAdhocQuestions).toBe(1);
  });
});
```

- [ ] **步骤 5.6：跑 3 测试 + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts tests/integration/pii-deactivate-user-tx-atomicity.test.ts tests/integration/pii-deactivate-user-dryrun.test.ts
Select-String -Path apps/web/tests/integration -Pattern "it\.todo" -Recurse
```

期望：全部测例通过 + 0 个 it.todo。

- [ ] **步骤 5.7：commit**

```powershell
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-deactivate-user.test.ts apps/web/tests/integration/pii-deactivate-user-tx-atomicity.test.ts apps/web/tests/integration/pii-deactivate-user-dryrun.test.ts
git commit -m "feat(web): Plan 6 Task 5 — deactivateUser + previewDeactivateUser service + 3 integration tests (happy / tx-atomicity / dryRun)"
```

---

## Task 6：`exportUserData` service + 测试

> **为什么先做：** 与 Plan 6 §4 directly mapped；service 完成后 CLI（Task 8）调即可。

**Files：**
- Modify: `apps/web/server/lib/pii-governance.ts`
- Create: `apps/web/tests/integration/pii-export-user-data.test.ts`

- [ ] **步骤 6.1：在 `pii-governance.ts` 追加 `exportUserData`**

```ts
// ============ exportUserData（spec §4）============

const EXPORT_SCHEMA_VERSION = "2026-05-26";

export interface UserDataExport {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  userId: string;
  user: {
    name: string | null;
    avatarUrl: string | null;
    persona: string;
    gradeLevel: string | null;
    isMinor: boolean;
    createdAt: string;
    deletedAt: string | null;
    deactivationReason: string | null;
  };
  authIdentities: Array<{
    provider: string;
    providerScope: string;
    providerUserIdMasked: string;
    unionIdMasked: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
  wallet: { balance: number; createdAt: string } | null;
  creditLedger: Array<{
    kind: string;
    delta: number;
    balanceAfter: number;
    actionKind: string | null;
    refTable: string | null;
    refId: string | null;
    idemKey: string;
    createdAt: string;
  }>;
  topupOrders: Array<{
    outTradeNo: string;
    amountCents: number;
    credits: number;
    status: string;
    transactionId: string | null;
    paidAt: string | null;
    expiredAt: string;
    createdAt: string;
  }>;
  errorBookEntries: Array<{
    id: string;
    questionId: string;
    status: string;
    rootCause: string;
    rootCauseReasoning: string;
    actualAnswerMd: string | null;
    reviewCount: number;
    nextReviewAt: string | null;
    createdAt: string;
  }>;
  userAdhocQuestions: Array<{
    id: string;
    stemMd: string;
    type: string;
    normalizedStemHash: string | null;
    createdAt: string;
  }>;
  modelCalls: Array<{
    taskKind: string;
    status: string;
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: string;
  }>;
}

function maskPhone(s: string): string {
  if (s.length === 11) return s.slice(0, 3) + "****" + s.slice(7);
  return "***";
}

function maskWechatId(s: string): string {
  // 用于 openid 和 unionId 两类 wechat 标识
  if (s.length <= 8) return "***";
  return s.slice(0, 3) + "****" + s.slice(-3);
}

function maskIdentity(provider: string, raw: string): string {
  return provider === "PHONE" ? maskPhone(raw) : maskWechatId(raw);
}

export async function exportUserData(
  prisma: PrismaClient,
  userId: string,
): Promise<UserDataExport> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserNotFoundError(userId);

  const [identities, wallet, ledger, orders, entries, adhocs, mcs] = await Promise.all([
    prisma.authIdentity.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.creditLedger.findMany({ where: { wallet: { userId } }, orderBy: { createdAt: "asc" } }),
    prisma.topupOrder.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.errorBookEntry.findMany({ where: { userId, status: { in: ["ACTIVE", "ARCHIVED"] } }, orderBy: { createdAt: "asc" } }),
    prisma.question.findMany({ where: { source: "USER_ADHOC" as never, createdByUserId: userId }, orderBy: { createdAt: "asc" } }),
    prisma.modelCall.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { taskKind: true, status: true, tokensIn: true, tokensOut: true, createdAt: true } }),
  ]);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    userId,
    user: {
      name: user.name,
      avatarUrl: user.avatarUrl,
      persona: user.persona,
      gradeLevel: user.gradeLevel,
      isMinor: user.isMinor,
      createdAt: user.createdAt.toISOString(),
      deletedAt: user.deletedAt?.toISOString() ?? null,
      deactivationReason: user.deactivationReason,
    },
    authIdentities: identities.map(i => ({
      provider: i.provider,
      providerScope: i.providerScope,
      providerUserIdMasked: maskIdentity(i.provider, i.providerUserId),
      unionIdMasked: i.unionId ? maskWechatId(i.unionId) : null,
      createdAt: i.createdAt.toISOString(),
      lastUsedAt: i.lastUsedAt?.toISOString() ?? null,
    })),
    wallet: wallet ? { balance: wallet.balance, createdAt: wallet.createdAt.toISOString() } : null,
    creditLedger: ledger.map(l => ({
      kind: l.kind, delta: l.delta, balanceAfter: l.balanceAfter, actionKind: l.actionKind,
      refTable: l.refTable, refId: l.refId, idemKey: l.idemKey, createdAt: l.createdAt.toISOString(),
    })),
    topupOrders: orders.map(o => ({
      outTradeNo: o.outTradeNo, amountCents: o.amountCents, credits: o.credits, status: o.status,
      transactionId: o.transactionId, paidAt: o.paidAt?.toISOString() ?? null,
      expiredAt: o.expiredAt.toISOString(), createdAt: o.createdAt.toISOString(),
    })),
    errorBookEntries: entries.map(e => ({
      id: e.id, questionId: e.questionId, status: e.status,
      rootCause: e.rootCause, rootCauseReasoning: e.rootCauseReasoning, actualAnswerMd: e.actualAnswerMd,
      reviewCount: e.reviewCount, nextReviewAt: e.nextReviewAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    userAdhocQuestions: adhocs.map(q => ({
      id: q.id, stemMd: q.stemMd, type: q.type,
      normalizedStemHash: q.normalizedStemHash, createdAt: q.createdAt.toISOString(),
    })),
    modelCalls: mcs.map(m => ({
      taskKind: m.taskKind, status: m.status, tokensIn: m.tokensIn, tokensOut: m.tokensOut,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
```

- [ ] **步骤 6.2：写 `pii-export-user-data.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { exportUserData } from "@/server/lib/pii-governance";

async function seed() {
  const user = await prisma.user.create({
    data: { name: "Bob", avatarUrl: "https://avatar.example/b.png", persona: "STUDENT", isMinor: false },
  });
  await prisma.authIdentity.create({ data: { userId: user.id, provider: "PHONE", providerScope: "GLOBAL", providerUserId: "13800000123" } });
  await prisma.authIdentity.create({ data: { userId: user.id, provider: "WECHAT_H5", providerScope: "wxAPPID01", providerUserId: "openid_abcdefghij", unionId: "union_xyzxyzxyz" } });
  const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 100 } });
  await prisma.creditLedger.create({ data: { walletId: wallet.id, kind: "TOPUP", delta: 100, balanceAfter: 100, idemKey: "topup:export-test-1" } });
  await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 1000, credits: 100, status: "PAID", outTradeNo: "zj_user_exportt", transactionId: "wx_tx_99", paidAt: new Date(), expiredAt: new Date(Date.now() + 3600_000), ipCreated: "1.1.1.1", userAgent: "ios" } });
  const subj = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const q = await prisma.question.create({ data: { subjectId: subj.id, stemMd: "Solve x", type: "ESSAY", status: "PUBLISHED" } });
  await prisma.question.create({ data: { subjectId: subj.id, stemMd: "user-typed stem", type: "ESSAY", status: "DRAFT", source: "USER_ADHOC" as never, createdByUserId: user.id, normalizedStemHash: "h1" } });
  await prisma.errorBookEntry.create({ data: { userId: user.id, questionId: q.id, status: "ACTIVE", rootCause: "OTHER", rootCauseReasoning: "x", actualAnswerMd: "user answer" } });
  await prisma.modelCall.create({ data: { taskKind: "TUTOR_ASK", model: "qwen-plus", requestJson: { prompt: "sensitive system prompt" }, responseJson: { content: "sensitive ai response" }, status: "SUCCESS", userId: user.id, tokensIn: 100, tokensOut: 50 } });
  return { userId: user.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("exportUserData", () => {
  it("includes whitelist fields", async () => {
    const { userId } = await seed();
    const r = await exportUserData(prisma, userId);
    expect(r.schemaVersion).toBe("2026-05-26");
    expect(r.userId).toBe(userId);
    expect(r.user.name).toBe("Bob");
    expect(r.authIdentities).toHaveLength(2);
    expect(r.wallet?.balance).toBe(100);
    expect(r.creditLedger).toHaveLength(1);
    expect(r.topupOrders).toHaveLength(1);
    expect(r.errorBookEntries).toHaveLength(1);
    expect(r.userAdhocQuestions).toHaveLength(1);
    expect(r.modelCalls).toHaveLength(1);
    expect(r.modelCalls[0]!.taskKind).toBe("TUTOR_ASK");
    expect(r.modelCalls[0]!.tokensIn).toBe(100);
  });

  it("excludes forbidden fields (regex 红线 R1)", async () => {
    const { userId } = await seed();
    const r = await exportUserData(prisma, userId);
    const json = JSON.stringify(r);
    // 红线 R1：必须用 regex not.toMatch，不用 .includes
    expect(json).not.toMatch(/rawBody|requestJson|responseJson|ipCreated|userAgent|errorMessage|promptTemplateId/);
    // ModelCall 不含敏感
    expect(json).not.toContain("sensitive system prompt");
    expect(json).not.toContain("sensitive ai response");
  });

  it("masks identity fields (no clear-text phone / openid / unionId)", async () => {
    const { userId } = await seed();
    const r = await exportUserData(prisma, userId);
    const phoneIdentity = r.authIdentities.find(i => i.provider === "PHONE")!;
    const wechatIdentity = r.authIdentities.find(i => i.provider === "WECHAT_H5")!;
    expect(phoneIdentity.providerUserIdMasked).toBe("138****0123");
    expect(wechatIdentity.providerUserIdMasked).toMatch(/^ope\*{4}.{3}$/);
    expect(wechatIdentity.unionIdMasked).toMatch(/^uni\*{4}.{3}$/);
    const json = JSON.stringify(r);
    expect(json).not.toContain("13800000123");
    expect(json).not.toContain("openid_abcdefghij");
    expect(json).not.toContain("union_xyzxyzxyz");
  });

  it("throws UserNotFoundError on bogus userId", async () => {
    await expect(exportUserData(prisma, "ckxx-bogus")).rejects.toThrow(/User not found/);
  });
});
```

- [ ] **步骤 6.3：跑测试 + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-export-user-data.test.ts
Select-String -Path apps/web/tests/integration -Pattern "it\.todo" -Recurse
```

期望：4 测例通过 + 0 it.todo。

- [ ] **步骤 6.4：commit**

```powershell
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-export-user-data.test.ts
git commit -m "feat(web): Plan 6 Task 6 — exportUserData service + 4 integration tests (regex R1 + identity masking)"
```

---

## Task 7：`sweepPii` 5 个 sweeper + 5 测试

> **为什么先做：** GC sweepers 独立于 deactivateUser 流程；service 完成后 CLI（Task 8）调即可。

**Files：**
- Modify: `apps/web/server/lib/pii-governance.ts`
- Create: `apps/web/tests/integration/pii-gc-sweep-short.test.ts`
- Create: `apps/web/tests/integration/pii-gc-sweep-medium.test.ts`
- Create: `apps/web/tests/integration/pii-gc-sweep-orphan.test.ts`
- Create: `apps/web/tests/integration/pii-gc-sweep-dryrun.test.ts`
- Create: `apps/web/tests/integration/pii-gc-sweep-batching.test.ts`

- [ ] **步骤 7.1：在 `pii-governance.ts` 追加 sweep 类型与 5 个 sweeper**

```ts
// ============ sweepPii（spec §5）============

export type SweepBucket = "short" | "medium" | "orphan";

export interface SweepResult {
  bucket: SweepBucket;
  table: string;
  affected: number;
  dryRun: boolean;
  hasMore: boolean;
}

export interface SweepArgs {
  bucket: SweepBucket | "all";
  shortDays: number;
  mediumDays: number;
  orphanDays: number;
  now?: Date;
  dryRun?: boolean;
}

const BATCH_LIMIT = 10000;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

// Sweeper #1: OtpRequest (short bucket) - COALESCE(consumedAt, expiredAt, expiresAt) - 红线 #5
async function sweepOtpRequests(
  prisma: PrismaClient,
  cutoff: Date,
  dryRun: boolean,
): Promise<SweepResult> {
  const candidates = await prisma.otpRequest.findMany({
    where: {
      OR: [
        { consumedAt: { not: null, lt: cutoff } },
        { AND: [{ consumedAt: null }, { expiredAt: { not: null, lt: cutoff } }] },
        { AND: [{ consumedAt: null }, { expiredAt: null }, { expiresAt: { lt: cutoff } }] },
      ],
    },
    select: { id: true },
    take: BATCH_LIMIT,
  });
  if (dryRun) return { bucket: "short", table: "otp_requests", affected: candidates.length, dryRun, hasMore: candidates.length === BATCH_LIMIT };
  const r = await prisma.otpRequest.deleteMany({ where: { id: { in: candidates.map(c => c.id) } } });
  return { bucket: "short", table: "otp_requests", affected: r.count, dryRun, hasMore: candidates.length === BATCH_LIMIT };
}

// Sweeper #2: Session (short bucket) - COALESCE(revokedAt, expiresAt) - 红线 #5
async function sweepInactiveSessions(
  prisma: PrismaClient,
  cutoff: Date,
  dryRun: boolean,
): Promise<SweepResult> {
  const candidates = await prisma.session.findMany({
    where: {
      OR: [
        { revokedAt: { not: null, lt: cutoff } },
        { AND: [{ revokedAt: null }, { expiresAt: { lt: cutoff } }] },
      ],
    },
    select: { id: true },
    take: BATCH_LIMIT,
  });
  if (dryRun) return { bucket: "short", table: "sessions", affected: candidates.length, dryRun, hasMore: candidates.length === BATCH_LIMIT };
  const r = await prisma.session.deleteMany({ where: { id: { in: candidates.map(c => c.id) } } });
  return { bucket: "short", table: "sessions", affected: r.count, dryRun, hasMore: candidates.length === BATCH_LIMIT };
}

// Sweeper #3: WechatPayEvent.rawBody (medium bucket)
async function sweepWechatPayEventBodies(
  prisma: PrismaClient,
  cutoff: Date,
  dryRun: boolean,
): Promise<SweepResult> {
  if (dryRun) {
    const c = await prisma.wechatPayEvent.count({ where: { createdAt: { lt: cutoff }, rawBody: { not: null } } });
    return { bucket: "medium", table: "wechat_pay_events", affected: Math.min(c, BATCH_LIMIT), dryRun, hasMore: c > BATCH_LIMIT };
  }
  const affected: number = await prisma.$executeRaw`
    WITH targets AS (
      SELECT id FROM wechat_pay_events
      WHERE created_at < ${cutoff} AND raw_body IS NOT NULL
      LIMIT ${BATCH_LIMIT}
    )
    UPDATE wechat_pay_events SET raw_body = null
    WHERE id IN (SELECT id FROM targets)
  `;
  return { bucket: "medium", table: "wechat_pay_events", affected, dryRun, hasMore: affected === BATCH_LIMIT };
}

// Sweeper #4: TopupOrder ip/ua (medium bucket)
async function sweepTopupOrderPii(
  prisma: PrismaClient,
  cutoff: Date,
  dryRun: boolean,
): Promise<SweepResult> {
  const candidates = await prisma.topupOrder.findMany({
    where: {
      status: { in: ["PAID", "FAILED", "EXPIRED"] },
      updatedAt: { lt: cutoff },
      OR: [{ ipCreated: { not: null } }, { userAgent: { not: null } }],
    },
    select: { id: true },
    take: BATCH_LIMIT,
  });
  if (dryRun) return { bucket: "medium", table: "topup_orders", affected: candidates.length, dryRun, hasMore: candidates.length === BATCH_LIMIT };
  const r = await prisma.topupOrder.updateMany({
    where: { id: { in: candidates.map(c => c.id) } },
    data: { ipCreated: null, userAgent: null },
  });
  return { bucket: "medium", table: "topup_orders", affected: r.count, dryRun, hasMore: candidates.length === BATCH_LIMIT };
}

// Sweeper #5: Orphan TopupOrder (orphan bucket) - 红线 #6
async function sweepOrphanTopupOrders(
  prisma: PrismaClient,
  cutoff: Date,
  dryRun: boolean,
): Promise<SweepResult> {
  if (dryRun) {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM topup_orders
      WHERE status = 'EXPIRED'
        AND paid_at IS NULL
        AND created_at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger
          WHERE ref_table = 'topup_orders' AND ref_id = topup_orders.id
        )
    `;
    const c = Number(rows[0]!.count);
    return { bucket: "orphan", table: "topup_orders", affected: Math.min(c, BATCH_LIMIT), dryRun, hasMore: c > BATCH_LIMIT };
  }
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    WITH targets AS (
      SELECT id FROM topup_orders
      WHERE status = 'EXPIRED'
        AND paid_at IS NULL
        AND created_at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger
          WHERE ref_table = 'topup_orders' AND ref_id = topup_orders.id
        )
      LIMIT ${BATCH_LIMIT}
    ),
    deleted AS (
      DELETE FROM topup_orders WHERE id IN (SELECT id FROM targets) RETURNING id
    )
    SELECT count(*)::bigint AS count FROM deleted
  `;
  const affected = Number(rows[0]!.count);
  return { bucket: "orphan", table: "topup_orders", affected, dryRun, hasMore: affected === BATCH_LIMIT };
}

// ============ Public entrypoint ============

export interface SweepRunArgs extends SweepArgs {
  operatorId: string | null;
  initiatorRef: string;
}

export async function sweepPii(
  prisma: PrismaClient,
  args: SweepRunArgs,
): Promise<SweepResult[]> {
  const now = args.now ?? new Date();
  const dryRun = args.dryRun ?? false;

  const results: SweepResult[] = [];
  if (args.bucket === "short" || args.bucket === "all") {
    results.push(await sweepOtpRequests(prisma, daysAgo(now, args.shortDays), dryRun));
    results.push(await sweepInactiveSessions(prisma, daysAgo(now, args.shortDays), dryRun));
  }
  if (args.bucket === "medium" || args.bucket === "all") {
    results.push(await sweepWechatPayEventBodies(prisma, daysAgo(now, args.mediumDays), dryRun));
    results.push(await sweepTopupOrderPii(prisma, daysAgo(now, args.mediumDays), dryRun));
  }
  if (args.bucket === "orphan" || args.bucket === "all") {
    results.push(await sweepOrphanTopupOrders(prisma, daysAgo(now, args.orphanDays), dryRun));
  }

  // 写 OpsActionLog per bucket，dryRun 时不写（红线 #2 一致）
  if (!dryRun) {
    const buckets = args.bucket === "all" ? ["short", "medium", "orphan"] as const : [args.bucket];
    for (const b of buckets) {
      const bucketResults = results.filter(r => r.bucket === b);
      await prisma.opsActionLog.create({
        data: {
          kind: b === "short" ? "GC_SWEEP_SHORT" : b === "medium" ? "GC_SWEEP_MEDIUM" : "GC_SWEEP_ORPHAN",
          initiatorId: args.operatorId,
          initiatorRef: args.initiatorRef,
          targetUserId: null,
          reason: null,
          payload: { results: bucketResults, bucket: b, nowAt: now.toISOString() },
        },
      });
    }
  }

  return results;
}
```

- [ ] **步骤 7.2：写 `pii-gc-sweep-short.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { sweepPii } from "@/server/lib/pii-governance";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

const NOW = new Date("2026-06-01T00:00:00Z");
const D28 = new Date("2026-05-04T00:00:00Z");  // 28d ago
const D32 = new Date("2026-04-30T00:00:00Z");  // 32d ago

describe("sweepPii short bucket (30d)", () => {
  it("OtpRequest COALESCE 四形态：consumedAt-only / expiredAt-only / expiresAt-only 即自然过期 / 全空活跃", async () => {
    // consumedAt-only > 32d: should delete
    await prisma.otpRequest.create({ data: { phone: "13800000001", purpose: "LOGIN", codeHash: "h1", expiresAt: new Date("2026-04-25T00:00:00Z"), consumedAt: D32 } });
    // expiredAt-only > 32d: should delete
    await prisma.otpRequest.create({ data: { phone: "13800000002", purpose: "LOGIN", codeHash: "h2", expiresAt: new Date("2026-04-25T00:00:00Z"), expiredAt: D32 } });
    // expiresAt-only > 32d (natural expiry, no consume/expired mark): should delete
    await prisma.otpRequest.create({ data: { phone: "13800000003", purpose: "LOGIN", codeHash: "h3", expiresAt: D32 } });
    // 28d ago, within retention: keep
    await prisma.otpRequest.create({ data: { phone: "13800000004", purpose: "LOGIN", codeHash: "h4", expiresAt: D28 } });
    // 全空活跃 (expiresAt future, no consume/expired): keep
    await prisma.otpRequest.create({ data: { phone: "13800000005", purpose: "LOGIN", codeHash: "h5", expiresAt: new Date("2026-06-15T00:00:00Z") } });

    const r = await sweepPii(prisma, { bucket: "short", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    const otp = r.find(x => x.table === "otp_requests")!;
    expect(otp.affected).toBe(3);
    expect(await prisma.otpRequest.count()).toBe(2);
  });

  it("Session COALESCE 三形态：revoked-not-expired / expired-not-revoked / 活跃不动", async () => {
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
    // revoked > 32d, expires future: delete (revokedAt 主导)
    await prisma.session.create({ data: { userId: user.id, refreshTokenHash: "rt1", expiresAt: new Date("2026-12-31"), revokedAt: D32 } });
    // not revoked, expired > 32d ago: delete (expiresAt 兜底)
    await prisma.session.create({ data: { userId: user.id, refreshTokenHash: "rt2", expiresAt: D32 } });
    // 活跃: keep
    await prisma.session.create({ data: { userId: user.id, refreshTokenHash: "rt3", expiresAt: new Date("2026-12-31") } });
    // recently revoked (within 30d): keep
    await prisma.session.create({ data: { userId: user.id, refreshTokenHash: "rt4", expiresAt: new Date("2026-12-31"), revokedAt: D28 } });

    const r = await sweepPii(prisma, { bucket: "short", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    const sess = r.find(x => x.table === "sessions")!;
    expect(sess.affected).toBe(2);
    expect(await prisma.session.count()).toBe(2);
  });

  it("writes OpsActionLog with bucket payload", async () => {
    await prisma.otpRequest.create({ data: { phone: "13800000999", purpose: "LOGIN", codeHash: "h", expiresAt: D32 } });
    await sweepPii(prisma, { bucket: "short", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    const log = await prisma.opsActionLog.findFirstOrThrow({ where: { kind: "GC_SWEEP_SHORT" } });
    expect((log.payload as any).bucket).toBe("short");
    expect((log.payload as any).results).toHaveLength(2);
  });
});
```

- [ ] **步骤 7.3：写 `pii-gc-sweep-medium.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { sweepPii } from "@/server/lib/pii-governance";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

const NOW = new Date("2026-06-01T00:00:00Z");
const D88 = new Date("2026-03-05T00:00:00Z");
const D92 = new Date("2026-03-01T00:00:00Z");

describe("sweepPii medium bucket (90d)", () => {
  it("WechatPayEvent rawBody scrub at 92d / not 88d / idempotent re-run", async () => {
    await prisma.wechatPayEvent.create({ data: { outTradeNo: "old", rawBody: "{old payload}", verifyStatus: "OK", createdAt: D92 } });
    await prisma.wechatPayEvent.create({ data: { outTradeNo: "young", rawBody: "{young payload}", verifyStatus: "OK", createdAt: D88 } });

    const r1 = await sweepPii(prisma, { bucket: "medium", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    expect(r1.find(x => x.table === "wechat_pay_events")!.affected).toBe(1);
    const old = await prisma.wechatPayEvent.findFirstOrThrow({ where: { outTradeNo: "old" } });
    expect(old.rawBody).toBeNull();
    const young = await prisma.wechatPayEvent.findFirstOrThrow({ where: { outTradeNo: "young" } });
    expect(young.rawBody).toBe("{young payload}");

    // 幂等：再跑一次 affected=0
    const r2 = await sweepPii(prisma, { bucket: "medium", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    expect(r2.find(x => x.table === "wechat_pay_events")!.affected).toBe(0);
  });

  it("TopupOrder ip/ua scrub at 92d when status terminal", async () => {
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
    // PAID 92d ago: scrub
    const oldPaid = await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 100, credits: 10, status: "PAID", outTradeNo: "zj_aa_old001", expiredAt: new Date("2026-03-02"), ipCreated: "1.1.1.1", userAgent: "ios", paidAt: D92, createdAt: D92, updatedAt: D92 } });
    // PAID 88d ago: keep
    await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 100, credits: 10, status: "PAID", outTradeNo: "zj_aa_young01", expiredAt: new Date("2026-03-06"), ipCreated: "1.1.1.1", userAgent: "ios", paidAt: D88, createdAt: D88, updatedAt: D88 } });
    // PENDING 92d ago (not terminal): keep
    await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 100, credits: 10, status: "PENDING", outTradeNo: "zj_aa_pending1", expiredAt: new Date("2026-03-02"), ipCreated: "1.1.1.1", userAgent: "ios", createdAt: D92, updatedAt: D92 } });

    await sweepPii(prisma, { bucket: "medium", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });

    const scrubbedOld = await prisma.topupOrder.findUniqueOrThrow({ where: { id: oldPaid.id } });
    expect(scrubbedOld.ipCreated).toBeNull();
    expect(scrubbedOld.userAgent).toBeNull();
    expect(scrubbedOld.amountCents).toBe(100); // 金额保留
    const young = await prisma.topupOrder.findFirstOrThrow({ where: { outTradeNo: "zj_aa_young01" } });
    expect(young.ipCreated).toBe("1.1.1.1");
    const pending = await prisma.topupOrder.findFirstOrThrow({ where: { outTradeNo: "zj_aa_pending1" } });
    expect(pending.ipCreated).toBe("1.1.1.1");
  });
});
```

- [ ] **步骤 7.4：写 `pii-gc-sweep-orphan.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { sweepPii } from "@/server/lib/pii-governance";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

const NOW = new Date("2026-06-01T00:00:00Z");
const D175 = new Date("2025-12-08T00:00:00Z");
const D185 = new Date("2025-11-28T00:00:00Z");

describe("sweepPii orphan bucket (180d)", () => {
  it("EXPIRED + paidAt=null + 185d + no ledger ref: delete", async () => {
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
    await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "zj_orphan_001", expiredAt: D185, createdAt: D185 } });

    const r = await sweepPii(prisma, { bucket: "orphan", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    expect(r.find(x => x.bucket === "orphan")!.affected).toBe(1);
    expect(await prisma.topupOrder.count()).toBe(0);
  });

  it("175d (within retention): keep", async () => {
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
    await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "zj_orphan_175", expiredAt: D175, createdAt: D175 } });
    await sweepPii(prisma, { bucket: "orphan", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    expect(await prisma.topupOrder.count()).toBe(1);
  });

  it("paidAt non-null (曾支付): keep even if 185d+ EXPIRED", async () => {
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
    await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "zj_ever_paid", paidAt: new Date("2026-01-01"), expiredAt: D185, createdAt: D185 } });
    await sweepPii(prisma, { bucket: "orphan", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    expect(await prisma.topupOrder.count()).toBe(1);
  });

  it("NOT EXISTS CreditLedger: keep order if any ledger refs it", async () => {
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
    const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
    const order = await prisma.topupOrder.create({ data: { userId: user.id, amountCents: 100, credits: 10, status: "EXPIRED", outTradeNo: "zj_with_ledger", expiredAt: D185, createdAt: D185 } });
    await prisma.creditLedger.create({ data: { walletId: wallet.id, kind: "TOPUP", delta: 0, balanceAfter: 0, idemKey: "ledger:plan6:gc-test-1", refTable: "topup_orders", refId: order.id } });
    await sweepPii(prisma, { bucket: "orphan", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    expect(await prisma.topupOrder.count()).toBe(1);
  });
});
```

- [ ] **步骤 7.5：写 `pii-gc-sweep-dryrun.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { sweepPii } from "@/server/lib/pii-governance";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("sweepPii dryRun", () => {
  it("dryRun=true returns counts but 0 DB changes and 0 OpsActionLog", async () => {
    const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
    await prisma.otpRequest.create({ data: { phone: "13800000888", purpose: "LOGIN", codeHash: "h", expiresAt: new Date("2026-01-01") } });
    await prisma.session.create({ data: { userId: user.id, refreshTokenHash: "rt-old", expiresAt: new Date("2026-01-01") } });

    const r = await sweepPii(prisma, { bucket: "all", shortDays: 30, mediumDays: 90, orphanDays: 180, now: new Date("2026-06-01T00:00:00Z"), dryRun: true, operatorId: null, initiatorRef: "cli:t:t" });
    expect(r.find(x => x.table === "otp_requests")!.affected).toBe(1);
    expect(r.find(x => x.table === "otp_requests")!.dryRun).toBe(true);

    // 0 DB 改动
    expect(await prisma.otpRequest.count()).toBe(1);
    expect(await prisma.session.count()).toBe(1);
    // 0 OpsActionLog
    expect(await prisma.opsActionLog.count({ where: { kind: { in: ["GC_SWEEP_SHORT", "GC_SWEEP_MEDIUM", "GC_SWEEP_ORPHAN"] } } })).toBe(0);
  });
});
```

- [ ] **步骤 7.6：写 `pii-gc-sweep-batching.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { sweepPii } from "@/server/lib/pii-governance";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("sweepPii batching (LIMIT 10000 + hasMore)", () => {
  it("seed 12000 OtpRequest rows → first batch 10000+hasMore=true → second batch 2000+hasMore=false", async () => {
    const cutoff = new Date("2026-01-01");
    const rows = Array.from({ length: 12000 }, (_, i) => ({
      phone: "138" + String(i).padStart(8, "0"),
      purpose: "LOGIN" as const,
      codeHash: "h" + i,
      expiresAt: cutoff,
    }));
    await prisma.otpRequest.createMany({ data: rows });

    const NOW = new Date("2026-06-01T00:00:00Z");
    const r1 = await sweepPii(prisma, { bucket: "short", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    const otp1 = r1.find(x => x.table === "otp_requests")!;
    expect(otp1.affected).toBe(10000);
    expect(otp1.hasMore).toBe(true);

    const r2 = await sweepPii(prisma, { bucket: "short", shortDays: 30, mediumDays: 90, orphanDays: 180, now: NOW, dryRun: false, operatorId: null, initiatorRef: "cli:t:t" });
    const otp2 = r2.find(x => x.table === "otp_requests")!;
    expect(otp2.affected).toBe(2000);
    expect(otp2.hasMore).toBe(false);
  });
});
```

- [ ] **步骤 7.7：跑 5 测试 + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-gc-sweep-short.test.ts tests/integration/pii-gc-sweep-medium.test.ts tests/integration/pii-gc-sweep-orphan.test.ts tests/integration/pii-gc-sweep-dryrun.test.ts tests/integration/pii-gc-sweep-batching.test.ts
Select-String -Path apps/web/tests/integration -Pattern "it\.todo" -Recurse
```

期望全过 + 0 it.todo。

- [ ] **步骤 7.8：commit**

```powershell
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-gc-sweep-*.test.ts
git commit -m "feat(web): Plan 6 Task 7 — sweepPii 5 sweepers (COALESCE 三层兜底 + CTE+queryRaw orphan) + 5 integration tests"
```

---

## Task 8：3 个 CLI 脚本 + package.json scripts

> **为什么先做：** Task 5-7 service 已就绪；CLI 是 thin wrapper，单 task 把 3 个全写完。

**Files：**
- Create: `apps/web/scripts/user-deactivate.ts`
- Create: `apps/web/scripts/user-export.ts`
- Create: `apps/web/scripts/pii-gc-sweep.ts`
- Modify: `apps/web/package.json`

- [ ] **步骤 8.1：新建 `scripts/user-deactivate.ts`**

```ts
#!/usr/bin/env tsx
// Plan 6 spec §3.6: OPS CLI 注销
//   pnpm.cmd --filter @zhijiao/web user:deactivate <userId> [--reason TEXT] [--dry-run]

import { PrismaClient } from "@prisma/client";
import { deactivateUser } from "../server/lib/pii-governance.js";
import { resolveOperatorUserId, buildInitiatorRef } from "../server/lib/operator.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let reason: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reason") { reason = argv[++i]; continue; }
    if (argv[i] === "--dry-run") { dryRun = true; continue; }
    positional.push(argv[i]!);
  }
  if (positional.length !== 1) throw new Error("Usage: user-deactivate <userId> [--reason TEXT] [--dry-run]");
  return { userId: positional[0]!, reason, dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const initiatorRef = buildInitiatorRef();
    const r = await deactivateUser(prisma, { userId: args.userId, operatorId, initiatorRef, reason: args.reason, dryRun: args.dryRun });
    if (r.alreadyDeactivated) {
      console.log(JSON.stringify({ alreadyDeactivated: true }, null, 2));
      return;
    }
    console.log(JSON.stringify(r.payload, null, 2));
    if (!args.dryRun) {
      console.log("Done.");
    } else {
      console.log("(dryRun — no changes written)");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **步骤 8.2：新建 `scripts/user-export.ts`**

```ts
#!/usr/bin/env tsx
// Plan 6 spec §4.4: OPS CLI 导出用户数据副本
//   pnpm.cmd --filter @zhijiao/web user:export <userId> --out <path>

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { exportUserData } from "../server/lib/pii-governance.js";
import { resolveOperatorUserId, buildInitiatorRef } from "../server/lib/operator.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") { out = argv[++i]; continue; }
    positional.push(argv[i]!);
  }
  if (positional.length !== 1 || !out) throw new Error("Usage: user-export <userId> --out <path>");
  if (!out.endsWith(".json")) throw new Error("--out must end with .json");
  if (fs.existsSync(out)) throw new Error(`Refuse to overwrite existing file: ${out}`);
  return { userId: positional[0]!, out };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const initiatorRef = buildInitiatorRef();
    const data = await exportUserData(prisma, args.userId);
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(args.out, json, { encoding: "utf8" });
    try { fs.chmodSync(args.out, 0o600); } catch (e) { console.warn(`chmod 0600 failed (Windows best-effort): ${(e as Error).message}`); }

    const recordCounts = {
      authIdentities: data.authIdentities.length,
      creditLedger: data.creditLedger.length,
      topupOrders: data.topupOrders.length,
      errorBookEntries: data.errorBookEntries.length,
      userAdhocQuestions: data.userAdhocQuestions.length,
      modelCalls: data.modelCalls.length,
    };

    await prisma.opsActionLog.create({
      data: {
        kind: "EXPORT_USER_DATA",
        initiatorId: operatorId,
        initiatorRef,
        targetUserId: args.userId,
        reason: null,
        // 红线 #1：不写 outPath / 路径前缀
        payload: { exportSizeBytes: Buffer.byteLength(json, "utf8"), recordCounts, outputWritten: true },
      },
    });
    console.log(`Exported to ${args.out} (${Buffer.byteLength(json, "utf8")} bytes)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **步骤 8.3：新建 `scripts/pii-gc-sweep.ts`**

```ts
#!/usr/bin/env tsx
// Plan 6 spec §5.5: GC sweep CLI
//   pnpm.cmd --filter @zhijiao/web pii:gc-sweep [--bucket short|medium|orphan|all] [--dry-run] [--now ISO]

import { PrismaClient } from "@prisma/client";
import { sweepPii, type SweepBucket } from "../server/lib/pii-governance.js";
import { resolveOperatorUserId, buildInitiatorRef } from "../server/lib/operator.js";

const MAX_BATCHES = 10;

function parseArgs(argv: string[]) {
  let bucket: SweepBucket | "all" = "all";
  let dryRun = false;
  let now: Date | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--bucket") { bucket = argv[++i] as never; continue; }
    if (argv[i] === "--dry-run") { dryRun = true; continue; }
    if (argv[i] === "--now") { now = new Date(argv[++i]!); continue; }
  }
  if (!["short", "medium", "orphan", "all"].includes(bucket)) throw new Error(`Invalid --bucket: ${bucket}`);
  return { bucket, dryRun, now };
}

function loadEnvThresholds(): { shortDays: number; mediumDays: number; orphanDays: number } {
  const shortDays = Number(process.env.PII_RETENTION_SHORT_DAYS ?? "30");
  const mediumDays = Number(process.env.PII_RETENTION_MEDIUM_DAYS ?? "90");
  const orphanDays = Number(process.env.PII_RETENTION_ORPHAN_TOPUP_DAYS ?? "180");
  if (!Number.isInteger(shortDays) || shortDays < 1) throw new Error(`Invalid PII_RETENTION_SHORT_DAYS`);
  if (!Number.isInteger(mediumDays) || mediumDays <= shortDays) throw new Error(`Invalid PII_RETENTION_MEDIUM_DAYS`);
  if (!Number.isInteger(orphanDays) || orphanDays <= mediumDays) throw new Error(`Invalid PII_RETENTION_ORPHAN_TOPUP_DAYS`);
  return { shortDays, mediumDays, orphanDays };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = loadEnvThresholds();
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const initiatorRef = buildInitiatorRef();
    console.log(`[pii:gc-sweep] bucket=${args.bucket} dryRun=${args.dryRun} thresholds=${JSON.stringify(thresholds)}`);

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const results = await sweepPii(prisma, { ...args, ...thresholds, operatorId, initiatorRef });
      for (const r of results) console.log(`  Batch ${batch + 1} ${r.table} (${r.bucket}): ${r.affected} affected, hasMore=${r.hasMore}`);
      if (!results.some(r => r.hasMore)) break;
    }
    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **步骤 8.4：改 `apps/web/package.json` 加 3 scripts**

打开 `package.json` 找 `"scripts": { ... }` 段，加：

```json
"user:deactivate": "tsx scripts/user-deactivate.ts",
"user:export": "tsx scripts/user-export.ts",
"pii:gc-sweep": "tsx scripts/pii-gc-sweep.ts"
```

- [ ] **步骤 8.5：smoke 跑 3 个 CLI**

```powershell
# 干净 dev DB；预期 0-effect
pnpm.cmd --filter @zhijiao/web pii:gc-sweep --dry-run
# 期望：3 个 bucket 各 1-2 个 sweeper 都 affected=0, hasMore=false, Done

pnpm.cmd --filter @zhijiao/web user:deactivate ckxxxxxx --dry-run
# 期望：UserNotFoundError + exit 1

pnpm.cmd --filter @zhijiao/web user:export ckxxxxxx --out /tmp/test.json
# 期望：UserNotFoundError + exit 1
```

- [ ] **步骤 8.6：typecheck**

```powershell
pnpm.cmd exec turbo typecheck --force
```

期望全绿。

- [ ] **步骤 8.7：commit**

```powershell
git add apps/web/scripts/user-deactivate.ts apps/web/scripts/user-export.ts apps/web/scripts/pii-gc-sweep.ts apps/web/package.json
git commit -m "feat(web): Plan 6 Task 8 — 3 OPS CLI scripts (user:deactivate / user:export / pii:gc-sweep)"
```

---

## Task 9：静态页 `/support/deactivate` + E2E + 2 个补测试

> **为什么先做：** UI 改动独立于 service；E2E 守门探针 35 + R3 红线在此 task 落定。同时把 relogin + ops-action-log payload 两个测试也补齐。

**Files：**
- Create: `apps/web/app/(public)/support/deactivate/page.tsx`
- Create: `apps/web/e2e/support-deactivate-page.spec.ts`
- Create: `apps/web/tests/integration/pii-deleted-user-relogin.test.ts`
- Create: `apps/web/tests/unit/pii-ops-action-log-payload.test.ts`

- [ ] **步骤 9.1：新建 `page.tsx`**

```tsx
// Plan 6 spec §6.1: 注销渠道 + 主体 + 时限 + 身份核验 静态说明页
// 4 处 placeholder 待 ICP 备案 + 公司主体落地后改 PR 替换。
// 红线 R4 / 探针 #35：grep XXXXX|.example|"运营主体：XXXXX" 命中则阻断 prod ship。

const PLACEHOLDER_WECHAT_OA = "XXXXX";
const PLACEHOLDER_SUPPORT_EMAIL = "support@zhijiao.example";
const PLACEHOLDER_OPERATOR = "XXXXX";
const PLACEHOLDER_ICP = "XXXXX";

export default function DeactivatePage() {
  return (
    <main style={{ maxWidth: "720px", margin: "2rem auto", padding: "1rem", lineHeight: 1.8 }}>
      <h1>账号注销与个人信息处理</h1>
      <p>依据《个人信息保护法》第四十七条，您有权请求注销账号并删除您的个人信息。</p>

      <h2>如何申请</h2>
      <p>当前注销流程通过人工处理。请选择以下任一渠道与我们联系：</p>
      <ul>
        <li>微信公众号：智教（{PLACEHOLDER_WECHAT_OA}）</li>
        <li>客服邮箱：{PLACEHOLDER_SUPPORT_EMAIL}</li>
        <li>工单：暂未开放</li>
      </ul>
      <p>请在申请中提供：</p>
      <ul>
        <li>您的注册手机号（用于身份核验）</li>
        <li>注销原因（可选；帮助我们改进产品）</li>
      </ul>
      <p>未满 14 周岁的用户，请由监护人代为发起申请，并提供必要的监护关系核验材料。</p>

      <h2>处理时限</h2>
      <p>我们承诺在收到完整身份核验信息后 15 个工作日内完成注销。</p>

      <h2>身份核验方式</h2>
      <p>我们会通过您注册时使用的手机号发送验证码进行核验。微信注册的账号需提供绑定手机号；如尚未绑定，请先在 App 内绑定后再发起注销申请。</p>

      <h2>注销后您的数据处置</h2>
      <ol>
        <li>立即删除：您的姓名、头像、登录身份（手机号 / 微信关联）、验证码记录、错题本、变式题、自建题目内容</li>
        <li>永久去标识化：会话记录、支付订单中的 IP 与设备信息</li>
        <li>依法保留：根据《电子商务法》和税务相关规定，您的支付金额、订单号、交易号将作为财务凭证保留，但与您的身份信息切断关联</li>
        <li>注销前请先处理账号内余额或未完成订单；注销完成后账号权益将无法恢复</li>
      </ol>

      <h2>数据副本权利（PIPL 第四十五条）</h2>
      <p>您也有权获取个人信息副本。请通过上述渠道申请，我们会以 JSON 文件形式通过身份核验后的渠道交付。</p>

      <h2>主体信息</h2>
      <p>运营主体：{PLACEHOLDER_OPERATOR}</p>
      <p>ICP 备案号：{PLACEHOLDER_ICP}</p>
    </main>
  );
}
```

- [ ] **步骤 9.2：写 `e2e/support-deactivate-page.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test.describe("/support/deactivate static page", () => {
  test("renders 200 with PIPL Art 47 + minor guardian + no refund promise", async ({ page }) => {
    const r = await page.goto("/support/deactivate");
    expect(r?.status()).toBe(200);

    // PIPL Art 47 字串
    await expect(page.locator("body")).toContainText("个人信息保护法》第四十七条");

    // PIPL Art 45 字串
    await expect(page.locator("body")).toContainText("PIPL 第四十五条");

    // 未成年人监护人发起说明
    await expect(page.locator("body")).toContainText("未满 14 周岁的用户，请由监护人代为发起申请");

    // 红线 R3：不含退款/赔付字串（CLAUDE.md 合规规则）
    const text = await page.locator("body").textContent();
    expect(text).not.toMatch(/退款|全额返还|赔付/);

    // 探针 #35：placeholder 仍在；提醒未来 PR 替换
    expect(text).toContain("XXXXX");
    expect(text).toContain(".example");
  });
});
```

- [ ] **步骤 9.3：写 `pii-deleted-user-relogin.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { deactivateUser } from "@/server/lib/pii-governance";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("relogin after deactivation", () => {
  it("same phone after deactivation: AuthIdentity findUnique returns null → register path can build new User", async () => {
    const u1 = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false, name: "Old User" } });
    await prisma.authIdentity.create({ data: { userId: u1.id, provider: "PHONE", providerScope: "GLOBAL", providerUserId: "13800000777" } });

    await deactivateUser(prisma, { userId: u1.id, operatorId: null, initiatorRef: "cli:t:t" });

    // 旧 User row 留 tombstone
    const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: u1.id } });
    expect(tombstone.deletedAt).not.toBeNull();
    expect(tombstone.name).toBeNull();

    // PHONE identity 查不到（已删）
    const lookup = await prisma.authIdentity.findUnique({
      where: { uniq_identity: { provider: "PHONE", providerScope: "GLOBAL", providerUserId: "13800000777" } },
    });
    expect(lookup).toBeNull();

    // 同手机号 register 路径建新 User row
    const u2 = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false, name: "New User" } });
    await prisma.authIdentity.create({ data: { userId: u2.id, provider: "PHONE", providerScope: "GLOBAL", providerUserId: "13800000777" } });
    expect(u2.id).not.toBe(u1.id);
    expect(await prisma.user.count()).toBe(2);
  });
});
```

- [ ] **步骤 9.4：写 `pii-ops-action-log-payload.test.ts`**

```ts
import { describe, it, expect } from "vitest";

// Plan 6 红线 #1: OpsActionLog.payload 不可含任何 PII；字段白名单严格枚举。

const PII_REGEX = /(\d{11}|wx_[a-zA-Z0-9]+|stem_md|raw_body|outPath|C:\\\\|\/Users\/|\/home\/)/;

const DEACTIVATE_PAYLOAD_KEYS = new Set(["scrubbed", "deleted", "dryRun"]);
const EXPORT_PAYLOAD_KEYS = new Set(["exportSizeBytes", "recordCounts", "outputWritten"]);
const GC_PAYLOAD_KEYS = new Set(["results", "bucket", "nowAt"]);

function assertNoPii(payload: unknown) {
  const json = JSON.stringify(payload);
  expect(json).not.toMatch(PII_REGEX);
}

function assertWhitelist(payload: object, allowed: Set<string>) {
  for (const k of Object.keys(payload)) {
    expect(allowed.has(k)).toBe(true);
  }
}

describe("OpsActionLog.payload no-PII regex 守门", () => {
  it("DEACTIVATE_USER: scrubbed/deleted/dryRun only", () => {
    const payload = {
      scrubbed: { sessions: 3, topupOrders: 2, modelCalls: 1, kpAliases: 0, kpReconcileMatches: 0, authIdentities: 1, otpRequests: 1 },
      deleted: { errorBookEntries: 4, variantGroups: 1, variantItems: 1, userAdhocQuestions: 2 },
      dryRun: false,
    };
    assertNoPii(payload);
    assertWhitelist(payload, DEACTIVATE_PAYLOAD_KEYS);
  });

  it("EXPORT_USER_DATA: exportSizeBytes/recordCounts/outputWritten only", () => {
    const payload = { exportSizeBytes: 12345, recordCounts: { authIdentities: 2, modelCalls: 5 }, outputWritten: true };
    assertNoPii(payload);
    assertWhitelist(payload, EXPORT_PAYLOAD_KEYS);
  });

  it("GC_SWEEP_*: results/bucket/nowAt only", () => {
    const payload = { results: [{ table: "otp_requests", affected: 10, dryRun: false }], bucket: "short", nowAt: "2026-06-01T00:00:00Z" };
    assertNoPii(payload);
    assertWhitelist(payload, GC_PAYLOAD_KEYS);
  });

  it("phone PII catch: 11 digits flagged", () => {
    expect(() => assertNoPii({ note: "13800000123" })).toThrow();
  });

  it("openid PII catch: wx_ prefix flagged", () => {
    expect(() => assertNoPii({ note: "wx_abcXYZ123" })).toThrow();
  });

  it("Windows path catch: backslash prefix flagged", () => {
    expect(() => assertNoPii({ outPath: "C:\\Users\\admin\\export.json" })).toThrow();
  });

  it("Unix path catch: /Users/ or /home/ prefix flagged", () => {
    expect(() => assertNoPii({ note: "/Users/admin/export.json" })).toThrow();
    expect(() => assertNoPii({ note: "/home/admin/export.json" })).toThrow();
  });
});
```

- [ ] **步骤 9.5：next build + playwright 测试**

```powershell
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test support-deactivate-page.spec.ts
```

期望：next build exit 0；E2E 1 测例通过。

- [ ] **步骤 9.6：跑 2 个新 unit/integration + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deleted-user-relogin.test.ts tests/unit/pii-ops-action-log-payload.test.ts
Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse
```

期望全过 + 0 it.todo。

- [ ] **步骤 9.7：commit**

```powershell
git add apps/web/app/\(public\)/support/deactivate/page.tsx apps/web/e2e/support-deactivate-page.spec.ts apps/web/tests/integration/pii-deleted-user-relogin.test.ts apps/web/tests/unit/pii-ops-action-log-payload.test.ts
git commit -m "feat(web): Plan 6 Task 9 — /support/deactivate static page + E2E (PIPL Art 45/47 + minor guardian + no refund promise) + relogin test + payload regex unit test"
```

---

## Task 10：外部 scheduler 文档

> **为什么先做：** 配方文档独立于代码；先落避免 prod ship 时缺。

**Files：**
- Create: `docs/ops/pii-scheduling.md`

- [ ] **步骤 10.1：新建 `docs/ops/pii-scheduling.md`**

````markdown
# PII GC 外部 scheduler 配方

智教 Plan 6 PII 治理的 GC sweeps 不内嵌 cron，由 OPS 通过外部 scheduler 触发 CLI。本文档给出 Windows / Linux / k8s 三种环境的配置模板。

## Windows Task Scheduler（开发机 / 单台服务器）

任务名：`zhijiao-pii-gc-sweep`

频率建议：每日 03:00。

PowerShell 创建任务（管理员权限）：

```powershell
$action = New-ScheduledTaskAction `
  -Execute "pwsh.exe" `
  -Argument "-NoProfile -Command `"Set-Location D:\智教; pnpm.cmd --filter @zhijiao/web pii:gc-sweep`"" `
  -WorkingDirectory "D:\智教"

$trigger = New-ScheduledTaskTrigger -Daily -At 3:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable

Register-ScheduledTask -TaskName "zhijiao-pii-gc-sweep" -Action $action -Trigger $trigger -Settings $settings -Description "智教 PII GC 每日 03:00 跑一遍 all bucket"
```

日志输出位置（Task Scheduler 默认走 Event Log；建议 redirect 到文件）：

```powershell
# Modified -Argument 加输出 redirect
-Argument "-NoProfile -Command `"Set-Location D:\智教; pnpm.cmd --filter @zhijiao/web pii:gc-sweep *>> C:\Logs\zhijiao-pii-gc.log`""
```

## Linux cron / systemd timer

cron 行：

```cron
0 3 * * * cd /opt/zhijiao && /usr/local/bin/pnpm --filter @zhijiao/web pii:gc-sweep >> /var/log/zhijiao-pii-gc.log 2>&1
```

systemd timer（推荐）：

```ini
# /etc/systemd/system/zhijiao-pii-gc.service
[Unit]
Description=智教 PII GC sweep
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/opt/zhijiao
ExecStart=/usr/local/bin/pnpm --filter @zhijiao/web pii:gc-sweep
StandardOutput=append:/var/log/zhijiao-pii-gc.log
StandardError=inherit
User=zhijiao
```

```ini
# /etc/systemd/system/zhijiao-pii-gc.timer
[Unit]
Description=智教 PII GC daily timer

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

启用：`systemctl enable --now zhijiao-pii-gc.timer`

## k8s CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: zhijiao-pii-gc-sweep
spec:
  schedule: "0 3 * * *"
  successfulJobsHistoryLimit: 7
  failedJobsHistoryLimit: 14
  jobTemplate:
    spec:
      backoffLimit: 3
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: pii-gc
              image: zhijiao-web:latest
              command: ["pnpm", "--filter", "@zhijiao/web", "pii:gc-sweep"]
              env:
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: zhijiao-db
                      key: url
                # PII_RETENTION_* 可在此覆盖默认 30/90/180
```

## 频率建议

- **short bucket（30d 阈值）**：每日跑 1 次
- **medium bucket（90d 阈值）**：每周跑 1 次
- **orphan bucket（180d 阈值）**：每月跑 1 次
- **偷懒**：每日 `--bucket all`，多扫的代价是几个 SQL count，不算热路径

按 bucket 拆分调度（k8s 三个 CronJob 各自频率）能减少 DB IO，但配置成本更高。早期单 dev 用每日 all 即可。

## OPS 跑后看什么

```powershell
pnpm.cmd --filter @zhijiao/web exec tsx -e "import('@prisma/client').then(({PrismaClient})=>{const p=new PrismaClient();p.opsActionLog.findMany({where:{kind:{startsWith:'GC_SWEEP'}},orderBy:{createdAt:'desc'},take:5}).then(rs=>console.log(JSON.stringify(rs,null,2))).finally(()=>p.$disconnect())})"
```

## 故障排查

- CLI exit 1 + plain `Error`：DB 内没 OPS/ADMIN user；export `OPERATOR_USER_ID=<ckxxx>` 显式指定（必须是 OPS/ADMIN role 的 userId）
- `pii:gc-sweep` 跑了但 affected 持续=0：先 `--dry-run` 看预估；如确实 0，说明 retention 阈值内无符合条件的行（小数据量 dev 环境正常）
- 单批 hasMore=true 持续触发：MAX_BATCHES=10 兜底（hardcoded），OPS 跑完后 manually 查询确认；超量时拉数据规模 alert 而非加 batch
````

- [ ] **步骤 10.2：commit**

```powershell
git add docs/ops/pii-scheduling.md
git commit -m "docs(ops): Plan 6 Task 10 — PII GC 外部 scheduler 配方（Windows Task / systemd / k8s CronJob）"
```

---

## Task 11：全量回归 + CLAUDE.md 更新 + Merge

**Files：**
- Modify: `CLAUDE.md`

- [ ] **步骤 11.1：全量回归**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望 4 项全绿。

- [ ] **步骤 11.2：smoke 收尾（与 Plan 9 §7.3 工艺一致）**

```powershell
pnpm.cmd --filter @zhijiao/web pii:gc-sweep --dry-run
# 期望：所有 sweeper affected=0（dev DB 没历史 PII），CLI exit 0
```

- [ ] **步骤 11.3：CLAUDE.md "## 开始实现时（已落地）" 加 Plan 6 条目**

在 Plan 9 条目之后追加：

```markdown
- **Plan 6**（PII 治理：用户注销 + 数据导出 + 5 个 GC sweeper + OpsActionLog 审计；PIPL Art 45/47 + 税务永久 bucket）—— 见 `docs/superpowers/plans/2026-05-26-pii-governance.md`，spec 在 `docs/superpowers/specs/2026-05-26-pii-governance-design.md`
```

- [ ] **步骤 11.4：CLAUDE.md "知识点结构化现状（Plan 9）" 段之后加 "PII 治理现状（Plan 6）"**

```markdown
**PII 治理现状**（Plan 6）：
- `User.deletedAt` + `deactivationReason` 软删；`prisma.user.delete()` 不应再被业务代码调用（ErrorBookEntry.user Restrict 作护栏）；注销走 `apps/web/server/lib/pii-governance.ts` 的 `deactivateUser`
- `deactivateUser` 12 步序：preconditions → phone 提取（PHONE+GLOBAL only）→ 硬删 ErrorBookEntry/VariantGroup（新 Cascade）/VariantItem/USER_ADHOC Question → AuthIdentity 删 → OtpRequest by phone 删 → Session 7.1 active revoke + 7.2 全量擦 PII（含历史 revoked）→ TopupOrder ip/ua 擦 → ModelCall.userId set null → KpAlias/KpReconcileMatch SetNull → User scrub + tombstone → OpsActionLog 写入；单 `$transaction` 包，任意一步抛错全 rollback；幂等 alreadyDeactivated 短路
- `dryRun=true` 走 `previewDeactivateUser` 纯读路径，0 写 0 OpsActionLog；与 actual 路径共享 where 条件构造
- `exportUserData` 出 JSON：User / AuthIdentity 摘要（providerUserIdMasked / unionIdMasked）/ Wallet / CreditLedger / TopupOrder（无 ip/ua）/ ErrorBookEntry（仅 ACTIVE/ARCHIVED）/ USER_ADHOC Question / ModelCall 5 字段摘要；显式排除 rawBody / requestJson / responseJson / errorMessage / ipCreated / userAgent；CLI 写本地文件并 chmod 0600（Windows best-effort）；OpsActionLog payload 不写 outPath
- `sweepPii` 5 个 sweeper 分 3 bucket：short(30d) OtpRequest 用 `COALESCE(consumedAt, expiredAt, expiresAt)` + Session 用 `COALESCE(revokedAt, expiresAt)`；medium(90d) WechatPayEvent.rawBody 用 `$executeRaw` UPDATE CTE + TopupOrder ip/ua 用 ID-list updateMany；orphan(180d) 孤儿 TopupOrder 用 `$queryRaw` DELETE CTE + RETURNING count；每 sweeper LIMIT 10000 + hasMore；CLI 续跑 MAX_BATCHES=10 兜底
- `WechatPayEvent.rawBody` schema 改可空（原非空），让 sweep #3 能 set null
- `VariantGroup.entry` onDelete: Restrict → Cascade（仅此 1 处；让 ErrorBookEntry hard-delete 链通畅）；ErrorBookEntry.user 保持 Restrict 作误删 User 护栏
- `OpsActionLog` payload 严格白名单：`DEACTIVATE_USER`{scrubbed,deleted,dryRun} / `EXPORT_USER_DATA`{exportSizeBytes,recordCounts,outputWritten} / `GC_SWEEP_*`{results,bucket,nowAt}；regex 守门不含 phone/openid/path
- `USER_DEACTIVATED` 加进 `AUTH_ERROR_REASONS` (packages/auth) + `AuthError` union (apps/web/server/context.ts)；`createContext` 扩 `deletedAt` select + auth=null short circuit；refresh route `rotateSession` 后查 deletedAt 非空清 cookies；`issueSessionAndCookies` 入参校验（防御性）
- `resolveOperatorUserId()` + `buildInitiatorRef()` 抽到 `apps/web/server/lib/operator.ts`（从 Plan 9 `kp-reconcile.ts` 抽出复用，env 覆盖也校验 OPS/ADMIN role）；env 改名 `KP_REVIEW_USER_ID` → `OPERATOR_USER_ID`（如本地 `.env` 设过老名需手动改）；Plan 9 `kp:review` CLI / `kp-reconcile-reviewer-resolution.test.ts` 调用点同步迁移
- 静态页 `/support/deactivate`：4 处 PLACEHOLDER 待 ICP 备案后改 PR；探针 35 阻断含 placeholder 上 prod
- 3 个 OPS CLI：`user:deactivate <userId> [--reason] [--dry-run]` / `user:export <userId> --out <path>` / `pii:gc-sweep [--bucket short|medium|orphan|all] [--dry-run] [--now ISO]`
- 4 个 env：`PII_RETENTION_SHORT_DAYS=30 / MEDIUM=90 / ORPHAN_TOPUP=180 / FINANCIAL_RECORD_RETENTION_DAYS=null`（null 表示不自动删，避免在代码里写死"永久"的法律判断）；refine: medium > short、orphan > medium
- 外部 scheduler 配方见 `docs/ops/pii-scheduling.md`（Windows Task Scheduler / Linux systemd timer / k8s CronJob）；不内嵌 cron

**Plan 6 未完成的事 —— 等后续 plan**：
- 自助注销 mutation `auth.deactivate` + `/profile/deactivate` 表单（真用户上量后）
- 真用户身份核验自动化（短信 OTP 二次确认）
- 未成年人 <14 vs 14-17 精准建模 + parent guardian linkage → Plan 14
- Web `/ops/pii-actions` 页面查 OpsActionLog
- cron 自动触发 GC sweep（当前外部 scheduler 已够；真上量再加）
- `FINANCIAL_RECORD_RETENTION_DAYS` 非 null 时的财务 sweeper（等真合规意见到位）
```

- [ ] **步骤 11.5：CLAUDE.md "Merge 后必跑" 加 7 条新探针 35-41**

```markdown
35. **静态页 placeholder 不上 prod**（Plan 6 §6.1 / 红线 R4）：`Select-String -Path apps/web/app/\(public\)/support/deactivate/page.tsx -Pattern "XXXXX|\.example|`"运营主体：XXXXX`""`命中即阻断 prod ship（ICP 备案前必填实际公众号 + 邮箱 + 主体 + 备案号）
36. **VariantGroup.entry Cascade 落库**（Plan 6 §2.2）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d variant_groups"` 应见 `variant_groups_entry_id_fkey ... ON DELETE CASCADE`；不是 NO ACTION 也不是 RESTRICT
37. **WechatPayEvent.rawBody 可空**（Plan 6 §2.3）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d wechat_pay_events"` 的 `raw_body` 行**不**带 "not null"
38. **`prisma.user.delete()` 0 命中业务代码**（Plan 6 红线 #8）：`Select-String -Path apps/web/server,packages/billing/src,packages/auth/src -Pattern "user\.delete\(|users\.delete\("` 应 0 命中（仅测试代码可使用——其位置在 `tests/` / `test-utils/` 下）；未来误调用直接命中 ErrorBookEntry.user Restrict 抛错
39. **USER_DEACTIVATED 在 2 处 AuthError union**（Plan 6 §2.6）：`Select-String -Path packages/auth/src/errors.ts,apps/web/server/context.ts -Pattern "USER_DEACTIVATED"` 每文件 ≥1 命中
40. **OpsActionLog payload regex 守门**（Plan 6 红线 #1 / R1）：`pnpm.cmd --filter @zhijiao/web test -- tests/unit/pii-ops-action-log-payload.test.ts` 应 7 测例全绿；payload 无 phone/openid/path/字段名等任一字面值
41. **pii:gc-sweep CLI smoke**（Plan 6 §11.2）：`pnpm.cmd --filter @zhijiao/web pii:gc-sweep --dry-run` 应 exit 0；干净 dev DB 期望所有 sweeper affected=0
```

- [ ] **步骤 11.6：CLAUDE.md "下一步候选 Plan" 移走 Plan 6 + 候选重排**

把现有 "下一步候选 Plan" 段改为：

```markdown
**下一步候选 Plan**（Plan 4 + Plan 6 + Plan 8 + Plan 9 已落地）：
- Plan 5: 真接阿里云 SMS + 微信公众号（ICP 备案通过后；**且 Plan 2 Hardening 必须先 ship**；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
- Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 商户证书；激活 `RealWechatPayAdapter.unifiedOrder` + `verifyNotify`）—— **Plan 3 prod ship prereq**
- Plan 10: 教师端"分层作业"基于错题本扩展（教师可看班级错题热度图，按错因 / KP 分类布置分层作业 —— **Plan 9 接通后**有 KP id 数据可用）
- Plan 11: 学情画像 / 趋势报告（学生掌握度 + 薄弱点 + 趋势画像；家长简版报告 —— **Plan 9 接通后**有 KP id 数据可用）
- Plan 12: 题库去重 / PUBLISHED 复用 / 统计归并 + VariantItem 升格为独立 Question（Plan 8 §6.2 + Plan 9 §10.3 punt）
- Plan 13: KP 树扩充（small / middle / high school math KP curation；当前 seed 仅 4 个 math KP，alias 表长得慢，Plan 9 上线一段时间后 UNMATCHED → DROPPED 比例高）
- Plan 14: 未成年人保护专项（<14 vs 14-17 精准建模 + parent guardian linkage + 监护人代发起注销自动化）
```

- [ ] **步骤 11.7：最后一次全量回归**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望全绿。

- [ ] **步骤 11.8：commit**

```powershell
git add CLAUDE.md
git commit -m "docs(claude): Plan 6 Task 11 — Plan 6 landed + Merge probes 35-41 + candidates updated (Plan 14 added)"
```

回主仓 master，按 [[zhijiao-merge-workflow]] memory 工艺 merge：

```powershell
# 主仓 master 上
git switch master
git merge --no-ff plan-6-pii-governance -m "Merge plan-6-pii-governance: PII 治理 (Plan 6) — PIPL Art 45/47 合规收口"
git worktree remove .claude/worktrees/plan-6-pii-governance   # Windows path-too-long 可失败，留空壳
git worktree prune
git branch -d plan-6-pii-governance
```

Merge 后必跑 CLAUDE.md "Merge 后必跑" 全部探针（含新加 35-41）。

**注意（Plan 8/9 merge 经验，已固化为探针 29）：** Plan 6 加了新 Prisma 字段 + 新 model + onDelete 改 + nullable 改，主 worktree merge 后必须先：

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
```

再跑 typecheck，否则 stale Prisma Client 会在 typecheck 报找不到 `opsActionLog / user.deletedAt / wechatPayEvent.rawBody as string | null`。

---

## 完成条件

- [ ] 所有 Task 1-11 步骤勾完
- [ ] `pnpm.cmd exec turbo typecheck --force` 全绿
- [ ] `pnpm.cmd exec turbo test --force` 全绿（含 Plan 6 新加 14 测试）
- [ ] `pnpm.cmd --filter @zhijiao/web exec next build` exit 0
- [ ] `pnpm.cmd --filter @zhijiao/web exec playwright test` 全绿（含 `support-deactivate-page.spec.ts`）
- [ ] CLAUDE.md 加 Plan 6 条目 + "PII 治理现状" 段 + Merge 探针 35-41 + 候选 Plan 重排（含 Plan 14）
- [ ] **Task 5 关键守门**：`pii-deactivate-user.test.ts` 验证 Session 7.1+7.2 历史 revoked 也擦 PII；`pii-deactivate-user-tx-atomicity.test.ts` 验证 D 步骤抛错全 rollback
- [ ] **Task 6 反向断言**：`pii-export-user-data.test.ts` 用 regex `not.toMatch(/rawBody|requestJson|...)` 守门，不用 `.includes`
- [ ] **Task 7 关键守门**：`pii-gc-sweep-short.test.ts` 覆盖 OtpRequest 4 形态 + Session 3 形态；`pii-gc-sweep-orphan.test.ts` 覆盖 NOT EXISTS CreditLedger 守门
- [ ] **Task 9 红线**：E2E 含 PIPL Art 45/47 + 监护人提示 + 不含退款承诺；payload regex 测试 7 测例全绿
- [ ] **`Select-String apps/web/tests,packages/auth/tests -Pattern "it\.todo" -Recurse` 0 命中**
- [ ] **Prisma migration checksum 一致**：`prisma migrate status` 输出 `Database schema is up to date!`
- [ ] **`prisma.user.delete()` 0 命中业务代码**（探针 38）：grep 命中应仅在 `tests/` / `test-utils/` 下
- [ ] Merge commit message 引用 spec 路径

---

## 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| Schema 改动 `prisma migrate dev --create-only` 报缺 opposite relation | Task 1 步骤 1.2 失败 | 检查 `User` 加的 2 个反向 relation（`initiatedOpsActions` + `opsActionLogs`）名字与 `OpsActionLog @relation` 命名匹配 |
| `VariantGroup.entry` onDelete: Cascade 后既有业务代码意外触发删除链 | Task 1 步骤 1.6 typecheck 通过但 turbo test 有 entry 相关测例红 | `grep -rn "errorBookEntry.delete" apps/web packages` 确认调用点都期望 cascade；目前预测 0 命中（注销路径 Task 5 是唯一新加） |
| `WechatPayEvent.rawBody` 改 nullable 后既有读取代码报类型错 | Task 1 步骤 1.6 typecheck 红 | `grep -rn "rawBody\." packages/billing apps/web` 找读取点；加 `?? ""` 或 `?.length ?? 0` 防御 |
| `createContext` 加 deletedAt 查询导致性能微影响 | 实际 prod 无可测；dev 0 用户场景 | 已在 `findUnique({ select: { isMinor, deletedAt } })` 同一 query 加字段，无额外 round trip |
| 注销 tx 太长（12 步）超 `idle_in_transaction_timeout` | 用户内容 >10k 行 | 当前 0 用户不存在；未来出现走分批拆 tx，跳出单 `$transaction` 约束（spec §6.3） |
| `$queryRaw` CTE + RETURNING 在某些 Postgres 16 版本表现异常 | Task 7 步骤 7.4 orphan 测试红 | 改回"先 findMany 后 deleteMany"两段式（多一次往返，但 Prisma 原生支持）|
| `resolveOperatorUserId` rename 后 Plan 9 callers 报缺 | Task 3 步骤 3.6 测试红 | Task 3.4 + 3.5 把 `kp-review.ts` + 既有 reviewer-resolution 测试的 `resolveReviewerUserId` 调用 + import path + `KP_REVIEW_USER_ID` env 字面值全部同步改名；commit 前 `Select-String -Path apps/web -Pattern "resolveReviewerUserId\|KP_REVIEW_USER_ID" -Recurse` 应 0 命中 |
| E2E `support-deactivate-page.spec.ts` 因 placeholder 仍在但探针 35 阻断 | Task 11 步骤 11.1 playwright 红 | 测试本意就是验 placeholder 仍在；红线 R3 不含退款字串才是阻断点。如 E2E 红→检查测试 expect 而非 Code |
| Prisma client stale 导致 typecheck 报找不到 `opsActionLog / deletedAt / rawBody` 类型 | Merge 后跑 typecheck 红 | 沿用 Plan 8/9 merge 经验（探针 29）：先 `pnpm.cmd --filter @zhijiao/db db:generate` 再 typecheck |
| env validator: `PII_RETENTION_MEDIUM_DAYS ≤ SHORT` 或 `ORPHAN_TOPUP ≤ MEDIUM` | Task 2 步骤 2.3 env 测例红 | env.ts superRefine 顺序：把两条 refine issue.addIssue 在 schema parse 之后调用；测试已守门 |
| `pii:gc-sweep` 在干净 dev DB 上跑出 affected=0 但 OpsActionLog 仍写 N 条 | Task 8 步骤 8.5 smoke 期望 vs 实际偏差 | 这是 expected：non-dryRun 每 bucket 写一条 OpsActionLog，dryRun 不写。OPS 文档（Task 10 步骤 10.1）说明可重新检查 OpsActionLog count |
| ModelCall.userId 在新建用户时被错误依赖（认为非空） | Task 5 commit 后 turbo test 有 modelCall.userId 强制非空的代码 | grep `modelCall.userId` 使用点：当前已是 String? null OK；Plan 6 让其更"经常 null"，无 breaking change |
| 静态页 placeholder 探针 35 在 prod ship 时阻断 | 探针 35 命中 | OPS 在 ICP 备案落地后改 page.tsx 替换 4 处常量；CLAUDE.md 红线"placeholder 阻断"是设计意图 |

---

## 附录：与 Plan 4 / Plan 8 / Plan 9 工艺一致性

| 工艺 | Plan 4 / 8 / 9 来源 | Plan 6 沿用 |
|---|---|---|
| middleware 显式 chain 顺序 | Plan 4 §4.2 / Plan 8 §3.1 | N/A（Plan 6 不引入新 middleware；guard 在 createContext / refresh route 直插）|
| `chargeMiddleware(kind)` factory | Plan 4 Task 3 | N/A（Plan 6 不计费）|
| `migrate dev --create-only` → 浏览 SQL → `migrate dev` | Plan 4 / 8 / 9 Task 1 | 一致（Task 1 步骤 1.2-1.3）|
| P2002 catch → no-op 幂等 | Plan 8 `upsertUserAdhocQuestion` | N/A（Plan 6 无 unique 约束撞车场景；幂等靠 `alreadyDeactivated` 短路）|
| 每个 task 一个 commit + 引用 task 编号 | Plan 4 / 9 红线 #14 | 一致 |
| `pnpm.cmd`（PowerShell execution policy）| Plan 4 / 9 红线 #15 | 一致 |
| Vitest `it.todo` / 空 body 防御 | Plan 4 / 8 / 9 | 一致（每 task commit 前 grep）|
| `next build` 是 UI task 的 commit prereq | Plan 4 Task 6 followup | 一致（Task 9 步骤 9.5）|
| 收尾走 `zhijiao-merge-workflow`（无 GitHub remote）| Plan 4 / 8 / 9 Task 8/11 | 一致（Task 11 步骤 11.8）|
| Spec 是真理来源 + plan 引用章节号 | Plan 4 / 8 / 9 | 一致 |
| OPS 操作走 CLI 不走 Web | Plan 9 新工艺 | 一致（3 个 CLI）|
| 中文输出 | Plan 4 / 8 / 9 | 一致 [[zhijiao-chinese-default]] |
| `resolveOperatorUserId()` env 覆盖也校验 OPS/ADMIN role | Plan 9 hotfix `2f094a6` | 一致（复用同一 helper，从 kp-reconcile.ts 抽出）|
| 服务层接口写成可被未来 Web 包形式 | Plan 9 §1 / [[zhijiao-single-dev-no-ops-ui]] | 一致 |
| Plan merge 后必跑 `db:generate` | Plan 8 merge 经验（探针 29）| 一致（Task 11 步骤 11.8 末段）|
| 收尾运行 smoke（与 Plan 9 §7.3 / 收尾运行工艺一致）| Plan 9 | Plan 6 用 `pii:gc-sweep --dry-run` 一遍验证 schema/predicate（Task 11 步骤 11.2）|
