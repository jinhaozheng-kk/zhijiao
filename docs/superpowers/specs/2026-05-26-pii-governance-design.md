# 智教 · Plan 6 PII 治理 Design

> Spec 是 Plan 6 的真理来源；实现 plan 引用本 spec 章节号。

## §1 目标 + 范围 + 显式 punt

**目标：** 把 Plan 2/3/4/8/9 已经积累的 PII（手机号 / openid / IP / UA / 用户产生的内容 / 微信支付 rawBody）纳入生命周期管理，满足《个人信息保护法》（PIPL）Art 45（数据可携权）+ Art 47（删除权）；同时保留财务记录满足税务法定保存期。Plan 3 标的 prod ship prereq 由本 plan 收口。

**核心架构 4 条：**

1. **注销 = 软删 User + 硬删用户内容 + 财务行保留** —— 不 `prisma.user.delete()`（Wallet/Ledger/TopupOrder 仍 FK 回该 User row 作 tombstone）；用户产生的学习内容硬删；财务行 scrub IP/UA 后保留金额、订单号、transactionId 走税务永久 bucket。
2. **OPS CLI 单线，无自助 Web mutation** —— 注销 / 导出走 `pnpm.cmd ... user:deactivate <userId>` / `user:export <userId> --out <path>`；静态页 `/support/deactivate` 仅说明渠道、主体、时限、身份核验方式，无表单（沿用 [[zhijiao-single-dev-no-ops-ui]] memory 与 Plan 9 工艺）。
3. **GC sweep 也走 CLI，外部 scheduler 文档化** —— 5 个 sweeper 都靠 OPS 跑 `pii:gc-sweep`，README 写 Windows Task Scheduler / k8s CronJob 配方；不引入 apps/web 内嵌 cron。
4. **审计独立表 `OpsActionLog`** —— 注销 / 导出 / 每次 GC sweep 写一行，payload 仅含计数 + 非 PII 摘要；**不复用** `ModelCall.taskKind="OPS_ACTION"`（ModelCall 字段语义是 model/prompt/request/response/tokens/status，OPS 行为塞进去会污染统计与 retention 语义）。

**范围（本 plan 做）：**

- 1 张新表 `OpsActionLog` + 枚举 `OpsActionKind`
- `User` 加 `deletedAt` + `deactivationReason` + 索引
- 1 处 onDelete 改动：`VariantGroup.entry` Restrict → Cascade
- 1 处字段可空化：`WechatPayEvent.rawBody` String → String?
- `AuthError` union 加 `USER_DEACTIVATED`（`apps/web/server/context.ts` + `packages/auth/src/errors.ts` 同步）
- `apps/web/server/lib/pii-governance.ts` 服务层：`deactivateUser` / `previewDeactivateUser` / `exportUserData` / `sweepPii`（含 5 个内部 sweeper）+ 复用 `resolveOperatorUserId`
- `apps/web/server/context.ts` `createContext` 扩 `deletedAt` 查询 + auth=null short-circuit
- `app/api/auth/refresh/route.ts` `rotateSession` 后 `deletedAt` 校验 + 清 cookies
- 3 个 CLI 脚本：`user-deactivate.ts` / `user-export.ts` / `pii-gc-sweep.ts`
- 1 个静态页：`/support/deactivate` Server Component
- 4 个 env + zod refine
- `docs/ops/pii-scheduling.md`：外部 scheduler 配方
- 14 个测试文件（integration + unit + 1 E2E）
- CLAUDE.md 更新：状态条目 + Merge 探针 35-41 + 候选 Plan 重排

**显式 punt（写进本 spec + plan "不做" 清单）：**

- 自助注销 mutation `auth.deactivate` + `/profile/deactivate` 表单 → 真用户上量后开新 plan
- 真用户身份核验自动化（发短信 OTP 二次确认）→ 同上，OPS 当前手动核验
- 未成年人 <14 vs 14-17 精准建模 + parent guardian linkage → Plan 14（未成年人保护专项）；Plan 6 仅在静态页加监护人发起说明
- Web `/ops/pii-actions` 页面（查 OpsActionLog） → 等真有 OPS 角色再做
- cron 自动跑 GC sweep → 工艺一致性优先，外部 scheduler 文档先行
- `FINANCIAL_RECORD_RETENTION_DAYS` 非 null 时的财务 sweeper → 后续真有合规意见再独立 plan；本 plan 仅 env 留口子
- `prisma.user.delete()` 仍然合法但不应被业务调用的守门 → CLAUDE.md 红线"Plan 6 后所有用户清理都走 deactivateUser"

---

## §2 Schema 变更

### §2.1 `User` 加 2 字段 + 索引

```prisma
model User {
  // ... 既有字段
  deletedAt           DateTime?      @map("deleted_at")             // Plan 6
  deactivationReason  String?        @map("deactivation_reason")    // Plan 6
  // ... 既有 relations
  initiatedOpsActions OpsActionLog[] @relation("OpsActionInitiator")
  opsActionLogs       OpsActionLog[] @relation("OpsActionTarget")

  @@index([deletedAt])
}
```

- `deletedAt` 为 null 表示活跃账户；非空为软删 tombstone，所有 authed 入口拒绝
- `deactivationReason` 是 OPS CLI 调用时 `--reason` 参数；free text；用户提供 / OPS 填，非业务必填
- 索引：`createContext` 高频查；`@@index([deletedAt])` 不是 partial idx 因为非空行后期可能多

