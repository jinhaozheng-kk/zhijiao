# Plan 14b：DSAR 数据主体请求 + SLA 设计

> 状态：设计已与用户逐节确认（2026-05-31）。实现计划见后续 `docs/superpowers/plans/`。

## 1. 目标与定位

依据《个人信息保护法》第 45 条（查阅/复制权）与第 47 条（删除权），把当前**纯人工**的数据主体请求（DSAR）流程升级为**登录用户可在站内发起 + 工单化 SLA 追踪 + OPS CLI 履行**。

复用 Plan 6 已有原语 `exportUserData` / `deactivateUser` / `previewDeactivateUser`，不重写履行逻辑。遵循"单运营者 → OPS 走 CLI 不做 Web 后台"的项目约定：用户侧是 Web 自助入口，运营侧是 CLI。

**履行模型（hybrid，已确认）：**
- **数据副本（EXPORT）** —— 自助即时：登录用户点按钮 → 同步跑 `exportUserData` → 浏览器下载 JSON。仅限频，不需 OPS 介入。
- **注销（DELETION）** —— 工单化：用户经**新 OTP 重验**发起一条 `PENDING` 工单（**可自撤**），OPS 经 CLI 审核后执行 `deactivateUser`。不可逆，故走人工闸门。

两类都记入 `DsarRequest` 表并带 SLA 时钟（`dueAt`）。

## 2. 数据模型

新增 `DsarRequest` 表（数据主体发起，区别于运营发起的 `OpsActionLog`）：

```prisma
enum DsarRequestType   { EXPORT  DELETION }
enum DsarRequestStatus { PENDING  COMPLETED  REJECTED  CANCELED }

model DsarRequest {
  id             String  @id @default(cuid())
  userId         String  @map("user_id")
  type           DsarRequestType
  status         DsarRequestStatus @default(PENDING)
  isMinor        Boolean @default(false) @map("is_minor")  // 发起时快照（ctx.auth）
  reason         String?                                   // 用户自填（注销）；deactivate 时 scrub
  requestedAt    DateTime @default(now()) @map("requested_at")
  dueAt          DateTime @map("due_at")                   // requestedAt + 15 工作日
  resolvedAt     DateTime? @map("resolved_at")
  resolvedByRef  String?  @map("resolved_by_ref")          // "self" | 运营 initiatorRef
  resolutionNote String?  @map("resolution_note")          // OPS 驳回/完成备注
  createdAt      DateTime @default(now()) @map("created_at")
  user           User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([status, dueAt])
  @@index([userId])
}
```

`User` 加反向关系 `dsarRequests DsarRequest[]`。`onDelete: Cascade` 仅在 User 行被**硬删**时触发；注销走的是 soft-delete（置 `deletedAt`、scrub 字段、保留行），故 DsarRequest 行随用户 tombstone 一并保留（审计需要）。

**状态机：**
- **EXPORT** —— 出生即 `COMPLETED`（同步履行；`dueAt = resolvedAt = requestedAt = now`，`resolvedByRef = "self"`）。纯审计记录。
- **DELETION** —— `PENDING` →（OPS）`COMPLETED` |（OPS）`REJECTED` |（用户）`CANCELED`。终态不可再转。

**SLA：** 纯函数 `addWorkingDays(date, n)` 跳过周六周日（法定节假日忽略，作为已记录的近似；与 `/support/deactivate` 已承诺的"15 个工作日"一致）。`dueAt = addWorkingDays(requestedAt, 15)`。

发起 DELETION 工单**不锁定/降级账号** —— 在 OPS 执行前账号照常可用、可继续扣费，用户可随时撤销。

## 3. OTP 重验基础设施扩展

复用 `packages/auth/src/otp.ts`。两处改动：

1. `OtpPurpose` 枚举（`schema.prisma`）+ `IssueOtpInput.purpose` 联合类型加 `DSAR_DELETION`。
2. **`verifyOtp` 加可选 `purpose` 过滤**（向后兼容）：现签名 `verifyOtp(prisma, phone, code, pepper)` 不按 purpose 限定，会让 LOGIN 验证码也能授权注销。改为 `verifyOtp(prisma, phone, code, pepper, purpose?)`；传入时查询 `where: { phone, purpose, ... }` 限定。LOGIN 路径不传 purpose → 行为不变（零回归）。DSAR 路径传 `DSAR_DELETION` → 只认 DSAR 发的码。

