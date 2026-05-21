---
title: 智教 — Plan 3 Credit 计费 + 微信支付沙箱 设计 Spec
date: 2026-05-21
status: draft (awaiting user review)
scope: Credit 余额账务 + 微信支付 V3 沙箱（Adapter 模式 mock 主路径 + Real skeleton 留好）
audience: 实施者（Claude Code）、用户（产品/架构审核者）
source: 2026-05-21 brainstorm（7 轮决策 + 6 段设计 + 32 条修正吸收）
verification_prereqs:
  - Plan 2 真鉴权已落地（master commit 4dc55a4）
  - Plan 2 Hardening 已落地（master commit cc2c43b）
prod_ship_prereqs:
  - PII 治理 plan（用户注销 / 去标识化 / WechatPayEvent.rawBody 保留期）
  - ICP 备案 + 微信商户号 + APIv3 密钥 + 商户证书（真接 V3 API 激活前必须）
---

# 智教 · Plan 3 Credit 计费 + 微信支付沙箱 设计

## 0. 文档信息

**目标**：在 Plan 1/2 之上加 Credit 余额账务系统 + 微信支付 V3 沙箱（Adapter 模式 mock 主路径），把 `creditPlaceholder("TUTOR_ASK")` 替换为真正的扣点中间件，把"商业闭环"从占位变成可用。

**两套验收边界 —— 不要混淆**：

| 验收 | 前提 | 含义 |
|---|---|---|
| **Plan 3 mock MVP 完成** | 仅 Plan 1/2/2H | mock 支付路径全绿、所有测试矩阵过、CLAUDE.md 更新；可宣布"商业闭环代码实现完毕" |
| **Plan 3 可生产上线** | + PII 治理 plan + ICP 备案 + 商户号 + API 证书 | 完成 Plan 3 mock MVP **不等于**可 ship 生产；真接 V3 API 激活需要全套商户资质 |

本 plan 实施的是**第一层**（mock MVP 完成）。第二层验收要等 prod ship prereq plan 单独完成后再启动激活流程。

## 1. 决策摘要

7 轮 brainstorm 锁定的核心决策 + 后续 6 段设计推演中确认的第 8 条：

| # | 议题 | 决策 | 关键影响 |
|---|---|---|---|
| 1 | 计费模型 | 纯 Credit 余额制 | 排除订阅 / 混合；用户充值 → 变 Credit → 每 action 扣点 |
| 2 | 计费单位 | 按 action 固定扣点 | actionKind → creditCost 代码常量；ActionPricing **不建表**（MVP YAGNI） |
| 3 | 扣费时机 | 先扣后用 + 失败补偿 | 复用 Plan 2 Hardening predicate-on-update 工艺；防透支 + 防并发；失败补偿写第二条 COMPENSATION ledger |
| 4 | 支付集成 | Adapter 模式（mock 主 + 真接 skeleton） | 与 Plan 2 SMS / WeChat H5 同 pattern；`WECHAT_PAY_USE_MOCK=true` 是进 Mock 的唯一开关；真接代码留好但 ICP 备案前不激活 |
| 5 | 退款 | MVP 不支持 | 用户协议写"虚拟商品不可退"；异常场景走 `ADJUST_ADD` 补偿（不走真退款）；spec 不引入 V3 refund API |
| 6 | 未成年人 | 不加门 + 月度软上限（未付按 createdAt + 已付按 paidAt 合算） | `User.isMinor=true` 时 `wallet.topup.create` 校验本月（未付订单按创建时间占用 + 已付订单按支付时间落账）合计 ≤ 200 元（可配）—— 跨月精确，5/31 创建 6/1 付款会从 5 月转到 6 月 |
| 7 | 账本 | Append-only ledger + `wallet.balance` 缓存 | 写双轨：`wallet.balance` 用 predicate-on-update 原子改；`CreditLedger` append 记每笔；`balanceAfter` 列做对账 snapshot |
| 8 | 补偿策略 | fail-open compensation | 白名单**不**补偿（如 `ComplianceRejectedError`），其余抛错**默认**补偿（用户未拿到 usable result = 应补） |

## 2. 架构

3 个解耦模块 + 既有 `apps/web` 加 4 块薄胶水，零侵入 Plan 1/2 现有 schema。

```
┌─────────────────────────────────────────────────────────────┐
│                       apps/web (tRPC)                       │
│                                                             │
│  routers/wallet.ts                                          │
│  ├ balance                                                  │
│  ├ topupCreate                                              │
│  ├ topupStatus                                              │
│  ├ ledgerList                                               │
│  └ walletAdminAdjust  (permissionProcedure ADMIN)           │
│                                                             │
│  trpc.ts                                                    │
│  └ chargedProcedure(action)   ─── 替换 creditPlaceholder    │
│                                                             │
│  app/api/wechat-pay/notify/route.ts  (webhook 唯一入口)     │
│                                                             │
│  server/logger.ts             (pino, server-only)           │
└────────────────────────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┴───────┐
              ▼                              ▼
┌─────────────────────────────┐ ┌──────────────────────────────┐
│ packages/billing (新建)     │ │ packages/integrations (扩展) │
│                             │ │                              │
│ pricing.ts                  │ │ wechat-pay/                  │
│ ├ ActionKind union          │ │ ├ types.ts (Adapter 接口)    │
│ └ priceOf(kind)             │ │ ├ mock.ts                    │
│                             │ │ │  (HMAC 签 fake notify     │
│ wallet.ts                   │ │ │   + 3 种 notifyMode)       │
│ └ ensureWallet              │ │ ├ real.ts (V3 API 骨架)      │
│                             │ │ │   ICP 前不启用             │
│ ledger.ts                   │ │ ├ platform-cert-provider.ts  │
│ ├ chargeForAction           │ │ │  SingleFilePlatformCert... │
│ └ compensate                │ │ │  (接口为多证书扩展留口)    │
│                             │ │ └ build.ts                   │
│ wechat-notify.ts            │ │   buildWechatPayAdapter(env, │
│ └ applyWechatPayNotify      │ │     notifyUrl, mockSecret)   │
│                             │ │                              │
│ sweeper.ts                  │ └──────────────────────────────┘
│ └ expireStaleOrders         │
│                             │
│ admin.ts                    │
│ └ adminAdjust               │
│                             │
│ test-utils.ts               │
│ └ waitForCondition          │
└─────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────┐
│              packages/db (Prisma) — Plan 3 delta           │
│  Wallet · CreditLedger · TopupOrder · WechatPayEvent       │
│  enums: LedgerKind / TopupStatus / WechatPayEventVerify    │
└────────────────────────────────────────────────────────────┘
```

**模块边界（每个单位回答"做什么 / 怎么用 / 依赖谁"）**：

- **`packages/billing`**（新建，纯领域逻辑）—— Wallet/Ledger 操作、补偿、Webhook 应用层、过期扫描、OPS 调账。**只**依赖 `@zhijiao/db` 的 prisma 客户端；不直接调任何外部 API；不 import 任何 `apps/web` 的 env 或运行时。可单包 unit-test，独立 per-package test DB `zhijiao_test_billing`。
- **`packages/integrations` 扩展**—— `WechatPayAdapter` 接口 + Mock/Real 实现 + `PlatformCertProvider` 接口 + build factory。与 SMS / WeChat H5 OAuth 完全同 pattern。**包内严禁 import `apps/web/server/env`**：所有需要的 config（`notifyUrl` / `mockSecret` / `appId` / `mchId` / 证书 provider）由 factory 调用方显式传入。
- **`apps/web` 胶水**—— tRPC `wallet` router、`/api/wechat-pay/notify` route handler、`chargedProcedure(actionKind)` 中间件（替换 Plan 2 `creditPlaceholder`）、`server/logger.ts`。负责把 billing 包和 integrations 包粘起来 + 鉴权 + 限频 + ctx 注入。

**与 Plan 2 / Plan 2 Hardening 的工艺一致**：
- Adapter pattern 复刻 SMS / WeChat H5 OAuth（Plan 2）
- env validator 扩展（Plan 2 Hardening Task 1）：加 9 字段 + 2 条 refine，缺即 boot fail
- 限频规则扩展（Plan 2 Hardening Task 7）：加 `RULE_TOPUP_CREATE_{IP,USER}`，**fail-close**
- 原子化写入（Plan 2 Hardening Task 3/4）：predicate-on-update + balanceAfter snapshot

## 3. 数据模型 delta

加 **4 张表** + **3 个新 enum**，不动既有表（不影响 Plan 1/2 的 schema）。

### 3.1 Enum

```prisma
enum LedgerKind {
  TOPUP         // 充值入账（+）
  DEBIT         // action 扣点（-）
  COMPENSATION  // 失败补偿（+，对应某条 DEBIT）
  ADJUST_ADD    // OPS 手工加点（+）
  ADJUST_SUB    // OPS 手工扣点（-）
}

enum TopupStatus {
  CREATED   // 订单刚建，未调微信下单
  PENDING   // 已拿到 prepayId，等用户支付
  PAID      // webhook 验签通过 + 三联校验通过 + ledger 已写
  FAILED    // 调下单 API 失败 / webhook trade_state in (CLOSED, PAYERROR, REVOKED)
  EXPIRED   // 30 min 未支付，被 sweeper 扫到
}

enum WechatPayEventVerify {
  PENDING         // 刚收到，未 verify
  OK              // 验签 + 解密通过
  SIG_INVALID     // 签名错（RSA-SHA256 验证失败）
  CERT_NOT_FOUND  // X-WeChat-Pay-Serial 在 PlatformCertProvider 找不到
  PARSE_FAILED    // body 解析失败（含 APIv3 AEAD-AES-GCM 解密失败）
}
```