### §2.2 `VariantGroup.entry` 改 Cascade

```prisma
model VariantGroup {
  // entry: ErrorBookEntry @relation(..., onDelete: Restrict)  ← 旧
  entry  ErrorBookEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)  // Plan 6
}
```

**为什么仅这 1 处改：** `ErrorBookEntry.user` 保持 Restrict 作"防误删 User"防线（任何未来 `prisma.user.delete()` 命中 Restrict 会抛——这是合规护栏，不是阻碍）。我们走软删 User 的路径，不需要也不应该改 ErrorBookEntry.user。只需让"硬删 ErrorBookEntry 时连带删 VariantGroup → VariantItem"链通畅即可，故 1 处改足够。

### §2.3 `WechatPayEvent.rawBody` 可空化

```prisma
model WechatPayEvent {
  rawBody  String?  @db.Text @map("raw_body")  // Plan 6 改：原 String 非空
}
```

**为什么：** §5 `sweepWechatPayEventBodies` 要把 90d+ 行的 rawBody scrub 成 null（行留作 outTradeNo / transactionId / verifyStatus 审计）；Prisma `String @db.Text` 不可 set null。

**兼容性：** grep 现有 `applyWechatPayNotify` / `verifyNotify` 代码读 `event.rawBody` 的路径——目前仅在 audit 写入和测试 fixture 里用，读取路径用 `verifyNotify` 入参的 freshly-received body，不读 row。Plan 6 实施时再次 grep 验。

### §2.4 新表 `OpsActionLog`

```prisma
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
  initiatorId   String?        @map("initiator_id")    // OPS/ADMIN userId；env 覆盖时 null
  initiatorRef  String         @map("initiator_ref")   // 兜底身份串 "cli:<hostname>:<os-user>"
  targetUserId  String?        @map("target_user_id")  // null for system-wide GC sweep
  reason        String?
  payload       Json?                                  // 见 §3.4 / §5.4 schema
  createdAt     DateTime       @default(now()) @map("created_at")

  initiator     User?          @relation("OpsActionInitiator", fields: [initiatorId], references: [id], onDelete: SetNull)
  target        User?          @relation("OpsActionTarget",    fields: [targetUserId], references: [id], onDelete: SetNull)

  @@index([kind, createdAt])
  @@index([targetUserId])
  @@map("ops_action_logs")
}
```

**`initiatorRef` 兜底字段：** OPS 跑 CLI 时通过 `resolveOperatorUserId()`（Plan 9 helper 抽出复用）拿 OPS/ADMIN userId；若环境无法识别（env 覆盖路径），`initiatorId=null`，但 `initiatorRef` 永远有值（CLI 自动生成 `cli:<os.hostname()>:<os.userInfo().username>`），保证审计行可追溯到具体机器与系统账户。

**`payload` 字段强约束（红线 #1）：** 仅放计数与非 PII 摘要，**绝不**放 phone / openid / unionId / rawBody / stemMd / requestJson / actualAnswerMd 任何字面值。spec §6.2 `pii-ops-action-log-payload.test.ts` regex 守门。

### §2.5 4 个 env

```ts
PII_RETENTION_SHORT_DAYS:           z.coerce.number().int().min(1).default(30),    // OtpRequest / Session
PII_RETENTION_MEDIUM_DAYS:          z.coerce.number().int().min(1).default(90),    // rawBody / TopupOrder ip+ua
PII_RETENTION_ORPHAN_TOPUP_DAYS:    z.coerce.number().int().min(1).default(180),   // 孤儿 TopupOrder
FINANCIAL_RECORD_RETENTION_DAYS:    z.coerce.number().int().nullable().default(null),  // null = 不自动删
```

zod refine：`MEDIUM > SHORT`；`ORPHAN > MEDIUM`；`FINANCIAL_RECORD_RETENTION_DAYS == null` 不报错也不报警告。

**dry-run 通过 CLI flag 触发**（`--dry-run`），不走 env。env 路径会引入"配置-行为分离"的歧义（CLI flag 与 env 谁赢？）；单 CLI flag 路径更清晰。

**`FINANCIAL_RECORD_RETENTION_DAYS = null` 设计意图：** 不在代码里写死"永久"的法律判断；当未来合规意见落地（如"PAID 订单保留 10 年"）时改 env 即可激活财务 sweeper（后续 plan 接），现在 Plan 6 不实现该 sweeper。

### §2.6 `AuthError` union 同步

```ts
// packages/auth/src/errors.ts
export const AUTH_ERROR_REASONS = [
  // ... 既有
  "USER_DEACTIVATED",  // Plan 6
] as const;

// apps/web/server/context.ts:13
export type AuthError = "ACCESS_EXPIRED" | "ACCESS_INVALID" | "NO_SESSION" | "SESSION_REVOKED" | "USER_DEACTIVATED";
```

两处保持同步；`refresh` 路由抛 `AuthError("USER_DEACTIVATED")` 走 `@zhijiao/auth`；`createContext` 设 `authError="USER_DEACTIVATED"` 走 ctx union。

### §2.7 Migration 工艺

沿用 Plan 4 / 8 / 9 工艺：`migrate dev --create-only` → 浏览 `migration.sql` → `migrate dev`。无 raw SQL 追加（`@@unique` / `@@index` 都是 Prisma 5 schema 直接支持的）。

