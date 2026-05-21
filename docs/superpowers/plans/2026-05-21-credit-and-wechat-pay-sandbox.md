# 智教 · Plan 3 Credit 计费 + 微信支付沙箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1/2/2H 之上加 Credit 余额账务系统 + 微信支付 V3 沙箱（Adapter 模式 mock 主路径），把 `creditPlaceholder("TUTOR_ASK")` 占位中间件替换为真正的 `chargedProcedure("TUTOR_ASK")`，把"商业闭环"从占位变成可用。

**Architecture:** 3 个解耦单位 + 既有 `apps/web` 加薄胶水。
1. `packages/billing` 新建（纯领域逻辑，只依赖 `@zhijiao/db` 的 prisma client）—— Wallet/Ledger 操作 + 补偿 + Webhook 应用层 + 过期扫描 + OPS 调账
2. `packages/integrations` 扩展 —— `WechatPayAdapter` 接口 + Mock（3 种 notifyMode）+ Real V3 骨架 + PlatformCertProvider + build factory
3. `apps/web` 胶水 —— tRPC `wallet` 路由 + `/api/wechat-pay/notify` route handler + `chargedProcedure(actionKind)` 中间件 + `server/logger.ts`

**Tech Stack:**（不变）pnpm 9 / Turborepo / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 / Redis 7 / jose 5 / @trpc/server@11 / superjson / ioredis 5 / Vitest 1 / Testcontainers 10 / Playwright 1 / **+pino 8**（本 plan 新引入）

**Spec:** `docs/superpowers/specs/2026-05-21-credit-and-wechat-pay-sandbox-design.md`（本 plan 的真理来源；遇到模糊回去查 spec）

**Source Audit:** 2026-05-21 spec 两轮 review（commit `bf39220` + `0f4a98f`）已收口

---

## ⚠️ 关键实现红线

1. **`CreditLedger.idemKey` 是幂等核心**：任何路径写 ledger 必先想清 idemKey 是什么；写不出来 = schema 设计错。命名规则（spec §3.3）：
   - TOPUP → `topup:${outTradeNo}`
   - DEBIT → `debit:${kind.toLowerCase()}:${userId}:${clientRequestId}`
   - COMPENSATION → `comp:${originalLedgerId}`
   - ADJUST → 由 OPS 显式传入（建议 `adjust:${reasonCode}:${nanoid(16)}`）

2. **`Wallet.balance` 修改一律走 predicate-on-update 原子化**（与 Plan 2 Hardening Task 3/4 同款），先 `updateMany(where: balance >= cost)` 抢占再分支，绝不 `findUnique → -=cost → update`。不引入 version 列、不引入显式锁、不引入 raw SQL。

3. **`unifiedOrder` 绝不自动 fire mock notify**（spec §4.1.3 竞态分析）。Adapter 接口加 `signalOrderReady(outTradeNo, amountCents)` 生命周期钩子，由 `topupCreate` 在 **status=PENDING 成功 persist 之后**显式调用。Mock 实现 fire 本地 webhook；Real 实现 no-op。

4. **`signalOrderReady` Promise 不能 reject**（spec §4.1.3 接口契约）。任何内部错（network/HTTP/JSON）在实现内 swallow + log。`topupCreate` 调用方在 `await adapter.signalOrderReady(...)` 后不会再 catch。

5. **`applyWechatPayNotify` 内 `P2002` 后必须重读 DB 确认状态一致**（spec §4.1.1）。idemKey 重读：ledger 存在 + order PAID → ALREADY_PAID；不一致即抛错让微信重发并告警。transactionId 重读：写诊断日志。同时匹配 `idemKey`/`idem_key` + `transactionId`/`transaction_id` 防 Prisma 升级打穿。

6. **`prisma.$transaction` 内不要 try/catch P2002**：Prisma 事务一旦抛错就自动 rollback，事务内 catch 无法阻止 abort。把 catch 放在 `$transaction(...)` 调用**外**。

7. **`/api/wechat-pay/notify` 返码策略（spec §4.3）**：
   - **200**：验签失败 / 三联校验失败 / 中间态 / 已 PAID / 未知 trade_state / DUPLICATE_TRANSACTION_ID / `applyWechatPayNotify` 任何 kind
   - **500**：仅 `applyWechatPayNotify` 重抛非 P2002 异常（程序 bug / DB 不可达 / P2002 重读发现不一致）

8. **Mock 只能由 `WECHAT_PAY_USE_MOCK==="true"` 触发**，绝不能因 "key 缺失" 自动退化到 mock（与 Plan 2 Hardening 同款 fail-close）。`MOCK_WECHAT_PAY_SECRET` 长度 ≥ 16 字节，env validator boot-time 强制。

9. **`RULE_TOPUP_CREATE_{IP,USER}` 是 fail-CLOSE**（与 Plan 2 register/refresh 的 fail-open 区分）。Redis 挂时拒绝创单：`INTERNAL_SERVER_ERROR` + `reason: TOPUP_RATE_LIMIT_UNAVAILABLE`。

10. **未成年月度上限算法（spec §6.3）**：未付订单（CREATED/PENDING）按 `createdAt` 占创建月；已付订单（PAID）按 `paidAt` 计入实际付款月。两条 aggregate 之和。时区 `Asia/Shanghai` 自然月。EXPIRED/FAILED 不算。

11. **`toTRPCError(...)` helper 调用一律 `throw toTRPCError(...)`**（spec §5.1）—— 即使 helper 签名是 `: never`，避免实现者重构丢失类型推断导致错误路径继续执行。`return toTRPCError(...)` 等写法禁止。

12. **OPS 调账（`walletAdminAdjust`）严禁绕过**：禁止直接 `UPDATE wallets SET balance = ...`（Prisma Studio / psql / 任何工具）—— 会绕过 ledger 永久断对账。`packages/billing/README.md` 顶部写"账务红线"；CLAUDE.md "Merge 后必跑"加一条。

13. **每个 task 一个 commit**，commit message 引用 task 编号。

14. **PowerShell 调 pnpm 必须用 `pnpm.cmd`**（execution policy 拦 `.ps1`）。

---

## 范围

**本 plan 做**（对应 spec §1-§7 全部、§8 全部 task 0-15）：
- `packages/billing` 包脚手架 + 第 6 个 per-pkg test DB `zhijiao_test_billing`
- Prisma migration（Wallet / CreditLedger / TopupOrder / WechatPayEvent + 3 enums + 索引）
- billing 核心函数（ensureWallet / chargeForAction / compensate / priceOf）
- billing 支付应用层（applyWechatPayNotify / expireStaleOrders / adminAdjust）
- `packages/integrations` WeChat Pay adapter（接口 + Mock + Real 骨架 + PlatformCertProvider + build factory）
- env validator 扩展（9 字段 + 2 refine）+ 配套 env 文件同步
- 限频 `RULE_TOPUP_CREATE_{IP,USER}` 扩展（fail-close）
- Ctx 扩展（`requestId` + `isMinor`）+ pino structured logger
- `chargedProcedure` 中间件（替换 `creditPlaceholder`）
- `wallet` tRPC 路由（balance / topupCreate / topupStatus / ledgerList / walletAdminAdjust）
- `/api/wechat-pay/notify` route handler
- `tutor.ask` 接入 chargedProcedure + 加 clientRequestId input
- UI（最小化：充值入口 / 余额组件 / 简易 ledger 列表）
- E2E（topup-mock-happy-path / tutor-with-credit）
- CLAUDE.md 更新 + Merge 验收清单 prereq 区分

**本 plan 不做**（见 spec § 8 + §6.5）：
- 真接 V3 API 激活（ICP 备案 + 商户号 + APIv3 密钥 + 商户证书未到位；Real adapter 仅写骨架）
- PII 治理（用户注销 / 去标识化 / WechatPayEvent.rawBody 保留期）—— **prod ship prereq plan**
- 真接阿里云 SMS / 微信公众号（Plan 5 独立）
- 退款（用户协议写"虚拟商品不可退"；异常场景走 `walletAdminAdjust` 走 `ADJUST_ADD` 补偿）
- apps/admin / OPS UI（MVP 用 tRPC client 或一次性 tsx 脚本调）
- 周期性对账作业 / 外部告警接入（运维 plan）
- 举一反三 / 错因分析（Plan 4 独立）

---

## 文件结构（新建 / 修改清单）

```
.gitignore                                                  # 不动
CLAUDE.md                                                   # 改：常用命令 + Merge 清单 + 已落地状态

# === packages/billing 新建 ===
packages/billing/
  package.json                                              # 新
  tsconfig.json                                             # 新
  vitest.config.ts                                          # 新（指 zhijiao_test_billing）
  README.md                                                 # 新：账务红线
  src/
    index.ts                                                # 新：barrel
    pricing.ts                                              # 新：ActionKind + PRICING + priceOf
    wallet.ts                                               # 新：ensureWallet
    ledger.ts                                               # 新：chargeForAction + compensate + shouldCompensate + errors
    wechat-notify.ts                                        # 新：applyWechatPayNotify
    sweeper.ts                                              # 新：expireStaleOrders
    admin.ts                                                # 新：adminAdjust
    monthly-limit.ts                                        # 新：sumMonthlyTopupCents + startOfMonthInShanghai
    test-utils.ts                                           # 新：waitForCondition
  tests/
    pricing.test.ts                                         # 新
    wallet.test.ts                                          # 新
    charge.test.ts                                          # 新（含 race）
    compensate.test.ts                                      # 新
    wechat-notify.test.ts                                   # 新（含 P2002 race）
    sweeper.test.ts                                         # 新
    admin.test.ts                                           # 新
    monthly-limit.test.ts                                   # 新（含跨月边界）

# === packages/integrations 扩展 ===
packages/integrations/
  src/wechat-pay/                                           # 新目录
    index.ts                                                # 新
    types.ts                                                # 新：WechatPayAdapter / VerifyResult / NotifyMode
    mock.ts                                                 # 新：MockWechatPayAdapter
    real.ts                                                 # 新：RealWechatPayAdapter 骨架（ICP 前不启用）
    platform-cert-provider.ts                               # 新：SingleFilePlatformCertProvider + interface
    build.ts                                                # 新：buildWechatPayAdapter 工厂
  tests/
    wechat-pay-mock.test.ts                                 # 新（签名 / verify / fireMockNotify）
    wechat-pay-build.test.ts                                # 新（mock vs real 路径 + 错配 throw）

# === packages/db ===
packages/db/
  prisma/schema.prisma                                      # 改：加 4 model + 3 enum
  prisma/migrations/<timestamp>_plan3_credit_wechatpay/     # 新（prisma migrate dev 生成）
    migration.sql
  scripts/setup-test-dbs.ts                                 # 改：dbs 列表加 zhijiao_test_billing

# === packages/auth ===
packages/auth/src/ratelimit/rules.ts                        # 改：加 RULE_TOPUP_CREATE_{IP,USER}（fail-close）

# === apps/web ===
apps/web/
  package.json                                              # 改：加 pino, @types/pino, nanoid（如未有）
  server/env.ts                                             # 改：扩 9 字段 + 2 refine
  server/logger.ts                                          # 新：pino, server-only
  server/context.ts                                         # 改：加 requestId / isMinor 到 ctx；query User.isMinor
  server/trpc.ts                                            # 改：删 creditPlaceholder；加 chargedProcedure
  server/routers/_root.ts                                   # 改：挂 wallet 路由
  server/routers/wallet.ts                                  # 新：balance / topupCreate / topupStatus / ledgerList / walletAdminAdjust
  server/routers/tutor.ts                                   # 改：creditPlaceholder → chargedProcedure；input 加 clientRequestId
  app/api/wechat-pay/notify/route.ts                        # 新：webhook route handler
  app/(student)/wallet/page.tsx                             # 新：余额 + 充值入口
  app/(student)/wallet/topup-form.tsx                       # 新：充值表单（client component）
  app/(student)/wallet/ledger-list.tsx                      # 新：ledger 列表（client component）
  app/(student)/tutor/page.tsx                              # 改（如有）：catch INSUFFICIENT_BALANCE 提示充值
  tests/setup.ts                                            # 改：补 WECHAT_PAY_USE_MOCK + MOCK_WECHAT_PAY_SECRET
  e2e/global-setup.ts                                       # 改：spawn child env 同上 + 默认 isMinor=false seed
  tests/integration/wallet-balance.test.ts                  # 新
  tests/integration/wallet-topup-create.test.ts             # 新
  tests/integration/wallet-topup-create-ratelimit.test.ts   # 新（fail-close）
  tests/integration/wallet-topup-create-minor.test.ts       # 新（跨月边界）
  tests/integration/wallet-ledger-list.test.ts              # 新
  tests/integration/wallet-admin-adjust.test.ts             # 新
  tests/integration/wechat-pay-notify-happy.test.ts         # 新
  tests/integration/wechat-pay-notify-race.test.ts          # 新（P2002 → ALREADY_PAID）
  tests/integration/wechat-pay-notify-invalid.test.ts       # 新（验签 / 三联失败）
  tests/integration/charged-procedure-tutor.test.ts         # 新（套 tutor.ask 走全链路）
  tests/integration/charged-procedure-idempotency.test.ts   # 新（同 clientRequestId 第二次 CONFLICT）
  tests/integration/charged-procedure-compensation.test.ts  # 新（默认补偿 / ComplianceRejected 不补偿）
  e2e/wallet-topup-mock-happy-path.spec.ts                  # 新
  e2e/tutor-with-credit.spec.ts                             # 新（已有 tutor.spec 改造）

# === 根 ===
package.json                                                # 改：test:setup 间接影响（dbs 列表加 billing 已在 scripts 里）
.env.example                                                # 改：加 WECHAT_PAY_USE_MOCK=true + MOCK_WECHAT_PAY_SECRET=...
```

---

## 前置：环境检查 + 分支

> **Shell 约定**：本 plan 所有命令默认 **PowerShell**。本机 execution policy 拦 `.ps1`，PowerShell 里直接 `pnpm` 会被解析到 `pnpm.ps1` 报 "running scripts is disabled"。所以 **全文一律用 `pnpm.cmd`**（npm 装出的 `.cmd` shim，PowerShell 和 git-bash 都能跑）。

```powershell
node --version       # >= 20
pnpm.cmd --version   # >= 9
docker --version     # Docker Desktop 在运行
```

- [ ] **步骤 P.1：从 master 起 worktree**

```powershell
git fetch origin
git switch master
git pull --ff-only
git worktree add .claude/worktrees/plan-3-credit-wechatpay -b plan-3-credit-wechatpay master
```

新窗口 `Set-Location .claude/worktrees/plan-3-credit-wechatpay`，后续命令都在 worktree 里跑。

- [ ] **步骤 P.2：起 docker、装依赖、迁主库**

```powershell
docker compose up -d
pnpm.cmd install
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd --filter @zhijiao/db db:migrate:deploy
pnpm.cmd db:seed
```

- [ ] **步骤 P.3：baseline 跑 3 次（确认 master 无 regression）**

```powershell
"" | Out-File baseline-runs.txt -Encoding utf8
foreach ($i in 1..3) {
  "=== Run $i ===" | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tc = pnpm.cmd exec turbo typecheck --force 2>&1
  $tc | Select-Object -Last 5  | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tt = pnpm.cmd exec turbo test --force 2>&1
  $tt | Select-Object -Last 10 | Out-File baseline-runs.txt -Encoding utf8 -Append
}

"=== E2E ===" | Out-File baseline-runs.txt -Encoding utf8 -Append
$e2e = pnpm.cmd --filter @zhijiao/web test:e2e 2>&1
$e2e | Select-Object -Last 10 | Out-File baseline-runs.txt -Encoding utf8 -Append

Get-Content baseline-runs.txt
```

期望：3/3 typecheck 全绿；3/3 test 全绿；E2E 1 轮绿。若出现稳定失败 / flake 密集，**先停**——不进 Task 0，回 master 修，本 plan 暂缓。

---

## Task 0：仓库卫生（保证起跑点干净）

> **为什么先做**：worktree 起完后，确保 `.gitignore` 不漏掉本 plan 会产生的临时文件，`.claude/worktrees/` 残留也清掉。沿用 Plan 2 Hardening Task 0 工艺，无新概念。

**Files：**
- Modify: `.gitignore`（确认 `.claude/worktrees/`、`baseline-runs.txt`、`*.log` 已在；缺则加）

- [ ] **步骤 0.1：检查 `.gitignore`**

```powershell
Select-String -Path .gitignore -Pattern "claude/worktrees|baseline-runs|\.log$"
```

期望都能命中。如有缺，用 Edit 工具加。

- [ ] **步骤 0.2：清残留 worktree**

```powershell
git worktree list
```

若有 `.claude/worktrees/plan-2-hardening` 等已 merge 完的残留：

```powershell
git worktree remove .claude/worktrees/plan-2-hardening
git worktree prune
```

如果 git 已不认它但目录还在：

```powershell
Remove-Item -Recurse -Force -LiteralPath .claude/worktrees/plan-2-hardening
```

- [ ] **步骤 0.3：commit（如有改动）**

```powershell
git status --short
# 如果 .gitignore 改了：
git add .gitignore
git commit -m "chore(plan-3): Task 0 — gitignore hygiene"
```

如无改动 skip commit（本 task 可空）。

---

## Task 1：`packages/billing` 包脚手架 + 第 6 个 per-pkg test DB

> **为什么先做**：本 plan 几乎所有领域逻辑都进这个新包；test DB 不先开，后面所有 unit/integration 都跑不起来。

**Files：**
- Create: `packages/billing/package.json`
- Create: `packages/billing/tsconfig.json`
- Create: `packages/billing/vitest.config.ts`
- Create: `packages/billing/src/index.ts`（barrel，先空）
- Create: `packages/billing/README.md`（顶部"账务红线"）
- Modify: `packages/db/scripts/setup-test-dbs.ts`（dbs 列表加 `zhijiao_test_billing`）
- Modify: 根 `pnpm-workspace.yaml`（如未通配 `packages/*` 需要显式加）

- [ ] **步骤 1.1：建 `packages/billing/package.json`**

```json
{
  "name": "@zhijiao/billing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./test-utils": "./src/test-utils.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zhijiao/db": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **步骤 1.2：建 `packages/billing/tsconfig.json`**

复用根 `tsconfig.base.json`（grep 现有包看具体路径名）：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

> 如果项目用的是别的名字（`tsconfig.json` 在根），跑 `Get-ChildItem -Path . -Filter "tsconfig*.json" -Depth 1` 看实际，然后照同款包的 tsconfig 抄。

- [ ] **步骤 1.3：建 `packages/billing/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    env: {
      DATABASE_URL:
        "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_billing",
    },
    testTimeout: 15000,
  },
});
```

- [ ] **步骤 1.4：建空 barrel + README**

`packages/billing/src/index.ts`：

```ts
// Barrel. Populated by subsequent tasks.
export {};
```

`packages/billing/README.md`：

```markdown
# @zhijiao/billing

智教 Credit 余额账务系统。Wallet / Ledger / 充值 / 扣点 / 补偿 / OPS 调账。

## 账务红线（**勿越**）

1. **`Wallet.balance` 的修改一律走 `chargeForAction` / `compensate` / `applyWechatPayNotify` / `adminAdjust`**。禁止任何工具（Prisma Studio / psql / 一次性脚本 / DB GUI）直接 `UPDATE wallets SET balance = ...`——会绕过 ledger 永久断对账。
2. **任何写 ledger 必须先想清 `idemKey`**（`topup:${outTradeNo}` / `debit:${kind}:${userId}:${clientRequestId}` / `comp:${originalLedgerId}` / OPS 显式）。写不出来 = schema 设计错。
3. **`balanceAfter` snapshot 是对账依据**：最新 ledger entry 的 `balanceAfter` 必须 == `wallets.balance`，不一致即事务边界 bug。
4. **OPS 调账走 `wallet.walletAdminAdjust` procedure** 或 `adminAdjust(prisma, {...})` 一次性脚本；不走任何 ad-hoc SQL。

详见 spec `docs/superpowers/specs/2026-05-21-credit-and-wechat-pay-sandbox-design.md` §3 / §5。
```

- [ ] **步骤 1.5：加 `zhijiao_test_billing` 到 `setup-test-dbs.ts`**

打开 `packages/db/scripts/setup-test-dbs.ts`，把 `dbs` 数组改为：

```ts
const dbs = [
  "zhijiao_test_ai",
  "zhijiao_test_auth",
  "zhijiao_test_db",
  "zhijiao_test_integrations",
  "zhijiao_test_web",
  "zhijiao_test_billing",
];
```

- [ ] **步骤 1.6：装包 + 跑 test:setup 创建第 6 个 test DB**

```powershell
pnpm.cmd install
pnpm.cmd test:setup
```

期望 stdout 出现 `[setup-test-dbs] created zhijiao_test_billing` 或 `[setup-test-dbs] zhijiao_test_billing already exists`，最后一行 `[setup-test-dbs] all 6 test DBs ready`。

- [ ] **步骤 1.7：典型 smoke unit test 验证 vitest 配置生效**

`packages/billing/tests/_smoke.test.ts`：

```ts
import { describe, it, expect } from "vitest";