### 3.2 表

```prisma
model Wallet {
  id        String   @id @default(cuid())
  userId    String   @unique @map("user_id")
  // Credit 余额（单位：点；可 < 0 仅在 OPS 调账时；正常路径有 INSUFFICIENT_BALANCE check 兜底）
  balance   Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")

  // 安全默认：不 CASCADE。若有人尝试 prisma.user.delete()，会被 FK Restrict 抛错。
  // 用户注销 / 去标识化路径推迟到 PII 治理 plan。
  user      User           @relation(fields: [userId], references: [id], onDelete: Restrict)
  ledger    CreditLedger[]

  @@map("wallets")
}

model CreditLedger {
  id            String      @id @default(cuid())
  walletId      String      @map("wallet_id")
  kind          LedgerKind
  // 有符号；TOPUP/COMPENSATION/ADJUST_ADD>0，DEBIT/ADJUST_SUB<0
  delta         Int
  // 写入时 wallet.balance 的新值；对账用（最新 ledger.balanceAfter 必须 == wallets.balance）
  balanceAfter  Int         @map("balance_after")
  // 幂等核心：UNIQUE 顶重复写
  // TOPUP→`topup:${outTradeNo}`；DEBIT→`debit:${kind}:${userId}:${clientRequestId}`
  // COMPENSATION→`comp:${originalLedgerId}`；ADJUST→由 OPS 提供
  idemKey       String      @unique @map("idem_key")
  // 引用源：TOPUP→TopupOrder.id；DEBIT→ModelCall.id（或 null，actionKind 走业务标识）
  // COMPENSATION→对应 DEBIT 的 ledger.id；ADJUST→null
  refTable      String?     @map("ref_table")
  refId         String?     @map("ref_id")
  // 仅 DEBIT / COMPENSATION 有值（"TUTOR_ASK" 等）
  actionKind    String?     @map("action_kind")
  // 自由扩展：reason / compensationStatus / errorClass / OPS reasonCode/reasonDetail
  metadata      Json?
  createdAt     DateTime    @default(now()) @map("created_at")
  // 谁触发：用户自己/OPS userId/null=system（webhook 触发的 TOPUP）
  createdByUserId String?   @map("created_by_user_id")

  // 同安全默认；Wallet 不被自动删 → Ledger 也不会
  wallet        Wallet      @relation(fields: [walletId], references: [id], onDelete: Restrict)

  @@index([walletId, createdAt(sort: Desc)])
  @@index([refTable, refId])
  @@map("credit_ledger")
}

model TopupOrder {
  id            String       @id @default(cuid())
  userId        String       @map("user_id")
  // 用户实付金额（分）；输入校验 amountCents ∈ [100, 100_000]
  amountCents   Int          @map("amount_cents")
  // 兑换 Credit 数（创建时按当时 CREDIT_PER_YUAN 冻结进去）
  credits       Int
  status        TopupStatus  @default(CREATED)
  // 我们生成给微信的商户订单号；格式 `zj_${userIdShort}_${nanoid(12)}`
  outTradeNo    String       @unique @map("out_trade_no")
  prepayId      String?      @map("prepay_id")        // 微信返回
  // 微信支付订单号；UNIQUE 防同一交易号误入多单
  transactionId String?      @unique @map("transaction_id")
  paidAt        DateTime?    @map("paid_at")
  expiredAt     DateTime     @map("expired_at")       // 创建 +30 min
  ipCreated     String?      @map("ip_created")
  userAgent     String?      @map("user_agent")
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt      @map("updated_at")

  // 不设 FK 到 User：财务订单与用户生命周期解耦（与 ModelCall.userId 同款理由）
  // PII 治理 plan 接管"用户注销时如何处理孤儿订单"问题

  @@index([userId, createdAt(sort: Desc)])
  @@index([status, expiredAt])               // sweeper 过期扫描
  @@index([userId, status, createdAt])       // 未成年月度上限：未付订单按 createdAt
  @@index([userId, paidAt])                  // 未成年月度上限：已付订单按 paidAt
  @@map("topup_orders")
}

model WechatPayEvent {
  id            String                @id @default(cuid())
  // 关联 TopupOrder（非 FK；审计日志要解耦）；解析前可能为空字符串
  outTradeNo    String                @map("out_trade_no")
  // 微信支付订单号（从 V3 webhook resource 解密后提取）
  transactionId String?               @map("transaction_id")
  rawBody       String                @db.Text @map("raw_body")
  signature     String?
  timestamp     String?
  nonce         String?
  serial        String?                                       // X-WeChat-Pay-Serial
  verifyStatus  WechatPayEventVerify  @default(PENDING) @map("verify_status")
  handled       Boolean               @default(false)
  processedAt   DateTime?             @map("processed_at")
  // 失败原因：AMOUNT_MISMATCH / APP_OR_MCH_MISMATCH / ORDER_NOT_FOUND
  //          / SIG_INVALID / CERT_NOT_FOUND / PARSE_FAILED
  //          / INTERMEDIATE_STATE_NOTPAY / INTERMEDIATE_STATE_USERPAYING
  //          / unknown trade_state 等
  error         String?
  createdAt     DateTime              @default(now()) @map("created_at")

  @@index([outTradeNo])
  @@index([handled, createdAt])              // 未处理事件扫描
  @@map("wechat_pay_events")
}
```

### 3.3 设计关键点

**`CreditLedger.idemKey` 是幂等核心**：
- TOPUP 的 idemKey = `topup:${outTradeNo}` —— 顶住微信 webhook at-least-once 重发
- DEBIT 的 idemKey = `debit:${kind}:${userId}:${clientRequestId}` —— `clientRequestId` 由前端 randomUUID 生成，**必填 input 字段**，重试时复用
- COMPENSATION 的 idemKey = `comp:${originalLedgerId}` —— 顶住"补偿被并发触发两次"
- ADJUST 的 idemKey 由 OPS 显式传入（建议 `adjust:${nanoid(16)}` + reasonCode 前缀）
- 任何路径写 ledger 必先想清 idemKey 是什么；写不出来 = schema 设计错

**`balanceAfter` 列冗余但必要**：
- 对账：最新 ledger entry 的 `balanceAfter` 必须 == `wallets.balance`，不一致即事务边界 bug 报警
- 不靠 `SUM(delta)` 对账：append-only 表会很长，SUM 慢；snapshot 一次查询即可

**`Wallet.balance` 用 predicate-on-update 原子改**（与 Plan 2 Hardening Task 3/4 同款）：
```ts
// 扣（chargeForAction 内）
const claimed = await tx.wallet.updateMany({
  where: { id: walletId, balance: { gte: cost } },
  data: { balance: { decrement: cost } },
});
if (claimed.count !== 1) {
  // 余额不足：再读一次拿最新 balance 返给上层（不能用 pre-charge 值，并发下可能旧）
  const w = await tx.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { balance: true } });
  return { kind: "INSUFFICIENT_BALANCE", balance: w.balance };
}
const after = await tx.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { balance: true } });
await tx.creditLedger.create({ data: { walletId, kind: "DEBIT", delta: -cost, balanceAfter: after.balance, idemKey, ... } });
```

不引入 version 列、不引入显式锁、不引入 raw SQL。

**`TopupOrder` 与 `WechatPayEvent` 分离**：
- TopupOrder = 业务订单（用户视角）；一个订单一行
- WechatPayEvent = 通信日志（webhook 视角）；一个订单可能对应多条 event（at-least-once 重发 + 中间态多次）
- 幂等保证一个订单**最多入账一次**（由 `CreditLedger.idemKey` UNIQUE + `TopupOrder.transactionId` UNIQUE 双闸）

**`Wallet/CreditLedger` 用 `onDelete: Restrict`**：
- 删 User 时 FK violation 抛错 → 安全默认
- 用户注销 / 去标识化路径推迟到 **PII 治理 plan**（prod ship prereq）
- 不在 Plan 3 自做"软删 User"等账户生命周期管理（耦合过大）

**`TopupOrder` 四复合索引**：
- `(userId, createdAt desc)` —— 用户订单列表
- `(status, expiredAt)` —— sweeper 扫过期订单
- `(userId, status, createdAt)` —— 未成年月度上限：**未付**订单按 createdAt 算（CREATED/PENDING）
- `(userId, paidAt)` —— 未成年月度上限：**已付**订单按 paidAt 算（防跨月边界把"5/31 创建 6/1 支付"错算到 5 月）

## 4. 核心 Flows

### 4.1 Topup（充值）

**Sequence**（mock / real 同 code path，区别仅在 Adapter 实现）：

