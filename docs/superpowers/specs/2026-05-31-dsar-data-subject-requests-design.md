# Plan 14b：DSAR 数据主体请求 + SLA 设计

> 状态：设计已与用户逐节确认（2026-05-31）。经 4 个 subagent 评审后修订（合规/安全/代码契合/计划质量）。实现计划见 `docs/superpowers/plans/2026-05-31-dsar-data-subject-requests.md`。

## 1. 目标与定位

依据《个人信息保护法》第 45 条（查阅/复制权）与第 47 条（删除权），把当前**纯人工**的数据主体请求（DSAR）流程升级为**登录用户可在站内发起 + 工单化 SLA 追踪 + OPS CLI 履行**。

复用 Plan 6 已有原语 `exportUserData` / `deactivateUser` / `previewDeactivateUser`，不重写履行逻辑。遵循"单运营者 → OPS 走 CLI 不做 Web 后台"的项目约定：用户侧是 Web 自助入口，运营侧是 CLI。

**履行模型（hybrid）：**
- **数据副本（EXPORT）** —— 自助即时：登录用户点按钮 → 同步跑 `exportUserData` → 浏览器下载 JSON。限频（fail-CLOSE）+ 不需 OPS。
- **注销（DELETION）** —— 工单化：用户经**新 OTP 重验**发起；成年 → 直接 `PENDING`；未成年（`<14`）→ `AWAITING_GUARDIAN`，须**已绑定监护人在站内审批**后才转 `PENDING`，OPS 经 CLI 审核执行 `deactivateUser`。**可自撤**。

两类都记入 `DsarRequest` 表并带 SLA 时钟。

## 2. 数据模型

```prisma
enum DsarRequestType   { EXPORT  DELETION }
enum DsarRequestStatus { AWAITING_GUARDIAN  PENDING  COMPLETED  REJECTED  CANCELED }

model DsarRequest {
  id                   String            @id @default(cuid())
  userId               String            @map("user_id")
  type                 DsarRequestType
  status               DsarRequestStatus @default(PENDING)
  isMinor              Boolean           @default(false) @map("is_minor")  // 发起时快照
  reason               String?                                            // 用户自填；deactivate 时 scrub
  requestedAt          DateTime          @default(now()) @map("requested_at")
  dueAt                DateTime          @map("due_at")
  resolvedAt           DateTime?         @map("resolved_at")
  resolvedByRef        String?           @map("resolved_by_ref")           // "self" | 运营 initiatorRef
  resolutionNote       String?           @map("resolution_note")           // 驳回理由：REJECTED 时回显给用户
  guardianApprovedByUserId String?       @map("guardian_approved_by_user_id") // <14：审批的监护人
  guardianApprovedAt   DateTime?         @map("guardian_approved_at")
  createdAt            DateTime          @default(now()) @map("created_at")
  user                 User @relation("UserDsarRequests", fields: [userId], references: [id], onDelete: Cascade)
  @@index([status, dueAt])
  @@index([userId])
  @@map("dsar_requests")
}
```

`User` 加反向关系 `dsarRequests DsarRequest[]`。注销走 soft-delete（保留行作 tombstone）。

**幂等的 DB 级保证**：partial unique index `WHERE type='DELETION' AND status IN ('AWAITING_GUARDIAN','PADENING'...)` —— 即一个用户至多一条"未结"DELETION（raw SQL 在 migration 末尾追加，Prisma 5 schema 不支持 partial index）：`CREATE UNIQUE INDEX dsar_one_open_deletion ON dsar_requests(user_id) WHERE type='DELETION' AND status IN ('AWAITING_GUARDIAN','PENDING');`。与项目既有 partial-unique 纪律一致（Plan 4/8）。

**状态机：**
- **EXPORT** —— 出生即 `COMPLETED`（`requestedAt=dueAt=resolvedAt=now`，`resolvedByRef="self"`）。
- **DELETION（成年）** —— `PENDING` →（OPS）`COMPLETED` |（OPS）`REJECTED` |（用户）`CANCELED`。
- **DELETION（<14）** —— `AWAITING_GUARDIAN` →（监护人站内审批，写 `guardianApprovedByUserId/At`）`PENDING` → … 同上。用户/监护人在 `AWAITING_GUARDIAN` 与 `PENDING` 均可 `CANCELED`。
- 终态 `COMPLETED/REJECTED/CANCELED` 不可再转。