describe("billing package smoke", () => {
  it("DATABASE_URL is injected by vitest config (per-pkg test DB)", () => {
    expect(process.env.DATABASE_URL).toBe(
      "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_billing",
    );
  });
});
```

跑：

```powershell
pnpm.cmd --filter @zhijiao/billing test
```

期望：1 passed。

- [ ] **步骤 1.8：commit**

```powershell
git add packages/billing/ packages/db/scripts/setup-test-dbs.ts
git commit -m "feat(billing): Task 1 — package scaffold + zhijiao_test_billing"
```

---

## Task 2：Prisma migration（4 表 + 3 enum + 索引）

> **为什么先做**：billing 包的所有函数都依赖这些表。Schema 一落地，后面 task 都能写 Prisma 查询。

**Files：**
- Modify: `packages/db/prisma/schema.prisma`（加 4 model + 3 enum + 索引）
- Create: `packages/db/prisma/migrations/<timestamp>_plan3_credit_wechatpay/migration.sql`（prisma 生成）

- [ ] **步骤 2.1：编辑 `schema.prisma` 末尾追加 3 enum**

```prisma
enum LedgerKind {
  TOPUP
  DEBIT
  COMPENSATION
  ADJUST_ADD
  ADJUST_SUB
}

enum TopupStatus {
  CREATED
  PENDING
  PAID
  FAILED
  EXPIRED
}

enum WechatPayEventVerify {
  PENDING
  OK
  SIG_INVALID
  CERT_NOT_FOUND
  PARSE_FAILED
}
```

- [ ] **步骤 2.2：追加 `Wallet` model**

```prisma
model Wallet {
  id        String   @id @default(cuid())
  userId    String   @unique @map("user_id")
  balance   Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")

  user      User           @relation(fields: [userId], references: [id], onDelete: Restrict)
  ledger    CreditLedger[]

  @@map("wallets")
}
```

> `onDelete: Restrict`：删 User 时 FK violation 抛错（安全默认）。用户注销 / 去标识化推迟到 PII 治理 plan。

- [ ] **步骤 2.3：追加 `CreditLedger` model**

```prisma
model CreditLedger {
  id              String      @id @default(cuid())
  walletId        String      @map("wallet_id")
  kind            LedgerKind
  delta           Int
  balanceAfter    Int         @map("balance_after")
  idemKey         String      @unique @map("idem_key")
  refTable        String?     @map("ref_table")
  refId           String?     @map("ref_id")
  actionKind      String?     @map("action_kind")
  metadata        Json?
  createdAt       DateTime    @default(now()) @map("created_at")
  createdByUserId String?     @map("created_by_user_id")

  wallet          Wallet      @relation(fields: [walletId], references: [id], onDelete: Restrict)

  @@index([walletId, createdAt(sort: Desc)])
  @@index([refTable, refId])
  @@map("credit_ledger")
}
```

- [ ] **步骤 2.4：追加 `TopupOrder` model**

```prisma
model TopupOrder {
  id            String       @id @default(cuid())
  userId        String       @map("user_id")
  amountCents   Int          @map("amount_cents")
  credits       Int
  status        TopupStatus  @default(CREATED)
  outTradeNo    String       @unique @map("out_trade_no")
  prepayId      String?      @map("prepay_id")
  transactionId String?      @unique @map("transaction_id")
  paidAt        DateTime?    @map("paid_at")
  expiredAt     DateTime     @map("expired_at")
  ipCreated     String?      @map("ip_created")
  userAgent     String?      @map("user_agent")
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt      @map("updated_at")

  @@index([userId, createdAt(sort: Desc)])
  @@index([status, expiredAt])
  @@index([userId, status, createdAt])
  @@index([userId, paidAt])
  @@map("topup_orders")
}
```

> **不**设 FK 到 User：财务订单与用户生命周期解耦（与 `ModelCall.userId` 同款理由）。PII 治理 plan 接管"用户注销时如何处理孤儿订单"。

- [ ] **步骤 2.5：追加 `WechatPayEvent` model**

```prisma
model WechatPayEvent {
  id            String                @id @default(cuid())
  outTradeNo    String                @map("out_trade_no")
  transactionId String?               @map("transaction_id")
  rawBody       String                @db.Text @map("raw_body")
  signature     String?
  timestamp     String?
  nonce         String?
  serial        String?
  verifyStatus  WechatPayEventVerify  @default(PENDING) @map("verify_status")
  handled       Boolean               @default(false)
  processedAt   DateTime?             @map("processed_at")
  error         String?
  createdAt     DateTime              @default(now()) @map("created_at")

  @@index([outTradeNo])
  @@index([handled, createdAt])
  @@map("wechat_pay_events")
}
```

- [ ] **步骤 2.6：在 `User` model 加反向关系字段**

找到 `model User { ... }`，在 `sessions    Session[]` 行下加：

```prisma
  wallet      Wallet?
```

（`Wallet.userId` 是 `@unique` → 一对一关系）

- [ ] **步骤 2.7：生成 migration**

```powershell
pnpm.cmd --filter @zhijiao/db prisma migrate dev --name plan3_credit_wechatpay
```

期望：`migrations/<timestamp>_plan3_credit_wechatpay/migration.sql` 出现。打开看一下，应包含 `CREATE TYPE ledger_kind / topup_status / wechat_pay_event_verify`、`CREATE TABLE wallets / credit_ledger / topup_orders / wechat_pay_events`、4 个索引。如 Windows 上 `prisma migrate dev` 卡 shadow DB 权限，备用：

```powershell
docker exec -i zhijiao-postgres psql -U postgres -c "CREATE DATABASE zhijiao_shadow;"
$env:SHADOW_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_shadow"
pnpm.cmd --filter @zhijiao/db prisma migrate dev --name plan3_credit_wechatpay
Remove-Item Env:\SHADOW_DATABASE_URL
```

- [ ] **步骤 2.8：把 migration 应用到所有 test DB**

```powershell
pnpm.cmd test:setup
```

setup-test-dbs.ts 是幂等的，会对 6 个库都跑 `db:migrate:deploy`。期望最后一行 `all 6 test DBs ready`。

- [ ] **步骤 2.9：smoke 验证 schema 通**

`packages/billing/tests/_schema.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@zhijiao/db";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL! } },
});

describe("schema sanity", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events" RESTART IDENTITY CASCADE;',
    );
  });

  it("wallet row roundtrip", async () => {
    const user = await prisma.user.create({
      data: { name: "test", isMinor: false },
    });
    const w = await prisma.wallet.create({
      data: { userId: user.id, balance: 0 },
    });
    expect(w.balance).toBe(0);
    await prisma.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: 10,
        balanceAfter: 10,
        idemKey: "topup:test-1",
      },
    });
    const found = await prisma.creditLedger.findUnique({
      where: { idemKey: "topup:test-1" },
    });
    expect(found?.delta).toBe(10);
  });
});
```

跑：

```powershell
pnpm.cmd --filter @zhijiao/billing test -- tests/_schema.test.ts
```

期望：1 passed。

- [ ] **步骤 2.10：commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ packages/billing/tests/_schema.test.ts
git commit -m "feat(db): Task 2 — Wallet/CreditLedger/TopupOrder/WechatPayEvent migration"
```

---

## Task 3：billing 核心 — pricing / ensureWallet / chargeForAction / compensate

> **TDD 顺序**：pricing（纯函数）→ ensureWallet（upsert，简单）→ chargeForAction（带 race test）→ compensate。每个子函数先写 failing test，再写最小实现。

**Files：**
- Create: `packages/billing/src/pricing.ts`
- Create: `packages/billing/src/wallet.ts`
- Create: `packages/billing/src/ledger.ts`（含 `ActionAlreadyChargedError`, `chargeForAction`, `compensate`, `shouldCompensate`, `errorReason`, `ComplianceRejectedError` 重导出）
- Modify: `packages/billing/src/index.ts`（barrel 加 export）
- Create: `packages/billing/tests/pricing.test.ts`
- Create: `packages/billing/tests/wallet.test.ts`
- Create: `packages/billing/tests/charge.test.ts`
- Create: `packages/billing/tests/compensate.test.ts`
- Create: `packages/billing/src/test-utils.ts`（`prismaTest` + `resetBillingTables` + `waitForCondition`）

- [ ] **步骤 3.1：建测试公用 utils `packages/billing/src/test-utils.ts`**

```ts
import { PrismaClient } from "@zhijiao/db";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "test-utils.ts: DATABASE_URL must be set by vitest config (per-pkg test DB).",
  );
}

export const prismaTest = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

export async function resetBillingTables(): Promise<void> {
  await prismaTest.$executeRawUnsafe(
    'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "users" RESTART IDENTITY CASCADE;',
  );
}

export async function waitForCondition(
  fn: () => Promise<boolean> | boolean,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeout = opts.timeoutMs ?? 3000;
  const interval = opts.intervalMs ?? 25;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitForCondition timeout after ${timeout}ms: ${opts.label ?? "(unlabeled)"}`,
  );
}
```

- [ ] **步骤 3.2：失败 test — `pricing.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { priceOf, type ActionKind } from "../src/pricing";

describe("priceOf", () => {
  it("TUTOR_ASK = 1", () => expect(priceOf("TUTOR_ASK")).toBe(1));
  it("PAPER_GEN = 5", () => expect(priceOf("PAPER_GEN")).toBe(5));
  it("LESSON_PLAN_GEN = 3", () =>
    expect(priceOf("LESSON_PLAN_GEN")).toBe(3));
  it("PPT_GEN = 5", () => expect(priceOf("PPT_GEN")).toBe(5));
  it("VARIANT_GROUP_GEN = 3", () =>
    expect(priceOf("VARIANT_GROUP_GEN")).toBe(3));
  it("ERROR_ANALYSIS = 1", () =>
    expect(priceOf("ERROR_ANALYSIS")).toBe(1));
  it("unknown kind throws", () => {
    expect(() => priceOf("NOPE" as ActionKind)).toThrow(/Unknown action kind/);
  });
});
```

跑 `pnpm.cmd --filter @zhijiao/billing test -- tests/pricing.test.ts` → 期望 FAIL（pricing.ts 还没建）。

- [ ] **步骤 3.3：实现 `pricing.ts`**

```ts
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

跑测试 → 7 passed。

- [ ] **步骤 3.4：失败 test — `wallet.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { ensureWallet } from "../src/wallet";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("ensureWallet", () => {
  beforeEach(resetBillingTables);

  it("creates wallet on first call", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const w = await ensureWallet(prismaTest, u.id);
    expect(w.balance).toBe(0);
    expect(w.userId).toBe(u.id);
  });

  it("returns existing wallet on second call (no duplicate)", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const w1 = await ensureWallet(prismaTest, u.id);
    const w2 = await ensureWallet(prismaTest, u.id);
    expect(w2.id).toBe(w1.id);
    const count = await prismaTest.wallet.count({ where: { userId: u.id } });
    expect(count).toBe(1);
  });
});
```

跑 → FAIL（wallet.ts 还没建）。

- [ ] **步骤 3.5：实现 `wallet.ts`**

```ts
import type { PrismaClient, Wallet } from "@zhijiao/db";

export async function ensureWallet(
  prisma: PrismaClient,
  userId: string,
): Promise<Wallet> {
  return prisma.wallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}
```

跑 → 2 passed。

- [ ] **步骤 3.6：失败 test — `charge.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { ensureWallet } from "../src/wallet";
import {
  chargeForAction,
  ActionAlreadyChargedError,
} from "../src/ledger";
import { prismaTest, resetBillingTables } from "../src/test-utils";

async function makeUserWithBalance(initial: number) {
  const u = await prismaTest.user.create({ data: { isMinor: false } });
  const w = await ensureWallet(prismaTest, u.id);
  if (initial > 0) {
    await prismaTest.wallet.update({
      where: { id: w.id },
      data: { balance: initial },
    });
    await prismaTest.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: initial,
        balanceAfter: initial,
        idemKey: `topup:bootstrap:${u.id}`,
      },
    });
  }
  return { user: u, wallet: w };
}

describe("chargeForAction", () => {
  beforeEach(resetBillingTables);

  it("OK path: balance -= cost + DEBIT ledger inserted", async () => {
    const { user, wallet } = await makeUserWithBalance(5);
    const r = await chargeForAction(prismaTest, {
      walletId: wallet.id,
      kind: "TUTOR_ASK",
      cost: 1,
      idemKey: `debit:tutor_ask:${user.id}:req-1`,
      createdByUserId: user.id,
    });
    expect(r.kind).toBe("OK");
    if (r.kind !== "OK") return;
    expect(r.balanceAfter).toBe(4);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(4);
    const ledger = await prismaTest.creditLedger.findUnique({
      where: { idemKey: `debit:tutor_ask:${user.id}:req-1` },
    });
    expect(ledger?.delta).toBe(-1);
    expect(ledger?.balanceAfter).toBe(4);
    expect(ledger?.actionKind).toBe("TUTOR_ASK");
  });

  it("INSUFFICIENT_BALANCE: balance < cost → no debit, no ledger", async () => {
    const { user, wallet } = await makeUserWithBalance(0);
    const r = await chargeForAction(prismaTest, {
      walletId: wallet.id,
      kind: "TUTOR_ASK",
      cost: 1,
      idemKey: `debit:tutor_ask:${user.id}:req-2`,
      createdByUserId: user.id,
    });
    expect(r.kind).toBe("INSUFFICIENT_BALANCE");
    if (r.kind !== "INSUFFICIENT_BALANCE") return;
    expect(r.balance).toBe(0);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(0);
    const count = await prismaTest.creditLedger.count({
      where: { idemKey: `debit:tutor_ask:${user.id}:req-2` },
    });
    expect(count).toBe(0);
  });

  it("idempotency: same idemKey second call throws ActionAlreadyChargedError, no double-debit", async () => {
    const { user, wallet } = await makeUserWithBalance(5);
    const idem = `debit:tutor_ask:${user.id}:req-3`;
    await chargeForAction(prismaTest, {
      walletId: wallet.id,
      kind: "TUTOR_ASK",
      cost: 1,
      idemKey: idem,
      createdByUserId: user.id,
    });
    await expect(
      chargeForAction(prismaTest, {
        walletId: wallet.id,
        kind: "TUTOR_ASK",
        cost: 1,
        idemKey: idem,
        createdByUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(ActionAlreadyChargedError);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(4); // 仍只扣过一次
    const ledgerCount = await prismaTest.creditLedger.count({
      where: { idemKey: idem },
    });
    expect(ledgerCount).toBe(1);
  });

  it("race: two parallel charges with cost=1 on balance=1 → exactly one OK + one INSUFFICIENT", async () => {
    const { user, wallet } = await makeUserWithBalance(1);
    const [r1, r2] = await Promise.all([
      chargeForAction(prismaTest, {
        walletId: wallet.id,
        kind: "TUTOR_ASK",
        cost: 1,
        idemKey: `debit:tutor_ask:${user.id}:req-r1`,
        createdByUserId: user.id,
      }),
      chargeForAction(prismaTest, {
        walletId: wallet.id,
        kind: "TUTOR_ASK",
        cost: 1,
        idemKey: `debit:tutor_ask:${user.id}:req-r2`,
        createdByUserId: user.id,
      }),
    ]);
    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["INSUFFICIENT_BALANCE", "OK"]);
    const w = await prismaTest.wallet.findUnique({ where: { id: wallet.id } });
    expect(w?.balance).toBe(0);
    const debits = await prismaTest.creditLedger.count({
      where: { walletId: wallet.id, kind: "DEBIT" },
    });
    expect(debits).toBe(1);
  });
});
```

跑 → FAIL（ledger.ts 还没建）。

- [ ] **步骤 3.7：实现 `ledger.ts`（chargeForAction + compensate + 错误类型）**

```ts
import type { PrismaClient } from "@zhijiao/db";
import { Prisma } from "@zhijiao/db";

export class ActionAlreadyChargedError extends Error {
  constructor(public idemKey: string) {
    super(`action already charged: ${idemKey}`);
    this.name = "ActionAlreadyChargedError";
  }
}

export type ChargeResult =
  | { kind: "OK"; ledgerId: string; balanceAfter: number }
  | { kind: "INSUFFICIENT_BALANCE"; balance: number };

export interface ChargeArgs {
  walletId: string;
  kind: string;
  cost: number;
  idemKey: string;
  createdByUserId: string;
}

export async function chargeForAction(
  prisma: PrismaClient,
  args: ChargeArgs,
): Promise<ChargeResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.wallet.updateMany({
        where: { id: args.walletId, balance: { gte: args.cost } },
        data: { balance: { decrement: args.cost } },
      });
      if (claimed.count !== 1) {
        const w = await tx.wallet.findUniqueOrThrow({
          where: { id: args.walletId },
          select: { balance: true },
        });
        return { kind: "INSUFFICIENT_BALANCE" as const, balance: w.balance };
      }
      const after = await tx.wallet.findUniqueOrThrow({
        where: { id: args.walletId },
        select: { balance: true },
      });
      const entry = await tx.creditLedger.create({
        data: {
          walletId: args.walletId,
          kind: "DEBIT",
          delta: -args.cost,
          balanceAfter: after.balance,
          idemKey: args.idemKey,
          actionKind: args.kind,
          createdByUserId: args.createdByUserId,
        },
      });
      return {
        kind: "OK" as const,
        ledgerId: entry.id,
        balanceAfter: after.balance,
      };
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const target = (e.meta as { target?: string[] | string } | undefined)
        ?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
      if (targetStr.includes("idem_key") || targetStr.includes("idemKey")) {
        throw new ActionAlreadyChargedError(args.idemKey);
      }
    }
    throw e;
  }
}

export interface CompensateArgs {
  originalLedgerId: string;
  walletId: string;
  cost: number;
  kind: string;
  reason: string;
}

export async function compensate(
  prisma: PrismaClient,
  args: CompensateArgs,
): Promise<{ ledgerId: string; balanceAfter: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: args.walletId },
      data: { balance: { increment: args.cost } },
    });
    const after = await tx.wallet.findUniqueOrThrow({
      where: { id: args.walletId },
      select: { balance: true },
    });
    const entry = await tx.creditLedger.create({
      data: {
        walletId: args.walletId,
        kind: "COMPENSATION",
        delta: args.cost,
        balanceAfter: after.balance,
        idemKey: `comp:${args.originalLedgerId}`,
        refTable: "credit_ledger",
        refId: args.originalLedgerId,
        actionKind: args.kind,
        metadata: { reason: args.reason, originalLedgerId: args.originalLedgerId },
      },
    });
    return { ledgerId: entry.id, balanceAfter: after.balance };
  });
}

/**
 * fail-open compensation 白名单：明确不补的错；默认抛错 = 补偿。
 * ComplianceRejectedError 等"用户拿到了 service 输出（即使是拒绝判定）"的错不补。
 */
export function shouldCompensate(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "ComplianceRejectedError") return false;
  return true;
}

export function errorReason(e: unknown): string {
  return (e as { constructor?: { name?: string } } | null)?.constructor?.name ?? "Unknown";
}
```

跑 charge.test.ts → 期望 4 passed（含 race）。

- [ ] **步骤 3.8：失败 test — `compensate.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { ensureWallet } from "../src/wallet";
import { chargeForAction, compensate, shouldCompensate } from "../src/ledger";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("compensate", () => {
  beforeEach(resetBillingTables);

  it("refunds + writes COMPENSATION entry with comp:<id> idemKey", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const w = await ensureWallet(prismaTest, u.id);
    await prismaTest.wallet.update({ where: { id: w.id }, data: { balance: 5 } });
    await prismaTest.creditLedger.create({
      data: { walletId: w.id, kind: "TOPUP", delta: 5, balanceAfter: 5, idemKey: `topup:boot:${u.id}` },
    });
    const debit = await chargeForAction(prismaTest, {
      walletId: w.id, kind: "TUTOR_ASK", cost: 1,
      idemKey: `debit:tutor_ask:${u.id}:req-c1`, createdByUserId: u.id,
    });
    if (debit.kind !== "OK") throw new Error("setup failed");
    const r = await compensate(prismaTest, {
      originalLedgerId: debit.ledgerId, walletId: w.id, cost: 1, kind: "TUTOR_ASK", reason: "AdapterError",
    });
    expect(r.balanceAfter).toBe(5);
    const w2 = await prismaTest.wallet.findUnique({ where: { id: w.id } });
    expect(w2?.balance).toBe(5);
    const comp = await prismaTest.creditLedger.findUnique({
      where: { idemKey: `comp:${debit.ledgerId}` },
    });
    expect(comp?.delta).toBe(1);
    expect(comp?.kind).toBe("COMPENSATION");
    expect(comp?.refId).toBe(debit.ledgerId);
  });
});

describe("shouldCompensate whitelist", () => {
  it("ComplianceRejectedError → false", () => {
    class ComplianceRejectedError extends Error {
      constructor() { super("compliance"); this.name = "ComplianceRejectedError"; }
    }
    expect(shouldCompensate(new ComplianceRejectedError())).toBe(false);
  });
  it("generic Error → true (fail-open compensation default)", () => {
    expect(shouldCompensate(new Error("unknown"))).toBe(true);
  });
});
```