## 4. 用户侧接口（tRPC `dsar` router）

**合规红线：`dsar.*` 全部用裸 `authedProcedure`，绝不挂 `requireGuardianConsent`**（与 `auth.*` / `family.*` 同列白名单）。数据主体权利不能被 `GUARDIAN_CONSENT_REQUIRED` 门禁挡住，否则 PENDING-consent 的 `<14` 用户连导出/注销都做不了，本身违规。`dsar: dsarRouter` 注册进 `_root.ts`。

procedure（全部错误用 `cause: { reason }` 约定）：

1. **`dsar.exportMine`** (mutation，限频 fail-open)
   - 新增 `RULE_DSAR_EXPORT`（`packages/auth/src/ratelimit/rules.ts`，`failMode: "open"`）。per-user(`ctx.auth.userId`) + per-IP(`ctx.ip`) 各取一次。fail-open：限频后端挂时 `takeRule` 内部吞掉 `RateLimitBackendDownError` 返回 allowed（导出是权利，不该因 Redis 挂而阻断）。
   - 限频通过 → `exportUserData(ctx.db, userId)` → 同事务建 `DsarRequest(type=EXPORT, status=COMPLETED, requestedAt=dueAt=resolvedAt=now, resolvedByRef="self")` → 返回 `{ export, requestId }`。
   - 客户端把 `export` JSON 转 Blob 触发下载（`zhijiao-data-<userId 前缀>-<date>.json`）。

2. **`dsar.sendDeletionOtp`** (mutation，限频)
   - 取本人 `PHONE/GLOBAL` AuthIdentity 手机号；复用既有 `RULE_OTP_SEND_PHONE` + `RULE_OTP_SEND_IP`（fail-close）→ `issueOtp({ purpose: "DSAR_DELETION", ... })`。
   - E2E 下同样写 `e2e:last-otp:<phone>`（复用既有 hook）。
   - **WeChat-only 无手机号** → `PRECONDITION_FAILED / DSAR_NO_PHONE`，前端引导到 `/support/deactivate` 人工渠道（本 plan 不造无 OTP 的替代验证）。

3. **`dsar.requestDeletion`** (mutation)
   - 入参 `{ otpCode: string, reason?: string }`。先 `RULE_OTP_VERIFY_PH`（复用）→ `verifyOtp(..., "DSAR_DELETION")`；失败映射 `BAD_REQUEST / OTP_INVALID|OTP_EXPIRED|OTP_MAX_ATTEMPTS`，不建工单。
   - **幂等**：已有本人 open `PENDING` DELETION → 返回它，不重复建。
   - 否则建 `DsarRequest(type=DELETION, status=PENDING, isMinor=<ctx.auth.isMinor || guardianConsentStatus!=="NOT_REQUIRED" 快照>, dueAt=addWorkingDays(now,15), reason)`。

4. **`dsar.cancelDeletion`** (mutation)
   - 本人 open `PENDING` DELETION → `CANCELED`（`resolvedByRef="self"`, `resolvedAt=now`）。无 open → `NOT_FOUND / DSAR_NOT_FOUND`（不泄露存在性，沿用项目惯例）。

5. **`dsar.myRequests`** (query) —— 列本人全部请求（type/status/requestedAt/dueAt/resolvedAt），供页面展示。

**Service 层** `apps/web/server/lib/dsar.ts`：`createExportRequest` / `createDeletionRequest` / `cancelDeletionRequest` / `listRequests` / `fulfillDeletion` / `rejectDeletion` / `addWorkingDays`（纯函数）。router 与 CLI 共用。

## 5. 用户侧 UI

**页面 `apps/web/app/account/privacy/page.tsx`**（persona-neutral，**不**放 `(student)` 组；teacher/parent 同享 DSAR 权利）。server component + `privacy-view.tsx`（`"use client"`）。

**中间件**：`apps/web/middleware.ts` 的 `PROTECTED_PREFIXES` 加 `/account`（当前只含 `/profile,/error-book,/teacher,/parent,/admin`）。注：middleware 只查 cookie 存在性（edge 读不到 DB），真鉴权在 tRPC 层。