---

## §3 `deactivateUser` 流程

### §3.1 Signature

```ts
export async function deactivateUser(
  prisma: PrismaClient,
  args: {
    userId: string;
    operatorId: string | null;   // resolveOperatorUserId 返回的 OPS/ADMIN userId；env 覆盖时 null
    initiatorRef: string;         // "cli:<hostname>:<os-user>"
    reason?: string;
    dryRun?: boolean;
  }
): Promise<{
  alreadyDeactivated: boolean;
  payload: DeactivatePayload;
}>

export async function previewDeactivateUser(
  prisma: PrismaClient,
  userId: string,
): Promise<DeactivatePayload>

interface DeactivatePayload {
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
```

### §3.2 dryRun 走纯读路径（红线 #2）

```ts
if (args.dryRun) {
  return {
    alreadyDeactivated: false,
    payload: await previewDeactivateUser(prisma, args.userId),
  };
}
```

`previewDeactivateUser` 仅 `count()` / `select` 不修改任何行、不写 OpsActionLog；CLI stdout 打 payload。

**为什么不走 "tx 内 throw 回滚"：** 实现上容易把"预览"和"执行"混成一条写路径；如果后面某步引入了 tx 外副作用（日志、文件写出、外部 API）dry-run 就不再真 dry-run。两条路径分离实现，共享 where 条件构造（`previewDeactivateUser` 用 `count()` / `select` 复用 §3.3 各步的 `where` clauses，避免预览与执行 predicate 漂移）。

### §3.3 执行序列（非 dryRun 路径，全程单 `prisma.$transaction`）

#### A. preconditions

1. `User.findUnique({ id: userId, select: { id, deletedAt } })`
   - 不存在 → throw `NotFound`（OPS 手抖打错 id 直接挡）
   - `deletedAt != null` → 立即返 `{ alreadyDeactivated: true, payload: { ... 全 0, dryRun: false } }`；不重复 scrub，不写新 OpsActionLog（幂等）

2. **关键先读：** 在删 `AuthIdentity` 前先读出 PHONE identities 的 phone 串：
   ```ts
   const phoneIdentities = await tx.authIdentity.findMany({
     where: { userId, provider: "PHONE", providerScope: "GLOBAL" },
     select: { providerUserId: true },
   });
   const phones = phoneIdentities.map(i => i.providerUserId);
   ```
   **窄化（红线 #3）：** 只取 `provider === "PHONE" && providerScope === "GLOBAL"`；不碰 WECHAT openid/unionid；不按 User 其他字段猜手机号。

#### B. 硬删学习内容（顺序敏感）

3. `tx.errorBookEntry.deleteMany({ where: { userId } })`
   → VariantGroup（§2.2 新 Cascade）→ VariantItem（既有 Cascade）级联走
   → 记 count `{ errorBookEntries, variantGroups, variantItems }`（VariantGroup/Item 数量靠 deleteMany 前 `count()` 取，因为 Prisma deleteMany 不返级联 count）

4. `tx.question.deleteMany({ where: { source: "USER_ADHOC", createdByUserId: userId } })`
   → `QuestionAnswer` / `QuestionKPLink` / `KpReconcileMatch` 按现有 Cascade 走
   → 记 count `{ userAdhocQuestions }`
   → 注意：上一步已删完 ErrorBookEntry，所以 Question Restrict（`ErrorBookEntry.question`）不卡

#### C. Scrub PII（不删行）

5. `tx.authIdentity.deleteMany({ where: { userId } })` —— 同手机号可重新注册（unique idx `(provider, providerScope, providerUserId)` 不冲突）

6. `tx.otpRequest.deleteMany({ where: { phone: { in: phones } } })` —— 用步骤 2 读出的 phones 集合

7. Sessions：
   ```ts
   tx.session.updateMany({
     where: { userId, revokedAt: null },
     data: {
       revokedAt: now,
       revokedReason: "ADMIN_REVOKED",
       deviceLabel: null,
       ipCreated: null,
       userAgent: null,
     },
   });
   ```
   既有 revoked 行不动（其 ipCreated/userAgent 由 §5 GC sweep 处理）

8. `tx.topupOrder.updateMany({ where: { userId }, data: { ipCreated: null, userAgent: null } })`
   金额、订单号、transactionId、paidAt 不动（财务永久）

9. `tx.modelCall.updateMany({ where: { userId }, data: { userId: null } })`
   ModelCall 与 User 无 FK，但有 userId String 列；写 null 让 audit 行变"系统级"

10. `tx.kpAlias.updateMany({ where: { createdByUserId: userId }, data: { createdByUserId: null } })`
    `tx.kpReconcileMatch.updateMany({ where: { reviewedByUserId: userId }, data: { reviewedByUserId: null } })`
    （onDelete=SetNull 在 user.delete 时自动，但我们不 user.delete，所以显式 update）

11. `tx.user.update({ where: { id: userId }, data: { name: null, avatarUrl: null, deletedAt: now, deactivationReason: args.reason ?? null } })`

#### D. 写审计

12. `tx.opsActionLog.create({ data: { kind: "DEACTIVATE_USER", initiatorId, initiatorRef, targetUserId: userId, reason, payload: { scrubbed, deleted, dryRun: false } } })`

### §3.4 幂等性与 transactionality