```
学生 UI               wallet.topupCreate (tRPC)            TopupOrder       WechatPayAdapter      微信 V3
   │                          │                                │                  │                  │
   ├── topupCreate(100元) ───▶│                                │                  │                  │
   │                          │ 1. RULE_TOPUP_CREATE_IP        │                  │                  │
   │                          │    + RULE_TOPUP_CREATE_USER    │                  │                  │
   │                          │    (fail-CLOSE; Redis down →   │                  │                  │
   │                          │    TOPUP_RATE_LIMIT_UNAVAILABLE)│                  │                  │
   │                          │ 2. ensureWallet                │                  │                  │
   │                          │ 3. isMinor → 月度上限 check    │                  │                  │
   │                          │    (CREATED+PENDING+PAID 累计) │                  │                  │
   │                          │ 4. credits = amountCents/100 × │                  │                  │
   │                          │    CREDIT_PER_YUAN             │                  │                  │
   │                          │ 5. outTradeNo = `zj_${...}_${nano}`               │                  │
   │                          │ 6. expiredAt = now + 30 min    │                  │                  │
   │                          ├── create CREATED ─────────────▶│                  │                  │
   │                          │ 7. adapter.unifiedOrder(...) ──────────────────────▶│                 │
   │                          │                                │                  ├── V3 API ───────▶│
   │                          │                                │                  │ (mock: 仅生成    │
   │                          │                                │                  │  prepayId，NOT   │
   │                          │                                │                  │  自动 fire)      │
   │                          │                                │                  │◀── prepay_id ────│
   │                          │◀── prepayId ───────────────────────────────────────│                  │
   │                          ├── update CREATED→PENDING ─────▶│                  │                  │
   │                          │   set prepayId                 │                  │                  │
   │                          │ 8. adapter.signalOrderReady(.) ────────────────────▶│                 │
   │                          │   ⚠️ 必须在 step 7-8 之间 persist PENDING，否则     │                  │
   │                          │   mock notify 会与 update PENDING 竞态（详 §4.1.3）│                  │
   │                          │                                │                  │ (mock: 按        │
   │                          │                                │                  │  notifyMode      │
   │                          │                                │                  │  本地 HMAC fire) │
   │                          │                                │                  │ (real: no-op)    │
   │◀── { orderId, prepayId, qrCode/h5Url, expiresAt, credits } ┤                  │                  │
   │                                                                                                  │
   ├── 用户付款（H5/扫码/JSAPI；前端轮询 wallet.topupStatus）─────────────────────▶│                  │
   │                                                                                                  │
   │                          /api/wechat-pay/notify          │                  │                  │
   │                          (webhook from 微信 V3) ◀──────────────────────────────────────────────│
   │                          │ 1. 写 WechatPayEvent (verifyStatus=PENDING)        │                  │
   │                          │ 2. adapter.verifyNotify(headers, body) → {ok, ...} │                  │
   │                          │    成功：{ok:true, outTradeNo, tradeState,         │                  │
   │                          │      amountCents, appId, mchId, transactionId,     │                  │
   │                          │      successTime}                                  │                  │
   │                          │    失败：{ok:false, reason: SIG_INVALID            │                  │
   │                          │              | CERT_NOT_FOUND | PARSE_FAILED}      │                  │
   │                          │ 3a. !ok → update event.verifyStatus = reason       │                  │
   │                          │     return 200, **NOT touch TopupOrder**           │                  │
   │                          │ 3b. ok → update event.verifyStatus = OK            │                  │
   │                          │ 4. applyWechatPayNotify(...) → {kind: "..."}       │                  │
   │                          │    (按 §4.1.2 状态机)                              │                  │
   │                          │ 5. update event.handled=true, processedAt=now      │                  │
   │                          │    set error if kind != PAID/ALREADY_PAID          │                  │
   │                          │ 6. return 200 ───────────────────────────────────────────────────────▶│
```

#### 4.1.1 atomic apply（webhook 核心；同 `$transaction`）

按 brainstorm Section 3 修正后的顺序（**业务终态最后落**），并在 transaction **外**捕获 Prisma P2002 把 UNIQUE 冲突转化为业务返码（避免 P2002 冒到 route handler 触发 500 + webhook 重发风暴）：

```ts
export async function applyWechatPayNotify(
  prisma: PrismaClient,
  verify: VerifyOk,
  expectedAppId: string,
  expectedMchId: string,
): Promise<ApplyNotifyResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.topupOrder.findUnique({ where: { outTradeNo: verify.outTradeNo } });
      if (!order) return { kind: "ORDER_NOT_FOUND" as const };
      if (order.status === "PAID") return { kind: "ALREADY_PAID" as const };

      // L3/L4: 三联校验（金额 / appId / mchId）
      if (verify.amountCents !== order.amountCents) return { kind: "AMOUNT_MISMATCH" as const };
      if (verify.appId !== expectedAppId || verify.mchId !== expectedMchId) {
        return { kind: "APP_OR_MCH_MISMATCH" as const };
      }

      // L5: trade_state 分支
      if (verify.tradeState === "NOTPAY") return { kind: "INTERMEDIATE_STATE_NOTPAY" as const };
      if (verify.tradeState === "USERPAYING") return { kind: "INTERMEDIATE_STATE_USERPAYING" as const };
      if (["CLOSED", "PAYERROR", "REVOKED"].includes(verify.tradeState)) {
        await tx.topupOrder.update({
          where: { outTradeNo: verify.outTradeNo },
          data: { status: "FAILED", transactionId: verify.transactionId ?? null },
        });
        return { kind: "FAILED" as const };
      }
      if (verify.tradeState === "REFUND") {
        // MVP 不开退款，收到此事件即异常 —— 不动账，告警（外层 logger.warn）
        return { kind: "UNEXPECTED_REFUND" as const };
      }
      if (verify.tradeState !== "SUCCESS") {
        return { kind: "UNKNOWN_TRADE_STATE" as const };
      }

      // === SUCCESS 路径：业务终态最后落 ===
      // 1. wallet.update += credits
      await tx.wallet.update({
        where: { userId: order.userId },
        data: { balance: { increment: order.credits } },
      });
      // 2. 读新余额
      const w = await tx.wallet.findUniqueOrThrow({
        where: { userId: order.userId }, select: { id: true, balance: true },
      });
      // 3. ledger.insert（idemKey UNIQUE 顶并发 webhook）
      //    并发 race：两条 webhook 同时进入此 transaction，第一条写 ledger 成功并 commit，
      //    第二条 ledger.create 抛 P2002 → 整个 transaction 回滚 → 在外层 catch 转 ALREADY_PAID
      await tx.creditLedger.create({
        data: {
          walletId: w.id,
          kind: "TOPUP",
          delta: order.credits,
          balanceAfter: w.balance,
          idemKey: `topup:${verify.outTradeNo}`,
          refTable: "topup_orders",
          refId: order.id,
          createdByUserId: null,
        },
      });
      // 4. 业务终态最后落（含 transaction_id UNIQUE；若已被另一单用过会撞 P2002，外层 catch 处理）
      await tx.topupOrder.update({
        where: { outTradeNo: verify.outTradeNo },
        data: {
          status: "PAID",
          transactionId: verify.transactionId,
          paidAt: new Date(verify.successTime),
        },
      });
      return { kind: "PAID" as const };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta as { target?: string[] | string } | undefined)?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
      // CreditLedger.idemKey 冲突 = 并发 webhook，另一条已 win 并入账成功
      if (targetStr.includes("idem_key")) return { kind: "ALREADY_PAID" as const };
      // TopupOrder.transactionId 冲突 = 微信支付订单号已被另一单 outTradeNo 用过；异常告警
      if (targetStr.includes("transaction_id")) return { kind: "DUPLICATE_TRANSACTION_ID" as const };
    }
    // 非 UNIQUE 冲突的程序/DB 错 → 冒到 route handler 返 500（微信会重发）
    throw e;
  }
}
```

**为什么 transaction 外 catch**：Prisma transaction 内部抛错时 transaction 自动 rollback，事务内的 try/catch 无法阻止 abort 状态。把 catch 放在 `prisma.$transaction(...)` 调用**外**才能在 rollback 之后转返码。

**route handler 处理**：`{ kind: "ALREADY_PAID" }` / `{ kind: "PAID" }` 都是成功处理（return 200，不让微信重发）；`{ kind: "DUPLICATE_TRANSACTION_ID" }` 是异常告警 + return 200（不可恢复，重发也不会改善）；其它非 PAID/ALREADY_PAID 的 kind 都 return 200 + 写 event.error。

#### 4.1.2 TopupStatus 状态机（完整版）

| from → to | 触发 | 写入 |
|---|---|---|
| (init) → CREATED | `wallet.topupCreate` 限频通过 + 月度 check 通过 | TopupOrder row |
| CREATED → PENDING | `adapter.unifiedOrder` 返回 prepayId | TopupOrder.prepayId |
| CREATED → FAILED | `adapter.unifiedOrder` 抛 / 返非 SUCCESS | TopupOrder.status |
| PENDING → PAID | webhook ok + 三联通过 + trade_state=SUCCESS | wallet.balance + ledger TOPUP + TopupOrder (status/transactionId/paidAt) |
| PENDING → FAILED | webhook ok + trade_state ∈ {CLOSED, PAYERROR, REVOKED} | TopupOrder.status + transactionId |
| PENDING → EXPIRED | sweeper 扫到 expiredAt < now | TopupOrder.status |
| EXPIRED → PAID（grace） | 慢到的 webhook ok + SUCCESS（钱已收必须入账） | 同 PENDING → PAID 路径 |
| ANY → (no change) | verify 失败（SIG_INVALID/CERT_NOT_FOUND/PARSE_FAILED） | **只**写 WechatPayEvent；TopupOrder 不动 |
| ANY → (no change) | NOTPAY / USERPAYING 中间态 | **只**写 WechatPayEvent.error；TopupOrder 不动 |
| ANY → (no change) | AMOUNT_MISMATCH / APP_OR_MCH_MISMATCH | **只**写 WechatPayEvent.error；TopupOrder 不动 + 告警日志 |
| ANY → (no change) | UNEXPECTED_REFUND / UNKNOWN_TRADE_STATE | **只**写 WechatPayEvent.error；TopupOrder 不动 + 告警日志 |
| PAID → (no change) | 并发 webhook 撞 `CreditLedger.idemKey` UNIQUE → 事务 rollback → 外层 catch → `ALREADY_PAID` | 已 PAID 一次的订单第二次重发：不写 ledger、不重复加 balance；event.handled=true |
| ANY → (no change) | 同 transactionId 已被另一单用过 → P2002 → `DUPLICATE_TRANSACTION_ID` | **只**写 WechatPayEvent.error；TopupOrder 不动 + 严重告警（数据/配置异常） |