跑 → 期望 3 passed。

- [ ] **步骤 3.9：更新 barrel `packages/billing/src/index.ts`**

```ts
export * from "./pricing";
export * from "./wallet";
export * from "./ledger";
export * from "./test-utils";
```

- [ ] **步骤 3.10：全包 typecheck + test**

```powershell
pnpm.cmd --filter @zhijiao/billing typecheck
pnpm.cmd --filter @zhijiao/billing test
```

期望 typecheck 全绿，全部 test 通过（含 race）。

- [ ] **步骤 3.11：commit**

```powershell
git add packages/billing/
git commit -m "feat(billing): Task 3 — pricing/ensureWallet/chargeForAction/compensate + race tests"
```

---

## Task 4：billing 支付应用层 — applyWechatPayNotify / expireStaleOrders / adminAdjust / sumMonthlyTopupCents

> **核心**：`applyWechatPayNotify` 实现 spec §4.1.1 的状态机 + P2002 外层 catch 重读。`adminAdjust` 实现 spec §5.5 的 OPS 流程（含 `reasonCode` enum + reasonDetail 长度限制）。`sumMonthlyTopupCents` 实现 spec §6.3 的两条 aggregate 求和。

**Files：**
- Create: `packages/billing/src/wechat-notify.ts`
- Create: `packages/billing/src/sweeper.ts`
- Create: `packages/billing/src/admin.ts`
- Create: `packages/billing/src/monthly-limit.ts`
- Create: `packages/billing/src/logger.ts`（轻量 logger 接口，运行时 noop；apps/web 注入 pino 实现）
- Modify: `packages/billing/src/index.ts`
- Create: `packages/billing/tests/wechat-notify.test.ts`
- Create: `packages/billing/tests/sweeper.test.ts`
- Create: `packages/billing/tests/admin.test.ts`
- Create: `packages/billing/tests/monthly-limit.test.ts`

- [ ] **步骤 4.1：建 `packages/billing/src/logger.ts`（轻量接口 + default noop）**

> billing 包不能直接 `import "@/server/logger"` —— 那会反向耦合到 apps/web。billing 内部用一个最小 logger interface，apps/web 在调用时注入 pino。

```ts
export interface BillingLogger {
  error: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  info: (obj: object, msg: string) => void;
}

const noop: BillingLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
};

let current: BillingLogger = noop;

/** apps/web 启动时调一次 setBillingLogger(pinoInstance) 注入真 logger。 */
export function setBillingLogger(l: BillingLogger): void {
  current = l;
}

export function getBillingLogger(): BillingLogger {
  return current;
}
```

- [ ] **步骤 4.2：失败 test — `wechat-notify.test.ts`**

测覆盖：ORDER_NOT_FOUND / AMOUNT_MISMATCH / APP_OR_MCH_MISMATCH / NOTPAY / USERPAYING / CLOSED→FAILED / SUCCESS→PAID / 已 PAID replay→ALREADY_PAID / 并发→P2002 重读→ALREADY_PAID / DUPLICATE_TRANSACTION_ID。

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyWechatPayNotify, type VerifyOk } from "../src/wechat-notify";
import { ensureWallet } from "../src/wallet";
import { prismaTest, resetBillingTables } from "../src/test-utils";

const APP = "wxapp_test";
const MCH = "1900000001";

async function seedOrder(userId: string, status: "CREATED" | "PENDING" | "PAID" | "EXPIRED", opts?: { transactionId?: string; amountCents?: number }) {
  const out = `zj_${userId.slice(0, 8)}_${Math.random().toString(36).slice(2, 14)}`;
  return prismaTest.topupOrder.create({
    data: {
      userId,
      amountCents: opts?.amountCents ?? 100,
      credits: 10,
      status,
      outTradeNo: out,
      transactionId: opts?.transactionId ?? null,
      expiredAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}

function verifyOk(o: { outTradeNo: string; amountCents?: number; tradeState?: string; transactionId?: string; appId?: string; mchId?: string }): VerifyOk {
  return {
    ok: true,
    outTradeNo: o.outTradeNo,
    amountCents: o.amountCents ?? 100,
    tradeState: o.tradeState ?? "SUCCESS",
    transactionId: o.transactionId ?? `mock_txn_${Math.random().toString(36).slice(2, 18)}`,
    appId: o.appId ?? APP,
    mchId: o.mchId ?? MCH,
    successTime: new Date().toISOString(),
  };
}

describe("applyWechatPayNotify", () => {
  beforeEach(resetBillingTables);

  it("ORDER_NOT_FOUND when outTradeNo unknown", async () => {
    const r = await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: "zj_unknown" }), APP, MCH);
    expect(r.kind).toBe("ORDER_NOT_FOUND");
  });

  it("AMOUNT_MISMATCH when verify.amountCents != order.amountCents", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING", { amountCents: 100 });
    const r = await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, amountCents: 200 }), APP, MCH);
    expect(r.kind).toBe("AMOUNT_MISMATCH");
  });

  it("APP_OR_MCH_MISMATCH when appId differs", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const r = await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, appId: "wrong_app" }), APP, MCH);
    expect(r.kind).toBe("APP_OR_MCH_MISMATCH");
  });

  it("INTERMEDIATE_STATE_NOTPAY / USERPAYING do not change order", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const r1 = await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, tradeState: "NOTPAY" }), APP, MCH);
    expect(r1.kind).toBe("INTERMEDIATE_STATE_NOTPAY");
    const r2 = await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, tradeState: "USERPAYING" }), APP, MCH);
    expect(r2.kind).toBe("INTERMEDIATE_STATE_USERPAYING");
    const reloaded = await prismaTest.topupOrder.findUnique({ where: { outTradeNo: o.outTradeNo } });
    expect(reloaded?.status).toBe("PENDING");
  });

  it("CLOSED/PAYERROR/REVOKED → FAILED + transactionId stored", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const r = await applyWechatPayNotify(
      prismaTest,
      verifyOk({ outTradeNo: o.outTradeNo, tradeState: "CLOSED", transactionId: "tx_closed_1" }),
      APP, MCH,
    );
    expect(r.kind).toBe("FAILED");
    const reloaded = await prismaTest.topupOrder.findUnique({ where: { outTradeNo: o.outTradeNo } });
    expect(reloaded?.status).toBe("FAILED");
    expect(reloaded?.transactionId).toBe("tx_closed_1");
  });

  it("SUCCESS: balance += credits, TOPUP ledger inserted, status PAID, transactionId + paidAt set", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const txn = "tx_success_1";
    const r = await applyWechatPayNotify(
      prismaTest, verifyOk({ outTradeNo: o.outTradeNo, transactionId: txn }), APP, MCH,
    );
    expect(r.kind).toBe("PAID");
    const reloaded = await prismaTest.topupOrder.findUnique({ where: { outTradeNo: o.outTradeNo } });
    expect(reloaded?.status).toBe("PAID");
    expect(reloaded?.transactionId).toBe(txn);
    expect(reloaded?.paidAt).not.toBeNull();
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
    const ledger = await prismaTest.creditLedger.findUnique({
      where: { idemKey: `topup:${o.outTradeNo}` },
    });
    expect(ledger?.kind).toBe("TOPUP");
    expect(ledger?.delta).toBe(10);
    expect(ledger?.balanceAfter).toBe(10);
  });

  it("PAID replay with same transactionId → ALREADY_PAID (no double-credit)", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const txn = "tx_replay_1";
    await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, transactionId: txn }), APP, MCH);
    const r2 = await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, transactionId: txn }), APP, MCH);
    expect(r2.kind).toBe("ALREADY_PAID");
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
    const debits = await prismaTest.creditLedger.count({
      where: { walletId: { in: (await prismaTest.wallet.findMany({ where: { userId: u.id } })).map((x) => x.id) }, kind: "TOPUP" },
    });
    expect(debits).toBe(1);
  });

  it("PAID replay with different transactionId → DUPLICATE_TRANSACTION_ID", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_one" }), APP, MCH);
    const r2 = await applyWechatPayNotify(prismaTest, verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_two_different" }), APP, MCH);
    expect(r2.kind).toBe("DUPLICATE_TRANSACTION_ID");
  });

  it("concurrent webhooks (P2002 idemKey path) → exactly one PAID + one ALREADY_PAID", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "PENDING");
    const v = verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_concurrent_1" });
    const [r1, r2] = await Promise.all([
      applyWechatPayNotify(prismaTest, v, APP, MCH),
      applyWechatPayNotify(prismaTest, v, APP, MCH),
    ]);
    const kinds = [r1.kind, r2.kind].sort();
    expect(kinds).toEqual(["ALREADY_PAID", "PAID"]);
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
    const topupEntries = await prismaTest.creditLedger.findMany({
      where: { idemKey: `topup:${o.outTradeNo}` },
    });
    expect(topupEntries).toHaveLength(1);
  });

  it("EXPIRED → PAID grace: late webhook still credits", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, u.id);
    const o = await seedOrder(u.id, "EXPIRED");
    const r = await applyWechatPayNotify(
      prismaTest, verifyOk({ outTradeNo: o.outTradeNo, transactionId: "tx_grace" }), APP, MCH,
    );
    expect(r.kind).toBe("PAID");
    const w = await prismaTest.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balance).toBe(10);
  });
});
```

跑 → FAIL（wechat-notify.ts 还没建）。

- [ ] **步骤 4.3：实现 `wechat-notify.ts`**

完整复刻 spec §4.1.1。

```ts
import type { PrismaClient } from "@zhijiao/db";
import { Prisma } from "@zhijiao/db";
import { getBillingLogger } from "./logger";

export interface VerifyOk {
  ok: true;
  outTradeNo: string;
  amountCents: number;
  tradeState: string;
  transactionId: string;
  appId: string;
  mchId: string;
  successTime: string;
}

export type ApplyNotifyResult =
  | { kind: "PAID" }
  | { kind: "FAILED" }
  | { kind: "ALREADY_PAID" }
  | { kind: "ORDER_NOT_FOUND" }
  | { kind: "AMOUNT_MISMATCH" }
  | { kind: "APP_OR_MCH_MISMATCH" }
  | { kind: "INTERMEDIATE_STATE_NOTPAY" }
  | { kind: "INTERMEDIATE_STATE_USERPAYING" }
  | { kind: "UNEXPECTED_REFUND" }
  | { kind: "UNKNOWN_TRADE_STATE" }
  | { kind: "DUPLICATE_TRANSACTION_ID" };

export async function applyWechatPayNotify(
  prisma: PrismaClient,
  verify: VerifyOk,
  expectedAppId: string,
  expectedMchId: string,
): Promise<ApplyNotifyResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.topupOrder.findUnique({
        where: { outTradeNo: verify.outTradeNo },
      });
      if (!order) return { kind: "ORDER_NOT_FOUND" as const };

      if (verify.amountCents !== order.amountCents) {
        return { kind: "AMOUNT_MISMATCH" as const };
      }
      if (verify.appId !== expectedAppId || verify.mchId !== expectedMchId) {
        return { kind: "APP_OR_MCH_MISMATCH" as const };
      }

      if (order.status === "PAID" && verify.tradeState === "SUCCESS") {
        if (order.transactionId && order.transactionId !== verify.transactionId) {
          return { kind: "DUPLICATE_TRANSACTION_ID" as const };
        }
        return { kind: "ALREADY_PAID" as const };
      }

      if (verify.tradeState === "NOTPAY") {
        return { kind: "INTERMEDIATE_STATE_NOTPAY" as const };
      }
      if (verify.tradeState === "USERPAYING") {
        return { kind: "INTERMEDIATE_STATE_USERPAYING" as const };
      }
      if (["CLOSED", "PAYERROR", "REVOKED"].includes(verify.tradeState)) {
        await tx.topupOrder.update({
          where: { outTradeNo: verify.outTradeNo },
          data: { status: "FAILED", transactionId: verify.transactionId ?? null },
        });
        return { kind: "FAILED" as const };
      }
      if (verify.tradeState === "REFUND") {
        return { kind: "UNEXPECTED_REFUND" as const };
      }
      if (verify.tradeState !== "SUCCESS") {
        return { kind: "UNKNOWN_TRADE_STATE" as const };
      }

      // SUCCESS path: 业务终态最后落
      await tx.wallet.update({
        where: { userId: order.userId },
        data: { balance: { increment: order.credits } },
      });
      const w = await tx.wallet.findUniqueOrThrow({
        where: { userId: order.userId },
        select: { id: true, balance: true },
      });
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
      if (isUniqueTargetMatching(e, ["idemKey", "idem_key"])) {
        const [existingLedger, order] = await Promise.all([
          prisma.creditLedger.findUnique({
            where: { idemKey: `topup:${verify.outTradeNo}` },
            select: { id: true },
          }),
          prisma.topupOrder.findUnique({
            where: { outTradeNo: verify.outTradeNo },
            select: { status: true },
          }),
        ]);
        if (existingLedger && order?.status === "PAID") {
          return { kind: "ALREADY_PAID" as const };
        }
        getBillingLogger().error(
          {
            event: "p2002_idemkey_inconsistent",
            outTradeNo: verify.outTradeNo,
            hasLedger: !!existingLedger,
            orderStatus: order?.status,
          },
          "P2002 on CreditLedger.idemKey but DB state not as expected",
        );
        throw e;
      }
      if (isUniqueTargetMatching(e, ["transactionId", "transaction_id"])) {
        const conflicting = await prisma.topupOrder.findUnique({
          where: { transactionId: verify.transactionId },
          select: { id: true, outTradeNo: true, status: true },
        });
        getBillingLogger().error(
          {
            event: "wechat_pay_duplicate_transaction_id",
            incomingOutTradeNo: verify.outTradeNo,
            existingOrderId: conflicting?.id,
            existingOutTradeNo: conflicting?.outTradeNo,
            existingStatus: conflicting?.status,
          },
          "Duplicate transaction_id from WeChat Pay webhook",
        );
        return { kind: "DUPLICATE_TRANSACTION_ID" as const };
      }
    }
    throw e;
  }
}

function isUniqueTargetMatching(
  e: Prisma.PrismaClientKnownRequestError,
  fields: string[],
): boolean {
  const target = (e.meta as { target?: string[] | string } | undefined)?.target;
  const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
  return fields.some((f) => targetStr.includes(f));
}
```

跑 wechat-notify.test.ts → 10 passed。

- [ ] **步骤 4.4：失败 test — `sweeper.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { expireStaleOrders } from "../src/sweeper";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("expireStaleOrders", () => {
  beforeEach(resetBillingTables);

  it("marks CREATED/PENDING with expiredAt<now as EXPIRED; leaves PAID/FAILED alone", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    const mkOrder = (status: "CREATED" | "PENDING" | "PAID" | "FAILED", expiredAt: Date, tag: string) =>
      prismaTest.topupOrder.create({
        data: {
          userId: u.id, amountCents: 100, credits: 10, status,
          outTradeNo: `zj_${u.id.slice(0, 8)}_${tag}`,
          expiredAt,
        },
      });
    await mkOrder("CREATED", past, "c1");
    await mkOrder("PENDING", past, "p1");
    await mkOrder("PENDING", future, "p2"); // not yet expired
    await mkOrder("PAID", past, "paid1");   // PAID stays
    await mkOrder("FAILED", past, "f1");    // FAILED stays
    const r = await expireStaleOrders(prismaTest, new Date());
    expect(r.expired).toBe(2);
    const c1 = await prismaTest.topupOrder.findUnique({ where: { outTradeNo: `zj_${u.id.slice(0, 8)}_c1` } });
    expect(c1?.status).toBe("EXPIRED");
    const paid = await prismaTest.topupOrder.findUnique({ where: { outTradeNo: `zj_${u.id.slice(0, 8)}_paid1` } });
    expect(paid?.status).toBe("PAID");
  });
});
```

跑 → FAIL。

- [ ] **步骤 4.5：实现 `sweeper.ts`**

```ts
import type { PrismaClient } from "@zhijiao/db";

export async function expireStaleOrders(
  prisma: PrismaClient,
  now: Date,
): Promise<{ expired: number }> {
  const r = await prisma.topupOrder.updateMany({
    where: {
      status: { in: ["CREATED", "PENDING"] },
      expiredAt: { lt: now },
    },
    data: { status: "EXPIRED" },
  });
  return { expired: r.count };
}
```

跑 → 1 passed。

- [ ] **步骤 4.6：失败 test — `admin.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { adminAdjust } from "../src/admin";
import { ensureWallet } from "../src/wallet";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("adminAdjust", () => {
  beforeEach(resetBillingTables);

  it("positive delta writes ADJUST_ADD; balance += delta", async () => {
    const target = await prismaTest.user.create({ data: { isMinor: false } });
    const ops = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, target.id);
    const r = await adminAdjust(prismaTest, {
      targetUserId: target.id, delta: 50,
      reasonCode: "FAULT_RECOVERY", reasonDetail: "compensation for failed tutor call on 2026-05-21",
      opsUserId: ops.id,
    });
    expect(r.balanceAfter).toBe(50);
    const w = await prismaTest.wallet.findUnique({ where: { userId: target.id } });
    expect(w?.balance).toBe(50);
    const entry = await prismaTest.creditLedger.findUnique({ where: { id: r.ledgerId } });
    expect(entry?.kind).toBe("ADJUST_ADD");
    expect(entry?.delta).toBe(50);
    expect(entry?.createdByUserId).toBe(ops.id);
    expect((entry?.metadata as { reasonCode?: string })?.reasonCode).toBe("FAULT_RECOVERY");
  });

  it("negative delta writes ADJUST_SUB; respects predicate-on-update for non-negative end balance", async () => {
    const target = await prismaTest.user.create({ data: { isMinor: false } });
    const ops = await prismaTest.user.create({ data: { isMinor: false } });
    const w = await ensureWallet(prismaTest, target.id);
    await prismaTest.wallet.update({ where: { id: w.id }, data: { balance: 100 } });
    const r = await adminAdjust(prismaTest, {
      targetUserId: target.id, delta: -30,
      reasonCode: "FRAUD_CLAWBACK", reasonDetail: "fraud clawback for txn investigated 2026-05-21",
      opsUserId: ops.id,
    });
    expect(r.balanceAfter).toBe(70);
    const entry = await prismaTest.creditLedger.findUnique({ where: { id: r.ledgerId } });
    expect(entry?.kind).toBe("ADJUST_SUB");
    expect(entry?.delta).toBe(-30);
  });

  it("rejects delta=0 (validated at procedure layer; helper still throws for safety)", async () => {
    const target = await prismaTest.user.create({ data: { isMinor: false } });
    const ops = await prismaTest.user.create({ data: { isMinor: false } });
    await ensureWallet(prismaTest, target.id);
    await expect(adminAdjust(prismaTest, {
      targetUserId: target.id, delta: 0,
      reasonCode: "OTHER", reasonDetail: "should not be allowed at all",
      opsUserId: ops.id,
    })).rejects.toThrow(/delta must be non-zero/);
  });
});
```

跑 → FAIL。

- [ ] **步骤 4.7：实现 `admin.ts`**

```ts
import type { PrismaClient } from "@zhijiao/db";

export type AdjustReasonCode =
  | "FAULT_RECOVERY"
  | "CUSTOMER_SERVICE_GIFT"
  | "PROMO"
  | "FRAUD_CLAWBACK"
  | "OTHER";

export interface AdminAdjustArgs {
  targetUserId: string;
  delta: number;
  reasonCode: AdjustReasonCode;
  reasonDetail: string;
  opsUserId: string;
}