**SLA**：`addWorkingDays(date,n)` 纯函数跳过周末（法定节假日忽略）；`dueAt = min(addWorkingDays(requestedAt,15), requestedAt + 30 自然日)` —— 30 自然日硬上限,防春节/国庆长假把工作日推过 PIPL 通行的 30 日预期（评审 S1）。

发起 DELETION 不锁定/降级账号；OPS 执行前账号照常可用，用户可撤销。

## 3. OTP 重验基础设施扩展

复用 `packages/auth/src/otp.ts`：
1. `OtpPurpose` 枚举 + `IssueOtpInput.purpose` 联合加 `DSAR_DELETION`。
2. **`verifyOtp` 加可选 `purpose` 过滤**（向后兼容）：传入时 `where` 加 `purpose`，LOGIN 路径不传 → 零回归。防 LOGIN 码授权注销。
3. **专用 `RULE_DSAR_VERIFY_PH`**（fail-close，per-phone）：DSAR 验码不与 LOGIN 的 `RULE_OTP_VERIFY_PH` 共用暴破预算（评审安全 S2）。

## 4. 用户侧接口（tRPC `dsar` router）

**合规红线：`dsar.*` 全部裸 `authedProcedure`，绝不挂 `requireGuardianConsent`**（与 `auth.*`/`family.*` 同列白名单）；否则 PENDING-consent 的 `<14` 连导出/注销都做不了。`dsar: dsarRouter` 注册进 `_root.ts`。错误统一 `cause: { reason }`。

1. **`dsar.exportMine`** (mutation)
   - 新增 `RULE_DSAR_EXPORT`（**fail-CLOSE**，capacity 2 / refill 1 token 每天，per-user + per-IP）。**fail-close**：全量 PII 导出是高敏端点,Redis 挂时宁可短暂 `TOO_MANY_REQUESTS` 也不放任 stolen-session 无限 dump（评审安全 B1）。
   - 限频过 → `ctx.db.$transaction` 内 `exportUserData` + `recordExportRequest`（同事务,审计与数据原子,评审安全 N1）→ 返回 `{ export, requestId }`。客户端 Blob 下载。

2. **`dsar.sendDeletionOtp`** (mutation)
   - 取本人 `PHONE/GLOBAL` 手机号；`RULE_OTP_SEND_PHONE` + `RULE_OTP_SEND_IP`（fail-close）→ `issueOtp({ purpose:"DSAR_DELETION" })`。E2E 写 `e2e:last-otp:<phone>`。
   - 无手机号（WeChat-only）→ `PRECONDITION_FAILED / DSAR_NO_PHONE`，引导 `/support/deactivate`。

3. **`dsar.requestDeletion`** (mutation `{ otpCode, reason? }`)
   - `RULE_DSAR_VERIFY_PH` → `verifyOtp(..., "DSAR_DELETION")`；失败映射 `BAD_REQUEST / OTP_*`，不建工单。
   - **幂等**：已有本人未结（AWAITING_GUARDIAN/PENDING）DELETION → 返回它（partial unique idx 兜底并发）。
   - `needsGuardian = ctx.auth.isMinor || guardianConsentStatus !== "NOT_REQUIRED"`：
     - `needsGuardian` 且有 **≥1 ACTIVE FamilyLink 监护人** → 建 `AWAITING_GUARDIAN`（`isMinor=true`）。
     - `needsGuardian` 且**无**绑定监护人 → `PRECONDITION_FAILED / DSAR_GUARDIAN_REQUIRED`（引导先绑定监护人或走人工渠道），不建工单。
     - 成年 → 建 `PENDING`。

4. **`dsar.approveChildDeletion`** (mutation `{ childUserId }`) —— **监护人侧**
   - 调用者须与 `childUserId` 有 **ACTIVE FamilyLink（parent 侧）**（复用 Plan 11 校验,无关系 → `NOT_FOUND`,不泄露存在性）。
   - 该 child 的 `AWAITING_GUARDIAN` DELETION → `PENDING` + 写 `guardianApprovedByUserId=ctx.auth.userId, guardianApprovedAt=now`。无 awaiting 工单 → `NOT_FOUND / DSAR_NOT_FOUND`。