#### 4.1.3 Mock Adapter 与真路径对齐

**关键设计约束（避免 mock notify vs update PENDING 竞态）**：

`unifiedOrder` **绝不**自动触发 mock notify。原因：

```
1. tx.create(CREATED)
2. adapter.unifiedOrder()    ←  若此处 sync 自动 fire mock notify，webhook handler
   ├─ (sync mode 旧设计) fire → /api/wechat-pay/notify
   │  └─ applyWechatPayNotify 看到 status=CREATED → 入账 → status=PAID
   └─ return prepayId
3. tx.update(PENDING + prepayId)   ←  此时把已 PAID 状态覆盖回 PENDING（数据腐蚀）
```

修法：`unifiedOrder` 只返 prepayId，不触发 webhook。Adapter 接口加 `signalOrderReady(outTradeNo, amountCents)` 生命周期钩子，由 `topupCreate` 在 **status=PENDING 成功 persist 之后**显式调用。Mock 实现 fire 本地 webhook；Real 实现 no-op（真支付 webhook 由微信发，业务侧无需触发）。

```ts
// packages/integrations/src/wechat-pay/types.ts
export interface WechatPayAdapter {
  unifiedOrder(req: UnifiedOrderRequest): Promise<UnifiedOrderResult>;
  verifyNotify(headers: NotifyHeaders, rawBody: string): Promise<VerifyResult>;
  /**
   * 在 TopupOrder.status 已 update 到 PENDING 之后调用。
   * Mock 实现：按 notifyMode 触发本地 webhook（sync 同步 fire / async-delayed 排程 fire / manual 不动）。
   * Real 实现：no-op（真 webhook 由微信发）。
   * 不应抛错破坏 topupCreate 主流程——fire 失败应 swallow + log（webhook 重发机制兜底）。
   */
  signalOrderReady(outTradeNo: string, amountCents: number): Promise<void>;
}

// packages/integrations/src/wechat-pay/mock.ts
export type NotifyMode = "sync" | "async-delayed" | "manual";

export class MockWechatPayAdapter implements WechatPayAdapter {
  constructor(private opts: {
    notifyUrl: string;       // by factory: `${env.NEXT_PUBLIC_APP_URL}/api/wechat-pay/notify`
    mockSecret: string;      // by factory: env.MOCK_WECHAT_PAY_SECRET (min 16)
    appId: string;
    mchId: string;
    notifyMode: NotifyMode;
    delayMs?: number;        // for async-delayed
  }) {}

  async unifiedOrder(req: UnifiedOrderRequest): Promise<UnifiedOrderResult> {
    // ⚠️ 不在此处 fire notify —— 由 topupCreate 在 update PENDING 后调 signalOrderReady
    const prepayId = `mock_prepay_${randomBytes(8).toString("hex")}`;
    return { prepayId, qrCode: `mock://${prepayId}`, h5Url: `mock://${prepayId}` };
  }

  async signalOrderReady(outTradeNo: string, amountCents: number): Promise<void> {
    try {
      if (this.opts.notifyMode === "sync") {
        await this.fireMockNotify(outTradeNo, amountCents);
      } else if (this.opts.notifyMode === "async-delayed") {
        const delay = this.opts.delayMs ?? 50;
        setTimeout(() => {
          this.fireMockNotify(outTradeNo, amountCents).catch(() => {
            /* swallow: mock 模式下错过 notify 不应阻塞业务；测试可用 manual 模式精确控制 */
          });
        }, delay);
      }
      // "manual" mode: no-op；测试代码自己调 adapter.fireMockNotify(outTradeNo, amountCents)
    } catch {
      /* swallow */
    }
  }

  async fireMockNotify(outTradeNo: string, amountCents: number): Promise<void> {
    const body = JSON.stringify({
      id: nanoid(), summary: "支付成功",
      resource: {
        ciphertext: this.encryptResource({
          out_trade_no: outTradeNo,
          trade_state: "SUCCESS",
          amount: { total: amountCents },
          appid: this.opts.appId,
          mchid: this.opts.mchId,
          transaction_id: `mock_txn_${nanoid(16)}`,
          success_time: new Date().toISOString(),
        }),
      },
    });
    // HMAC-SHA256 with mockSecret 签 body —— 强制 mock 路径也覆盖验签
    const signature = crypto.createHmac("sha256", this.opts.mockSecret).update(body).digest("hex");
    await fetch(this.opts.notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Wechatpay-Signature": signature,
        "Wechatpay-Timestamp": String(Math.floor(Date.now() / 1000)),
        "Wechatpay-Nonce": randomBytes(16).toString("hex"),
        "Wechatpay-Serial": "MOCK_CERT_SERIAL",
      },
      body,
    });
  }

  async verifyNotify(headers, rawBody): Promise<VerifyResult> {
    if (headers.serial !== "MOCK_CERT_SERIAL") return { ok: false, reason: "CERT_NOT_FOUND" };
    const expected = crypto.createHmac("sha256", this.opts.mockSecret).update(rawBody).digest("hex");
    if (headers.signature !== expected) return { ok: false, reason: "SIG_INVALID" };
    try {
      const parsed = JSON.parse(rawBody);
      const decoded = JSON.parse(this.decryptResource(parsed.resource.ciphertext));
      return {
        ok: true,
        outTradeNo: decoded.out_trade_no,
        transactionId: decoded.transaction_id,
        tradeState: decoded.trade_state,
        amountCents: decoded.amount.total,
        appId: decoded.appid,
        mchId: decoded.mchid,
        successTime: decoded.success_time,
      };
    } catch {
      return { ok: false, reason: "PARSE_FAILED" };
    }
  }
}
```

测试在 `notifyMode: "sync"` 时一切都同步发生，断言简单；E2E 用 `"async-delayed"` + `waitForCondition` 轮询；精确时序测试用 `"manual"`。

### 4.2 Spend（消费）

**Sequence**（`chargedProcedure("TUTOR_ASK")` 套 `tutor.ask`）：

```
学生 UI            tutor.ask (chargedProcedure)              Wallet/Ledger          AI Adapter
   │                       │                                       │                     │
   ├── ask({question,      │                                       │                     │
   │       clientRequestId})▶                                      │                     │
   │                       │ 1. ensureWallet(userId)               │                     │
   │                       │ 2. cost = priceOf("TUTOR_ASK") = 1    │                     │
   │                       │ 3. chargeForAction({                  │                     │
   │                       │      walletId, kind, cost,            │                     │
   │                       │      idemKey: `debit:tutor_ask:       │                     │
   │                       │        ${userId}:${clientRequestId}`, │                     │
   │                       │      createdByUserId: userId,         │                     │
   │                       │    })                                 │                     │
   │                       │    ├ predicate-on-update              │                     │
   │                       │    │  balance>=cost → -=cost          │                     │
   │                       │    │  count!==1 → re-read balance     │                     │
   │                       │    │  → INSUFFICIENT_BALANCE          │                     │
   │                       │    ├ findUnique select balance        │                     │
   │                       │    └ ledger.insert DEBIT              │                     │
   │                       │      (UNIQUE 顶住客户端重试)          │                     │
   │                       │ 4. try {                              │                     │
   │                       │      result = await next() ────────────────────────────────▶│
   │                       │    }                                  │                     │
   │                       │    catch (e) {                        │                     │
   │                       │      if (shouldCompensate(e))         │                     │
   │                       │        compensate({                   │                     │
   │                       │          originalLedgerId, walletId,  │                     │
   │                       │          cost, kind, reason })        │                     │
   │                       │        ├ wallet.balance += cost       │                     │
   │                       │        ├ findUnique select balance    │                     │
   │                       │        └ ledger.insert COMPENSATION   │                     │
   │                       │      else                             │                     │
   │                       │        creditLedger.update metadata   │                     │
   │                       │        + logger.warn structured       │                     │
   │                       │      throw                            │                     │
   │                       │    }                                  │                     │
   │◀── result ────────────│                                       │                     │