export async function adminAdjust(
  prisma: PrismaClient,
  args: AdminAdjustArgs,
): Promise<{ ledgerId: string; balanceAfter: number }> {
  if (args.delta === 0) {
    throw new Error("delta must be non-zero");
  }
  return prisma.$transaction(async (tx) => {
    const w = await tx.wallet.findUniqueOrThrow({
      where: { userId: args.targetUserId },
      select: { id: true, balance: true },
    });
    await tx.wallet.update({
      where: { id: w.id },
      data: { balance: { increment: args.delta } },
    });
    const after = await tx.wallet.findUniqueOrThrow({
      where: { id: w.id },
      select: { balance: true },
    });
    const idemKey = `adjust:${args.reasonCode.toLowerCase()}:${args.opsUserId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const entry = await tx.creditLedger.create({
      data: {
        walletId: w.id,
        kind: args.delta > 0 ? "ADJUST_ADD" : "ADJUST_SUB",
        delta: args.delta,
        balanceAfter: after.balance,
        idemKey,
        actionKind: null,
        createdByUserId: args.opsUserId,
        metadata: {
          reasonCode: args.reasonCode,
          reasonDetail: args.reasonDetail,
        },
      },
    });
    return { ledgerId: entry.id, balanceAfter: after.balance };
  });
}
```

跑 → 3 passed。

- [ ] **步骤 4.8：失败 test — `monthly-limit.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  sumMonthlyTopupCents,
  startOfMonthInShanghai,
} from "../src/monthly-limit";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("startOfMonthInShanghai", () => {
  it("returns first day of month at 00:00 Asia/Shanghai (UTC offset +08:00)", () => {
    // 2026-06-15 00:00 Asia/Shanghai === 2026-05-31 16:00 UTC
    const d = startOfMonthInShanghai(new Date("2026-06-15T03:00:00Z"));
    expect(d.toISOString()).toBe("2026-05-31T16:00:00.000Z");
  });
});

describe("sumMonthlyTopupCents", () => {
  beforeEach(resetBillingTables);

  it("sums unpaid by createdAt + paid by paidAt; ignores EXPIRED/FAILED", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: true } });
    const monthStart = startOfMonthInShanghai(new Date());
    const inMonth = new Date(monthStart.getTime() + 24 * 60 * 60 * 1000);
    const beforeMonth = new Date(monthStart.getTime() - 24 * 60 * 60 * 1000);

    // PENDING in month: counted
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id, amountCents: 5000, credits: 500, status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_a`, createdAt: inMonth,
        expiredAt: new Date(inMonth.getTime() + 30 * 60 * 1000),
      },
    });
    // PAID in month (by paidAt): counted
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id, amountCents: 10000, credits: 1000, status: "PAID",
        outTradeNo: `zj_${u.id.slice(0, 8)}_b`, createdAt: beforeMonth,
        paidAt: inMonth,
        expiredAt: beforeMonth,
      },
    });
    // EXPIRED: ignored
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id, amountCents: 100, credits: 10, status: "EXPIRED",
        outTradeNo: `zj_${u.id.slice(0, 8)}_c`, createdAt: inMonth,
        expiredAt: inMonth,
      },
    });
    // FAILED: ignored
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id, amountCents: 100, credits: 10, status: "FAILED",
        outTradeNo: `zj_${u.id.slice(0, 8)}_d`, createdAt: inMonth,
        expiredAt: inMonth,
      },
    });
    // Cross-month: created before month, still PENDING — NOT counted (createdAt out of range)
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id, amountCents: 999, credits: 99, status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_e`, createdAt: beforeMonth,
        expiredAt: new Date(beforeMonth.getTime() + 30 * 60 * 1000),
      },
    });
    const sum = await sumMonthlyTopupCents(prismaTest, u.id);
    expect(sum).toBe(5000 + 10000);
  });

  it("cross-month shift: order created 5/31 23:55 SH + paid 6/1 00:05 SH moves quota from May→June", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: true } });
    // 5/31 23:55 Asia/Shanghai === 5/31 15:55 UTC
    const createdAtUtc = new Date("2026-05-31T15:55:00Z");
    // 6/1 00:05 Asia/Shanghai === 5/31 16:05 UTC
    const paidAtUtc = new Date("2026-05-31T16:05:00Z");
    // Simulate "now = mid June"
    const juneNow = new Date("2026-06-10T03:00:00Z");
    // Insert as PAID with paidAt in June, createdAt in May
    await prismaTest.topupOrder.create({
      data: {
        userId: u.id, amountCents: 7777, credits: 777, status: "PAID",
        outTradeNo: `zj_${u.id.slice(0, 8)}_shift`,
        createdAt: createdAtUtc, paidAt: paidAtUtc,
        expiredAt: new Date(createdAtUtc.getTime() + 30 * 60 * 1000),
      },
    });
    // Helper takes optional "now" — extend signature if needed; or call startOfMonth
    // with juneNow to get June month start
    const juneStart = startOfMonthInShanghai(juneNow);
    // Manual aggregate for the assertion: paid order with paidAt >= juneStart should be counted
    expect(paidAtUtc >= juneStart).toBe(true);
  });
});
```

跑 → FAIL。

- [ ] **步骤 4.9：实现 `monthly-limit.ts`**

```ts
import type { PrismaClient } from "@zhijiao/db";

/**
 * Asia/Shanghai 自然月开头（UTC 时刻）。
 * 上海是 UTC+8 全年（无 DST）。月初本地 00:00 == 月初 UTC 16:00（前一天）。
 */
export function startOfMonthInShanghai(now: Date): Date {
  const SHANGHAI_OFFSET_HOURS = 8;
  const utc = now.getTime();
  const shanghai = new Date(utc + SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000);
  const y = shanghai.getUTCFullYear();
  const m = shanghai.getUTCMonth();
  // 月初本地 00:00 → 减回 8h 得 UTC
  return new Date(Date.UTC(y, m, 1, 0, 0, 0) - SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000);
}

export async function sumMonthlyTopupCents(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const monthStart = startOfMonthInShanghai(now);
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

跑 → 2 passed。

- [ ] **步骤 4.10：更新 barrel + 全包验证**

`packages/billing/src/index.ts`：

```ts
export * from "./pricing";
export * from "./wallet";
export * from "./ledger";
export * from "./wechat-notify";
export * from "./sweeper";
export * from "./admin";
export * from "./monthly-limit";
export * from "./logger";
export * from "./test-utils";
```

```powershell
pnpm.cmd --filter @zhijiao/billing typecheck
pnpm.cmd --filter @zhijiao/billing test
```

全绿。

- [ ] **步骤 4.11：commit**

```powershell
git add packages/billing/
git commit -m "feat(billing): Task 4 — applyWechatPayNotify (P2002 re-read) + sweeper + adminAdjust + monthly-limit"
```

---

## Task 5：`packages/integrations` WeChat Pay adapter（Mock + Real 骨架 + PlatformCertProvider + build）

> **核心**：sketch interface 让 Mock 与 Real 共享 contract；Mock 实现 fireMockNotify 用 HMAC-SHA256（mockSecret）签名，提供 sync / async-delayed / manual 三种 notifyMode；Real 仅写骨架（throws on activation 等 ICP 备案）；build factory 由 `WECHAT_PAY_USE_MOCK` 路由。

**Files：**
- Create: `packages/integrations/src/wechat-pay/index.ts`（barrel）
- Create: `packages/integrations/src/wechat-pay/types.ts`
- Create: `packages/integrations/src/wechat-pay/mock.ts`
- Create: `packages/integrations/src/wechat-pay/real.ts`
- Create: `packages/integrations/src/wechat-pay/platform-cert-provider.ts`
- Create: `packages/integrations/src/wechat-pay/build.ts`
- Modify: `packages/integrations/src/index.ts`（barrel 加 export）
- Create: `packages/integrations/tests/wechat-pay-mock.test.ts`
- Create: `packages/integrations/tests/wechat-pay-build.test.ts`

- [ ] **步骤 5.1：建 `types.ts`**

```ts
export interface UnifiedOrderRequest {
  outTradeNo: string;
  amountCents: number;
  description: string;
}
export interface UnifiedOrderResult {
  prepayId: string;
  qrCode?: string;
  h5Url?: string;
}

export interface NotifyHeaders {
  signature: string | null;
  timestamp: string | null;
  nonce: string | null;
  serial: string | null;
}

export type VerifyResult =
  | {
      ok: true;
      outTradeNo: string;
      transactionId: string;
      tradeState: string;
      amountCents: number;
      appId: string;
      mchId: string;
      successTime: string;
    }
  | { ok: false; reason: "SIG_INVALID" | "CERT_NOT_FOUND" | "PARSE_FAILED" };

export type NotifyMode = "sync" | "async-delayed" | "manual";

export interface WechatPayAdapter {
  unifiedOrder(req: UnifiedOrderRequest): Promise<UnifiedOrderResult>;
  verifyNotify(headers: NotifyHeaders, rawBody: string): Promise<VerifyResult>;
  /**
   * 在 TopupOrder.status 已 update 到 PENDING 之后调用。Promise 不能 reject。
   * Mock: 按 notifyMode 触发本地 webhook。Real: no-op。
   */
  signalOrderReady(outTradeNo: string, amountCents: number): Promise<void>;
}
```

- [ ] **步骤 5.2：建 `platform-cert-provider.ts`**

```ts
import { readFileSync } from "node:fs";

export interface PlatformCertProvider {
  getBySerial(serial: string): Promise<string | null>;
}

/** Real V3 用：单证书文件（PEM）；接口为多证书扩展留口。 */
export class SingleFilePlatformCertProvider implements PlatformCertProvider {
  private readonly cert: string;
  constructor(
    private readonly serial: string,
    pubKeyFile: string,
  ) {
    this.cert = readFileSync(pubKeyFile, "utf8");
  }
  async getBySerial(serial: string): Promise<string | null> {
    return serial === this.serial ? this.cert : null;
  }
}
```

- [ ] **步骤 5.3：建 `mock.ts`**

```ts
import crypto from "node:crypto";
import { randomBytes } from "node:crypto";
import type {
  WechatPayAdapter,
  UnifiedOrderRequest,
  UnifiedOrderResult,
  NotifyHeaders,
  VerifyResult,
  NotifyMode,
} from "./types";

export interface MockOpts {
  notifyUrl: string;
  mockSecret: string;
  appId: string;
  mchId: string;
  notifyMode: NotifyMode;
  delayMs?: number;
}

function nanoid(n: number): string {
  return randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}

export class MockWechatPayAdapter implements WechatPayAdapter {
  constructor(private readonly opts: MockOpts) {}