- A.1 短路保证：重跑直接返 `alreadyDeactivated: true`
- 全部 `deleteMany / updateMany` SQL 层天然幂等（条件不命中时 affected=0）
- 单 `$transaction` 包整段：任意一步抛错完整回滚到调用前；OPS 看到要么全成要么全没事
- 默认 Postgres `idle_in_transaction_timeout=0` 不设；用户内容 >10k 行的极端 case 现阶段不存在，未来真出现走分批走出 tx（§7 风险）

### §3.5 Auth 失效路径

| 入口 | 改动 |
|---|---|
| `apps/web/server/context.ts:88` `prisma.user.findUnique({ select: { isMinor } })` | 扩 select：`{ isMinor: true, deletedAt: true }`；若 `user.deletedAt != null` → `auth = null; authError = "USER_DEACTIVATED"`（不构造 AuthCtx；同步把 `USER_DEACTIVATED` 加进 §2.6 union）|
| `apps/web/server/trpc.ts:33` `authedProcedure` | **零行 diff** —— `ctx.auth=null` 自动落 `UNAUTHORIZED`，`ctx.authError="USER_DEACTIVATED"` 透传给前端 |
| `apps/web/app/api/auth/refresh/route.ts` `rotateSession` 后 `findUniqueOrThrow` 处 | 扩 select 加 `deletedAt`；非空 throw `AuthError("USER_DEACTIVATED")` + 清 `COOKIE_AT` + `COOKIE_RT` |
| `apps/web/server/auth-service.ts` `issueSessionAndCookies` | 入参增 `userId` 校验：findUnique 取 `deletedAt`，非空 throw（防御性；正常流 AuthIdentity 已删不会走到这）|
| `apps/web/server/auth-service.ts` `loginOrPrepareRegisterByWechat` / `apps/web/server/routers/auth.ts` OTP login | 按 phone/openid 查 AuthIdentity 时**不需要**额外加过滤（AuthIdentity 已在 §3.3 step 5 删了，自然查不到）；防御性可加 `where: { user: { deletedAt: null } }` 但与 unique idx 行为重叠，YAGNI |
| Session 已被 §3.3 step 7 revoke | 旧 access token 在 createContext `isSessionRevoked` 检查会立即落 `SESSION_REVOKED`（独立守门，先于 USER_DEACTIVATED 触发）|

**defense-in-depth 排序：** Session revoke（即时） > deletedAt 检查（user 状态） > AuthIdentity 删除（重新登录不可能成）。三层有任意一层挡就拒。

### §3.6 CLI 形态

```bash
pnpm.cmd --filter @zhijiao/web user:deactivate <userId>
pnpm.cmd --filter @zhijiao/web user:deactivate <userId> --reason "用户主动申请"
pnpm.cmd --filter @zhijiao/web user:deactivate <userId> --dry-run
```

CLI 内部：
1. `resolveOperatorUserId()` 拿 operatorId（env override 或 OPS/ADMIN userId 校验）
2. `initiatorRef = "cli:" + os.hostname() + ":" + os.userInfo().username`
3. 调 service 层；stdout 打 JSON payload
4. 非 dryRun 成功后 stdout 打 `Done. OpsActionLog id=<id>`

---

## §4 `exportUserData` 流程

### §4.1 Signature

```ts
export async function exportUserData(
  prisma: PrismaClient,
  userId: string,
): Promise<UserDataExport>

interface UserDataExport {
  schemaVersion: "2026-05-26";
  exportedAt: string;          // ISO8601 UTC
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
    providerUserIdMasked: string;   // 见 §4.3
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
    // 显式排除：ipCreated, userAgent
  }>;

  errorBookEntries: Array<{      // 仅 ACTIVE/ARCHIVED；DELETED 不导
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

  modelCalls: Array<{            // 摘要 5 字段，红线 #4
    taskKind: string;
    status: string;
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: string;
    // 显式排除：requestJson, responseJson, errorMessage, promptTemplateId, model
  }>;
}
```

### §4.2 显式排除字段（红线 #4）

| 字段 | 表 | 排除理由 |
|---|---|---|
| `rawBody` | WechatPayEvent | 含 wechat 端 PII（payer info），本人无法控制 wechat 端数据流；属于商户内部留存非用户副本 |
| `requestJson / responseJson` | ModelCall | 完整 prompt 含系统提示、内部策略、其他用户上下文、模型供应商 metadata |
| `errorMessage` | ModelCall | 可能泄露内部模块路径 / 异常栈 |
| `promptTemplateId / model` | ModelCall | 内部模型路由策略，非用户产生信息 |
| `ipCreated / userAgent` | Session, TopupOrder, OtpRequest | 风控字段，PIPL 第 13 条"基于合同必要处理"非"用户副本" |
| `OpsActionLog` 涉及该用户的行 | OpsActionLog | OPS 行为审计，不是"本人产生的信息" |
| `OtpRequest` 历史 | OtpRequest | 一次性 token；本人已用完即抛 |
| `KpReconcileMatch.reviewedByUserId / KpAlias.createdByUserId` 的行 | KpReconcileMatch, KpAlias | OPS 行为产物，非本人产生 |
| `Session.refreshTokenHash / id` | Session | 安全凭证 hash，不导出 |

### §4.3 `providerUserIdMasked` 格式