5. **`dsar.cancelDeletion`** (mutation) —— 本人未结（AWAITING_GUARDIAN/PENDING）DELETION → `CANCELED`。无 → `NOT_FOUND / DSAR_NOT_FOUND`。

6. **`dsar.myRequests`** (query) —— 列本人全部请求；**REJECTED 行回显 `resolutionNote` 作驳回理由**（PIPL 第 50 条第 2 款,评审合规 B1）。其它状态不回显内部备注。

7. **`dsar.pendingChildApprovals`** (query) —— 监护人列其 ACTIVE 子女的 `AWAITING_GUARDIAN` 注销申请,供家长端审批 UI。

**Service** `apps/web/server/lib/dsar.ts`（**不带 `import "server-only"`** —— 被 tsx CLI import,评审代码契合 Item 4；遵循 `pii-governance.ts`/`kp-reconcile.ts` 先例）：`addWorkingDays`/`dueAtFor` + `recordExportRequest`/`createDeletionRequest`/`approveChildDeletion`/`cancelDeletionRequest`/`listOwnRequests`/`listPendingChildApprovals` + OPS `listForOps`/`fulfillDeletion`/`rejectDeletion`。

## 5. 用户侧 UI

**`apps/web/app/account/privacy/{page,privacy-view}.tsx`**（persona-neutral，不放 `(student)` 组）。`middleware.ts` 的 `PROTECTED_PREFIXES` **与** `matcher` 都加 `/account`（评审代码契合：两处都要）。

三块：下载数据副本（Blob+anchor，本仓库首个下载实现）/ 申请注销（发码→填码→提交；`<14` 无监护人时提示先绑定；处理中显示 dueAt + 撤销）/ 我的请求记录（**REJECTED 显示驳回理由**）。testid：`dsar-export`/`dsar-send-otp`/`dsar-otp-code`/`dsar-reason`/`dsar-delete-submit`/`dsar-pending`/`dsar-delete-cancel`/`dsar-requests`/`dsar-error`。

**家长端**：在既有 `/parent/children/[childId]`（Plan 11）加"子女注销申请"审批块（`pendingChildApprovals` + `approveChildDeletion`，testid `dsar-approve-child`）。

`/support/deactivate` 保留 + 加一句指向 `/account/privacy`。

## 6. OPS CLI 工作流 + SLA 追踪

三脚本挂 `apps/web/scripts/`，骨架沿用 `user-deactivate.ts`（`loadCliEnv`/`parseArgs`/`resolveOperatorUserId`/`buildInitiatorRef`/`main().catch`）；从 `../server/lib/dsar.js` import。`package.json` 加 `dsar:list`/`dsar:fulfill`/`dsar:reject`。

1. **`dsar:list [--status pending|all] [--overdue] [--type ...]`** —— 队列视图（含 `AWAITING_GUARDIAN`）；逾期高亮（`now>dueAt` 且未结）。SLA 追踪主要落点。
2. **`dsar:fulfill <id> [--dry-run]`** —— 守卫：须 `DELETION` 且 `status=PENDING`（`AWAITING_GUARDIAN` 不可履行,提示"等监护人审批"）。**未成年闸门改为数据可验证**：`isMinor` 行须已有 `guardianApprovedByUserId`（站内审批留痕），**不再用 `--guardian-verified` 荣誉旗标**（评审合规 B2）。另**复核 live `user.isMinor`**（防 stale 快照,评审 N2）。履行：`deactivateUser(prisma,...)` 顺序调用（**不**嵌套 `$transaction`,评审代码契合 Item 1）→ **predicate-on-update** `updateMany({where:{id,status:'PENDING'}})` 置 COMPLETED（防并发双 fulfill,评审安全 N5）。`--dry-run` 走 `previewDeactivateUser`。
3. **`dsar:reject <id> --note "..."`** —— `PENDING`→`REJECTED` + 必填 `resolutionNote`（**会回显给用户**,操作员须写面向用户的理由,勿写内部 PII）。