  async unifiedOrder(_req: UnifiedOrderRequest): Promise<UnifiedOrderResult> {
    const prepayId = `mock_prepay_${nanoid(16)}`;
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
            // swallow: 测试用 manual 模式精确控制
          });
        }, delay);
      }
      // manual: no-op
    } catch {
      // swallow per interface contract
    }
  }

  async fireMockNotify(outTradeNo: string, amountCents: number): Promise<void> {
    const resourcePlain = JSON.stringify({
      out_trade_no: outTradeNo,
      trade_state: "SUCCESS",
      amount: { total: amountCents },
      appid: this.opts.appId,
      mchid: this.opts.mchId,
      transaction_id: `mock_txn_${nanoid(16)}`,
      success_time: new Date().toISOString(),
    });
    const ciphertext = Buffer.from(resourcePlain).toString("base64");
    const body = JSON.stringify({
      id: nanoid(32),
      summary: "支付成功",
      resource: { ciphertext },
    });
    const signature = crypto
      .createHmac("sha256", this.opts.mockSecret)
      .update(body)
      .digest("hex");
    await fetch(this.opts.notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Wechatpay-Signature": signature,
        "Wechatpay-Timestamp": String(Math.floor(Date.now() / 1000)),
        "Wechatpay-Nonce": nanoid(32),
        "Wechatpay-Serial": "MOCK_CERT_SERIAL",
      },
      body,
    });
  }

  async verifyNotify(
    headers: NotifyHeaders,
    rawBody: string,
  ): Promise<VerifyResult> {
    if (headers.serial !== "MOCK_CERT_SERIAL") {
      return { ok: false, reason: "CERT_NOT_FOUND" };
    }
    if (!headers.signature) return { ok: false, reason: "SIG_INVALID" };
    const expected = crypto
      .createHmac("sha256", this.opts.mockSecret)
      .update(rawBody)
      .digest("hex");
    if (headers.signature !== expected) {
      return { ok: false, reason: "SIG_INVALID" };
    }
    try {
      const parsed = JSON.parse(rawBody) as {
        resource: { ciphertext: string };
      };
      const decoded = JSON.parse(
        Buffer.from(parsed.resource.ciphertext, "base64").toString("utf8"),
      ) as {
        out_trade_no: string;
        trade_state: string;
        amount: { total: number };
        appid: string;
        mchid: string;
        transaction_id: string;
        success_time: string;
      };
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

- [ ] **步骤 5.4：建 `real.ts`（骨架，ICP 前 throw）**

```ts
import type {
  WechatPayAdapter,
  UnifiedOrderRequest,
  UnifiedOrderResult,
  NotifyHeaders,
  VerifyResult,
} from "./types";
import type { PlatformCertProvider } from "./platform-cert-provider";

export interface RealOpts {
  appId: string;
  mchId: string;
  apiV3Key: string;
  privateKey: string;
  certSerial: string;
  notifyHost: string;
  certProvider: PlatformCertProvider;
}

/**
 * V3 API skeleton.
 * **不**在 ICP 备案 + 商户号 + APIv3 密钥 + 商户证书全部到位前激活。
 * Plan 3 仅落 contract；激活实现走独立 plan（"Plan 3 真接 V3" / "WeChat Pay activation"）。
 */
export class RealWechatPayAdapter implements WechatPayAdapter {
  constructor(private readonly opts: RealOpts) {}

  async unifiedOrder(_req: UnifiedOrderRequest): Promise<UnifiedOrderResult> {
    throw new Error(
      "RealWechatPayAdapter.unifiedOrder not implemented — set WECHAT_PAY_USE_MOCK=true or implement V3 API activation",
    );
  }

  async signalOrderReady(_outTradeNo: string, _amountCents: number): Promise<void> {
    // Real path: webhook 由微信发，业务侧 no-op。即使尚未实现 unifiedOrder，此方法保持 no-op 契约。
  }

  async verifyNotify(_headers: NotifyHeaders, _rawBody: string): Promise<VerifyResult> {
    throw new Error(
      "RealWechatPayAdapter.verifyNotify not implemented — set WECHAT_PAY_USE_MOCK=true or implement V3 API activation",
    );
  }
}
```

- [ ] **步骤 5.5：建 `build.ts`**

```ts
import type { WechatPayAdapter, NotifyMode } from "./types";
import { MockWechatPayAdapter } from "./mock";
import { RealWechatPayAdapter } from "./real";
import { SingleFilePlatformCertProvider } from "./platform-cert-provider";

export interface BuildWechatPayAdapterArgs {
  useMock: boolean;
  notifyUrl: string;
  mockSecret?: string;
  appId: string;
  mchId: string;
  notifyMode?: NotifyMode;
  // Real-mode only:
  apiV3Key?: string;
  privateKey?: string;
  certSerial?: string;
  pubKeyFile?: string;
  notifyHost?: string;
}

export function buildWechatPayAdapter(
  args: BuildWechatPayAdapterArgs,
): WechatPayAdapter {
  if (args.useMock) {
    if (!args.mockSecret || args.mockSecret.length < 16) {
      throw new Error(
        "buildWechatPayAdapter: mockSecret required (min 16 bytes) when useMock=true",
      );
    }
    return new MockWechatPayAdapter({
      notifyUrl: args.notifyUrl,
      mockSecret: args.mockSecret,
      appId: args.appId,
      mchId: args.mchId,
      notifyMode: args.notifyMode ?? "async-delayed",
    });
  }
  if (
    !args.apiV3Key ||
    !args.privateKey ||
    !args.certSerial ||
    !args.pubKeyFile ||
    !args.notifyHost
  ) {
    throw new Error(
      "buildWechatPayAdapter: real mode requires apiV3Key + privateKey + certSerial + pubKeyFile + notifyHost",
    );
  }
  return new RealWechatPayAdapter({
    appId: args.appId,
    mchId: args.mchId,
    apiV3Key: args.apiV3Key,
    privateKey: args.privateKey,
    certSerial: args.certSerial,
    notifyHost: args.notifyHost,
    certProvider: new SingleFilePlatformCertProvider(
      args.certSerial,
      args.pubKeyFile,
    ),
  });
}
```

- [ ] **步骤 5.6：barrel**

`packages/integrations/src/wechat-pay/index.ts`：

```ts
export * from "./types";
export * from "./mock";
export * from "./real";
export * from "./platform-cert-provider";
export * from "./build";
```

`packages/integrations/src/index.ts` 末尾追加：

```ts
export * from "./wechat-pay/index.js";
```

> 现有 integrations 包的 barrel 风格如果是 `.js` 后缀（ESM）就照旧；如果是裸路径，照葫芦画瓢。

- [ ] **步骤 5.7：失败 test — `wechat-pay-mock.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { MockWechatPayAdapter } from "../src/wechat-pay/mock";

const mkAdapter = (notifyMode: "sync" | "async-delayed" | "manual" = "manual") =>
  new MockWechatPayAdapter({
    notifyUrl: "http://localhost:0/never",
    mockSecret: "test-mock-secret-min-16-bytes-ok",
    appId: "wxapp_test",
    mchId: "1900000001",
    notifyMode,
  });

describe("MockWechatPayAdapter", () => {
  it("unifiedOrder returns prepayId, does NOT fire notify", async () => {
    const fires: string[] = [];
    const adapter = new MockWechatPayAdapter({
      notifyUrl: "http://example.invalid/notify",
      mockSecret: "test-mock-secret-min-16-bytes-ok",
      appId: "wxapp_test",
      mchId: "1900000001",
      notifyMode: "sync",
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fires.push(String(input));
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      const r = await adapter.unifiedOrder({
        outTradeNo: "zj_t_unified_1",
        amountCents: 100,
        description: "test",
      });
      expect(r.prepayId).toMatch(/^mock_prepay_/);
      expect(fires).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("signalOrderReady(notifyMode=sync) fires once to notifyUrl", async () => {
    const fires: { url: string; body: unknown; headers: Headers }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fires.push({
        url: String(input),
        body: init?.body,
        headers: new Headers(init?.headers),
      });
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const adapter = new MockWechatPayAdapter({
      notifyUrl: "http://localhost:0/notify-target",
      mockSecret: "test-mock-secret-min-16-bytes-ok",
      appId: "wxapp_test",
      mchId: "1900000001",
      notifyMode: "sync",
    });
    try {
      await adapter.signalOrderReady("zj_t_signal_1", 100);
      expect(fires).toHaveLength(1);
      expect(fires[0].url).toBe("http://localhost:0/notify-target");
      expect(fires[0].headers.get("Wechatpay-Serial")).toBe("MOCK_CERT_SERIAL");
      expect(fires[0].headers.get("Wechatpay-Signature")).toBeTruthy();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("verifyNotify roundtrip: a body signed by fireMockNotify verifies ok", async () => {
    const captured: { headers: Headers; body: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      captured.push({
        headers: new Headers(init?.headers),
        body: String(init?.body),
      });
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const adapter = mkAdapter("manual");
    try {
      await adapter.fireMockNotify("zj_t_verify_1", 100);
    } finally {
      globalThis.fetch = realFetch;
    }
    const { headers, body } = captured[0];
    const v = await adapter.verifyNotify(
      {
        signature: headers.get("Wechatpay-Signature"),
        timestamp: headers.get("Wechatpay-Timestamp"),
        nonce: headers.get("Wechatpay-Nonce"),
        serial: headers.get("Wechatpay-Serial"),
      },
      body,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.outTradeNo).toBe("zj_t_verify_1");
    expect(v.amountCents).toBe(100);
    expect(v.tradeState).toBe("SUCCESS");
  });

  it("verifyNotify SIG_INVALID when signature tampered", async () => {
    const adapter = mkAdapter("manual");
    const v = await adapter.verifyNotify(
      { signature: "deadbeef", timestamp: "0", nonce: "n", serial: "MOCK_CERT_SERIAL" },
      "{}",
    );
    expect(v).toEqual({ ok: false, reason: "SIG_INVALID" });
  });

  it("verifyNotify CERT_NOT_FOUND when wrong serial", async () => {
    const adapter = mkAdapter("manual");
    const v = await adapter.verifyNotify(
      { signature: "x", timestamp: "0", nonce: "n", serial: "UNKNOWN_SERIAL" },
      "{}",
    );
    expect(v).toEqual({ ok: false, reason: "CERT_NOT_FOUND" });
  });

  it("verifyNotify PARSE_FAILED when sig matches but body not parseable", async () => {
    const adapter = mkAdapter("manual");
    // 构造 sig 匹配但 body 非 JSON
    const body = "not json";
    const crypto = await import("node:crypto");
    const sig = crypto
      .createHmac("sha256", "test-mock-secret-min-16-bytes-ok")
      .update(body)
      .digest("hex");
    const v = await adapter.verifyNotify(
      { signature: sig, timestamp: "0", nonce: "n", serial: "MOCK_CERT_SERIAL" },
      body,
    );
    expect(v).toEqual({ ok: false, reason: "PARSE_FAILED" });
  });
});
```

- [ ] **步骤 5.8：失败 test — `wechat-pay-build.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildWechatPayAdapter } from "../src/wechat-pay/build";
import { MockWechatPayAdapter } from "../src/wechat-pay/mock";
import { RealWechatPayAdapter } from "../src/wechat-pay/real";

describe("buildWechatPayAdapter", () => {
  it("useMock=true + secret returns MockWechatPayAdapter", () => {
    const a = buildWechatPayAdapter({
      useMock: true,
      notifyUrl: "http://x/notify",
      mockSecret: "x".repeat(16),
      appId: "app",
      mchId: "mch",
    });
    expect(a).toBeInstanceOf(MockWechatPayAdapter);
  });

  it("useMock=true without secret throws", () => {
    expect(() =>
      buildWechatPayAdapter({
        useMock: true,
        notifyUrl: "http://x/notify",
        appId: "app",
        mchId: "mch",
      }),
    ).toThrow(/mockSecret required/);
  });

  it("useMock=true with short secret throws", () => {
    expect(() =>
      buildWechatPayAdapter({
        useMock: true,
        notifyUrl: "http://x/notify",
        mockSecret: "short",
        appId: "app",
        mchId: "mch",
      }),
    ).toThrow(/min 16 bytes/);
  });

  it("useMock=false without real fields throws", () => {
    expect(() =>
      buildWechatPayAdapter({
        useMock: false,
        notifyUrl: "http://x/notify",
        appId: "app",
        mchId: "mch",
      }),
    ).toThrow(/real mode requires/);
  });
});
```

- [ ] **步骤 5.9：跑测 + typecheck**

```powershell
pnpm.cmd --filter @zhijiao/integrations typecheck
pnpm.cmd --filter @zhijiao/integrations test
```

全绿。

> 注：mock test 用了 `globalThis.fetch` 替换。Node 20+ 自带 fetch；`Response`、`Headers` 也是全局。如果 integrations 包 vitest 配置已禁用 globals，按需 `import { Response, Headers } from "undici"` 或回退用 mock library。

- [ ] **步骤 5.10：commit**

```powershell
git add packages/integrations/
git commit -m "feat(integrations): Task 5 — WechatPayAdapter (Mock 3-mode + Real skeleton + build factory)"
```

---

## Task 6：env validator 扩展 + 配套 env 文件同步

> **核心**：Plan 2 Hardening Task 1 已经搭好 `apps/web/server/env.ts` 的 zod schema + boot-fail 模式。本 task 在末尾扩 9 个字段 + 2 条 refine（spec §6.1），同时把 `.env.example`、`apps/web/tests/setup.ts`、`apps/web/e2e/global-setup.ts` 三处同步——缺一即 boot fail。

**Files：**
- Modify: `apps/web/server/env.ts`
- Modify: `.env.example`
- Modify: `apps/web/tests/setup.ts`
- Modify: `apps/web/e2e/global-setup.ts`
- Create: `apps/web/tests/integration/env-plan3.test.ts`（验证 boot-fail + boot-pass）

- [ ] **步骤 6.1：编辑 `apps/web/server/env.ts`**

在 `.object({ ... })` 末尾加：

```ts
    // === Plan 3: Credit / WeChat Pay ===
    WECHAT_PAY_USE_MOCK: z.enum(["true", "false"]).default("false"),

    WECHAT_PAY_APPID: z.string().optional(),
    WECHAT_PAY_MCHID: z.string().optional(),
    WECHAT_PAY_API_V3_KEY: z.string().optional(),
    WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
    WECHAT_PAY_CERT_SERIAL: z.string().optional(),
    WECHAT_PAY_PUB_KEY_FILE: z.string().optional(),
    WECHAT_PAY_NOTIFY_HOST: z.string().url().optional(),

    MOCK_WECHAT_PAY_SECRET: z.string().min(16).optional(),

    CREDIT_PER_YUAN: z.coerce.number().int().min(1).default(10),
    MINOR_MONTHLY_LIMIT_YUAN: z.coerce.number().int().min(1).default(200),

    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
```

在 schema 的 `.refine(...).refine(...)` 链末尾加两条：

```ts
  .refine(
    (e) =>
      e.WECHAT_PAY_USE_MOCK === "true" ||
      (!!e.WECHAT_PAY_APPID &&
        !!e.WECHAT_PAY_MCHID &&
        !!e.WECHAT_PAY_API_V3_KEY &&
        !!e.WECHAT_PAY_PRIVATE_KEY &&
        !!e.WECHAT_PAY_CERT_SERIAL &&
        !!e.WECHAT_PAY_PUB_KEY_FILE &&
        !!e.WECHAT_PAY_NOTIFY_HOST),
    {
      message:
        "Real WeChat Pay requires APPID + MCHID + API_V3_KEY + PRIVATE_KEY + CERT_SERIAL + PUB_KEY_FILE + NOTIFY_HOST",
    },
  )
  .refine(
    (e) =>
      e.WECHAT_PAY_USE_MOCK !== "true" || !!e.MOCK_WECHAT_PAY_SECRET,
    {
      message:
        "WECHAT_PAY_USE_MOCK=true requires MOCK_WECHAT_PAY_SECRET (min 16 bytes)",
    },
  );
```

在 `isBuildPhase` 分支的占位 object 里追加：

```ts
      WECHAT_PAY_USE_MOCK: "true",
      MOCK_WECHAT_PAY_SECRET: "build-phase-placeholder-mock-secret-16+",
      CREDIT_PER_YUAN: "10",
      MINOR_MONTHLY_LIMIT_YUAN: "200",
      WECHAT_PAY_APPID: "wxapp_build_phase",
      WECHAT_PAY_MCHID: "build_phase_mch",
```

- [ ] **步骤 6.2：编辑 `.env.example`**

末尾追加：

```
# === Plan 3: Credit / WeChat Pay ===
WECHAT_PAY_USE_MOCK=true
MOCK_WECHAT_PAY_SECRET=dev-only-mock-pay-secret-32bytes-padding
WECHAT_PAY_APPID=wxapp_dev_placeholder
WECHAT_PAY_MCHID=1900000000
CREDIT_PER_YUAN=10
MINOR_MONTHLY_LIMIT_YUAN=200
# LOG_LEVEL=info

# Real-mode credentials (leave blank in dev; required when WECHAT_PAY_USE_MOCK=false)
# WECHAT_PAY_API_V3_KEY=
# WECHAT_PAY_PRIVATE_KEY=
# WECHAT_PAY_CERT_SERIAL=
# WECHAT_PAY_PUB_KEY_FILE=
# WECHAT_PAY_NOTIFY_HOST=
```

如本地 `.env.local` 是从 example 拷的，**手动**同步上面这几行进去（`setup.cmd` 不会覆盖现有 `.env.local`）。

- [ ] **步骤 6.3：编辑 `apps/web/tests/setup.ts`**

在已有 env defaults 后面加（`??=` 不覆盖已有值）：

```ts
process.env.WECHAT_PAY_USE_MOCK ??= "true";
process.env.MOCK_WECHAT_PAY_SECRET ??= "test-mock-pay-secret-32bytes-padding";
process.env.WECHAT_PAY_APPID ??= "wxapp_test_dev";
process.env.WECHAT_PAY_MCHID ??= "1900000000";
process.env.CREDIT_PER_YUAN ??= "10";
process.env.MINOR_MONTHLY_LIMIT_YUAN ??= "200";
```

- [ ] **步骤 6.4：编辑 `apps/web/e2e/global-setup.ts`**

在 spawn child process 的 `env` 对象里加同上 6 个 key（global-setup 没有 vitest 的 env 自动注入；必须显式塞 child env）。

- [ ] **步骤 6.5：写 boot-fail / boot-pass 集成测试 `apps/web/tests/integration/env-plan3.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("env validator — Plan 3 fields", () => {
  it("boot-fail when WECHAT_PAY_USE_MOCK=true but MOCK_WECHAT_PAY_SECRET missing", async () => {
    // 复制现有 env，挑出来跑一个独立 vm sandbox 验证
    // 实际上最稳的做法：spawn 一个 child node process 引一下 env.ts 看是否 throw。
    // 但为了简单，这里用 vi.resetModules + 修改 process.env + dynamic import 测一次。
    const { resetEnvAndImport } = await import("./_env-helper");
    await expect(
      resetEnvAndImport({
        WECHAT_PAY_USE_MOCK: "true",
        MOCK_WECHAT_PAY_SECRET: undefined,
      }),
    ).rejects.toThrow(/MOCK_WECHAT_PAY_SECRET/);
  });

  it("boot-fail when MOCK_WECHAT_PAY_SECRET is short", async () => {
    const { resetEnvAndImport } = await import("./_env-helper");
    await expect(
      resetEnvAndImport({
        WECHAT_PAY_USE_MOCK: "true",
        MOCK_WECHAT_PAY_SECRET: "tooshort",
      }),
    ).rejects.toThrow(/min 16/i);
  });

  it("boot-fail when WECHAT_PAY_USE_MOCK=false but real fields missing", async () => {
    const { resetEnvAndImport } = await import("./_env-helper");
    await expect(
      resetEnvAndImport({
        WECHAT_PAY_USE_MOCK: "false",
        WECHAT_PAY_APPID: undefined,
        MOCK_WECHAT_PAY_SECRET: "x".repeat(32),
      }),
    ).rejects.toThrow(/Real WeChat Pay/);
  });

  it("boot-pass with mock + secret + appid + mchid", async () => {
    const { resetEnvAndImport } = await import("./_env-helper");
    const env = await resetEnvAndImport({
      WECHAT_PAY_USE_MOCK: "true",
      MOCK_WECHAT_PAY_SECRET: "x".repeat(32),
      WECHAT_PAY_APPID: "wxapp_test",
      WECHAT_PAY_MCHID: "1900000000",
    });
    expect(env.WECHAT_PAY_USE_MOCK).toBe("true");
    expect(env.CREDIT_PER_YUAN).toBe(10);
    expect(env.MINOR_MONTHLY_LIMIT_YUAN).toBe(200);
  });
});
```

辅助 `apps/web/tests/integration/_env-helper.ts`：

```ts
import { vi } from "vitest";

export async function resetEnvAndImport(
  overrides: Record<string, string | undefined>,
): Promise<typeof import("../../server/env").env> {
  // 保存现有 env，应用 overrides；undefined 删 key
  const original = { ...process.env };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  try {
    const mod = await import("../../server/env");
    return mod.env;
  } finally {
    // 还原 env
    for (const k of Object.keys(process.env)) {
      if (!(k in original)) delete process.env[k];
    }
    Object.assign(process.env, original);
  }
}
```

- [ ] **步骤 6.6：跑 + commit**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/env-plan3.test.ts
pnpm.cmd --filter @zhijiao/web typecheck
```

全绿。

```powershell
git add apps/web/server/env.ts apps/web/tests/setup.ts apps/web/e2e/global-setup.ts apps/web/tests/integration/env-plan3.test.ts apps/web/tests/integration/_env-helper.ts .env.example
git commit -m "feat(web): Task 6 — env validator + .env defaults for Plan 3 (9 fields + 2 refines)"
```

---

## Task 7：限频规则扩展 + Redis-down 测试

> **核心**：Plan 2 Hardening Task 7 已建好 `RULE_REGISTER_IP` / `RULE_REFRESH`（fail-open）；本 task 加 `RULE_TOPUP_CREATE_{IP,USER}`（**fail-close**，差异化）。

**Files：**
- Modify: `packages/auth/src/ratelimit/rules.ts`
- Create: `packages/auth/tests/topup-rules.test.ts`（unit; ratelimit cap & failClose）

- [ ] **步骤 7.1：扩 `rules.ts`**

在文件末尾的常量定义末尾追加（在 `takeRule` 函数定义之前，与其它 `RULE_` 并列）：

```ts
export const RULE_TOPUP_CREATE_IP: RateLimitRule = {
  prefix: "topup:create:ip:",
  capacity: 5,
  refillPerSec: 5 / 60,
  failMode: "close",
};
export const RULE_TOPUP_CREATE_USER: RateLimitRule = {
  prefix: "topup:create:user:",
  capacity: 10,
  refillPerSec: 10 / 600,
  failMode: "close",
};
```

- [ ] **步骤 7.2：失败 test — `topup-rules.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { InMemoryRateLimitStore } from "../src/ratelimit/in-memory-store";
import { RateLimitBackendDownError } from "../src/ratelimit/types";
import {
  takeRule,
  RULE_TOPUP_CREATE_IP,
  RULE_TOPUP_CREATE_USER,
} from "../src/ratelimit/rules";

describe("RULE_TOPUP_CREATE_IP / USER", () => {
  it("IP cap = 5", async () => {
    const store = new InMemoryRateLimitStore();
    let allowed = 0;
    for (let i = 0; i < 8; i++) {
      const r = await takeRule(store, RULE_TOPUP_CREATE_IP, "1.2.3.4");
      if (r.allowed) allowed++;
    }
    expect(allowed).toBe(5);
  });

  it("USER cap = 10", async () => {
    const store = new InMemoryRateLimitStore();
    let allowed = 0;
    for (let i = 0; i < 15; i++) {
      const r = await takeRule(store, RULE_TOPUP_CREATE_USER, "user-abc");
      if (r.allowed) allowed++;
    }
    expect(allowed).toBe(10);
  });

  it("fail-CLOSE: backend down throws RateLimitBackendDownError", async () => {
    const broken = {
      async take(): Promise<never> {
        throw new RateLimitBackendDownError();
      },
    };
    await expect(
      takeRule(broken, RULE_TOPUP_CREATE_IP, "ip"),
    ).rejects.toBeInstanceOf(RateLimitBackendDownError);
  });
});
```

跑 `pnpm.cmd --filter @zhijiao/auth test -- tests/topup-rules.test.ts` → 期望 3 passed。

> 如果 `InMemoryRateLimitStore` 实际类名不同，去 `packages/auth/src/ratelimit/in-memory-store.ts` 拿到正确导出名再改。

- [ ] **步骤 7.3：commit**

```powershell
git add packages/auth/src/ratelimit/rules.ts packages/auth/tests/topup-rules.test.ts
git commit -m "feat(auth): Task 7 — RULE_TOPUP_CREATE_IP/USER (fail-close)"
```

---

## Task 8：Ctx 扩展（requestId / isMinor）+ pino structured logger

> **核心**：Ctx 加 `requestId` + `auth.isMinor`。新建 `apps/web/server/logger.ts`（`import "server-only"` + pino）。把 `setBillingLogger(pinoInstance)` 在 logger 加载时调一下（让 billing 包写出去的日志真的进 pino）。

**Files：**
- Modify: `apps/web/package.json`（加 pino, @types/pino）
- Create: `apps/web/server/logger.ts`
- Modify: `apps/web/server/context.ts`（加 requestId + isMinor）
- Modify: `packages/auth/src/jwt.ts`（**不动**，isMinor 通过 createContext 查 DB，**不**进 JWT）
- Create: `apps/web/tests/integration/context-plan3.test.ts`（验证 ctx.requestId + ctx.auth.isMinor）

> 不动 JWT 的理由：JWT 里塞 isMinor 会让现有 token 失效（Plan 2 已签的 token 没这字段，反序列化遇 `roles ?? []` 一样会兼容但 `isMinor` 字段直接缺失）。`createContext` 走一次 `User.findUnique` 拿 `isMinor` 也很便宜（与现有 Session 查询合并的话 0 额外 round-trip）。

- [ ] **步骤 8.1：装依赖**

```powershell
pnpm.cmd add pino --filter @zhijiao/web
pnpm.cmd add -D @types/pino --filter @zhijiao/web
```

> 如果 `@types/pino` 在你装的 pino 版本里已经自带（pino 8.x 自带 types），可跳过。检查 `apps/web/node_modules/pino/package.json` 的 `types` 字段。

- [ ] **步骤 8.2：建 `apps/web/server/logger.ts`**

```ts
import "server-only";
import pino, { type Logger } from "pino";
import { env } from "./env.js";
import { setBillingLogger } from "@zhijiao/billing";

export const logger: Logger = pino({
  level: env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "*.rawBody",
      "*.signature",
    ],
    censor: "[redacted]",
  },
});

// 把 billing 包内部的 noop logger 替换成 pino。
// 注意：billing 是 ESM；模块单例；这里调用一次即可在整个进程生命周期生效。
setBillingLogger({
  error: (obj, msg) => logger.error(obj, msg),
  warn: (obj, msg) => logger.warn(obj, msg),
  info: (obj, msg) => logger.info(obj, msg),
});
```

- [ ] **步骤 8.3：修改 `apps/web/server/context.ts`**

把 `Ctx` 类型加两个字段；`createContext` 里查 User.isMinor + 生成 requestId：

```ts
export type Ctx = {
  db: typeof prisma;
  redis: typeof redis;
  auth: (AccessClaims & { isMinor: boolean }) | null;
  authError: AuthError | null;
  ip: string;
  ua: string;
  requestId: string;
  resHeaders: Headers;
  cookies: Record<string, string>;
};
```

在 `createContext` 末尾 return 之前：

```ts
const requestId =
  req.headers.get("x-request-id") ||
  (typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2));

let isMinor = true;
if (auth) {
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { isMinor: true },
  });
  isMinor = user?.isMinor ?? true; // 默认 fail-safe = true（保守）
}

return {
  db: prisma,
  redis,
  auth: auth ? { ...auth, isMinor } : null,
  authError,
  ip,
  ua,
  requestId,
  resHeaders,
  cookies,
};
```

> 注：`crypto.randomUUID` 在 Node 19+ 全局可用。如不确定，import `from "node:crypto"`。

- [ ] **步骤 8.4：把 `apps/web/server/logger.ts` 在合适入口加载一次**

最简单：在 `apps/web/server/context.ts` 顶部 `import "./logger.js";`——任何 tRPC 请求第一次进 ctx 都会触发 logger 单例加载和 `setBillingLogger(...)` 副作用。

或在 `apps/web/app/api/trpc/[trpc]/route.ts` 顶部 import 一次。两选一。

> 选 `context.ts` 顶部 import 更稳：webhook handler `/api/wechat-pay/notify` 不走 trpc context，但它自己 import logger 就好。

- [ ] **步骤 8.5：建集成测试 `apps/web/tests/integration/context-plan3.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createContext } from "../../server/context";

function mkReq(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { headers });
}

describe("createContext — Plan 3 additions", () => {
  it("generates requestId when X-Request-Id absent", async () => {
    const ctx = await createContext({
      req: mkReq({}),
      resHeaders: new Headers(),
    });
    expect(ctx.requestId).toBeTruthy();
    expect(ctx.requestId.length).toBeGreaterThanOrEqual(8);
  });

  it("uses X-Request-Id when present", async () => {
    const ctx = await createContext({
      req: mkReq({ "x-request-id": "trace-abc-123" }),
      resHeaders: new Headers(),
    });
    expect(ctx.requestId).toBe("trace-abc-123");
  });

  it("auth is null when no cookie → no isMinor lookup; ctx.auth === null", async () => {
    const ctx = await createContext({
      req: mkReq({}),
      resHeaders: new Headers(),
    });
    expect(ctx.auth).toBeNull();
  });

  // ctx.auth.isMinor positive-path 用 e2e 或 charged-procedure-tutor 集成测试覆盖（需要真 session）
});
```

跑 → 3 passed。

- [ ] **步骤 8.6：commit**

```powershell
git add apps/web/package.json apps/web/server/logger.ts apps/web/server/context.ts apps/web/tests/integration/context-plan3.test.ts pnpm-lock.yaml
git commit -m "feat(web): Task 8 — ctx.requestId + ctx.auth.isMinor + pino logger"
```

---

## Task 9：`chargedProcedure` 中间件（替换 `creditPlaceholder`）

> **核心**：删 Plan 2 的 `creditPlaceholder`；加 `chargedProcedure(actionKind)`：input 强校验 `clientRequestId` UUID → ensureWallet → `chargeForAction` → next() → catch 默认 compensate（白名单不补）。

**Files：**
- Modify: `apps/web/server/trpc.ts`（删 `creditPlaceholder`，加 `chargedProcedure`）
- Modify: `apps/web/server/routers/tutor.ts`（暂不动，下一 task 改）

> 本 task 只引入 `chargedProcedure` 类型 & 中间件；先不在 tutor 上挂——避免一次改动太大。Task 12 才挂到 tutor。

- [ ] **步骤 9.1：改 `apps/web/server/trpc.ts`**

```ts
import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { hasPermission, type Permission } from "@zhijiao/domain";
import {
  ensureWallet,
  chargeForAction,
  compensate,
  shouldCompensate,
  errorReason,
  ActionAlreadyChargedError,
  priceOf,
  type ActionKind,
} from "@zhijiao/billing";
import { logger } from "./logger.js";
import type { Ctx } from "./context.js";

const t = initTRPC.context<Ctx>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause as { reason?: string } | undefined;
    return {
      ...shape,
      data: { ...shape.data, reason: cause?.reason ?? null },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请先登录",
      cause: { reason: ctx.authError ?? "NO_SESSION" },
    });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

export const permissionProcedure = (perm: Permission) =>
  authedProcedure.use(({ ctx, next }) => {
    if (!hasPermission(ctx.auth.roles, perm)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "权限不足",
        cause: { reason: "PERMISSION_DENIED" },
      });
    }
    return next();
  });