```ts
function maskPhone(s: string): string {
  if (s.length === 11) return s.slice(0, 3) + "****" + s.slice(7);
  return "***";
}

function maskWechatId(s: string): string {
  // 同时用于 providerUserId (openid) 与 unionId 两类 WECHAT 标识
  if (s.length <= 8) return "***";
  return s.slice(0, 3) + "****" + s.slice(-3);
}
```

不输出明文 phone/openid/unionId——本人申请副本时 OPS 还要做身份核验，全明文反而是 PII 二次暴露。本人记得自己手机号尾号，masked 足够确认账号身份。

### §4.4 CLI 形态 + 输出安全

```bash
pnpm.cmd --filter @zhijiao/web user:export <userId> --out <path>
```

CLI 行为：
1. 校验 `--out` 必填、以 `.json` 结尾、目标文件**不存在**（不覆盖）
2. 调 `exportUserData(prisma, userId)` 返 `UserDataExport`
3. `fs.writeFileSync(path, JSON.stringify(result, null, 2))`
4. `fs.chmod(path, 0o600)` —— Windows best-effort，失败 warn 不 abort
5. 写 `OpsActionLog`（`kind="EXPORT_USER_DATA"`，payload 仅 `{ exportSizeBytes, outPath, recordCounts }`；**不写 JSON 内容本身**）
6. stdout 打 `Exported to <path> (<bytes> bytes)`

### §4.5 安全交付（流程层，非代码）

CLI 把 JSON 文件写到 OPS 本地后，OPS 通过身份核验后的可信渠道（邮箱、加密文件传输）交付本人。本仓库不提供 Web 下载入口（避免增加攻击面）。

---

## §5 5 个 GC sweepers

### §5.1 统一 signature

```ts
export interface SweepResult {
  bucket: "short" | "medium" | "orphan";
  table: string;                    // "otp_requests" / "sessions" / ...
  affected: number;
  dryRun: boolean;
  hasMore: boolean;                 // 当批 LIMIT=10000 未排空时 true，CLI 自动续跑
}

export async function sweepPii(
  prisma: PrismaClient,
  args: {
    bucket: "short" | "medium" | "orphan" | "all";
    now?: Date;
    dryRun?: boolean;
  }
): Promise<SweepResult[]>
```

`now` 可注便于测试与复盘；CLI 默认 `new Date()`。

### §5.2 5 个 sweeper 的 predicate

| # | Sweeper | Bucket | Predicate | Action |
|---|---|---|---|---|
| 1 | `sweepOtpRequests` | short | `COALESCE(consumedAt, expiredAt) IS NOT NULL AND COALESCE(consumedAt, expiredAt) < now - SHORT_DAYS` | DELETE 行 |
| 2 | `sweepInactiveSessions` | short | `COALESCE(revokedAt, expiresAt) < now - SHORT_DAYS` | DELETE 行 |
| 3 | `sweepWechatPayEventBodies` | medium | `createdAt < now - MEDIUM_DAYS AND rawBody IS NOT NULL` | UPDATE rawBody=null（行留作 outTradeNo/transactionId 审计；幂等再跑 affected=0） |
| 4 | `sweepTopupOrderPii` | medium | `status IN (PAID, FAILED, EXPIRED) AND updatedAt < now - MEDIUM_DAYS AND (ipCreated IS NOT NULL OR userAgent IS NOT NULL)` | UPDATE ipCreated=null, userAgent=null |
| 5 | `sweepOrphanTopupOrders` | orphan | `status = EXPIRED AND paidAt IS NULL AND createdAt < now - ORPHAN_DAYS AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE refTable='topup_orders' AND refId=topup_orders.id)` | DELETE 行 |

**sweeper #2 用 COALESCE（红线 #5）：** Session GC 不只清 revoked，也清自然过期。`revokedAt` 优先；若空（自然过期未主动 logout），用 `expiresAt`。30d 是足够的安全排查窗口，再长就不符合 PIPL"不超过必要期限"。

**sweeper #5 NOT EXISTS 实现（红线 #6）：** Prisma `deleteMany` 不支持跨表 NOT EXISTS；用 raw SQL：

```ts
await prisma.$executeRaw`
  DELETE FROM topup_orders
  WHERE status = 'EXPIRED'
    AND paid_at IS NULL
    AND created_at < ${cutoff}
    AND NOT EXISTS (
      SELECT 1 FROM credit_ledger
      WHERE ref_table = 'topup_orders' AND ref_id = topup_orders.id
    )
  RETURNING id
`;
```

单条原子 SQL，比"先 findMany 后 deleteMany"少一次往返且无 race window。

### §5.3 批量上限 + Prisma `updateMany` 无 `take` 的实现笔记

每个 sweeper 内部 `LIMIT 10000`。Prisma `updateMany / deleteMany` 不支持 `take`，实现模式：

**模式 A（行 ID 先查后改，sweeper 1 / 2 / 4）：**
```ts
const ids = await tx.session.findMany({
  where: predicate,
  select: { id: true },
  take: 10000,
});
const affected = await tx.session.updateMany({  // 或 deleteMany
  where: { id: { in: ids.map(r => r.id) } },
  data: { ... },
});
return { affected: affected.count, hasMore: ids.length === 10000 };
```

**模式 B（raw SQL CTE，sweeper 3 / 5）：**
```sql
WITH targets AS (
  SELECT id FROM wechat_pay_events
  WHERE created_at < $1 AND raw_body IS NOT NULL
  LIMIT 10000
)
UPDATE wechat_pay_events SET raw_body = null
WHERE id IN (SELECT id FROM targets)
```