```

**`shouldCompensate(e)` 白名单**：
```ts
function shouldCompensate(e: unknown): boolean {
  if (e instanceof ComplianceRejectedError) return false;  // 用户得到"内容不合规"判定 = service 已交付
  // 默认 ALL 其它抛错都补偿（包括未知错）—— fail-open compensation
  return true;
}
```

**判定依据**：next() **是否成功 return** = 服务是否交付。次拿到 result 视为已得到 service；next() 抛 = 用户未拿到 → 默认补，除非白名单。

**不补偿分支的 metadata + 日志**：
```ts
await ctx.db.creditLedger.update({
  where: { id: debit.ledgerId },
  data: { metadata: {
    compensationStatus: "not_compensated_whitelisted",
    errorClass: e?.constructor?.name,
  } },
});
logger.warn({
  event: "charged_action_not_compensated",
  ledgerId: debit.ledgerId, walletId, userId,
  actionKind: kind, cost,
  errorClass: e?.constructor?.name, requestId,
}, "Action failed but whitelisted as non-compensable");
```

### 4.3 Webhook 可靠性 & 边角

#### At-least-once 防御层级

| 层 | 实现位置 | 失败动作 |
|---|---|---|
| L1 签名验证（RSA-SHA256 + 平台证书） | `WechatPayAdapter.verifyNotify` | `verifyStatus=SIG_INVALID`，return 200，订单不动 |
| L2 证书查找（`PlatformCertProvider.getBySerial(s)`） | 同上 | `verifyStatus=CERT_NOT_FOUND`，return 200，订单不动 |
| L3 解密 resource（APIv3 AEAD-AES-GCM） | 同上 | `verifyStatus=PARSE_FAILED`，return 200，订单不动 |
| L4 金额校验（amount.total === order.amountCents） | `applyWechatPayNotify` | `error=AMOUNT_MISMATCH`，return 200，**严重告警** |
| L5 商户/应用校验（appId + mchId） | 同上 | `error=APP_OR_MCH_MISMATCH`，return 200，**严重告警** |
| L6 trade_state 终态判断 | 同上 | 详 §4.1.2 |
| L7 ledger UNIQUE(idemKey) | DB 约束 | 重发撞 UNIQUE → 事务回滚 → return 200（已 handled） |

#### 告警阈值（仅打结构化日志；MVP 不接外部告警系统）

- `event: wechat_pay_sig_invalid_burst` —— 同 outTradeNo 上 SIG_INVALID 次数 > 3
- `event: wechat_pay_critical_mismatch` —— 任意 AMOUNT_MISMATCH / APP_OR_MCH_MISMATCH 一次
- `event: wechat_pay_unexpected_refund` —— REFUND trade_state（MVP 未开退款，出现即异常）
- `event: wechat_pay_unknown_trade_state` —— V3 API 升级新状态时早警

#### 返码策略

| 内部状态 | HTTP code | 含义 |
|---|---|---|
| 验签失败 / 三联校验失败 / 中间态 / 已 PAID / 未知 trade_state | **200** | "我收到了你也别再发了"（不可恢复 + 已幂等的情况都 ack） |
| 程序 bug / DB 不可达 | **500** | "我没处理好，你重发"（微信会在数分钟内重试） |

#### EXPIRED → PAID 的 grace 路径

慢到的 webhook（用户拖延付款，server-side 已扫 EXPIRED）仍然必须入账：
- 钱已收 → credit 必须给
- EXPIRED 只是 server-side 的清理时间标记，不是支付意义上的失败
- 走与 PENDING → PAID 相同的 atomic apply 逻辑（status 从 EXPIRED 直接跳 PAID，metadata 标记 `grace_after_expiry`）

#### Sweeper（过期订单清理）

- `packages/billing/src/sweeper.ts` `expireStaleOrders(prisma, now): Promise<{ expired: number }>`
- pure function；调用方决定如何调度（dev 手动跑 / CI cron / Vercel Cron / Node setInterval）
- 行为：`updateMany({ where: { status: { in: ["CREATED", "PENDING"] }, expiredAt: { lt: now } }, data: { status: "EXPIRED" } })`
- Plan 3 不接定时器；Plan 4+ 或运维 plan 决定如何触发

## 5. API Surface

### 5.1 tRPC `wallet` 路由（apps/web/server/routers/wallet.ts）

**`toTRPCError` helper 控制流约定**：helper 签名 `function toTRPCError(...): never { throw new TRPCError({...}) }`（Plan 2 既有定义，签名为 `: never`）。但**所有 Plan 3 新增 call site 必须显式写 `throw toTRPCError(...)`**——避免实现者重构时不慎丢失 `: never` 类型推断导致错误路径继续执行。`return toTRPCError(...)` 等写法也禁止；统一 `throw` 关键字明确控制流。

**未成年月度上限算法**（修正后）：未支付订单（CREATED/PENDING）按 `createdAt` 占用**创建月**额度；已支付订单（PAID）按 `paidAt` 计入**实际付款月**。这样跨月边界（5/31 创建、6/1 付款）下额度从 5 月转移到 6 月，符合用户对"充值月"的直觉。需要两条 aggregate 并相加：

```ts
export const walletRouter = router({

  balance: authedProcedure.query(async ({ ctx }) => {
    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    let monthly: { topupYuan: number; remainingYuan: number; limitYuan: number } | null = null;
    if (ctx.auth.isMinor) {
      const used = await sumMonthlyTopupCents(ctx.db, ctx.auth.userId);
      const limit = env.MINOR_MONTHLY_LIMIT_YUAN;
      monthly = {
        topupYuan: used / 100,
        limitYuan: limit,
        remainingYuan: Math.max(0, limit - used / 100),
      };
    }
    return { balance: wallet.balance, monthly };
  }),

  topupCreate: authedProcedure
    .input(z.object({
      amountCents: z.number().int().min(100).max(100_000),  // 1 元 - 1000 元
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. ratelimit (RULE_TOPUP_CREATE_IP + RULE_TOPUP_CREATE_USER, fail-CLOSE)
      const store = ratelimitStore(ctx.redis);
      try {
        const r1 = await takeRule(store, RULE_TOPUP_CREATE_IP, ctx.ip);
        if (!r1.allowed) throw toTRPCError("TOPUP_TOO_FREQUENT", "TOO_MANY_REQUESTS", { retryAfterMs: r1.retryAfterMs });
        const r2 = await takeRule(store, RULE_TOPUP_CREATE_USER, ctx.auth.userId);
        if (!r2.allowed) throw toTRPCError("TOPUP_TOO_FREQUENT", "TOO_MANY_REQUESTS", { retryAfterMs: r2.retryAfterMs });
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) {
          throw toTRPCError("TOPUP_RATE_LIMIT_UNAVAILABLE", "INTERNAL_SERVER_ERROR");
        }
        throw e;
      }

      // 2. ensureWallet
      const wallet = await ensureWallet(ctx.db, ctx.auth.userId);

      // 3. isMinor 月度上限校验（未付按 createdAt + 已付按 paidAt）
      if (ctx.auth.isMinor) {
        const used = await sumMonthlyTopupCents(ctx.db, ctx.auth.userId);
        const limit = env.MINOR_MONTHLY_LIMIT_YUAN * 100;
        if (used + input.amountCents > limit) {
          throw toTRPCError("MINOR_MONTHLY_LIMIT_REACHED", "PRECONDITION_FAILED", {
            monthlyYuan: used / 100, limitYuan: limit / 100, attemptYuan: input.amountCents / 100,
          });
        }
      }

      // 4. credits & outTradeNo & expiredAt
      const credits = (input.amountCents / 100) * env.CREDIT_PER_YUAN;
      const outTradeNo = `zj_${ctx.auth.userId.slice(0, 8)}_${nanoid(12)}`;
      const expiredAt = new Date(Date.now() + 30 * 60 * 1000);

      // 5. create CREATED
      const order = await ctx.db.topupOrder.create({
        data: {
          userId: ctx.auth.userId, amountCents: input.amountCents, credits,
          outTradeNo, expiredAt,
          ipCreated: ctx.ip, userAgent: ctx.ua,
        },
      });

      // 6. adapter.unifiedOrder（仅返 prepayId，不触发 webhook —— 详 §4.1.3 竞态分析）
      const adapter = getWechatPayAdapter();
      let prepayId: string, qrCode: string | undefined, h5Url: string | undefined;
      try {
        const r = await adapter.unifiedOrder({
          outTradeNo, amountCents: input.amountCents,
          description: `智教 Credit 充值 ${input.amountCents / 100} 元`,
        });
        prepayId = r.prepayId;
        qrCode = r.qrCode;
        h5Url = r.h5Url;
      } catch (e) {
        await ctx.db.topupOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
        logger.error({ event: "topup_unified_order_failed", orderId: order.id, error: String(e) }, "unifiedOrder threw");
        throw toTRPCError("TOPUP_ADAPTER_ERROR", "INTERNAL_SERVER_ERROR");
      }

      // 7. update CREATED → PENDING + prepayId
      //    必须在 signalOrderReady 之前完成，否则 mock notify 可能与此 update 竞态
      await ctx.db.topupOrder.update({
        where: { id: order.id },
        data: { status: "PENDING", prepayId },
      });

      // 8. signal adapter that PENDING is persisted（Mock fires local webhook；Real no-op）
      //    swallow 错误（即使 notify 失败也不阻塞 topupCreate；微信重发机制兜底）
      await adapter.signalOrderReady(outTradeNo, input.amountCents);

      return { orderId: order.id, outTradeNo, prepayId, qrCode, h5Url, expiresAt: expiredAt, credits };
    }),

  topupStatus: authedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ ctx, input }) => {
      const o = await ctx.db.topupOrder.findFirst({
        where: { id: input.orderId, userId: ctx.auth.userId }, // 仅本人订单
      });
      if (!o) throw new TRPCError({ code: "NOT_FOUND", cause: { reason: "ORDER_NOT_FOUND" } });
      return { status: o.status, paidAt: o.paidAt, credits: o.credits, expiredAt: o.expiredAt };
    }),

  ledgerList: authedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
      const entries = await ctx.db.creditLedger.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const nextCursor = entries.length > input.limit ? entries.pop()!.id : null;
      return { entries: entries.map(toLedgerView), nextCursor };
    }),

  walletAdminAdjust: permissionProcedure("WALLET_ADJUST")
    .input(z.object({
      targetUserId: z.string(),
      delta: z.number().int().refine(
        n => n !== 0 && Math.abs(n) <= 1_000_000,
        "delta must be non-zero and |delta| <= 1,000,000 credits"
      ),
      reasonCode: z.enum(["FAULT_RECOVERY", "CUSTOMER_SERVICE_GIFT", "PROMO", "FRAUD_CLAWBACK", "OTHER"]),
      reasonDetail: z.string().min(10).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await adminAdjust(ctx.db, {
        targetUserId: input.targetUserId,
        delta: input.delta,
        reasonCode: input.reasonCode,
        reasonDetail: input.reasonDetail,
        opsUserId: ctx.auth.userId,
      });
      logger.info({
        event: "ops_wallet_adjust", opsUserId: ctx.auth.userId,
        targetUserId: input.targetUserId, delta: input.delta,
        reasonCode: input.reasonCode, ledgerId: result.ledgerId,
      }, "OPS adjusted wallet");
      return result;
    }),
});
```

**`sumMonthlyTopupCents` helper**（apps/web/server/wallet-helpers.ts 或 packages/billing/src/monthly-limit.ts；推荐放 billing 包以便 unit-test）：

```ts
/**
 * 上海自然月内的"占用月度额度"统计。
 * - 未支付订单（CREATED/PENDING）按 createdAt 占创建月额度
 * - 已支付订单（PAID）按 paidAt 计入实际付款月（防 5/31 创建、6/1 支付的边界偏差）
 * - EXPIRED / FAILED 不算
 *
 * 返 cents 整数，方便与 amountCents 直接比较。
 */