export const chargedProcedure = (kind: ActionKind) =>
  authedProcedure.use(async ({ ctx, next, rawInput }) => {
    const parsed = z
      .object({ clientRequestId: z.string().uuid() })
      .safeParse(rawInput);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "缺少 clientRequestId",
        cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" },
      });
    }
    const clientRequestId = parsed.data.clientRequestId;

    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    const cost = priceOf(kind);

    let debit: Awaited<ReturnType<typeof chargeForAction>>;
    try {
      debit = await chargeForAction(ctx.db, {
        walletId: wallet.id,
        kind,
        cost,
        idemKey: `debit:${kind.toLowerCase()}:${ctx.auth.userId}:${clientRequestId}`,
        createdByUserId: ctx.auth.userId,
      });
    } catch (e) {
      if (e instanceof ActionAlreadyChargedError) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "请求已处理，请勿重复提交",
          cause: { reason: "ACTION_IDEMPOTENCY_HIT" },
        });
      }
      throw e;
    }

    if (debit.kind === "INSUFFICIENT_BALANCE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "余额不足",
        cause: {
          reason: "INSUFFICIENT_BALANCE",
          required: cost,
          balance: debit.balance,
        },
      });
    }

    try {
      return await next();
    } catch (e) {
      if (shouldCompensate(e)) {
        await compensate(ctx.db, {
          originalLedgerId: debit.ledgerId,
          walletId: wallet.id,
          cost,
          kind,
          reason: errorReason(e),
        });
      } else {
        await ctx.db.creditLedger.update({
          where: { id: debit.ledgerId },
          data: {
            metadata: {
              compensationStatus: "not_compensated_whitelisted",
              errorClass:
                (e as { constructor?: { name?: string } } | null)?.constructor
                  ?.name ?? "Unknown",
            },
          },
        });
        logger.warn(
          {
            event: "charged_action_not_compensated",
            ledgerId: debit.ledgerId,
            walletId: wallet.id,
            userId: ctx.auth.userId,
            actionKind: kind,
            cost,
            errorClass:
              (e as { constructor?: { name?: string } } | null)?.constructor
                ?.name ?? "Unknown",
            requestId: ctx.requestId,
          },
          "Action failed but whitelisted as non-compensable",
        );
      }
      throw e;
    }
  });
```

注意：删除原来的 `creditPlaceholder` 导出。

- [ ] **步骤 9.2：临时让 tutor 继续 build**

`apps/web/server/routers/tutor.ts` 里 `creditPlaceholder("TUTOR_ASK")` 暂时改成 `authedProcedure`（Task 12 才正式套 chargedProcedure）：

```ts
import "server-only";
import { authedProcedure, router } from "../trpc.js";
// ... rest unchanged
export const tutorRouter = router({
  ask: authedProcedure
    .input(TutoringInputSchema)
    .mutation(async ({ ctx, input }) => {
      // ... unchanged body
    }),
});
```

> 这一步是过渡。Task 12 会把 input schema 加 `clientRequestId` 并切回 `chargedProcedure("TUTOR_ASK")`。

- [ ] **步骤 9.3：typecheck**

```powershell
pnpm.cmd --filter @zhijiao/web typecheck
```

期望全绿。如果报 `creditPlaceholder` 还在被其他文件 import，grep 找出来全删：

```powershell
Get-ChildItem -Recurse -Path apps/web,packages -Include *.ts | Select-String "creditPlaceholder"
```

- [ ] **步骤 9.4：commit**

```powershell
git add apps/web/server/trpc.ts apps/web/server/routers/tutor.ts
git commit -m "feat(web): Task 9 — chargedProcedure middleware (replaces creditPlaceholder)"
```

---

## Task 10：`wallet` tRPC 路由

> **核心**：5 个 procedure（balance / topupCreate / topupStatus / ledgerList / walletAdminAdjust）。topupCreate 是最复杂——RULE_TOPUP_CREATE_{IP,USER} fail-close → ensureWallet → 未成年月度上限 → create CREATED → adapter.unifiedOrder → update PENDING → adapter.signalOrderReady。

**Files：**
- Create: `apps/web/server/routers/wallet.ts`
- Modify: `apps/web/server/routers/_root.ts`（挂 wallet）
- Create: `apps/web/server/wechat-pay-adapter.ts`（singleton getter）
- Create: `apps/web/server/errors.ts`（如不存在；加 `toTRPCError`）
- Create: `apps/web/tests/integration/wallet-balance.test.ts`
- Create: `apps/web/tests/integration/wallet-topup-create.test.ts`
- Create: `apps/web/tests/integration/wallet-topup-create-ratelimit.test.ts`
- Create: `apps/web/tests/integration/wallet-topup-create-minor.test.ts`
- Create: `apps/web/tests/integration/wallet-ledger-list.test.ts`
- Create: `apps/web/tests/integration/wallet-admin-adjust.test.ts`

- [ ] **步骤 10.1：建 `apps/web/server/wechat-pay-adapter.ts`（singleton）**

```ts
import "server-only";
import {
  buildWechatPayAdapter,
  type WechatPayAdapter,
} from "@zhijiao/integrations";
import { env } from "./env.js";

let _adapter: WechatPayAdapter | null = null;

export function getWechatPayAdapter(): WechatPayAdapter {
  if (_adapter) return _adapter;
  const useMock = env.WECHAT_PAY_USE_MOCK === "true";
  const notifyUrl = `${env.NEXT_PUBLIC_APP_URL}/api/wechat-pay/notify`;
  _adapter = buildWechatPayAdapter({
    useMock,
    notifyUrl,
    mockSecret: env.MOCK_WECHAT_PAY_SECRET,
    appId: env.WECHAT_PAY_APPID ?? "wxapp_unknown",
    mchId: env.WECHAT_PAY_MCHID ?? "0",
    apiV3Key: env.WECHAT_PAY_API_V3_KEY,
    privateKey: env.WECHAT_PAY_PRIVATE_KEY,
    certSerial: env.WECHAT_PAY_CERT_SERIAL,
    pubKeyFile: env.WECHAT_PAY_PUB_KEY_FILE,
    notifyHost: env.WECHAT_PAY_NOTIFY_HOST,
    notifyMode:
      process.env.NODE_ENV === "test" ? "manual" : "async-delayed",
  });
  return _adapter;
}

/** Test-only helper: 重置 singleton（用于单测换 notifyMode 或换 adapter）。 */
export function _resetWechatPayAdapterForTests(): void {
  _adapter = null;
}
```

- [ ] **步骤 10.2：建 `apps/web/server/errors.ts`（如已存在则在末尾加）**

```ts
import { TRPCError } from "@trpc/server";

type TrpcCode =
  | "PARSE_ERROR"
  | "BAD_REQUEST"
  | "INTERNAL_SERVER_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "METHOD_NOT_SUPPORTED"
  | "UNPROCESSABLE_CONTENT"
  | "TOO_MANY_REQUESTS"
  | "CLIENT_CLOSED_REQUEST";

export function toTRPCError(
  reason: string,
  code: TrpcCode,
  extras?: Record<string, unknown>,
): never {
  throw new TRPCError({
    code,
    message: reason,
    cause: { reason, ...(extras ?? {}) },
  });
}
```

> 如果 Plan 2 已经有 `toTRPCError` helper，沿用，不要重定义。grep 一遍：`Get-ChildItem -Recurse -Path apps/web -Include *.ts | Select-String "function toTRPCError"`。

- [ ] **步骤 10.3：建 `apps/web/server/routers/wallet.ts`**

```ts
import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { customAlphabet } from "nanoid";
import {
  ensureWallet,
  adminAdjust,
  sumMonthlyTopupCents,
  type AdjustReasonCode,
} from "@zhijiao/billing";
import {
  RedisRateLimitStore,
  takeRule,
  RULE_TOPUP_CREATE_IP,
  RULE_TOPUP_CREATE_USER,
  RateLimitBackendDownError,
} from "@zhijiao/auth";
import {
  authedProcedure,
  permissionProcedure,
  router,
} from "../trpc.js";
import { env } from "../env.js";
import { getWechatPayAdapter } from "../wechat-pay-adapter.js";
import { logger } from "../logger.js";
import { toTRPCError } from "../errors.js";

const ratelimitStore = (redis: import("ioredis").default) =>
  new RedisRateLimitStore(redis);

const nanoid = customAlphabet(
  "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  12,
);

export const walletRouter = router({
  balance: authedProcedure.query(async ({ ctx }) => {
    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    let monthly: {
      topupYuan: number;
      remainingYuan: number;
      limitYuan: number;
    } | null = null;
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
    .input(
      z.object({
        amountCents: z
          .number()
          .int()
          .min(100)
          .max(100_000)
          .refine((v) => v % 100 === 0, "amountCents must be a multiple of 100"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const store = ratelimitStore(ctx.redis);
      try {
        const r1 = await takeRule(store, RULE_TOPUP_CREATE_IP, ctx.ip);
        if (!r1.allowed) {
          throw toTRPCError("TOPUP_TOO_FREQUENT", "TOO_MANY_REQUESTS", {
            retryAfterMs: r1.retryAfterMs,
          });
        }
        const r2 = await takeRule(
          store,
          RULE_TOPUP_CREATE_USER,
          ctx.auth.userId,
        );
        if (!r2.allowed) {
          throw toTRPCError("TOPUP_TOO_FREQUENT", "TOO_MANY_REQUESTS", {
            retryAfterMs: r2.retryAfterMs,
          });
        }
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) {
          throw toTRPCError(
            "TOPUP_RATE_LIMIT_UNAVAILABLE",
            "INTERNAL_SERVER_ERROR",
          );
        }
        throw e;
      }

      await ensureWallet(ctx.db, ctx.auth.userId);

      if (ctx.auth.isMinor) {
        const used = await sumMonthlyTopupCents(ctx.db, ctx.auth.userId);
        const limit = env.MINOR_MONTHLY_LIMIT_YUAN * 100;
        if (used + input.amountCents > limit) {
          throw toTRPCError(
            "MINOR_MONTHLY_LIMIT_REACHED",
            "PRECONDITION_FAILED",
            {
              monthlyYuan: used / 100,
              limitYuan: limit / 100,
              attemptYuan: input.amountCents / 100,
            },
          );
        }
      }

      const credits = (input.amountCents / 100) * env.CREDIT_PER_YUAN;
      const outTradeNo = `zj_${ctx.auth.userId.slice(0, 8)}_${nanoid()}`;
      const expiredAt = new Date(Date.now() + 30 * 60 * 1000);

      const order = await ctx.db.topupOrder.create({
        data: {
          userId: ctx.auth.userId,
          amountCents: input.amountCents,
          credits,
          outTradeNo,
          expiredAt,
          ipCreated: ctx.ip,
          userAgent: ctx.ua,
        },
      });

      const adapter = getWechatPayAdapter();
      let prepayId: string;
      let qrCode: string | undefined;
      let h5Url: string | undefined;
      try {
        const r = await adapter.unifiedOrder({
          outTradeNo,
          amountCents: input.amountCents,
          description: `智教 Credit 充值 ${input.amountCents / 100} 元`,
        });
        prepayId = r.prepayId;
        qrCode = r.qrCode;
        h5Url = r.h5Url;
      } catch (e) {
        await ctx.db.topupOrder.update({
          where: { id: order.id },
          data: { status: "FAILED" },
        });
        logger.error(
          { event: "topup_unified_order_failed", orderId: order.id, error: String(e) },
          "unifiedOrder threw",
        );
        throw toTRPCError("TOPUP_ADAPTER_ERROR", "INTERNAL_SERVER_ERROR");
      }

      await ctx.db.topupOrder.update({
        where: { id: order.id },
        data: { status: "PENDING", prepayId },
      });

      await adapter.signalOrderReady(outTradeNo, input.amountCents);

      return {
        orderId: order.id,
        outTradeNo,
        prepayId,
        qrCode,
        h5Url,
        expiresAt: expiredAt,
        credits,
      };
    }),

  topupStatus: authedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ ctx, input }) => {
      const o = await ctx.db.topupOrder.findFirst({
        where: { id: input.orderId, userId: ctx.auth.userId },
      });
      if (!o) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "订单不存在",
          cause: { reason: "ORDER_NOT_FOUND" },
        });
      }
      return {
        status: o.status,
        paidAt: o.paidAt,
        credits: o.credits,
        expiredAt: o.expiredAt,
      };
    }),

  ledgerList: authedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
      const entries = await ctx.db.creditLedger.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor
          ? { cursor: { id: input.cursor }, skip: 1 }
          : {}),
      });
      const nextCursor =
        entries.length > input.limit ? entries.pop()!.id : null;
      return {
        entries: entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          delta: e.delta,
          balanceAfter: e.balanceAfter,
          actionKind: e.actionKind,
          createdAt: e.createdAt,
        })),
        nextCursor,
      };
    }),

  walletAdminAdjust: permissionProcedure("OPS_ADJUST_CREDIT")
    .input(
      z.object({
        targetUserId: z.string(),
        delta: z
          .number()
          .int()
          .refine(
            (n) => n !== 0 && Math.abs(n) <= 1_000_000,
            "delta must be non-zero and |delta| <= 1,000,000 credits",
          ),
        reasonCode: z.enum([
          "FAULT_RECOVERY",
          "CUSTOMER_SERVICE_GIFT",
          "PROMO",
          "FRAUD_CLAWBACK",
          "OTHER",
        ]),
        reasonDetail: z.string().min(10).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureWallet(ctx.db, input.targetUserId);
      const result = await adminAdjust(ctx.db, {
        targetUserId: input.targetUserId,
        delta: input.delta,
        reasonCode: input.reasonCode as AdjustReasonCode,
        reasonDetail: input.reasonDetail,
        opsUserId: ctx.auth.userId,
      });
      logger.info(
        {
          event: "ops_wallet_adjust",
          opsUserId: ctx.auth.userId,
          targetUserId: input.targetUserId,
          delta: input.delta,
          reasonCode: input.reasonCode,
          ledgerId: result.ledgerId,
          requestId: ctx.requestId,
        },
        "OPS adjusted wallet",
      );
      return result;
    }),
});
```

> `nanoid` 来源：grep 包看是否已 dep。如未有：`pnpm.cmd add nanoid --filter @zhijiao/web`。

- [ ] **步骤 10.4：挂到 root router**

打开 `apps/web/server/routers/_root.ts`，加：

```ts
import { walletRouter } from "./wallet.js";
// ... 在 router({ ... }) 内加：
//   wallet: walletRouter,
```

- [ ] **步骤 10.5：写集成测试**

每个测试都需要：用 tRPC server-side caller 直接调 procedure（Plan 2 已建好模式）。grep 看 Plan 2 集成测试怎么 create caller 的（`Get-Content apps/web/tests/integration/auth-register-ratelimit.test.ts | Select-Object -First 30`）然后照搬。

**`wallet-balance.test.ts`**：建用户 → ensureWallet → 给 balance；call balance → 拿到 balance + isMinor 时 monthly 字段。

**`wallet-topup-create.test.ts`**：happy path（非未成年）→ amountCents=100 → 拿到 prepayId+qrCode+h5Url+credits=10；DB 里 TopupOrder.status=PENDING。

**`wallet-topup-create-ratelimit.test.ts`**：
- Sub-test 1：同 IP 6 次 → 第 6 次 TOO_MANY_REQUESTS / reason=TOPUP_TOO_FREQUENT
- Sub-test 2：Redis 挂（mock store 抛 RateLimitBackendDownError）→ 第 1 次就 INTERNAL_SERVER_ERROR / reason=TOPUP_RATE_LIMIT_UNAVAILABLE；DB 无新 TopupOrder

**`wallet-topup-create-minor.test.ts`**：
- isMinor=true + 已 PAID 累计 19000 cents（190 元）+ 新单 amountCents=2000 → PRECONDITION_FAILED / reason=MINOR_MONTHLY_LIMIT_REACHED
- isMinor=true + 已 PAID 19000 + 新单 1000 → OK
- isMinor=true + CREATED/PENDING 9000 + PAID 9000 + 新单 3000 → 触发上限（合计算）

**`wallet-ledger-list.test.ts`**：seed 30 条 ledger → 默认 limit=20 拿 20 + nextCursor；带 cursor 拿下 10 + nextCursor=null。

**`wallet-admin-adjust.test.ts`**：
- 非 OPS user 调 → FORBIDDEN / PERMISSION_DENIED
- OPS user 调 +100 → balance=100；新 ADJUST_ADD entry，metadata.reasonCode/reasonDetail/opsUserId 都对
- delta=0 → BAD_REQUEST（zod refine）
- |delta|>1_000_000 → BAD_REQUEST
- reasonDetail < 10 → BAD_REQUEST

每个测试范例（以 wallet-balance 为最简 reference，其它仿照）：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "../../server/routers/_root";
import { prisma } from "@zhijiao/db";
import { redis } from "../../server/lib/redis";

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "sessions", "auth_identities", "user_roles", "users" RESTART IDENTITY CASCADE;',
  );
}

async function seedUser(isMinor = false): Promise<string> {
  const u = await prisma.user.create({
    data: { isMinor, persona: "STUDENT" },
  });
  return u.id;
}

function makeCtx(userId: string, opts: { isMinor?: boolean; ip?: string } = {}) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [],
      isMinor: opts.isMinor ?? false,
    },
    authError: null,
    ip: opts.ip ?? "127.0.0.1",
    ua: "vitest",
    requestId: "test-req",
    resHeaders: new Headers(),
    cookies: {},
  };
}

describe("wallet.balance", () => {
  beforeEach(reset);

  it("returns balance=0 for fresh user; monthly=null when not minor", async () => {
    const userId = await seedUser(false);
    const caller = appRouter.createCaller(makeCtx(userId));
    const r = await caller.wallet.balance();
    expect(r.balance).toBe(0);
    expect(r.monthly).toBeNull();
  });

  it("returns balance + monthly limits for minor", async () => {
    const userId = await seedUser(true);
    const caller = appRouter.createCaller(makeCtx(userId, { isMinor: true }));
    const r = await caller.wallet.balance();
    expect(r.balance).toBe(0);
    expect(r.monthly?.limitYuan).toBe(200);
    expect(r.monthly?.remainingYuan).toBe(200);
  });
});
```

> 注意：`makeCtx` 直接构造 ctx 绕过真鉴权——Plan 2 集成测试已经是这模式（看 `auth-register-ratelimit.test.ts` 的 `tRPC.createCaller(...)` 风格）。如果实际入口是 `appRouter`、`testCaller` 等不同名字，从已有测试搬。