CLI 见 `hasMore=true` 自动续跑（while 循环最多 `MAX_BATCHES=10` 兜底防失控；hardcoded 常量，真遇极端 case 再 env 化）。

### §5.4 OpsActionLog 写入

每个 bucket 跑完（即使 affected=0）写一行 `OpsActionLog`：

```ts
{
  kind: "GC_SWEEP_<BUCKET>",
  initiatorId, initiatorRef,
  targetUserId: null,
  reason: null,
  payload: {
    results: [
      { table: "otp_requests", affected: 123, dryRun: false },
      { table: "sessions", affected: 45, dryRun: false },
    ],
    bucket: "short",
    nowAt: "2026-05-26T03:00:00Z",
  },
}
```

dryRun=true 整 bucket 不写 OpsActionLog（红线 #2 一致）；CLI stdout 打 results 表即可。

### §5.5 CLI

```bash
pii:gc-sweep                                # bucket=all
pii:gc-sweep --bucket short
pii:gc-sweep --dry-run
pii:gc-sweep --bucket medium --now 2026-06-01T00:00:00Z
```

### §5.6 外部 scheduler 配方（`docs/ops/pii-scheduling.md`）

```markdown
## Windows Task Scheduler
- 任务名：zhijiao-pii-gc-sweep
- 频率：每日 03:00
- 操作：pwsh.exe -NoProfile -Command "Set-Location D:\智教; pnpm.cmd --filter @zhijiao/web pii:gc-sweep"
- 日志：stdout → C:\Logs\zhijiao-pii-gc.log

## k8s CronJob（未来部署侧）
schedule: "0 3 * * *"
job 镜像 entrypoint: pnpm --filter @zhijiao/web pii:gc-sweep
backoffLimit: 3
successfulJobsHistoryLimit: 7
failedJobsHistoryLimit: 14

## 频率建议
- short bucket（30d 阈值）→ 每日 1 次
- medium bucket（90d 阈值）→ 每周 1 次
- orphan bucket（180d 阈值）→ 每月 1 次
- 偷懒：每日 --bucket all，多扫的代价是几个 SQL count
```

---

## §6 静态页 + 测试 + 风险

### §6.1 `/support/deactivate` 文案

文件 `apps/web/app/(public)/support/deactivate/page.tsx` 是 Next 14 Server Component，纯文本无表单。

完整文案（中文）：

```
账号注销与个人信息处理

依据《个人信息保护法》第四十七条，您有权请求注销账号并删除您的个人信息。

如何申请
-------
当前注销流程通过人工处理。请选择以下任一渠道与我们联系：
 - 微信公众号：智教（{{WECHAT_OA_PLACEHOLDER}}）
 - 客服邮箱：{{SUPPORT_EMAIL_PLACEHOLDER}}
 - 工单：暂未开放

请在申请中提供：
 - 您的注册手机号（用于身份核验）
 - 注销原因（可选；帮助我们改进产品）

未满 14 周岁的用户，请由监护人代为发起申请，并提供必要的监护关系核验材料。

处理时限
-------
我们承诺在收到完整身份核验信息后 15 个工作日内完成注销。

身份核验方式
-----------
我们会通过您注册时使用的手机号发送验证码进行核验。微信注册的账号需提供绑定手机号；
如尚未绑定，请先在 App 内绑定后再发起注销申请。

注销后您的数据处置
-----------------
注销操作完成后：
 1. 立即删除：您的姓名、头像、登录身份（手机号 / 微信关联）、验证码记录、错题本、
    变式题、自建题目内容
 2. 永久去标识化：会话记录、支付订单中的 IP 与设备信息
 3. 依法保留：根据《电子商务法》和税务相关规定，您的支付金额、订单号、交易号将作
    为财务凭证保留，但与您的身份信息切断关联
 4. 注销前请先处理账号内余额或未完成订单；注销完成后账号权益将无法恢复

数据副本权利（PIPL 第四十五条）
-----------------------------
您也有权获取个人信息副本。请通过上述渠道申请，我们会以 JSON 文件形式通过身份核验
后的渠道交付。

主体信息
-------
运营主体：{{OPERATOR_PLACEHOLDER}}
ICP 备案号：{{ICP_PLACEHOLDER}}
```

4 处 `{{...}}` 是模板占位；page.tsx 用 `const PLACEHOLDER_WECHAT_OA = "XXXXX"` 等常量。Env 校验**不接管**这些字符串（产品文案非配置），ICP 备案下来时改 PR。

**Prod ship 探针（CLAUDE.md 加 #35）：** grep `apps/web/app/(public)/support/deactivate/page.tsx` 找 `XXXXX` / `\.example` / "运营主体：XXXXX" 任一命中 → prod ship 阻断。

### §6.2 测试覆盖矩阵