export async function sumMonthlyTopupCents(prisma: PrismaClient, userId: string): Promise<number> {
  const monthStart = startOfMonthInShanghai(new Date());
  const [unpaidAgg, paidAgg] = await Promise.all([
    prisma.topupOrder.aggregate({
      where: {
        userId,
        status: { in: ["CREATED", "PENDING"] },
        createdAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    }),
    prisma.topupOrder.aggregate({
      where: {
        userId,
        status: "PAID",
        paidAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    }),
  ]);
  return (unpaidAgg._sum.amountCents ?? 0) + (paidAgg._sum.amountCents ?? 0);
}
```

**故意不存在的 procedure**：
- ❌ `wallet.topupConfirm` —— 客户端无任何"标 PAID"能力，唯一真理是 webhook
- ❌ `wallet.topupCancel` —— MVP 让订单走 EXPIRED 自然超时

### 5.2 `/api/wechat-pay/notify` Route Handler

详细实现见 §4.3 / §4.1.1。关键点：
- `runtime = "nodejs"`（不能 edge，需要 `crypto` / `prisma`）
- 先无条件写 `WechatPayEvent`（verifyStatus=PENDING）作为审计日志
- 再调 `adapter.verifyNotify(headers, body)` 验签
- 验签失败 → update event.verifyStatus + return 200
- 验签 OK → `applyWechatPayNotify(...)` 走 §4.1.1 transaction（内部已 catch P2002 → ALREADY_PAID/DUPLICATE_TRANSACTION_ID）
- **正常处理结果（PAID / ALREADY_PAID / FAILED / 三联失败 / 中间态 / 未知 trade_state / UNEXPECTED_REFUND / DUPLICATE_TRANSACTION_ID）一律 return 200**（不让微信重发；不可恢复的写 event.error 留审计）
- **仅程序 bug / DB 完全不可达（applyWechatPayNotify 重抛非 P2002 异常）才 return 500**——这是给微信重发机制的真正信号
- 异常告警通过结构化日志打 `event.error` 字段；MVP 不接外部告警（运维 plan 接入）

### 5.3 `chargedProcedure` 中间件（apps/web/server/trpc.ts）

```ts
// 删除 Plan 2 的 creditPlaceholder；替换为：
export const chargedProcedure = (kind: ActionKind) =>
  authedProcedure.use(async ({ ctx, next, rawInput }) => {
    // 强制要求 input 含 clientRequestId（idemKey 防重试重复扣的核心）
    const parsedInput = z.object({ clientRequestId: z.string().uuid() }).safeParse(rawInput);
    if (!parsedInput.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "缺少 clientRequestId",
        cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" },
      });
    }
    const clientRequestId = parsedInput.data.clientRequestId;

    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    const cost = priceOf(kind);

    // 1. pre-charge
    const debit = await chargeForAction(ctx.db, {
      walletId: wallet.id, kind, cost,
      idemKey: `debit:${kind.toLowerCase()}:${ctx.auth.userId}:${clientRequestId}`,
      createdByUserId: ctx.auth.userId,
    });
    if (debit.kind === "INSUFFICIENT_BALANCE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "余额不足",
        cause: { reason: "INSUFFICIENT_BALANCE", required: cost, balance: debit.balance },
      });
    }

    // 2. next() 抛 = 服务未交付（per §1.8 fail-open compensation）
    try {
      return await next();
    } catch (e) {
      if (shouldCompensate(e)) {
        await compensate(ctx.db, {
          originalLedgerId: debit.ledgerId,
          walletId: wallet.id, cost, kind,
          reason: errorReason(e),
        });
      } else {
        await ctx.db.creditLedger.update({
          where: { id: debit.ledgerId },
          data: { metadata: {
            compensationStatus: "not_compensated_whitelisted",
            errorClass: e?.constructor?.name,
          } },
        });
        logger.warn({
          event: "charged_action_not_compensated",
          ledgerId: debit.ledgerId, walletId: wallet.id, userId: ctx.auth.userId,
          actionKind: kind, cost,
          errorClass: e?.constructor?.name, requestId: ctx.requestId,
        }, "Action failed but whitelisted as non-compensable");
      }
      throw e;
    }
  });
```

**Plan 3 顺手加的 Ctx 字段**：
- `Ctx.requestId: string` —— 来自 `X-Request-Id` header 或 procedure 入口生成 UUID。Plan 4+ 也会用
- `Ctx.auth.isMinor: boolean` —— 从 User 表读，避免每次 chargedProcedure 重查

### 5.4 `packages/billing` 导出函数

```ts
ensureWallet(prisma, userId): Promise<Wallet>
  // prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} })

chargeForAction(prisma, { walletId, kind, cost, idemKey, createdByUserId })
  : Promise<{ kind: "OK", ledgerId, balanceAfter } | { kind: "INSUFFICIENT_BALANCE", balance }>
  // 全程 $transaction：
  //   1. predicate-on-update wallet.balance >= cost → -=cost
  //   2. count !== 1 → re-read balance → return INSUFFICIENT_BALANCE
  //   3. findUnique select balance
  //   4. ledger.create DEBIT idemKey actionKind=kind balanceAfter
  // ledger 撞 UNIQUE → idemKey 已被用过（前端重试同一操作）→ throw IDEMPOTENT_HIT

compensate(prisma, { originalLedgerId, walletId, cost, kind, reason })
  // 全程 $transaction：
  //   1. wallet.update balance += cost
  //   2. findUnique select balance
  //   3. ledger.create COMPENSATION delta=+cost idemKey=`comp:${originalLedgerId}`
  //      refTable="credit_ledger" refId=originalLedgerId
  //      metadata={ reason, originalLedgerId }

applyWechatPayNotify(prisma, verify, expectedAppId, expectedMchId)
  : Promise<{ kind: "PAID" | "FAILED" | "ALREADY_PAID" | "ORDER_NOT_FOUND"
              | "AMOUNT_MISMATCH" | "APP_OR_MCH_MISMATCH"
              | "INTERMEDIATE_STATE_NOTPAY" | "INTERMEDIATE_STATE_USERPAYING"
              | "UNEXPECTED_REFUND" | "UNKNOWN_TRADE_STATE"
              | "DUPLICATE_TRANSACTION_ID" }>
  // 按 §4.1.1 完整实现；transaction 外 catch P2002（idem_key→ALREADY_PAID, transaction_id→DUPLICATE_TRANSACTION_ID）

expireStaleOrders(prisma, now): Promise<{ expired: number }>
adminAdjust(prisma, { targetUserId, delta, reasonCode, reasonDetail, opsUserId })
  : Promise<{ ledgerId, balanceAfter }>
priceOf(kind: ActionKind): number
```

### 5.5 OPS 调账

| 维度 | 决策 |
|---|---|
| UI | **无**（MVP 不上 apps/admin） |
| 入口 | `wallet.walletAdminAdjust` procedure（前端通过 tRPC 调；OPS 用 admin client 或 curl）或一次性 tsx 脚本调 `adminAdjust()` |
| 严禁 | 直接在 Prisma Studio / psql / 任何工具里 `UPDATE wallets SET balance = ...` —— 会绕过 ledger 永久断对账 |
| 警告位置 | `packages/billing/README.md` 顶部一段"账务红线"；CLAUDE.md "Merge 后必跑"段加一条 |

## 6. 限频 / Env / 安全边角

### 6.1 Env validator 扩展

在 `apps/web/server/env.ts`（Plan 2 Task 1 建立的 schema）末尾扩展：

```ts
// === Plan 3: Credit / WeChat Pay ===
WECHAT_PAY_USE_MOCK:      z.enum(["true", "false"]).default("false"),

// 真接才需要（refine 校）
WECHAT_PAY_MCHID:         z.string().optional(),
WECHAT_PAY_API_V3_KEY:    z.string().optional(),
WECHAT_PAY_PRIVATE_KEY:   z.string().optional(),
WECHAT_PAY_CERT_SERIAL:   z.string().optional(),
WECHAT_PAY_PUB_KEY_FILE:  z.string().optional(),
WECHAT_PAY_NOTIFY_HOST:   z.string().url().optional(),

// Mock 模式必需（refine 校 min 16）
MOCK_WECHAT_PAY_SECRET:   z.string().min(16).optional(),

// 业务常量（有默认值）
CREDIT_PER_YUAN:          z.coerce.number().int().min(1).default(10),
MINOR_MONTHLY_LIMIT_YUAN: z.coerce.number().int().min(1).default(200),

// Logger
LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),