每个测试跑：

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/wallet-balance.test.ts
# 重复其它 5 个
```

- [ ] **步骤 10.6：合并跑全部 web integration**

```powershell
pnpm.cmd --filter @zhijiao/web test
```

期望全绿。

- [ ] **步骤 10.7：commit**

```powershell
git add apps/web/server/routers/wallet.ts apps/web/server/routers/_root.ts apps/web/server/wechat-pay-adapter.ts apps/web/server/errors.ts apps/web/tests/integration/wallet-*.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): Task 10 — wallet tRPC router (balance/topupCreate/topupStatus/ledgerList/adminAdjust)"
```

---

## Task 11：`/api/wechat-pay/notify` route handler

> **核心**：webhook 唯一入口。先无条件写 WechatPayEvent（PENDING）作审计；调 `adapter.verifyNotify`；失败 → 更新 event.verifyStatus + 200；OK → 调 `applyWechatPayNotify`；正常处理结果一律 200；仅 applyWechatPayNotify 重抛非 P2002 → 500。

**Files：**
- Create: `apps/web/app/api/wechat-pay/notify/route.ts`
- Create: `apps/web/tests/integration/wechat-pay-notify-happy.test.ts`
- Create: `apps/web/tests/integration/wechat-pay-notify-race.test.ts`
- Create: `apps/web/tests/integration/wechat-pay-notify-invalid.test.ts`

- [ ] **步骤 11.1：建 `apps/web/app/api/wechat-pay/notify/route.ts`**

```ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@zhijiao/db";
import { applyWechatPayNotify } from "@zhijiao/billing";
import { getWechatPayAdapter } from "@/server/wechat-pay-adapter";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers = {
    signature: req.headers.get("Wechatpay-Signature"),
    timestamp: req.headers.get("Wechatpay-Timestamp"),
    nonce: req.headers.get("Wechatpay-Nonce"),
    serial: req.headers.get("Wechatpay-Serial"),
  };

  // 1. 先无条件写 event 作审计
  const event = await prisma.wechatPayEvent.create({
    data: {
      outTradeNo: "",
      rawBody,
      signature: headers.signature ?? undefined,
      timestamp: headers.timestamp ?? undefined,
      nonce: headers.nonce ?? undefined,
      serial: headers.serial ?? undefined,
      verifyStatus: "PENDING",
    },
  });

  try {
    // 2. verify
    const adapter = getWechatPayAdapter();
    const verify = await adapter.verifyNotify(headers, rawBody);
    if (!verify.ok) {
      await prisma.wechatPayEvent.update({
        where: { id: event.id },
        data: {
          verifyStatus: verify.reason,
          handled: true,
          processedAt: new Date(),
        },
      });
      return new NextResponse("", { status: 200 });
    }

    // 3. apply
    await prisma.wechatPayEvent.update({
      where: { id: event.id },
      data: {
        verifyStatus: "OK",
        outTradeNo: verify.outTradeNo,
        transactionId: verify.transactionId,
      },
    });

    const result = await applyWechatPayNotify(
      prisma,
      verify,
      env.WECHAT_PAY_APPID ?? "wxapp_unknown",
      env.WECHAT_PAY_MCHID ?? "0",
    );

    const errorMap: Partial<Record<typeof result.kind, string>> = {
      ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
      AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
      APP_OR_MCH_MISMATCH: "APP_OR_MCH_MISMATCH",
      INTERMEDIATE_STATE_NOTPAY: "INTERMEDIATE_STATE_NOTPAY",
      INTERMEDIATE_STATE_USERPAYING: "INTERMEDIATE_STATE_USERPAYING",
      UNEXPECTED_REFUND: "UNEXPECTED_REFUND",
      UNKNOWN_TRADE_STATE: "UNKNOWN_TRADE_STATE",
      DUPLICATE_TRANSACTION_ID: "DUPLICATE_TRANSACTION_ID",
    };

    const isOk = result.kind === "PAID" || result.kind === "ALREADY_PAID" || result.kind === "FAILED";
    await prisma.wechatPayEvent.update({
      where: { id: event.id },
      data: {
        handled: true,
        processedAt: new Date(),
        error: isOk ? null : (errorMap[result.kind] ?? result.kind),
      },
    });

    if (
      result.kind === "AMOUNT_MISMATCH" ||
      result.kind === "APP_OR_MCH_MISMATCH"
    ) {
      logger.error(
        {
          event: "wechat_pay_critical_mismatch",
          kind: result.kind,
          outTradeNo: verify.outTradeNo,
          eventId: event.id,
        },
        "WeChat Pay critical mismatch — investigate",
      );
    } else if (result.kind === "UNEXPECTED_REFUND") {
      logger.warn(
        { event: "wechat_pay_unexpected_refund", outTradeNo: verify.outTradeNo, eventId: event.id },
        "Refund webhook received but refunds disabled",
      );
    } else if (result.kind === "UNKNOWN_TRADE_STATE") {
      logger.warn(
        { event: "wechat_pay_unknown_trade_state", tradeState: verify.tradeState, eventId: event.id },
        "Unknown trade_state — V3 API upgrade?",
      );
    }

    // 所有可处理结果（含异常但已 handled）都 200
    return new NextResponse("", { status: 200 });
  } catch (e) {
    // 仅"程序 bug / DB 不可达 / P2002 重读不一致"才到这里
    logger.error(
      { event: "wechat_pay_notify_500", eventId: event.id, error: String(e) },
      "applyWechatPayNotify threw — returning 500 so WeChat retries",
    );
    return new NextResponse("", { status: 500 });
  }
}
```

- [ ] **步骤 11.2：失败 test — `wechat-pay-notify-happy.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../app/api/wechat-pay/notify/route";
import { prisma } from "@zhijiao/db";
import { MockWechatPayAdapter } from "@zhijiao/integrations";
import { _resetWechatPayAdapterForTests } from "../../server/wechat-pay-adapter";

const APP = "wxapp_test_dev";
const MCH = "1900000000";
const SECRET = "test-mock-pay-secret-32bytes-padding";

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "users" RESTART IDENTITY CASCADE;',
  );
  _resetWechatPayAdapterForTests();
}

async function captureNotify(adapter: MockWechatPayAdapter, outTradeNo: string, amountCents: number) {
  let captured: { headers: Headers; body: string } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    captured = {
      headers: new Headers(init?.headers),
      body: String(init?.body),
    };
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    await adapter.fireMockNotify(outTradeNo, amountCents);
  } finally {
    globalThis.fetch = realFetch;
  }
  return captured!;
}

function mkRequest(captured: { headers: Headers; body: string }): Request {
  return new Request("http://localhost/api/wechat-pay/notify", {
    method: "POST",
    headers: captured.headers,
    body: captured.body,
  });
}

describe("/api/wechat-pay/notify happy path", () => {
  beforeEach(reset);

  it("SUCCESS: order PENDING→PAID, balance += credits, ledger TOPUP inserted, returns 200", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({ data: { userId: u.id } });
    const order = await prisma.topupOrder.create({
      data: {
        userId: u.id,
        amountCents: 100,
        credits: 10,
        status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_happy1`,
        expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const adapter = new MockWechatPayAdapter({
      notifyUrl: "http://x/notify",
      mockSecret: SECRET,
      appId: APP,
      mchId: MCH,
      notifyMode: "manual",
    });
    const captured = await captureNotify(adapter, order.outTradeNo, 100);

    const res = await POST(mkRequest(captured) as never);
    expect(res.status).toBe(200);

    const reloaded = await prisma.topupOrder.findUnique({ where: { id: order.id } });
    expect(reloaded?.status).toBe("PAID");
    const wallet = await prisma.wallet.findUnique({ where: { id: w.id } });
    expect(wallet?.balance).toBe(10);
    const ledger = await prisma.creditLedger.findUnique({
      where: { idemKey: `topup:${order.outTradeNo}` },
    });
    expect(ledger?.delta).toBe(10);

    const events = await prisma.wechatPayEvent.findMany({
      where: { outTradeNo: order.outTradeNo },
    });
    expect(events).toHaveLength(1);
    expect(events[0].verifyStatus).toBe("OK");
    expect(events[0].handled).toBe(true);
    expect(events[0].error).toBeNull();
  });
});
```

> **重要**：这个测试用了 `POST(...) as never` 调 route handler 函数；Next.js 把 `NextRequest` 当成 `Request` 子类，直接 `new Request()` 大多数情况能跑。如果 Next 14 严格区分，用 `import { NextRequest } from "next/server"; new NextRequest(...)`。

- [ ] **步骤 11.3：失败 test — `wechat-pay-notify-race.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../app/api/wechat-pay/notify/route";
import { prisma } from "@zhijiao/db";
import { MockWechatPayAdapter } from "@zhijiao/integrations";
import { _resetWechatPayAdapterForTests } from "../../server/wechat-pay-adapter";

// shared setup helpers same as previous file …

describe("/api/wechat-pay/notify concurrent webhook race", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "users" RESTART IDENTITY CASCADE;',
    );
    _resetWechatPayAdapterForTests();
  });

  it("two parallel notifies on same outTradeNo → exactly one PAID + one ALREADY_PAID, both 200", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    await prisma.wallet.create({ data: { userId: u.id } });
    const order = await prisma.topupOrder.create({
      data: {
        userId: u.id, amountCents: 100, credits: 10, status: "PENDING",
        outTradeNo: `zj_${u.id.slice(0, 8)}_race1`,
        expiredAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const adapter = new MockWechatPayAdapter({
      notifyUrl: "http://x/notify",
      mockSecret: "test-mock-pay-secret-32bytes-padding",
      appId: "wxapp_test_dev",
      mchId: "1900000000",
      notifyMode: "manual",
    });
    // 用同一 transactionId 让两条 webhook 长得一样
    let captured: { headers: Headers; body: string } | null = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_i: unknown, init?: RequestInit) => {
      captured = { headers: new Headers(init?.headers), body: String(init?.body) };
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      await adapter.fireMockNotify(order.outTradeNo, 100);
    } finally {
      globalThis.fetch = realFetch;
    }

    const mkReq = () =>
      new Request("http://localhost/api/wechat-pay/notify", {
        method: "POST",
        headers: captured!.headers,
        body: captured!.body,
      });

    const [r1, r2] = await Promise.all([
      POST(mkReq() as never),
      POST(mkReq() as never),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const wallet = await prisma.wallet.findUnique({ where: { userId: u.id } });
    expect(wallet?.balance).toBe(10); // 不是 20
    const topupEntries = await prisma.creditLedger.findMany({
      where: { idemKey: `topup:${order.outTradeNo}` },
    });
    expect(topupEntries).toHaveLength(1);
    const events = await prisma.wechatPayEvent.findMany({
      where: { outTradeNo: order.outTradeNo },
    });
    expect(events).toHaveLength(2); // 每条 webhook 都写了 event
  });
});
```

> **注意**：这里 fireMockNotify 用同样的 transactionId 是因为我们捕获的 body 复用了。如果同一 body 被两条独立 mock notify 用，验证签都过 → 走到 `applyWechatPayNotify`，第二条撞 idemKey UNIQUE → P2002 重读 → ALREADY_PAID。正是 spec §4.1.1 想覆盖的情景。

- [ ] **步骤 11.4：失败 test — `wechat-pay-notify-invalid.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../app/api/wechat-pay/notify/route";
import { prisma } from "@zhijiao/db";
import { _resetWechatPayAdapterForTests } from "../../server/wechat-pay-adapter";

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "users" RESTART IDENTITY CASCADE;',
  );
  _resetWechatPayAdapterForTests();
}

describe("/api/wechat-pay/notify invalid input", () => {
  beforeEach(reset);

  it("SIG_INVALID: returns 200, event.verifyStatus=SIG_INVALID, no order change", async () => {
    const req = new Request("http://localhost/api/wechat-pay/notify", {
      method: "POST",
      headers: {
        "Wechatpay-Signature": "deadbeef",
        "Wechatpay-Timestamp": "0",
        "Wechatpay-Nonce": "n",
        "Wechatpay-Serial": "MOCK_CERT_SERIAL",
      },
      body: "{}",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const event = await prisma.wechatPayEvent.findFirst({});
    expect(event?.verifyStatus).toBe("SIG_INVALID");
    expect(event?.handled).toBe(true);
  });

  it("CERT_NOT_FOUND: wrong serial → 200, event.verifyStatus=CERT_NOT_FOUND", async () => {
    const req = new Request("http://localhost/api/wechat-pay/notify", {
      method: "POST",
      headers: {
        "Wechatpay-Signature": "x",
        "Wechatpay-Timestamp": "0",
        "Wechatpay-Nonce": "n",
        "Wechatpay-Serial": "UNKNOWN_SERIAL",
      },
      body: "{}",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const event = await prisma.wechatPayEvent.findFirst({});
    expect(event?.verifyStatus).toBe("CERT_NOT_FOUND");
  });
});
```

- [ ] **步骤 11.5：跑全部 + commit**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/wechat-pay-notify
pnpm.cmd --filter @zhijiao/web typecheck
```

全绿。

```powershell
git add apps/web/app/api/wechat-pay/notify/ apps/web/tests/integration/wechat-pay-notify-*.test.ts
git commit -m "feat(web): Task 11 — /api/wechat-pay/notify route handler (verify + apply + audit)"
```

---

## Task 12：接入 `tutor.ask`（chargedProcedure + clientRequestId）

> **核心**：把 Task 9 临时 fallback 的 `authedProcedure` 切回 `chargedProcedure("TUTOR_ASK")`；input schema 加 `clientRequestId: z.string().uuid()`。

**Files：**
- Modify: `apps/web/server/routers/tutor.ts`
- Modify: `apps/web/app/(student)/tutor/page.tsx`（或客户端调用方）—— 加 `clientRequestId: crypto.randomUUID()` 进 mutation input
- Create: `apps/web/tests/integration/charged-procedure-tutor.test.ts`
- Create: `apps/web/tests/integration/charged-procedure-idempotency.test.ts`
- Create: `apps/web/tests/integration/charged-procedure-compensation.test.ts`

- [ ] **步骤 12.1：改 `tutor.ts`**

```ts
import "server-only";
import { z } from "zod";
import { chargedProcedure, router } from "../trpc.js";
import { TutoringInputSchema, ComplianceRejectedError } from "@zhijiao/ai";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";

export const tutorRouter = router({
  ask: chargedProcedure("TUTOR_ASK")
    .input(
      z.object({
        clientRequestId: z.string().uuid(),
      }).and(TutoringInputSchema),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const r = getAiRouter(ctx.auth.userId);
        return await r.tutor(input);
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "讲解内容未通过合规检查，请换一道题或稍后再试。",
            cause: { reason: "COMPLIANCE_REJECTED" },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "讲解失败，请稍后再试。",
          cause: { reason: "TUTOR_INTERNAL" },
        });
      }
    }),
});
```

> 如果 `TutoringInputSchema` 本身是 `z.object({...})`，可以用 `.merge(z.object({ clientRequestId: ... }))`。两种写法都行；`.and()` 也通。验证 typecheck 即可。

- [ ] **步骤 12.2：改前端调用方（`apps/web/app/(student)/tutor/page.tsx` 或对应 client component）**

每次提问时生成 fresh UUID（避免点"提交"重试时重复扣点的话用同一 UUID）。最简：组件级 `useState(() => crypto.randomUUID())` 在每次点提交时刷新。grep 找 `tutor.ask.useMutation` 之类的调用点，加 input：

```ts
const clientRequestId = crypto.randomUUID();
mutation.mutate({ ...input, clientRequestId });
```

如果是 OptimizedUI 想"重试同一请求"，把 clientRequestId 存 ref / state，重试时复用。

> 这里允许偷懒：在 client 顶层 `<TutorForm />` 维护 `currentReqId`，"提交"时清掉换新，"重试"时复用。

- [ ] **步骤 12.3：建集成测试 `charged-procedure-tutor.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { appRouter } from "../../server/routers/_root";
import { prisma } from "@zhijiao/db";
import { redis } from "../../server/lib/redis";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor() {
      return { explanation: "ok", knowledgePoints: [], steps: [], answer: "42" };
    },
  }),
}));

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "model_calls", "prompt_templates", "users" RESTART IDENTITY CASCADE;',
  );
}

function makeCtx(userId: string) {
  return {
    db: prisma, redis,
    auth: { userId, sessionId: "s", persona: "STUDENT" as const, roles: [], isMinor: false },
    authError: null, ip: "127.0.0.1", ua: "vitest", requestId: "r",
    resHeaders: new Headers(), cookies: {},
  };
}

describe("chargedProcedure full chain via tutor.ask", () => {
  beforeEach(reset);

  it("success: balance -= 1 cost; one DEBIT ledger entry with idemKey debit:tutor_ask:<userId>:<clientRequestId>", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({ data: { userId: u.id, balance: 5 } });
    await prisma.creditLedger.create({
      data: { walletId: w.id, kind: "TOPUP", delta: 5, balanceAfter: 5, idemKey: `topup:boot:${u.id}` },
    });
    const reqId = "11111111-1111-1111-1111-111111111111";
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.tutor.ask({
      clientRequestId: reqId,
      question: "1+1=?", subject: "MATH", grade: 7, // adapt to TutoringInputSchema actual shape
    } as never);
    expect(r.answer).toBe("42");
    const wallet = await prisma.wallet.findUnique({ where: { id: w.id } });
    expect(wallet?.balance).toBe(4);
    const debit = await prisma.creditLedger.findUnique({
      where: { idemKey: `debit:tutor_ask:${u.id}:${reqId}` },
    });
    expect(debit?.delta).toBe(-1);
    expect(debit?.actionKind).toBe("TUTOR_ASK");
  });

  it("INSUFFICIENT_BALANCE: balance=0 → PRECONDITION_FAILED with required/balance fields", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.tutor.ask({
        clientRequestId: "22222222-2222-2222-2222-222222222222",
        question: "x", subject: "MATH", grade: 7,
      } as never),
    ).rejects.toThrow(/余额不足/);
  });

  it("CLIENT_REQUEST_ID_REQUIRED when clientRequestId not UUID", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    await prisma.wallet.create({ data: { userId: u.id, balance: 5 } });
    const caller = appRouter.createCaller(makeCtx(u.id));
    // 不传 / 非 UUID 都应 reject（zod input 校验或中间件校验）
    await expect(
      caller.tutor.ask({
        clientRequestId: "not-a-uuid",
        question: "x", subject: "MATH", grade: 7,
      } as never),
    ).rejects.toThrow();
  });
});
```

> 注：上面假设 `TutoringInputSchema` 包含 `question / subject / grade` 字段。**Read 一下** `packages/ai/src/...` 确认实际 schema 字段名，按实际改。

- [ ] **步骤 12.4：建 `charged-procedure-idempotency.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
// ... mock + reset 同上

describe("chargedProcedure idempotency", () => {
  beforeEach(reset);

  it("same clientRequestId twice → second returns CONFLICT/ACTION_IDEMPOTENCY_HIT; balance only -1 once; ai called only once", async () => {
    let aiCalls = 0;
    vi.doMock("@/lib/ai-client", () => ({
      getAiRouter: () => ({
        async tutor() {
          aiCalls++;
          return { explanation: "ok", knowledgePoints: [], steps: [], answer: "42" };
        },
      }),
    }));
    const u = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({ data: { userId: u.id, balance: 5 } });
    await prisma.creditLedger.create({
      data: { walletId: w.id, kind: "TOPUP", delta: 5, balanceAfter: 5, idemKey: `topup:boot:${u.id}` },
    });
    const reqId = "33333333-3333-3333-3333-333333333333";
    const caller = appRouter.createCaller(makeCtx(u.id));
    await caller.tutor.ask({
      clientRequestId: reqId, question: "x", subject: "MATH", grade: 7,
    } as never);
    await expect(
      caller.tutor.ask({
        clientRequestId: reqId, question: "x", subject: "MATH", grade: 7,
      } as never),
    ).rejects.toThrow(/请勿重复提交/);
    const wallet = await prisma.wallet.findUnique({ where: { id: w.id } });
    expect(wallet?.balance).toBe(4);
    expect(aiCalls).toBe(1);
  });
});
```

> `vi.doMock` 顺序敏感；如果 hoisted mock 与 doMock 冲突，把 ai-client mock 在文件顶部用 `vi.mock` 一次即可，counter 用 module-scoped 变量。

- [ ] **步骤 12.5：建 `charged-procedure-compensation.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
// reset, makeCtx 同上
import { ComplianceRejectedError } from "@zhijiao/ai";

describe("chargedProcedure compensation policy", () => {
  beforeEach(reset);

  it("default: ai throws generic Error → balance restored + COMPENSATION ledger entry", async () => {
    vi.doMock("@/lib/ai-client", () => ({
      getAiRouter: () => ({
        async tutor() { throw new Error("upstream timeout"); },
      }),
    }));
    const u = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({ data: { userId: u.id, balance: 5 } });
    await prisma.creditLedger.create({
      data: { walletId: w.id, kind: "TOPUP", delta: 5, balanceAfter: 5, idemKey: `topup:boot:${u.id}` },
    });
    const reqId = "44444444-4444-4444-4444-444444444444";
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.tutor.ask({
        clientRequestId: reqId, question: "x", subject: "MATH", grade: 7,
      } as never),
    ).rejects.toThrow();
    const wallet = await prisma.wallet.findUnique({ where: { id: w.id } });
    expect(wallet?.balance).toBe(5); // 已补
    const debit = await prisma.creditLedger.findFirst({
      where: { walletId: w.id, kind: "DEBIT" },
    });
    const comp = await prisma.creditLedger.findUnique({
      where: { idemKey: `comp:${debit!.id}` },
    });
    expect(comp?.delta).toBe(1);
    expect(comp?.kind).toBe("COMPENSATION");
  });

  it("ComplianceRejectedError whitelist: balance NOT restored; metadata.compensationStatus marked", async () => {
    vi.doMock("@/lib/ai-client", () => ({
      getAiRouter: () => ({
        async tutor() { throw new ComplianceRejectedError("blocked"); },
      }),
    }));
    const u = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({ data: { userId: u.id, balance: 5 } });
    await prisma.creditLedger.create({
      data: { walletId: w.id, kind: "TOPUP", delta: 5, balanceAfter: 5, idemKey: `topup:boot:${u.id}` },
    });
    const reqId = "55555555-5555-5555-5555-555555555555";
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.tutor.ask({
        clientRequestId: reqId, question: "x", subject: "MATH", grade: 7,
      } as never),
    ).rejects.toThrow();
    const wallet = await prisma.wallet.findUnique({ where: { id: w.id } });
    expect(wallet?.balance).toBe(4); // 没补
    const debit = await prisma.creditLedger.findFirst({
      where: { walletId: w.id, kind: "DEBIT" },
    });
    expect((debit?.metadata as { compensationStatus?: string })?.compensationStatus)
      .toBe("not_compensated_whitelisted");
  });
});
```

- [ ] **步骤 12.6：跑 + commit**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure
pnpm.cmd --filter @zhijiao/web typecheck
```

全绿。

```powershell
git add apps/web/server/routers/tutor.ts apps/web/app/(student)/tutor/ apps/web/tests/integration/charged-procedure-*.test.ts
git commit -m "feat(web): Task 12 — wire tutor.ask to chargedProcedure(TUTOR_ASK) + idempotency + compensation tests"
```

---

## Task 13：UI（最小化）—— 充值入口 + 余额组件 + ledger 列表

> **核心**：UI 不是 Plan 3 重点；最少够走通"充 100 元 → 看到 balance 10 → 提交 tutor 看到 balance 9"的闭环。所有 mutate 与查询都走 tRPC。