三块（中文文案）：
- **下载我的数据副本** —— 按钮 → `exportMine` → Blob+anchor 下载（本仓库首个下载实现）。附 PIPL 第 45 条说明。错误用 `data-testid="dsar-export-error"`。
- **申请注销账号** —— 折叠：`sendDeletionOtp` 发码（`dsar-send-otp`）→ 填码 `dsar-otp-code` + 可选原因 → `requestDeletion`（`dsar-delete-submit`）。已有 PENDING 时显示"处理中 + 预计完成 `dueAt` + 撤销按钮 `dsar-delete-cancel`"。PIPL 第 47 条 + 不可逆警告 + 无手机号引导。
- **我的请求记录** —— `myRequests` 列表。

OTP UI 镜像既有 `OtpForm.tsx`（testid 风格、resend 冷却）。错误展示沿用 `className="text-red-600 text-sm"` + `data-testid="dsar-*-error"`。`/support/deactivate` 静态页保留，加一句"已登录用户可在 `/account/privacy` 自助办理"。

## 6. OPS CLI 工作流 + SLA 追踪

三脚本挂 `apps/web/scripts/`，骨架沿用 `user-deactivate.ts`（`#!/usr/bin/env tsx` + `loadCliEnv()` + `parseArgs` + `new PrismaClient()` + `resolveOperatorUserId` / `buildInitiatorRef`（`server/lib/operator.js`）+ `main().catch(exit 1)`）。从 `../server/lib/dsar.js` import service（**不**碰 `server-only`/`@/lib/ai-client`）。`package.json` 加 `"dsar:list" / "dsar:fulfill" / "dsar:reject": "tsx scripts/dsar-*.ts"`。

1. **`dsar:list [--status pending|all] [--overdue] [--type export|deletion]`** —— 队列视图（SLA 追踪主要落点）。默认列 `PENDING` DELETION；每行 `id/userId/type/isMinor/requestedAt/dueAt` + 逾期高亮（`now>dueAt`）。`--overdue` 只列逾期。不做通知/升级（单人 CLI 姿态，靠定期巡检）。
2. **`dsar:fulfill <id> [--dry-run] [--guardian-verified]`** —— 履行注销。守卫：工单须 `PENDING` 且 `DELETION`。**未成年闸门**：`isMinor=true` 而未带 `--guardian-verified` → 拒绝并提示需先核验监护人（落实"flag for OPS, guardian noted"决策）。履行：`$transaction` 内调 `deactivateUser`（写其 `DEACTIVATE_USER` OpsActionLog）+ 置工单 `COMPLETED/resolvedAt/resolvedByRef`。`--dry-run` 走 `previewDeactivateUser`，不落库不改工单。
3. **`dsar:reject <id> --note "..."`** —— `PENDING`→`REJECTED` + 必填 `resolutionNote` + `resolvedByRef`。

`resolvedByRef` 与履行时 `deactivateUser` 的 `OpsActionLog.initiatorRef` 同为 `cli:<host>:<user>`，两处可对账。EXPORT 工单不进 CLI 履行（自助即完成）；`dsar:list --type export` 仅供审计查阅。

## 7. PII 治理扩展（扩 Plan 6）

- **`deactivateUser` 事务内新增**：scrub 本人 `DsarRequest.reason = null`（用户自填可能含 PII），**保留行**（type/status/时间戳是"已在 SLA 内履行 DSAR"的合规证据）。计数计入 `DeactivatePayload.scrubbed.dsarRequests`（落在既有 `scrubbed` 键下，**不**新增 payload root key → `pii-ops-action-log-payload.test` 的 `DEACTIVATE_USER` ROOT_KEYS `["deleted","dryRun","scrubbed"]` 不变）。
- **`exportUserData` 新增 `dsarRequests` 白名单段**（type/status/requestedAt/dueAt/resolvedAt）。**不含** `reason`/`resolutionNote` 自由文本（resolutionNote 是 OPS 内部备注，不回流用户）。`schemaVersion` 字面值从 `"2026-05-26"` 升到 `"2026-05-31"`（line 37 接口 + line 384 返回处同步）。
- **payload 守词集新增** `dsar_reason` / `resolution_note`（`pii-ops-action-log-payload.test` 的 `FORBIDDEN_TEXT` 正则）。