// === Refines ===
.refine(
  e => e.WECHAT_PAY_USE_MOCK === "true" ||
       (e.WECHAT_PAY_MCHID && e.WECHAT_PAY_API_V3_KEY &&
        e.WECHAT_PAY_PRIVATE_KEY && e.WECHAT_PAY_CERT_SERIAL && e.WECHAT_PAY_PUB_KEY_FILE),
  "Real WeChat Pay requires WECHAT_PAY_MCHID + API_V3_KEY + PRIVATE_KEY + CERT_SERIAL + PUB_KEY_FILE"
)
.refine(
  e => e.WECHAT_PAY_USE_MOCK !== "true" || e.MOCK_WECHAT_PAY_SECRET,
  "WECHAT_PAY_USE_MOCK=true requires MOCK_WECHAT_PAY_SECRET (min 16 bytes)"
);
```

**配套环境必须同步更新**（Plan 3 实施时一并修，缺一即 boot fail）：

| 文件 | 加入 |
|---|---|
| `.env.example` | `WECHAT_PAY_USE_MOCK=true`、`MOCK_WECHAT_PAY_SECRET=dev-only-mock-pay-secret-32` |
| `apps/web/tests/setup.ts` | 同上两条（`??=`） |
| `apps/web/e2e/global-setup.ts` | spawn child env 加同上两条 |
| **生产部署 checklist** | `WECHAT_PAY_USE_MOCK=false` + 6 个 `WECHAT_PAY_*` real 配齐 |

### 6.2 限频规则扩展

在 `packages/auth/src/ratelimit/rules.ts` 末尾扩展：

```ts
export const RULE_TOPUP_CREATE_IP:   RateLimitRule = {
  prefix: "topup:create:ip:",   capacity: 5,  refillPerSec: 5/60,  failMode: "close"
};
export const RULE_TOPUP_CREATE_USER: RateLimitRule = {
  prefix: "topup:create:user:", capacity: 10, refillPerSec: 10/600, failMode: "close"
};
```

**fail-close 论证**：
- Plan 2 的 register/refresh 用 fail-open 是因为登录是核心可用性主路径（Redis 挂时不能让用户登不上）
- 充值不是同一级别 —— Redis 挂时拒绝创单是可接受的（用户稍后重试）
- 反向：fail-open 在 mock 模式下能被打成 TopupOrder + mock webhook 风暴
- Redis 挂时返：`code: "INTERNAL_SERVER_ERROR"`, `cause: { reason: "TOPUP_RATE_LIMIT_UNAVAILABLE" }`
- 前端 UX："系统繁忙，请稍后再试"

**`chargedProcedure` 不接限频**：扣点本身被余额上限保护；若未来发现"低价 action 被刷"再加。

**`/api/wechat-pay/notify` 不接限频**：流量来自微信，IP 不固定也不公布；限频会破坏可用性。防御靠验签 + 三联校验 + ledger UNIQUE，不靠流控。

### 6.3 未成年月度上限实现细节

| 项 | 决策 |
|---|---|
| 上限值 | `env.MINOR_MONTHLY_LIMIT_YUAN`，默认 200 元 |
| 时区 | `Asia/Shanghai` 自然月（用户在国内）|
| 查源 | 两条 aggregate 之和（详 §5.1 `sumMonthlyTopupCents`）：① `status in (CREATED, PENDING) AND createdAt ≥ 上海月初` ② `status=PAID AND paidAt ≥ 上海月初`。EXPIRED/FAILED 不算 |
| 跨月边界处理 | 5/31 创建 + 6/1 支付 → CREATED/PENDING 在 5 月占额度；支付完成切换到 6 月（按 paidAt）。这是"创建月预占用 + 实际付款月落账"的精确语义 |
| 校验时机 | `wallet.topupCreate` 入口；仅 `ctx.auth.isMinor === true` |
| 行为 | `used + input.amountCents > limit` → `PRECONDITION_FAILED, MINOR_MONTHLY_LIMIT_REACHED, { monthlyYuan, limitYuan, attemptYuan }` |
| UX | `wallet.balance` query 同时返 `monthly.{ topupYuan, remainingYuan, limitYuan }`，前端在创单页提示用户 |
| 边界（接受的小 race）| 两 IP 并发"几乎同瞬间"创单可能小幅超额（被 `RULE_TOPUP_CREATE_IP cap=5` 限 + DB read 等级压窄）；不上 advisory lock |

**时区实现**：用 `Intl.DateTimeFormat` 或 `date-fns-tz`（如果已是 deps）；不引入新依赖前先 grep 现有依赖。

### 6.4 输入校验与防注入

| 字段 | 校验 |
|---|---|
| `amountCents` | `z.number().int().min(100).max(100_000)`（1 元 - 1000 元） |
| `clientRequestId`（任何 chargedProcedure input） | `z.string().uuid()` 必填 |
| `outTradeNo` | **服务端生成**，`zj_${userId.slice(0,8)}_${nanoid(12)}`；客户端无法影响 |
| `topupStatus.orderId` query | userId scope filter，防越权查他人订单 |
| OPS `targetUserId` | `findUniqueOrThrow`，缺 → NOT_FOUND |
| OPS `delta` | `int + abs <= 1_000_000 + !=0`（refine） |
| OPS `reasonCode` | enum 限定 |
| OPS `reasonDetail` | `min(10).max(500)` |
| webhook `rawBody` | 解析失败也保留原文供事后查 |

全程 Prisma client，零 raw SQL（沿用 Plan 1/2 工艺）。

### 6.5 PII / 审计资产保留

| 表 / 字段 | 含 PII | 保留 | 上线前必须由 |
|---|---|---|---|
| `Wallet` (userId / balance) | 否 | 不实现自动清理；DB 全量保留 | — |
| `CreditLedger` | 否（不存 IP / UA / payload）| 同上 | — |
| `TopupOrder.ipCreated / userAgent` | 是（IP / UA） | 同上 | **PII 治理 plan** 定保留期 + 脱敏 |
| `WechatPayEvent.rawBody` | 含微信支付订单号；V3 resource 解密后可能含 `payer.openid` | 同上 | **PII 治理 plan** 定保留期 + 脱敏 |
| structured logger 输出 | 含 userId / IP / outTradeNo | 取决于运维 pipeline | 运维 plan |

**Plan 3 显式 punt**：PII 治理（保留期 / 脱敏 / 用户注销路径 / 数据 export）是独立 plan，与 Plan 3 解耦。Plan 3 只**记录**资产清单 + 安全默认（不 CASCADE 删，强制走 procedure 改账）。**PII 治理 plan 是 Plan 3 prod ship prereq**（不是可选 future plan）。

### 6.6 Structured logger

Plan 3 第一次有"需要正经结构化日志"的需求（不补偿告警 / webhook 异常事件 / OPS 调账审计）。

| 决策 | 选择 | 理由 |
|---|---|---|
| 库 | **pino** | Node 生态标准、零依赖、JSON line、性能好 |
| 路径 | `apps/web/server/logger.ts` | 与 server/env.ts、server/context.ts 同级；clear server-only signal |
| 第一行 | `import "server-only"` | Next 编译期防止误进 client bundle |
| 输出 | stdout JSON line | 让运维 pipeline 接（运维 plan 决定 Sentry / Datadog / ELK） |
| 日志级别 | `env.LOG_LEVEL ?? "info"` | LOG_LEVEL 作 optional env，dev 可设 "debug" |
| Redact | `redact: ["req.headers.cookie", "req.headers.authorization", "*.rawBody"]` | 防误打 cookie 和 webhook 加密 payload |

调用 site：
- `chargedProcedure` 不补偿分支
- `applyWechatPayNotify` 异常 case（AMOUNT_MISMATCH / APP_OR_MCH_MISMATCH / UNEXPECTED_REFUND / UNKNOWN_TRADE_STATE）
- `wallet.topupCreate` adapter 抛错时
- `walletAdminAdjust` 每次调账（含 reasonCode + opsUserId）
- **不**在 hot path 上每次都打（spam 风险）—— 只打"判断 + 异常"路径

**Plan 3 加 pino 进 `apps/web` 依赖**：`pnpm add pino @types/pino --filter @zhijiao/web`。运维 plan 之后加 transport。

## 7. 测试矩阵

详见 brainstorm Section 6.1（不重复贴）。要点：

### 7.1 测试基础设施扩展

- `packages/db/scripts/setup-test-dbs.ts` 加 `zhijiao_test_billing`（第 6 个 per-pkg test DB）
- 新建 `packages/billing/vitest.config.ts` 指 `zhijiao_test_billing`
- `packages/billing/tests/test-utils.ts` 复用 `@zhijiao/db/test-utils` 的 `prisma + resetDb`，加 `waitForCondition(fn, {timeoutMs, intervalMs})` helper
- `apps/web/tests/setup.ts` 加 `WECHAT_PAY_USE_MOCK=true` + `MOCK_WECHAT_PAY_SECRET=...`
- `apps/web/e2e/global-setup.ts` spawn child env 同上

### 7.2 必须覆盖的关键 race / 边界

- **充值幂等**：UNIQUE(idemKey=`topup:${outTradeNo}`) 顶重复 webhook
- **扣点幂等**：UNIQUE(idemKey=`debit:...:${clientRequestId}`) 顶 client 重试
- **充值并发 → ALREADY_PAID**：`Promise.all([fireMockNotify, fireMockNotify])` 同 outTradeNo 两条 webhook 同时进入 `applyWechatPayNotify`，第二条 P2002 → 外层 catch → 返 `ALREADY_PAID`；DB 真理断言 `wallet.balance` 只 +credits 一次、`creditLedger` TOPUP entry 恰好 1 条、route 返 200（**不**返 500）
- **扣点并发**：两 charged action 同时（同 / 不同 clientRequestId）按余额够不够并发安全
- **跨月边界**：5/31 23:55 创建 + 6/1 00:10 付款 → 5 月 query 看不到此单计数（已切到 paidAt=6/1）；6 月 query 算进 paidAt=6/1 那条
- **未付订单占额度**：CREATED/PENDING 订单按 createdAt 占当月额度；EXPIRED/FAILED 即时释放（不再算）
- **月度上限并发**：两 IP 同瞬间创单可能小幅超额（被 RULE_TOPUP_CREATE_IP cap=5 限）；测试断言此 race 可见但被限频压窄
- **fail-close 限频在 Redis down 时**：模拟 Redis 不可用（端口关 / mock store 抛 `RateLimitBackendDownError`），断言 `topupCreate` 返 `TOPUP_RATE_LIMIT_UNAVAILABLE`（不继续下单、TopupOrder 表无新行）
- **mock unifiedOrder 不自动 fire notify**（防 §4.1.3 竞态）：构造一个只有 `unifiedOrder` 没调 `signalOrderReady` 的 path，断言 `/api/wechat-pay/notify` 完全没被调（mock notify URL 上挂一个 spy fetch 监控）
- **signalOrderReady 在 PENDING 之后**：在 mock notifyMode="sync" 下，跑 happy-path 后断言 TopupOrder.status 最终是 PAID（不是 PENDING）—— 间接证明 update PENDING 发生在 mock notify 之前
- **EXPIRED → PAID grace**：sweeper 标 EXPIRED 后慢到的 webhook 仍入账
- **不补偿白名单**：`ComplianceRejectedError` 抛时不补偿 + metadata 标记 + 结构化日志
- **未知错补偿**：默认抛错时补偿（fail-open）
- **三联校验**：AMOUNT_MISMATCH / APP_OR_MCH_MISMATCH 不入账 + 告警日志
- **`clientRequestId` 必填**：缺则 BAD_REQUEST + `CLIENT_REQUEST_ID_REQUIRED`

## 8. 阶段顺序（Plan 3 内部 task 排序）

| # | Task | 说明 | 依赖 |
|---|---|---|---|
| 0 | 仓库卫生 / 起 worktree | 沿用 Plan 2 Hardening Task 0 工艺 | — |
| 1 | `packages/billing` 包脚手架 + per-pkg test DB | 第 6 个 test DB；扩 `setup-test-dbs.ts` + 根 `package.json` | 0 |
| 2 | Prisma migration | Wallet / CreditLedger / TopupOrder / WechatPayEvent + 3 enums + 索引 | 0 |
| 3 | `packages/billing` 核心函数 | ensureWallet / chargeForAction / compensate / priceOf + unit tests | 1, 2 |
| 4 | `packages/billing` 支付应用层 | applyWechatPayNotify / expireStaleOrders / adminAdjust + unit tests | 3 |
| 5 | `packages/integrations` WeChat Pay adapter | Adapter 接口 + Mock（3 notifyMode）+ Real skeleton + PlatformCertProvider + build factory + 单测 | 0 |
| 6 | env validator 扩展 + 配套 env 更新 | `apps/web/server/env.ts` + `.env.example` + `tests/setup.ts` + `e2e/global-setup.ts` 同步 | 0 |
| 7 | 限频规则扩展 + Redis-down 测试 | `packages/auth/src/ratelimit/rules.ts` 加 RULE_TOPUP_CREATE_{IP,USER}（fail-close）；Redis 不可用模拟 | 0 |
| 8 | Ctx 扩展 + pino logger 引入 | `apps/web/server/context.ts` 加 `requestId` / `isMinor`；`pnpm add pino`；新建 `apps/web/server/logger.ts` (`import "server-only"`)；加 `LOG_LEVEL` env | 6 |
| 9 | `chargedProcedure` 中间件 | 替换 `creditPlaceholder`；input schema 强校验 `clientRequestId` | 3, 8 |
| 10 | `wallet` tRPC 路由 | balance / topupCreate / topupStatus / ledgerList / walletAdminAdjust + integration tests | 4, 5, 6, 7, 8 |
| 11 | `/api/wechat-pay/notify` handler | 验签 / 三联校验 / atomic apply / 返码策略 + integration tests | 4, 5 |
| 12 | 接入 `tutor.ask` | input 加 `clientRequestId`；`creditPlaceholder("TUTOR_ASK")` → `chargedProcedure("TUTOR_ASK")` + integration tests | 9 |
| 13 | UI（最小化） | 充值入口页 / 余额组件 / 简易 ledger 列表 | 10 |
| 14 | E2E | topup-mock-happy-path + tutor-with-credit | 10, 11, 12, 13 |
| 15 | 全量回归 + CLAUDE.md 更新 | 仿照 Plan 2 Hardening Task 9；加 Plan 3 已落地条目 + Merge 验收清单 prereq 区分 | 14 |

依赖路径：1+2 → 3 → 4 / 9 → 12 → 14；5 / 6 / 7 / 8 可并行；10 / 11 在所有基础设施 OK 后。预估 worktree 内 4-6 个工作日量。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| `wallet.balance` 与 `ledger SUM(delta)` 不一致 | `balanceAfter` snapshot 列做对账；CI 中加一条"周期性 reconcile"测试（可选） |
| 微信 webhook 重发风暴 / 异常 trade_state | At-least-once 防御 7 层（§4.3）；UNKNOWN_TRADE_STATE 早警避免 V3 升级 surprise |
| Mock secret 泄露 → 本地客户端伪造 webhook | `MOCK_WECHAT_PAY_SECRET min(16)` + 生产 `WECHAT_PAY_USE_MOCK=false`；env validator boot-fail 保证不会"勿用 mock 上 prod" |
| 未成年月度上限被并发绕过 | CREATED+PENDING+PAID 累计算（含未付）；`RULE_TOPUP_CREATE_IP cap=5/min` 限并发；接受微小 race |
| Plan 3 落地后 PII 资产堆积 | spec 显式标 PII 治理 plan 为 prod ship prereq；Plan 3 不假装解决它 |
| 真接 V3 API skeleton 与 Mock 行为分歧 | `WechatPayAdapter` 接口共享；`build.test.ts` 覆盖两条 path；Real 路径激活时单独走 V3 API contract test plan |
| OPS 误操作大额调账 | `|delta| <= 1_000_000` + `reasonDetail.min(10)` + 每次调账打结构化日志 + 严禁 Studio 直改 |
| Postgres `Read Committed` 隔离下 charge race | 与 Plan 2 Hardening Task 3/4 同款，行级锁兜底；race tests 在 `packages/billing/tests/charge.test.ts` |
| pino 引入打破现有 build | Next 14 + pino 5 兼容；Plan 3 实施时跑一轮 `next build` 验证；可在 dep PR 单独验 |

## 附录 A：核心常量

```ts
// packages/billing/src/pricing.ts
export type ActionKind =
  | "TUTOR_ASK"
  | "PAPER_GEN"
  | "LESSON_PLAN_GEN"
  | "PPT_GEN"
  | "VARIANT_GROUP_GEN"
  | "ERROR_ANALYSIS";