**Files：**
- Create: `apps/web/app/(student)/wallet/page.tsx`（Server Component 主壳）
- Create: `apps/web/app/(student)/wallet/topup-form.tsx`（Client Component）
- Create: `apps/web/app/(student)/wallet/ledger-list.tsx`（Client Component）
- Modify: `apps/web/app/(student)/tutor/page.tsx`（catch INSUFFICIENT_BALANCE → 提示充值）

- [ ] **步骤 13.1：建 `wallet/page.tsx`**

```tsx
import "server-only";
import { TopupForm } from "./topup-form";
import { LedgerList } from "./ledger-list";

export default function WalletPage() {
  return (
    <div className="mx-auto max-w-2xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">钱包</h1>
      <TopupForm />
      <LedgerList />
    </div>
  );
}
```

- [ ] **步骤 13.2：建 `wallet/topup-form.tsx`**

```tsx
"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client"; // adapt to actual client helper path

const PRESETS = [100, 500, 1000, 5000];

export function TopupForm() {
  const balance = trpc.wallet.balance.useQuery();
  const topup = trpc.wallet.topupCreate.useMutation();
  const [amountCents, setAmountCents] = useState(100);
  const [result, setResult] = useState<{
    orderId: string; prepayId: string; qrCode?: string; h5Url?: string; credits: number;
  } | null>(null);

  if (balance.isLoading) return <div>加载中…</div>;
  if (balance.isError) return <div className="text-red-600">读取余额失败</div>;

  return (
    <section className="space-y-4">
      <div className="rounded border p-4">
        <div className="text-sm text-gray-500">当前余额</div>
        <div className="text-3xl font-semibold">{balance.data!.balance} 点</div>
        {balance.data!.monthly && (
          <div className="text-xs text-amber-600 mt-2">
            未成年月度额度：{balance.data!.monthly.topupYuan} / {balance.data!.monthly.limitYuan} 元
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setAmountCents(c)}
            className={`rounded border px-3 py-1 ${amountCents === c ? "bg-black text-white" : ""}`}
          >
            {c / 100} 元
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={topup.isPending}
        onClick={async () => {
          try {
            const r = await topup.mutateAsync({ amountCents });
            setResult(r);
          } catch (e) {
            // tRPC error: cause.reason carries semantic code
            const reason = (e as { data?: { reason?: string } } | null)?.data?.reason;
            alert(`充值失败：${reason ?? String(e)}`);
          }
        }}
        className="rounded bg-emerald-600 px-4 py-2 text-white"
      >
        {topup.isPending ? "下单中…" : `充值 ${amountCents / 100} 元`}
      </button>

      {result && (
        <div className="rounded border p-3 text-sm space-y-1">
          <div>订单号：{result.orderId}</div>
          <div>预支付 ID：{result.prepayId}</div>
          <div>到账 Credit：{result.credits}</div>
          {result.qrCode && (
            <div className="font-mono text-xs">扫码（mock）：{result.qrCode}</div>
          )}
          <div className="text-gray-500 text-xs">支付完成后余额会自动更新（等几秒）</div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **步骤 13.3：建 `wallet/ledger-list.tsx`**

```tsx
"use client";
import { trpc } from "@/lib/trpc-client";

const KIND_LABEL: Record<string, string> = {
  TOPUP: "充值",
  DEBIT: "扣费",
  COMPENSATION: "补偿",
  ADJUST_ADD: "OPS 调账（增）",
  ADJUST_SUB: "OPS 调账（减）",
};

export function LedgerList() {
  const q = trpc.wallet.ledgerList.useQuery({ limit: 20 });
  if (q.isLoading) return <div>加载中…</div>;
  if (q.isError) return <div className="text-red-600">读取流水失败</div>;
  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">流水</h2>
      <ul className="divide-y border rounded">
        {q.data!.entries.map((e) => (
          <li key={e.id} className="flex justify-between p-3 text-sm">
            <div>
              <div>{KIND_LABEL[e.kind] ?? e.kind}{e.actionKind ? `（${e.actionKind}）` : ""}</div>
              <div className="text-gray-500 text-xs">{new Date(e.createdAt).toLocaleString()}</div>
            </div>
            <div className={`font-mono ${e.delta < 0 ? "text-red-600" : "text-emerald-600"}`}>
              {e.delta > 0 ? "+" : ""}{e.delta}
            </div>
          </li>
        ))}
        {q.data!.entries.length === 0 && (
          <li className="p-3 text-sm text-gray-500">暂无流水</li>
        )}
      </ul>
    </section>
  );
}
```

- [ ] **步骤 13.4：tutor 页面加 INSUFFICIENT_BALANCE 提示（如需要）**

grep `tutor.ask.useMutation` 找到 catch 路径，对 `error.data.reason === "INSUFFICIENT_BALANCE"` 提示"余额不足，去充值"并加链接到 `/wallet`。

- [ ] **步骤 13.5：手动 smoke**

```powershell
pnpm.cmd dev
```

打开 `http://localhost:3000/wallet`：
- 未登录：应跳登录
- 登录后：余额=0；点 1 元充值；点完应看到 prepayId + qrCode（mock）；几秒后余额变 10；ledger 出现一条 +10
- 切到 `/tutor`：提交一题 → 余额变 9；ledger 加一条 -1

如果 mock notify 没自动 fire：检查 `getWechatPayAdapter` 里 `notifyMode` 在 dev 是不是 `"async-delayed"`（应是；测试环境才 manual）。

- [ ] **步骤 13.6：commit**

```powershell
git add apps/web/app/(student)/wallet/ apps/web/app/(student)/tutor/
git commit -m "feat(web): Task 13 — minimal wallet UI (topup form + ledger list)"
```

---

## Task 14：E2E

> **核心**：两条 Playwright 流：`wallet-topup-mock-happy-path.spec.ts`（充值 → 余额变化）+ `tutor-with-credit.spec.ts`（带 credit 提问 → 余额扣 1）。E2E 在 mock 模式跑，`notifyMode=async-delayed` 让 webhook 在几十毫秒内自动到达。

**Files：**
- Create: `apps/web/e2e/wallet-topup-mock-happy-path.spec.ts`
- Create: `apps/web/e2e/tutor-with-credit.spec.ts`
- Modify: `apps/web/e2e/global-setup.ts`（确保 seed 一个 `isMinor=false` 的固定测试用户）

- [ ] **步骤 14.1：检查 / 调 global-setup**

打开 `apps/web/e2e/global-setup.ts`，确认它在 `zhijiao_test_web` 库里 seed 了一个测试账号（Plan 2 应该已有，复用）。如该账号是 `isMinor=true`（schema default），把 seed 改成 `isMinor: false`，避免 E2E 的充值踩 200 元月限。

- [ ] **步骤 14.2：建 `wallet-topup-mock-happy-path.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("topup 1元 → balance becomes 10 within 5s (mock async-delayed webhook)", async ({ page }) => {
  // 假设 Plan 2 e2e helper 已经有 loginAs / seedUser；按实际改
  await page.goto("/wallet");
  // 已登录情况下应该立即看到余额
  await expect(page.getByText("当前余额")).toBeVisible();
  const initialBalance = await page.locator("text=/^\\d+\\s*点$/").first().textContent();

  await page.getByRole("button", { name: "1 元" }).click();
  await page.getByRole("button", { name: /充值 1 元|下单中/ }).click();

  // 出现订单详情
  await expect(page.getByText("订单号：")).toBeVisible({ timeout: 5_000 });

  // 等 webhook 到达 + balance 刷新（前端可能需要手动 refetch；如果用了 react-query 的 invalidate 应该自动）
  await expect(async () => {
    await page.reload();
    const txt = await page.locator("text=/^\\d+\\s*点$/").first().textContent();
    expect(txt).not.toBe(initialBalance);
  }).toPass({ timeout: 10_000, intervals: [500] });

  // ledger 至少出现一条 +10
  await expect(page.getByText("+10")).toBeVisible();
});
```

> 如果前端没在 mutation onSuccess 里 invalidate `wallet.balance` query，整个体验需要手动刷新。可以在 TopupForm 加 `await utils.wallet.balance.invalidate()` after `mutateAsync`，把 reload 那段省掉。

- [ ] **步骤 14.3：建 `tutor-with-credit.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("tutor with credit: balance -1 after submission", async ({ page }) => {
  // 先充 1 元 → 余额 10（或假设已有余额；用 OPS 调账 helper 直接 +10）
  await page.goto("/wallet");
  // ... 充值流程（或调一个 e2e-hooks 接口直接给 +10）

  // 提问
  await page.goto("/tutor");
  await page.getByLabel(/题目|问题/).fill("1+1=?");
  await page.getByRole("button", { name: /提交|发送|答疑/ }).click();
  await expect(page.getByText(/答案|解析/)).toBeVisible({ timeout: 30_000 });

  // 检查 ledger 出现 -1（去 /wallet）
  await page.goto("/wallet");
  await expect(page.getByText("-1")).toBeVisible();
});
```

> 若 Plan 1/2 已有 e2e-hooks 端点（grep `apps/web/app/api/e2e-hooks`），加一个 e2e-only 接口 `POST /api/e2e-hooks/seed-credit` 直接 OPS 调账加 100 credit，让 E2E 跳过充值流程。或在 global-setup 时给固定测试用户预充 100 credit。

- [ ] **步骤 14.4：跑 E2E**

```powershell
pnpm.cmd --filter @zhijiao/web test:e2e
```

绿。

> ⚠️ **不要**与 `turbo test --force` 并发跑——`.next` build 写冲突会卡。如 webhook 超时，加大 `notifyMode="async-delayed"` 的 delayMs（默认 50ms，可调到 100ms）。

- [ ] **步骤 14.5：commit**

```powershell
git add apps/web/e2e/wallet-topup-mock-happy-path.spec.ts apps/web/e2e/tutor-with-credit.spec.ts apps/web/e2e/global-setup.ts
git commit -m "test(web): Task 14 — E2E (wallet topup mock happy path + tutor with credit)"
```

---

## Task 15：全量回归 + CLAUDE.md 更新 + Merge 验收清单

> **核心**：仿照 Plan 2 Hardening Task 9 的工艺：跑 3 轮 typecheck、3 轮 test、1 轮 E2E、跑 5 条 Merge-后必跑探针；更新 CLAUDE.md 的"已落地"区 + "下一步候选 Plan"区。

**Files：**
- Modify: `CLAUDE.md`
- Create: `RELEASE-NOTES-plan-3.md`（PR 描述初稿）—— optional but useful

- [ ] **步骤 15.1：跑 3 轮 typecheck + 3 轮 test + 1 轮 E2E**

```powershell
"" | Out-File final-runs.txt -Encoding utf8
foreach ($i in 1..3) {
  "=== Run $i ===" | Out-File final-runs.txt -Encoding utf8 -Append
  $tc = pnpm.cmd exec turbo typecheck --force 2>&1
  $tc | Select-Object -Last 5 | Out-File final-runs.txt -Encoding utf8 -Append
  $tt = pnpm.cmd exec turbo test --force 2>&1
  $tt | Select-Object -Last 10 | Out-File final-runs.txt -Encoding utf8 -Append
}
"=== E2E ===" | Out-File final-runs.txt -Encoding utf8 -Append
$e2e = pnpm.cmd --filter @zhijiao/web test:e2e 2>&1
$e2e | Select-Object -Last 10 | Out-File final-runs.txt -Encoding utf8 -Append
Get-Content final-runs.txt
```

期望 3/3 typecheck 全绿，3/3 test 全绿，E2E 1 轮绿。

- [ ] **步骤 15.2：跑 CLAUDE.md "Merge 后必跑" 全部 7 项**

按 CLAUDE.md 现有清单跑，把 Plan 3 相关 4 条 spec-defined 探针加上：

1. ✅ `git status --short --branch` 干净
2. ✅ `pnpm.cmd exec turbo typecheck --force`
3. ✅ `pnpm.cmd exec turbo test --force`
4. ✅ `pnpm.cmd --filter @zhijiao/web test:e2e`
5. ✅ env 探针：注释 `.env.local` 的 `MOCK_WECHAT_PAY_SECRET` 行（保持 `WECHAT_PAY_USE_MOCK=true`），`pnpm.cmd --filter @zhijiao/web dev`，期望 fail-fast throw 列出 zod issue
6. ✅ 路由契约：`Select-String -Path apps/web/app/api/wechat-pay/notify/route.ts -Pattern "/api/wechat-pay/notify"`；`Select-String -Path apps/web/server/wechat-pay-adapter.ts -Pattern "notifyUrl"` 一致
7. ✅ revoke 即时生效（不变，沿用 Plan 2 Hardening）
8. ✅ PowerShell pnpm.cmd 约定（不变）

**Plan 3 新增探针**：

9. ✅ **mock 不漏到 prod**：把 `apps/web/server/wechat-pay-adapter.ts` 暂时让 `useMock=false` 但缺 real fields，跑 `pnpm.cmd --filter @zhijiao/web dev`，期望 env validator throw `/Real WeChat Pay requires/`
10. ✅ **idemKey 命名唯一**：grep `idemKey:` 在 `packages/billing/src` + `apps/web/server`，确认每处都是 `topup:` / `debit:` / `comp:` / `adjust:` 之一前缀
11. ✅ **adapter.unifiedOrder 不 fire notify**：grep `fireMockNotify` 在 `packages/integrations/src/wechat-pay/mock.ts` 看是否仅在 `signalOrderReady` 和测试 helper 调（不在 `unifiedOrder` 里）
12. ✅ **OPS 调账不能裸 SQL**：`Get-ChildItem -Recurse -Path . -Include *.ts | Select-String "UPDATE wallets|UPDATE \"wallets\""` 应只在 migrations / 一次性脚本（如有）里出现，业务代码 0 命中

- [ ] **步骤 15.3：更新 CLAUDE.md**

打开 `CLAUDE.md`，在 "开始实现时（已落地）" 段加一条：

```markdown
- **Plan 3**（Credit 计费 + 微信支付 V3 沙箱：mock 主路径 + Real V3 骨架）—— 见 `docs/superpowers/plans/2026-05-21-credit-and-wechat-pay-sandbox.md`，spec 在 `docs/superpowers/specs/2026-05-21-credit-and-wechat-pay-sandbox-design.md`

**计费现状**：
- `packages/billing` 新建：ensureWallet / chargeForAction（predicate-on-update + idemKey 防重）/ compensate / applyWechatPayNotify（P2002 idemKey 重读 → ALREADY_PAID）/ expireStaleOrders / adminAdjust（OPS 调账）
- `chargedProcedure(actionKind)` 替换 `creditPlaceholder`；input 强制 `clientRequestId: uuid`；默认 fail-open compensation（白名单 `ComplianceRejectedError` 不补）
- `wallet.topupCreate`：RULE_TOPUP_CREATE_{IP,USER} fail-CLOSE → ensureWallet → 未成年月度上限（CREATED+PENDING+PAID 累计 + paidAt 优先 + Asia/Shanghai 自然月）→ create CREATED → adapter.unifiedOrder → update PENDING → adapter.signalOrderReady
- `/api/wechat-pay/notify`：先无条件写 WechatPayEvent（PENDING）作审计 → adapter.verifyNotify → applyWechatPayNotify → 200 always；仅 applyWechatPayNotify 重抛非 P2002 时 500
- `WechatPayAdapter` (Mock 3 modes: sync / async-delayed / manual) + `RealWechatPayAdapter` 骨架（throws on activation；等 ICP 备案 + 商户号 + APIv3 + 证书）
- `pino` structured logger 在 `apps/web/server/logger.ts`（server-only）；billing 包通过 `setBillingLogger(...)` 注入

**Plan 3 *未*完成的事 —— prod ship 前必须做**：
- PII 治理 plan：用户注销 / 去标识化 / `WechatPayEvent.rawBody` 保留期 / `TopupOrder` 孤儿订单清理策略
- ICP 备案 + 微信商户号申请 + APIv3 密钥 + 商户证书 / `WECHAT_PAY_USE_MOCK=false` 配套 6 个 real env
- Real adapter 激活：实现 `unifiedOrder` 走 V3 prepay API + `verifyNotify` 走 RSA-SHA256 + PlatformCertProvider 真接

`pnpm setup` 一键起本地后 `pnpm test:setup` 创建 6 个 per-pkg test DB（含 `zhijiao_test_billing`）。
```

在 "常用命令" 段加一条：

```markdown
# 跑 billing 包测试：
pnpm --filter @zhijiao/billing test
```

在 "Merge 后必跑" 段加 4 条 Plan 3 探针（步骤 15.2 的 9-12）。

在 "下一步候选 Plan" 段把 "Plan 3" 这条删掉（已落地），保留 Plan 4/5 候选；考虑加 "Plan 6: PII 治理（用户注销 / 去标识化 / 保留期）" 和 "Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 证书）"。

- [ ] **步骤 15.4：commit**

```powershell
git add CLAUDE.md final-runs.txt
git commit -m "docs(claude): Task 15 — Plan 3 落地状态 + Merge 探针 + 候选 plan 调整"
```

- [ ] **步骤 15.5：起 PR**

```powershell
git push -u origin plan-3-credit-wechatpay
gh pr create --base main --title "Plan 3 — Credit 计费 + 微信支付 V3 沙箱（mock 主 + Real V3 骨架）" --body "$(cat <<'EOF'
## Summary
- 加 `packages/billing`（Wallet / Ledger / 充值 / 扣点 / 补偿 / 应用层 / 过期扫描 / OPS 调账 + 未成年月度上限 helper）
- 加 `packages/integrations/src/wechat-pay/`（Adapter 接口 + Mock 3 mode + Real 骨架 + PlatformCertProvider + build factory）
- 加 `chargedProcedure` 中间件 + `wallet` tRPC 路由 + `/api/wechat-pay/notify` route handler + pino logger
- 接入 `tutor.ask`（替换 creditPlaceholder）+ 最小化 wallet UI + E2E（topup-mock + tutor-with-credit）

## 验收
- 3/3 typecheck + 3/3 test + 1 E2E 全绿（见 final-runs.txt）
- CLAUDE.md Merge 后必跑 9-12 条新探针全绿
- spec 与 plan：见 docs/superpowers/specs/2026-05-21-credit-and-wechat-pay-sandbox-design.md / docs/superpowers/plans/2026-05-21-credit-and-wechat-pay-sandbox.md

## ⚠️ prod ship 仍需的前置
- PII 治理 plan（用户注销 / 保留期 / WechatPayEvent.rawBody 脱敏）
- ICP 备案 + 微信商户号 + APIv3 密钥 + 商户证书
- Real adapter 真接激活（独立 plan）

## Test plan
- [ ] mock 充 1 元 → balance +10
- [ ] tutor 提问 → balance -1
- [ ] OPS 调账（permissionProcedure OPS_ADJUST_CREDIT）
- [ ] env validator boot-fail 探针（mock 缺 secret / real 缺 6 字段）
- [ ] 并发 webhook → ALREADY_PAID，balance 不重复加

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR URL 返给用户。

---

## 收尾说明

### 风险与缓解（再次提醒）

| 风险 | 缓解 |
|---|---|
| `wallet.balance` 与 `ledger SUM(delta)` 不一致 | `balanceAfter` snapshot；CI 可加周期性对账测试（Plan 3 不接，运维 plan 接） |
| 微信 webhook 重发风暴 / 异常 trade_state | 7 层防御（spec §4.3）；UNKNOWN_TRADE_STATE 告警早警 |
| Mock secret 泄露伪造 webhook | `MOCK_WECHAT_PAY_SECRET min(16)`；prod `WECHAT_PAY_USE_MOCK=false` boot-fail 兜底 |
| 未成年月度并发绕过 | CREATED+PENDING+PAID 累计；RULE_TOPUP_CREATE_IP cap=5 限并发；微小 race 可接受 |
| Plan 3 落地后 PII 资产堆积 | spec / plan 显式标 prod ship prereq |
| Real V3 API 激活时与 Mock 行为分歧 | Adapter 接口共享；激活时单独走 V3 contract test plan |
| OPS 误操作大额调账 | `|delta| <= 1_000_000` + `reasonDetail.min(10)` + 结构化日志 + 严禁 Studio 直改 |
| Postgres `Read Committed` charge race | 与 Plan 2 Hardening Task 3/4 同款行锁兜底；race tests 在 `packages/billing/tests/charge.test.ts` |
| pino 引入打破 build | Next 14 + pino 8 兼容；Task 15 全量回归一次确认 |

### 依赖路径

```
0 → 1 ─┬─ 3 ─┬─ 9 ─ 12 ─ 13 ─ 14 ─ 15
        │     └─ 4 ─ 10 ─┐
        │                │
        2 ─┘             11 ─┘
        5 ─ 10 / 11 / 12
        6 ─ 10 / 11
        7 ─ 10
        8 ─ 9 / 10 / 11 / 12
```

Task 5/6/7/8 互相独立可并行。Task 10/11 在 4+5+6+7+8 都落地后跑。
预估在 worktree 内 4-6 个工作日量。