## 8. 测试矩阵

- **纯单测**（`packages/?` 或 `apps/web/tests/unit`）：`addWorkingDays(date,15)` 跳周末（含起点周五跨周边界）；状态机转移合法性。
- **集成（web）** `tests/integration/dsar-*.test.ts`：
  - `exportMine`：返数据 + 建 COMPLETED EXPORT 工单 + 限频超额拒 + fail-open（后端挂仍放行）。
  - `requestDeletion`：无效 OTP 拒且不建工单；有效 OTP 建 PENDING + `dueAt` 正确 + `isMinor` 快照；幂等（二次返同一条）；**`<14` PENDING-consent 仍可建（白名单守门）**。
  - `cancelDeletion`：PENDING→CANCELED；无 open→NOT_FOUND；COMPLETED 不可撤。
  - `sendDeletionOtp`：无手机号→`DSAR_NO_PHONE`。
  - `verifyOtp` purpose 隔离：LOGIN 码不能验 DSAR、反之亦然（auth 包单测）。
- **OPS CLI 集成**：`fulfill` 跑 `deactivateUser` 并置 COMPLETED + 写两处 ref；`isMinor` 缺 `--guardian-verified` 拒；`reject` 必填 note；`--dry-run` 不落库；`list --overdue` 只列逾期。
- **PII**：`pii-deactivate-user.test` 断言 `reason` 被 scrub、行保留 + payload 计数；`pii-export-user-data.test` 含 `dsarRequests` 段不含自由文本 + schemaVersion 升版；`pii-ops-action-log-payload.test` 守新禁词。
- **E2E** `e2e/dsar.spec.ts`：登录 → `/account/privacy` → 下载数据副本（断言下载触发）；发起注销（发码→填码→提交）→ 见"处理中 + dueAt"→ 撤销 → 回到可再次申请。串行 + 复用 stagger login helper。

## 9. 文件结构

| 文件 | 责任 |
|---|---|
| `packages/db/prisma/schema.prisma` | `DsarRequest` 模型 + 2 枚举；`OtpPurpose` 加 `DSAR_DELETION`；`User.dsarRequests` 反向关系 |
| `packages/auth/src/otp.ts` | `IssueOtpInput.purpose` 加 `DSAR_DELETION`；`verifyOtp` 加可选 `purpose` 过滤 |
| `packages/auth/src/ratelimit/rules.ts` | `RULE_DSAR_EXPORT`（fail-open） |
| `apps/web/server/lib/dsar.ts` | service：create/cancel/fulfill/reject/list + `addWorkingDays` |
| `apps/web/server/routers/dsar.ts` | 5 个 procedure |
| `apps/web/server/routers/_root.ts` | 注册 `dsar` |
| `apps/web/server/trpc.ts` | `dsar.*` 白名单说明（沿用 authedProcedure，无需改 procedure 定义） |
| `apps/web/server/lib/pii-governance.ts` | scrub `reason`；export 加 `dsarRequests` 段；schemaVersion 升版 |
| `apps/web/app/account/privacy/{page,privacy-view}.tsx` | 用户侧三块 UI |
| `apps/web/middleware.ts` | `PROTECTED_PREFIXES` 加 `/account` |
| `apps/web/app/support/deactivate/page.tsx` | 加一句指向 `/account/privacy` |
| `apps/web/scripts/dsar-{list,fulfill,reject}.ts` + `package.json` | OPS CLI |
| 各 `tests/...` | 见 §8 |

## 10. 显式不做（YAGNI / punt）

- **PIPL 第 46 条更正权（rectification）**：本 plan 只做查阅/复制 + 删除两类，不做"更正"工单。
- **导出文件服务端落盘/异步生成/下载链接**：导出走同步内存返回 + 浏览器 Blob，不存服务端副本（避免再生 PII 落盘面）。
- **OPS Web 后台 / DSAR 通知与升级**：CLI + 定期巡检即可（单运营者）。
- **无手机号用户的站内替代验证**：WeChat-only 走人工渠道。
- **DSAR 工单本身的导出条目反向递归**：导出含 dsarRequests 段，但不含其它用户、不含内部备注。