export const PRICING: Record<ActionKind, number> = {
  TUTOR_ASK: 1,
  PAPER_GEN: 5,
  LESSON_PLAN_GEN: 3,
  PPT_GEN: 5,
  VARIANT_GROUP_GEN: 3,
  ERROR_ANALYSIS: 1,
};

export function priceOf(kind: ActionKind): number {
  const p = PRICING[kind];
  if (p == null) throw new Error(`Unknown action kind: ${kind}`);
  return p;
}
```

Plan 3 MVP **只接** `TUTOR_ASK`（套 `chargedProcedure`）；其余 action 在 map 留位但中间件不套（实现各自功能的 plan 负责接入）。

## 附录 B：微信 V3 trade_state 完整映射

| trade_state | 终态？ | 我们的处理 |
|---|---|---|
| `SUCCESS` | 是 | PENDING/EXPIRED → PAID + 入账 |
| `CLOSED` | 是 | PENDING → FAILED |
| `PAYERROR` | 是 | PENDING → FAILED |
| `REVOKED` | 是 | PENDING → FAILED（仅刷卡支付有此态） |
| `NOTPAY` | 否（中间态） | 写 event.error=INTERMEDIATE_STATE_NOTPAY，TopupOrder 不动 |
| `USERPAYING` | 否（中间态） | 写 event.error=INTERMEDIATE_STATE_USERPAYING，TopupOrder 不动 |
| `REFUND` | 是（退款）| MVP 不开退款 → event.error=UNEXPECTED_REFUND，告警 |
| 未知值 | — | event.error=UNKNOWN_TRADE_STATE，告警（防 V3 升级 surprise） |

## 附录 C：与 Plan 2 / Plan 2 Hardening 工艺一致性对照

| 工艺 | Plan 2 / 2H 来源 | Plan 3 沿用 |
|---|---|---|
| Adapter 模式（mock 主 + 真接留好）| SMS / WeChat H5 OAuth | WeChat Pay |
| `*_USE_MOCK==="true"` 唯一开关 + boot fail-close | Plan 2 Hardening Task 1/2 | WECHAT_PAY_USE_MOCK + MOCK_WECHAT_PAY_SECRET |
| zod env validator + refine | Plan 2 Hardening Task 1 | 加 9 字段 + 2 refine |
| Predicate-on-update 原子化 | Plan 2 Hardening Task 3/4 | wallet.balance 扣点 |
| Append-only 设计（事件可追） | Plan 2 Hardening Task 5 (Session.revokedAt DB truth) | CreditLedger + WechatPayEvent |
| 限频接入（takeRule / RedisRateLimitStore） | Plan 2 Hardening Task 7 | RULE_TOPUP_CREATE_{IP,USER}（fail-close 与 register/refresh 的 open 区别明确） |
| Race tests（DB 真理断言副作用次数） | Plan 2 Hardening Task 3/4 | charge / compensate / webhook 重发 |
| Per-package test DB 隔离 | Plan 2 Hardening Task -1 | 加 zhijiao_test_billing |
| `import "server-only"` 防 client bundle 误引 | Plan 2 Hardening Task 1 (env.ts) | logger.ts |
| Merge 验收清单（不只是绿测试）| Plan 2 Hardening Task 9 | spec 9.3 加 Plan 3 条目 |