`resolvedByRef`/`guardianApprovedByUserId` 与 `deactivateUser` 的 `OpsActionLog.initiatorRef` 可对账。

## 7. PII 治理扩展（扩 Plan 6）

- `deactivateUser` 事务内：scrub 本人 `DsarRequest.reason = null` **保留行**（审计 SLA 履行证据）；计入 `DeactivatePayload.scrubbed.dsarRequests`（落 `scrubbed` 键,不新增 root key）。
- **悬挂工单收口（评审 N1）**：`deactivateUser` 事务内把本人未结（AWAITING_GUARDIAN/PENDING）DELETION 置 `COMPLETED`（`resolvedByRef=initiatorRef`），避免经 `user:deactivate` 直接注销后 `dsar:list` 永久残留逾期噪音。
- `exportUserData` 加 `dsarRequests` 白名单段（type/status/requestedAt/dueAt/resolvedAt）；**不含** `reason`/`resolutionNote` 自由文本。`schemaVersion` 升 `"2026-05-31"`（line 37 接口 + line 384 返回处）。
- payload 守词集加 `dsar_reason` / `resolution_note`（`pii-ops-action-log-payload.test`）。

## 8. 测试矩阵

- **纯单测**：`addWorkingDays` 跳周末 + `dueAtFor` 30 日封顶；状态机转移合法性。
- **集成（web）** `dsar-router.test.ts`：
  - `exportMine`：返数据 + COMPLETED 工单 + 同事务；**限频超额拒**；**fail-close（后端挂 → INTERNAL_SERVER_ERROR）**。
  - `requestDeletion`：无效 OTP 拒不建；成年 → PENDING + dueAt(≤30 日)；`<14` 有监护人 → AWAITING_GUARDIAN；`<14` 无监护人 → `DSAR_GUARDIAN_REQUIRED` 不建；幂等；**`<14` PENDING-consent 仍可发起（白名单）**。
  - `approveChildDeletion`：监护人 ACTIVE → AWAITING_GUARDIAN→PENDING + 留痕；非监护人 → NOT_FOUND。
  - `cancelDeletion`：AWAITING_GUARDIAN/PENDING→CANCELED；无 → NOT_FOUND；终态不可撤。
  - `myRequests`：REJECTED 回显 resolutionNote；其它不回显。
  - `sendDeletionOtp`：无手机号 → DSAR_NO_PHONE。
- **auth 单测**：`verifyOtp` purpose 隔离（LOGIN 码不能 DSAR 验、不传 purpose 零回归）。
- **OPS CLI 集成** `dsar-cli.test.ts`：`fulfill` 成年跑 deactivate + COMPLETED + 双 ref；`AWAITING_GUARDIAN` 不可 fulfill；`isMinor` 行无 `guardianApprovedByUserId` → 拒；有则放行；二次 fulfill（status 守卫）拒；`reject` 必填 note；`list --overdue` 只列逾期。
- **PII**：deactivate scrub reason 保留行 + 悬挂 DELETION→COMPLETED + payload 计数；export 含 dsarRequests 段不含自由文本 + schemaVersion；payload 守新禁词。
- **E2E** `dsar.spec.ts`（成年用户）：登录 → 下载副本 → 发起注销 → 见 dueAt → 撤销。（`<14` 监护人审批闭环由集成测试覆盖,不进 E2E 以控 OTP/scope。）

## 9. 文件结构

见实现计划 §File Structure（新增 `approveChildDeletion`/`pendingChildApprovals` 接口、家长端审批块、partial unique idx migration）。

## 10. 显式不做（YAGNI / punt）

- PIPL 第 46 条更正权（rectification）—— 下一 plan。
- 导出文件服务端落盘/异步/下载链接 —— 同步内存返回 + Blob。
- **完成/驳回 SMS 通知** —— 本期仅站内回显驳回理由（满足 Art 50§2 最小合规）；完成态 SMS 确认留后续 plan（评审合规 B1 的 (b) 部分）。
- OPS Web 后台 / DSAR 自动升级 —— CLI + 巡检。
- WeChat-only 无手机号站内替代验证 —— 人工渠道。