| 测试 | 类型 | 覆盖 |
|---|---|---|
| `pii-deactivate-user.test.ts` | integration | happy path 12 步顺序 / 幂等（重跑 `alreadyDeactivated` 短路）/ Restrict 不阻挡（先删 entry 后 cascade 到 group）/ AuthIdentity 删后 OtpRequest by phone 删 / PHONE only providerScope=GLOBAL 不撞 WECHAT openid |
| `pii-deactivate-user-tx-atomicity.test.ts` | integration | 单步抛错全 rollback：mock step 12 抛 → 验 ErrorBookEntry / USER_ADHOC Question 未删、AuthIdentity 未删、User.deletedAt 未变、OpsActionLog 未写 |
| `pii-deactivate-user-dryrun.test.ts` | integration | dryRun → `previewDeactivateUser` 纯读，count 正确；DB 行 0 改动；0 OpsActionLog 写入 |
| `pii-export-user-data.test.ts` | integration | 输出 JSON 含全部白名单字段；不含 `rawBody / requestJson / responseJson / ipCreated / userAgent`（regex `expect(JSON.stringify(result)).not.toMatch(/rawBody\|requestJson\|responseJson\|ipCreated\|userAgent/)`）；ModelCall 摘要 5 字段限制；`providerUserIdMasked` 格式 |
| `pii-deleted-user-auth-guard.test.ts` | integration | `createContext`：valid access token + `user.deletedAt != null` → `auth=null, authError="USER_DEACTIVATED"`；`authedProcedure` 自动 throw UNAUTHORIZED；`refresh` route：deactivated user → 401 USER_DEACTIVATED + 清 cookies |
| `pii-deleted-user-relogin.test.ts` | integration | 同手机号注销后重新走 register flow：findUnique PHONE identity 命中 0 行（已删）→ 走 register 路径建**新** User row；旧 User.deletedAt 行保留作 tombstone |
| `pii-gc-sweep-short.test.ts` | integration | OtpRequest 28d/32d boundary / Session COALESCE 三种形态（revoked-not-expired / expired-not-revoked / 活跃 session 不动）|
| `pii-gc-sweep-medium.test.ts` | integration | WechatPayEvent createdAt 88d/92d boundary + 第二次跑 affected=0 幂等 / TopupOrder PII updatedAt boundary + 已 null 字段第二次跑 affected=0 |
| `pii-gc-sweep-orphan.test.ts` | integration | EXPIRED 175d/185d boundary / `paidAt` 非空不动 / NOT EXISTS CreditLedger refId 引用的不动（即使 EXPIRED 且超期）|
| `pii-gc-sweep-dryrun.test.ts` | integration | dryRun=true 对 5 个 sweeper 都 0 行改动；返 count 正确；不写 OpsActionLog |
| `pii-gc-sweep-batching.test.ts` | integration | LIMIT=10000 + `hasMore=true` 续跑：seed 25k 行 → 第一批 affected=10000, hasMore=true → 第二/三批继续 → 第四批 affected=0 收尾 |
| `pii-ops-action-log-payload.test.ts` | unit | payload regex 守门：`expect(JSON.stringify(payload)).not.toMatch(/(\d{11}\|wx_[a-zA-Z0-9]+\|stem_md\|raw_body)/)` 兜底，且字段白名单严格枚举 |
| `pii-governance-env.test.ts` | unit | 4 env zod refine：`SHORT=10, MEDIUM=5` → throw "MEDIUM > SHORT"；`ORPHAN=80, MEDIUM=90` → throw；`FINANCIAL_RECORD_RETENTION_DAYS=null` 不报错 |
| `support-deactivate-page.spec.ts` | E2E | 静态页 200 / 含 PIPL Art 47 字串 / 含监护人提示 / 占位常量显示（提醒未来 PR 替换；上线探针 #35 关联）/ 不含"退款承诺"或"全额退款"字符串 |

**关键反向守门红线：**

- 红线 R1：`pii-export-user-data.test.ts` 必须 `not.toMatch(/rawBody|requestJson|responseJson|ipCreated|userAgent/)` regex 断言（不用 `.includes`，避免字面值漏判）
- 红线 R2：`pii-deactivate-user.test.ts` 必须断言注销后 `prisma.modelCall.findMany({ where: { userId: <注销 userId> } })` 返 `count === 0`（已 set null）+ `prisma.modelCall.count({ where: { userId: null } }) >= <原 modelCall 数>`（旧 row 仍在）
- 红线 R3：`support-deactivate-page.spec.ts` grep 不到 `/(退款|全额返还|赔付)/` —— 避免文案踩 CLAUDE.md 合规规则"不得保证提分/分数/退款"
- 红线 R4：CLAUDE.md 探针 #35 grep `apps/web/app/(public)/support/deactivate/page.tsx` 找 `XXXXX|\.example|运营主体：XXXXX` 任一命中 → 阻断 prod ship

### §6.3 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| `VariantGroup.entry` Restrict → Cascade 误删 ErrorBookEntry 时连带删未预期 group | 业务代码里有"删 entry 但保 group"语义 | migration 前 `grep -rn "errorBookEntry.delete" apps/web packages` 确认所有 entry.delete 调用都期望 cascade group；目前 0 命中（仅 §3.3 step 3 一处新加） |
| `WechatPayEvent.rawBody` 改 nullable 后既有 webhook 处理代码假定非空挂掉 | `applyWechatPayNotify` 内 `event.rawBody.length` 之类 | migration 前 grep `rawBody`：目前仅在 audit 写入和测试 fixture 里用；读取路径用 `verifyNotify` 入参的 freshly-received body 不读 row；Plan 6 实施时再次 grep 验 |
| `createContext` 加 deletedAt 查询多一次 DB | 性能微影响 | 已在 `findUnique({ select: { isMinor, deletedAt } })` 同一查询里加字段，无额外 round trip |
| 注销 tx 太长（12 步）超 `idle_in_transaction_timeout` | 用户内容 >10k 行的极端 case | 默认 timeout=0 不设；当前 0 用户不存在；未来真出现走分批拆 tx |
| `prisma.user.delete()` 被未来代码误调用导致级联 | 误删整账户级 | ErrorBookEntry.user 保持 Restrict → 任何 user.delete() 命中 Restrict 会抛；CLAUDE.md 红线"Plan 6 后所有用户清理走 deactivateUser" |
| GC sweep 跑慢锁表 | 量大时 affected=百万 | §5.3 LIMIT=10000 + hasMore 续跑；CLI 默认 max 10 batch 兜底；超出则 OPS 手动 |
| dryRun preview 与 actual 不一致（race） | 高并发场景 | 当前 0 用户不存在；文档化"dryRun 是粗略预估" |
| 注销中用户旧 access token 没过期 | access token TTL 15min 内仍可调 authed endpoint | `createContext` 已查 deletedAt 立即生效；最坏情况 15min 窗口；同时 §3.3 step 7 revoke session → `isSessionRevoked` 立挡，双层防 |
| 同手机号 relogin 走到旧 deletedAt User 行 | findUnique 时未过滤 deletedAt | AuthIdentity 已删 → 重新 register 路径建新 User row；spec §3.5 验证；测试 `pii-deleted-user-relogin.test.ts` 守门 |
| WechatPayEvent rawBody schema 改 nullable 后 typescript 类型变化 | 既有代码 `event.rawBody.length` 报 string \| null 类型错 | typecheck 全量跑会暴露；migration 阶段同步修；目前预测 0-1 处 |
| `resolveOperatorUserId()` env 覆盖路径让无 OPS 角色用户跑 user:deactivate | 未来若 env 暴露过广 | Plan 9 已通过 `2f094a6 fix` 实现"env 覆盖也必须是 OPS/ADMIN role"，Plan 6 复用同一 helper |

### §6.4 风险预估总览

- migration 风险：低（1 处 onDelete + 1 处 nullable + 1 新表 + 5 字段，全 Prisma 5 原生支持）
- 跨包改动：中（packages/auth + apps/web 同步加 USER_DEACTIVATED；测试需双向覆盖）
- 测试矩阵：高（14 个测试文件，PII 反向断言密度大）
- 数据风险：低（0 真实用户；dryRun 双路径保命）

---

## §7 与既有 Plan 工艺的一致性

| 工艺 | 来源 | Plan 6 沿用 |
|---|---|---|
| `migrate dev --create-only` → 浏览 SQL → `migrate dev` | Plan 4 / 8 / 9 Task 1 | 一致（§2.7） |
| 每个 task 一个 commit，commit message 引用 task 编号 | Plan 4 / 9 红线 #14 | 一致 |
| `pnpm.cmd`（PowerShell execution policy）| Plan 4 / 9 红线 #15 | 一致 |
| Vitest `it.todo` / 空 body 防御 | Plan 4 / 9 红线 #13 | 一致；每 task commit 前 grep |
| OPS 操作走 CLI 不走 Web | Plan 9 工艺 | 一致；3 个 CLI 脚本 |
| 中文输出 | Plan 4 / 8 / 9 | 一致 [[zhijiao-chinese-default]] |
| Spec 是真理来源 + plan 引用章节号 | Plan 4 / 8 / 9 | 一致 |
| `resolveOperatorUserId()` env 覆盖也校验 OPS/ADMIN role | Plan 9 hotfix `2f094a6` | 一致（复用同一 helper） |
| 服务层接口写成可被未来 Web 包形式 | Plan 9 §1 / [[zhijiao-single-dev-no-ops-ui]] | 一致 |
| Plan 6 merge 后必跑 `db:generate` | Plan 8 merge 经验（CLAUDE.md 探针 29）| 一致；Plan 6 加新 model + 改 onDelete + nullable 字段 |
| 收尾运行（spec §7.3 = Plan 9 工艺） | Plan 9 | Plan 6 收尾运行 = `pii:gc-sweep --dry-run` 走一遍验证 schema/predicate；不需要真数据，0 用户场景 smoke 即可 |

---

## §8 完成条件

- 所有 Task 1-N 步骤勾完（task 数量由实现 plan 划分）
- `pnpm.cmd exec turbo typecheck --force` 全绿
- `pnpm.cmd exec turbo test --force` 全绿（含 Plan 6 新加 14 测试）
- `pnpm.cmd --filter @zhijiao/web exec next build` exit 0
- `pnpm.cmd --filter @zhijiao/web exec playwright test` 全绿（含 `support-deactivate-page.spec.ts`）
- CLAUDE.md 加 Plan 6 条目 + "PII 治理现状" 段 + Merge 探针 35-41 + 候选 Plan 重排（Plan 5/7/10/11/12/13/14）
- 14 个测试文件全过；反向断言（红线 R1-R3）守门生效
- Prisma migration checksum 一致：`prisma migrate status` 输出 `Database schema is up to date!`
- `unlinkIfOrphan` 类反悔入口未暴露的 Plan 9 工艺延续：本 plan 无对应概念但保留 CLI 不暴露"撤销注销"入口
- merge commit message 引用 spec 路径
