# 智教 · Plan 2 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 Plan 2 merge 后留下的 3 Critical + 4 Important + 一组覆盖/契约缺口，把"测试全绿"和"系统就绪"之间的鸿沟填上，再放行 Plan 3/4；Plan 5 阻塞到本 plan 完成。

**Architecture:** 全部应用层 + env 校验 + DB `Session.revokedAt` 真理查询（复用既有列）；零新表、零迁移、零新 Redis key 协议。所有改动都贴在 §0 的范围内。

**Tech Stack:**（不变）pnpm 9 / Turborepo / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 / Redis 7 / jose 5 / @trpc/server@11 / superjson / ioredis 5 / Vitest 1 / Testcontainers 10 / Playwright 1

**Spec:** `docs/superpowers/specs/2026-05-20-plan2-hardening-design.md`（本 plan 的真理来源；遇到模糊回去查 spec）

**Source Audit:** 2026-05-20 三只读 subagent + 主线 spot-check（见 spec §1.1）

---

## ⚠️ 关键实现红线

1. **env 校验在 import time 报错**：`apps/web/server/env.ts` 在第一次被 import 时就跑 zod schema，缺/弱 env 直接 throw。**所有** `process.env.ACCESS_JWT_SECRET ?? ""` / `process.env.OTP_PEPPER ?? ""` 必须替换为 `env.ACCESS_JWT_SECRET` / `env.OTP_PEPPER`，零 fallback。
2. **Mock 只能由 `*_USE_MOCK==="true"` 触发**，绝不能因为 "key 缺失" 自动退化到 mock。生产 env 漏配 = boot fail = 立刻可见。
3. **predicate-on-update 是原子化的唯一手段**：`rotateSession` / `verifyOtp` 必须先 `updateMany(predicate)` 抢占，再决定下一步分支；不要先 `findUnique` 再单独写。
4. **session-revoke 是 DB 真理**：Plan 2 已经在 revoke 路径写 `Session.revokedAt`；本 plan 在 context 每次 authed 请求查 `prisma.session.findUnique({where:{id:sessionId}, select:{revokedAt, expiresAt}})`。**不引入 Redis 缓存层**（2026-05-20 review 决定；缓存的 fail-mode 与"revoke 即时生效"语义冲突）。
5. **bind callback 必须再校验 access JWT**：state.userId 不再被信任为身份；identity_mismatch / identity_required 两条分支都只清 `COOKIE_WX_STATE`，不动 access / refresh cookies。
6. **race tests 必须真去 DB 断言副作用次数**，不要只断言 `toHaveBeenCalledTimes`。`Promise.all` 的两条调用都过了不算，副作用次数才是真理。
7. **测试新增请在已有 vitest config 的范围内**（不要新建 testcontainers 容器，复用 `packages/db/src/test-utils.ts`）。
8. **本 plan 不动 schema.prisma**（零新表、零迁移）。如果你以为需要加列，回 spec §4 看为什么不需要。
9. **不要在本 plan 修 turbo flake / e2e vs build 写冲突**（spec 附录 A）。两条进 CLAUDE.md Merge 清单告诫；具体修留独立 plan。
10. **每个 task 一个 commit**，commit message 引用 task 编号。

---

## 范围

**本 plan 做**（对应 spec §1.1 全条 + §3 全节）：
- env validator 上线（C1+C2）
- WeChat callback path 对账（C3）
- refresh 轮换原子化 + race test（I1）
- OTP 校验原子化 + race test + 边界 test（I2）
- session-revoke 即时生效（I3）
- bind callback access JWT 校验（I4）
- register / refresh 限频接入（G1）
- middleware guard / bind / OTP 边界测试（G2-G4）
- `.gitignore` 加 `.claude/worktrees/`、`.claire/` 并清残留（H1）
- CLAUDE.md Merge 验收清单 + 本 plan 状态更新

**本 plan 不做**（见 spec §6）：
- Credit / 举一反三 / 真接 SMS / 真接微信公众号 / 账户合并 / 设备管理 / apps/admin / CSRF token
- turbo 并发 test flake、e2e vs build 写 `.next` 冲突（次级稳定性，独立 plan）

---

## 文件结构（新建 / 修改清单）

```
.gitignore                                                  # 改
CLAUDE.md                                                   # 改：Merge 清单 + 状态

apps/web/
  server/env.ts                                             # 新
  server/auth-service.ts                                    # 改：env
  server/context.ts                                         # 改：env + DB session 查询 + SESSION_REVOKED
  server/routers/auth.ts                                    # 改：register 接 RULE_REGISTER_IP；env
  app/api/auth/refresh/route.ts                             # 改：env + 接 RULE_REFRESH (key=IP)
  app/(auth)/wechat/start/route.ts                          # 改：env
  app/(auth)/wechat/callback/route.ts                       # 改：bind 分支重校验 access JWT
  lib/ai-client.ts                                          # 改：消除"!DASHSCOPE_API_KEY 自动 mock"反模式
  tests/setup.ts                                            # 改：补齐 env validator 需要的 secret/pepper/mock flags
  e2e/global-setup.ts                                       # 改：OTP_PEPPER 长度 ≥ 16
  tests/integration/env-validation.test.ts                  # 新
  tests/integration/session-revoke-immediate.test.ts        # 新
  tests/integration/auth-wechat-bind.test.ts                # 新
  tests/integration/auth-register-ratelimit.test.ts         # 新
  tests/integration/auth-refresh-ratelimit.test.ts          # 新
  tests/integration/middleware-guard.test.ts                # 新
  tests/unit/ai-client.test.ts                              # 新（如不存在）

packages/auth/
  src/session.ts                                            # 改：rotateSession 原子化（无 Redis 改动）
  src/otp.ts                                                # 改：verifyOtp 原子化
  tests/session-race.test.ts                                # 新
  tests/otp-race.test.ts                                    # 新
  tests/otp-boundary.test.ts                                # 新

packages/integrations/
  src/wechat/h5-oauth/build.ts                              # 改：消除静默 mock + callback path /wechat/callback
  src/sms/build.ts                                          # 改（如存在）：消除静默 mock
  tests/wechat-build.test.ts                                # 新
```

---

## 前置：环境检查 + 分支

> **Shell 约定**：本 plan 所有命令默认 **PowerShell**（项目 CLAUDE.md / 环境实测）。本机 execution policy 拦 `.ps1`，PowerShell 里直接 `pnpm` 会被解析到 `pnpm.ps1` 报 "running scripts is disabled"。所以 **全文一律用 `pnpm.cmd`**（npm 装出的 `.cmd` shim，PowerShell 和 git-bash 都能跑）。如果你换 shell（比如 WSL）请按你自己的 shim 来。

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
git worktree add .claude/worktrees/plan-2-hardening -b plan-2-hardening master
```

新窗口 `Set-Location .claude/worktrees/plan-2-hardening`，后续命令都在 worktree 里跑。

- [ ] **步骤 P.2：起 docker、装依赖**

```powershell
docker compose up -d
pnpm.cmd install
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd --filter @zhijiao/db db:migrate:deploy
pnpm.cmd db:seed

# test 库（E2E 与 web integration 用）：要在子进程的 env 里设 DATABASE_URL，PowerShell 不能用 bash 那种 inline 前缀
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test'
pnpm.cmd --filter @zhijiao/db db:migrate:deploy
pnpm.cmd db:seed
Remove-Item Env:\DATABASE_URL
```

> **PowerShell 调 pnpm 必须用 `pnpm.cmd`**：本机 execution policy 默认拦 `.ps1`，直接 `pnpm` 会解析到 `pnpm.ps1` 报 "running scripts is disabled"。`pnpm.cmd` 是 npm 装出的 `.cmd` shim，PowerShell 可以无障碍调。

- [ ] **步骤 P.3：baseline 复现 flake（必做，连跑 3 次）**

```powershell
# 跑 3 轮 typecheck + test，把每轮结果汇总到 baseline-runs.txt
"" | Out-File baseline-runs.txt -Encoding utf8
foreach ($i in 1..3) {
  "=== Run $i ===" | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tc = pnpm.cmd exec turbo typecheck --force 2>&1
  $tc | Select-Object -Last 5  | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tt = pnpm.cmd exec turbo test --force 2>&1
  $tt | Select-Object -Last 10 | Out-File baseline-runs.txt -Encoding utf8 -Append
}

# E2E 单独跑（不要与 typecheck/test 并发——会写 .next 冲突，详见 spec 附录 A）
"=== E2E ===" | Out-File baseline-runs.txt -Encoding utf8 -Append
$e2e = pnpm.cmd --filter @zhijiao/web test:e2e 2>&1
$e2e | Select-Object -Last 10 | Out-File baseline-runs.txt -Encoding utf8 -Append

Get-Content baseline-runs.txt
```

> 如果你更顺手在 Git Bash 里跑这一步，对应 bash 版本是 `for i in 1 2 3; do ... done | tee baseline-runs.txt`——但项目主线 shell 是 PowerShell，文档以 PowerShell 为准，bash 版本仅作参考。

- [ ] **步骤 P.4：依据 baseline 结果决策**

**2026-05-20 实测 baseline**（在 `.claude/worktrees/plan-2-hardening` 内跑）：

| 阶段 | 结果 |
|---|---|
| typecheck 3/3 轮 | 全绿，6/6 packages |
| test 3/3 轮 | **稳定挂** `@zhijiao/ai > tests/router.test.ts > happy path` —— `P2003 Foreign key constraint violated: model_calls_prompt_template_id_fkey` at `packages/ai/src/audit.ts:17`。单跑 `pnpm.cmd --filter @zhijiao/ai test` 13/13 全绿；只在 turbo 全图并发时挂。**机制**：所有 package 共用 `zhijiao_test` 一个库，ai 的 `ensurePromptInDb` 创建 PromptTemplate 行后，`writeAudit` 写 ModelCall 之前被另一进程（packages/db/src/test-utils.ts 的 `resetDb()`）TRUNCATE CASCADE 掉，FK 引用即时失效。spec 附录 A 原标的 `router.test.ts:132` 位置不准——实际稳定点是 happy path 第 23 行 |
| E2E 1 轮 | `globalSetup: server didn't start within 60s` —— `next build` 通过，playwright global-setup spawn dev server 60s 内没起来 |

**走向**（依 P.4 决策表 "3/3 全挂 / 同一处稳定失败 → 停"）：

| 现象 | 处理 |
|---|---|
| 3/3 全绿 | 在 PR 描述里记录"baseline 3 轮全绿"，继续 |
| 1-2/3 flake，单包重跑可恢复 | 在 PR 描述里贴 baseline-runs.txt 的失败现场；**继续**，但 Task 9 验收必须连跑 3 次都绿；如果新增 race tests 让 flake 变密，必须暂停 |
| 3/3 全挂 / 同一处稳定失败 | **停**，不进 Task 0；将 fix 拉进本 plan 作为 Task -1（baseline blocker）；本 plan 顺序前移 Task -1 → Task -1B → Task 0 → … |

**本次 baseline 落到第 3 行 → 触发 Task -1 + Task -1B**（见下）。Task 0+ 在 Task -1/-1B 全绿后才能开始。

> 不允许：跳过这一步、或在 baseline 不绿的情况下继续推进。"测试全绿"和"系统就绪"已经被 review 区分清楚——baseline 是后续每个 task 测试结果的参照系。

---

## Task -1：跨 package 测试 DB 隔离（baseline blocker）

> **为什么先做**：2026-05-20 baseline 3 轮 `pnpm.cmd exec turbo test --force` 全在 `@zhijiao/ai > router.test.ts > happy path` 同一处挂，错误 `P2003 model_calls_prompt_template_id_fkey`。机制：所有 package 共用 `zhijiao_test` 一个 Postgres database，每包各自的 `beforeEach(resetDb)` 互踩——ai 测试在 `ensurePromptInDb` 建的 PromptTemplate 行，在 `writeAudit` 之前被另一进程（`packages/db/src/test-utils.ts` 里的 `resetDb()`，TRUNCATE 全表 CASCADE）擦掉，FK 即时失效。
>
> **明确不做的事**：
> - **不**加 `turbo --concurrency=1`（race 本身没修，未来 race tests 直接被串行掩盖）
> - **不**引入跨进程 advisory lock（复杂度高、绕弯）
> - **不**改 `beforeEach`（数据库层切干净更彻底）

**Files：**
- Modify: `packages/ai/vitest.config.ts` — env DATABASE_URL 指 `zhijiao_test_ai`
- Modify: `packages/auth/vitest.config.ts` — 指 `zhijiao_test_auth`
- Modify: `packages/db/vitest.config.ts` — 指 `zhijiao_test_db`
- Modify: `packages/integrations/vitest.config.ts` — 指 `zhijiao_test_integrations`
- Modify: `apps/web/vitest.config.ts` — 指 `zhijiao_test_web`
- Modify: `packages/db/src/test-utils.ts` — 删硬编码默认，fail-close（无 `DATABASE_URL` → throw）
- Modify: `packages/ai/tests/router.test.ts` — `TEST_DB_URL` 同样 fail-close（不再 `??` 兜默认）
- Create: `packages/db/scripts/setup-test-dbs.ts` — 一次性创建 5 个库 + 跑 migrate（幂等）
- Modify: 根 `package.json` — 加 `test:setup` 脚本
- Modify: `apps/web/e2e/global-setup.ts` — spawn child env 里写 `DATABASE_URL=zhijiao_test_web`
- Modify: `apps/web/tests/setup.ts` — 删硬编码默认，依赖 vitest config 注入
- Modify: `CLAUDE.md` — 加一句多 test DB 约定

- [ ] **步骤 -1.1：DB 命名表**

| package | test DB |
|---|---|
| `packages/ai` | `zhijiao_test_ai` |
| `packages/auth` | `zhijiao_test_auth` |
| `packages/db` | `zhijiao_test_db` |
| `packages/integrations` | `zhijiao_test_integrations` |
| `apps/web`（unit + integration + E2E） | `zhijiao_test_web` |

`apps/web` 的 unit / integration 和 E2E **共用一个** test DB：两者不会并发跑（E2E 与 `turbo test --force` 已被 .next 写冲突约束分开，见 spec 附录 A）。

- [ ] **步骤 -1.2：`packages/db/scripts/setup-test-dbs.ts`**

```ts
import { execSync } from "node:child_process";

const HOST = process.env.PGHOST ?? "127.0.0.1";
const PORT = process.env.PGPORT ?? "5432";
const USER = process.env.PGUSER ?? "postgres";
const PWD  = process.env.PGPASSWORD ?? "postgres";

const ROOT = `postgresql://${USER}:${PWD}@${HOST}:${PORT}/postgres`;

const dbs = [
  "zhijiao_test_ai",
  "zhijiao_test_auth",
  "zhijiao_test_db",
  "zhijiao_test_integrations",
  "zhijiao_test_web",
];

function ensureDb(name: string) {
  const sql = `CREATE DATABASE "${name}";`;
  try {
    execSync(`psql "${ROOT}" -v ON_ERROR_STOP=1 -c "${sql}"`, { stdio: "pipe" });
    console.log(`[setup-test-dbs] created ${name}`);
  } catch (e) {
    const msg = String((e as any)?.stderr ?? e);
    if (!msg.includes("already exists")) throw e;
    console.log(`[setup-test-dbs] ${name} already exists`);
  }
}

function migrate(name: string) {
  const url = `postgresql://${USER}:${PWD}@${HOST}:${PORT}/${name}`;
  execSync(`pnpm.cmd --filter @zhijiao/db db:migrate:deploy`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}

for (const db of dbs) {
  ensureDb(db);
  migrate(db);
}
console.log("[setup-test-dbs] all 5 test DBs ready");
```

> 为什么走 `psql` 不走 Prisma：Prisma 没有 `CREATE DATABASE` 能力，必须走 root postgres user。Windows 上 psql 通常在 docker 容器内，所以备用方案是 `docker exec -i zhijiao-postgres psql -U postgres -c "..."` —— 见步骤 -1.8 兜底。

- [ ] **步骤 -1.3：每个 package 的 `vitest.config.ts`**

Pattern（以 ai 为例，其它包同构）：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_ai",
    },
  },
});
```

把现有 `process.env.DATABASE_URL_TEST ?? "..."` 那段直接换。**vitest 的 `test.env` 是写到 child fork 的 `process.env`**，子进程内 prisma client 拿到的就是这个 URL。

> 反对的写法：不要再保留 `??` 后备值——一旦默认值仍然指向 `zhijiao_test`（旧库），命名错的库会"看起来跑通"但实际穿到错库。

- [ ] **步骤 -1.4：`packages/db/src/test-utils.ts` fail-close**

```ts
const TEST_DATABASE_URL = process.env.DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error(
    "test-utils.ts: DATABASE_URL must be set by vitest config (per-package test DB). " +
    "Did you forget vitest.config.ts `test.env.DATABASE_URL`?"
  );
}
export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});
```

- [ ] **步骤 -1.5：`packages/ai/tests/router.test.ts` 同样移除硬编码**

```ts
const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) throw new Error("router.test.ts: DATABASE_URL must come from vitest config env");
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
```

并 grep 一遍 `packages/*/tests/`、`apps/web/tests/` 里所有硬编码字串 `zhijiao_test` —— 全部去掉 `??` 默认，统一 fail-close。

- [ ] **步骤 -1.6：`apps/web/e2e/global-setup.ts`**

spawn child 的 env 里：

```ts
DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_web",
```

注意不要从 `process.env.DATABASE_URL` 透传（global-setup 自身没有 vitest-style env 注入；spawn child 的 env 是 explicit object）。

- [ ] **步骤 -1.7：根 `package.json` 加 `test:setup`**

```json
"scripts": {
  "test:setup": "tsx packages/db/scripts/setup-test-dbs.ts"
}
```

如果根 `package.json` 有 `setup` 脚本，把 `test:setup` 串进去 `pnpm setup && pnpm test:setup`。

- [ ] **步骤 -1.8：跑 setup**

```powershell
pnpm.cmd test:setup
```

期望：5 个库全部 `created` 或 `already exists`，每个跑 `No pending migrations to apply.`。

> psql 不可用兜底：把 `setup-test-dbs.ts` 改为走 `docker exec -i zhijiao-postgres psql -U postgres -c "..."`。dev 环境必装 docker，这条路稳。

- [ ] **步骤 -1.9：seed 不动**

`db:seed` 现在面向主 `zhijiao` 库（dev server 用）。test DB 的 fixtures 都由各 test 文件按需 `prisma.x.create` 自填。本步骤不动 seed。

- [ ] **步骤 -1.10：3 轮 baseline 复跑**

```powershell
"" | Out-File baseline-runs.txt -Encoding utf8 -Force
foreach ($i in 1..3) {
  "=== Run $i (post Task -1) ===" | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tc = pnpm.cmd exec turbo typecheck --force 2>&1
  $tc | Select-Object -Last 5  | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tt = pnpm.cmd exec turbo test --force 2>&1
  $tt | Select-Object -Last 10 | Out-File baseline-runs.txt -Encoding utf8 -Append
}
Get-Content baseline-runs.txt
```

DoD：3 轮全绿。仍挂 → 重新诊断（**不允许**绕 race 测试或 concurrency=1）。

- [ ] **步骤 -1.11：commit**

```powershell
git add packages/ai/vitest.config.ts packages/auth/vitest.config.ts packages/db/vitest.config.ts packages/db/src/test-utils.ts packages/db/scripts/ packages/integrations/vitest.config.ts apps/web/vitest.config.ts apps/web/e2e/global-setup.ts apps/web/tests/setup.ts package.json packages/ai/tests/router.test.ts CLAUDE.md
git commit -m "test(infra): isolate per-package test DBs (zhijiao_test_<pkg>); fix Plan 2 Hardening baseline blocker (router.test.ts P2003 race)"
```

**Task -1 DoD：**
- `pnpm.cmd test:setup` 幂等成功
- 5 个 test DB 各跑 migrate 通过
- `pnpm.cmd exec turbo test --force` 3 轮全绿
- `pnpm.cmd --filter @zhijiao/ai test` / `--filter @zhijiao/auth test` / `--filter @zhijiao/integrations test` / `--filter @zhijiao/web test` 单跑全绿
- CLAUDE.md "常用命令" 段加一句 `pnpm.cmd test:setup`（首次跑测前必做）

---

## Task -1B：E2E global-setup 60s 起不来 server 根因（baseline blocker）

> **现状**：baseline E2E `next build && playwright test`，build 通过，进 playwright global-setup spawn dev server 60s 没起来；teardown `port-kill=[none]` 说明端口上没监听。
>
> **明确不做的事**：**禁止**改大 60s timeout；要求找出 server 为什么没起来。
>
> **scope 待定**：先手工 reproduce 拿证据再定 fix。本节先列诊断 + 候选根因表；具体步骤待 user 回报手工跑结果后补实。

- [ ] **步骤 -1B.1：手工 reproduce（user 跑或 user 授权 Claude 跑）**

```powershell
Set-Location D:\智教\.claude\worktrees\plan-2-hardening

# (1) 单跑 next build，看 .next 是否完整
pnpm.cmd --filter @zhijiao/web build 2>&1 | Tee-Object -FilePath e2e-diag-build.log

# (2) 单跑 next start（绕过 playwright global-setup），看 server 起不起来
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_web'
pnpm.cmd --filter @zhijiao/web start 2>&1 | Tee-Object -FilePath e2e-diag-start.log
# 同时另开 powershell：
#   Invoke-WebRequest http://127.0.0.1:3000/healthz -UseBasicParsing
# 看几秒内能不能拿到 200 / 看 e2e-diag-start.log 输出。
Remove-Item Env:\DATABASE_URL
```

把 `e2e-diag-build.log` 和 `e2e-diag-start.log` 头/末 50 行交给 review。

- [ ] **步骤 -1B.2：候选根因 → 实际看到的现象 → 修法**

| 假说 | 验证信号 | 修法 |
|---|---|---|
| H1: `next start` 因 env 缺失（`ACCESS_JWT_SECRET` / `OTP_PEPPER` 等）throw 退出 | start.log 看到 throw stack | Task 1 env validator 落地后 server 必然 fail-fast；本步骤先在 `apps/web/e2e/global-setup.ts` spawn child env 里把 ACCESS_JWT_SECRET / OTP_PEPPER fixture 值显式写齐——本质是把 Task 1 子集前移 |
| H2: pidfile 残留误判 | global-setup 在 spawn 之前没 `clearStaleState`；磁盘上有 `apps/web/.next/e2e.pid` | spawn 前先 `clearStaleState`；teardown 已有，启动入口也加 |
| H3: `next build` 是 standalone 但 `start` 没指 `server.js` | next.config.js `output: "standalone"` 但 `start` 跑 `next start`（找不到 .next 主入口） | 改 start 命令走 `node .next/standalone/server.js`；或撤掉 standalone |
| H4: Windows fork 下 child env 不完整 | start.log 完全空白 / 启动一半挂 | spawn 显式 inherit env，关 `windowsHide`，看子进程 PID 是否真的存活 |
| H5: 60s 真的不够（小概率） | start.log 显示在 60–90s 范围内才出 "ready" | **不修 timeout**，转而排查为何 ready 慢（如 next build cache miss 重编译） |

- [ ] **步骤 -1B.3：实施 fix（步骤待 user 观察后填实）**

- [ ] **步骤 -1B.4：验证**

```powershell
foreach ($i in 1..3) {
  "=== E2E Run $i ===" | Out-File e2e-runs.txt -Encoding utf8 -Append
  pnpm.cmd --filter @zhijiao/web test:e2e 2>&1 | Select-Object -Last 15 | Out-File e2e-runs.txt -Encoding utf8 -Append
}
Get-Content e2e-runs.txt
```

**Task -1B DoD：**
- 单跑 `pnpm.cmd --filter @zhijiao/web test:e2e` 3 轮全绿
- global-setup.ts 里 60s timeout **未改大**
- 修动到的根因点写一句进 CLAUDE.md（避免回归）

---

## Task 0：仓库卫生（H1）

> 先做 H1 让 `git status` 干净，后续每个 task commit 时不被噪音干扰。

**Files:**
- Modify: `.gitignore`
- Delete: `.claude/worktrees/plan-2-real-auth/`（如残留）

- [ ] **步骤 0.1：扩 `.gitignore`**

在文件末尾追加：

```
# Local tool worktree caches (Claude Code / Claire)
.claude/worktrees/
.claire/
```

> `.claude/settings.local.json` 已经被原来的 `.claude/settings.local.json` 单独 ignore；新加的 `.claude/worktrees/` 不影响那条。

- [ ] **步骤 0.2：清残留 worktree 目录（PowerShell；**主 repo 下操作，不是当前 worktree 内**）**

```powershell
# 先盘清楚 git 还认不认这个 worktree
git worktree list

# 如果列表里仍有 plan-2-real-auth → git 认它，用 git 的正式命令清（会同时清 metadata）：
git worktree remove .claude/worktrees/plan-2-real-auth
# 如果工作目录已被前一次 merge 物理删过、git 只剩 metadata → 让 git 自己 prune：
git worktree prune -v

# 如果 .claude/worktrees/plan-2-real-auth 仍以普通目录形式残留（git 已经不认了），且确认不是任何 worktree：
Get-ChildItem .claude/worktrees/  # 先看一眼
Remove-Item -Recurse -Force -LiteralPath .claude/worktrees/plan-2-real-auth  # 仅在确认不是当前 worktree、git worktree list 不再列它的前提下执行

Get-ChildItem .claire/  # 通常已空
```

> **绝对不要** `Remove-Item -Recurse -Force` 你当前所在的目录（你在 `.claude/worktrees/plan-2-hardening/` 里跑命令）。先 `Get-Location` 确认 cwd，再操作主 repo 路径——通常那是 `D:\智教\.claude\worktrees\plan-2-real-auth`。

- [ ] **步骤 0.3：验证**

```powershell
git status --short --branch
# 期望：只看到 M .gitignore，无 ?? 行
git worktree list
# 期望：只列出 master + plan-2-hardening；无 plan-2-real-auth
```

- [ ] **步骤 0.4：commit**

```powershell
git add .gitignore
git commit -m "chore(repo): ignore .claude/worktrees and .claire; clean post-merge leftovers (Task 0)"
```

---

## Task 1：env validator 上线（C1 + C2）

**Files:**
- Create: `apps/web/server/env.ts`
- Modify: `apps/web/server/auth-service.ts`
- Modify: `apps/web/server/context.ts`
- Modify: `apps/web/app/api/auth/refresh/route.ts`
- Modify: `apps/web/app/(auth)/wechat/start/route.ts`
- Modify: `apps/web/server/routers/auth.ts`
- Modify: `apps/web/.env.example`（如本地存在）/ 否则 `.env.example`

- [ ] **步骤 1.1：新建 `apps/web/server/env.ts`**

按 spec §3.1 完整内容写入。要点：
- `import "server-only"`
- zod schema 三个 `.refine`：AI / SMS / WeChat 的"mock 或真接二选一"
- `ACCESS_JWT_SECRET.min(32)`，`OTP_PEPPER.min(16)`
- `parsed.success === false` → console.error 每条 issue → throw

- [ ] **步骤 1.2：替换调用点**

逐个文件改：
- `apps/web/server/auth-service.ts:32` `process.env.ACCESS_JWT_SECRET ?? ""` → `env.ACCESS_JWT_SECRET`（顶部加 `import { env } from "./env.js"`）
- `apps/web/server/context.ts:40` 同上
- `apps/web/app/api/auth/refresh/route.ts:25` 同上（顶部加 `import { env } from "@/server/env"`）
- `apps/web/app/(auth)/wechat/start/route.ts:17` 同上
- `apps/web/server/routers/auth.ts` 中的 `process.env.OTP_PEPPER ?? ""`（grep 找）→ `env.OTP_PEPPER`

- [ ] **步骤 1.3：更新 `apps/web/tests/setup.ts`（关键：否则现有 web 测试全炸）**

```ts
// Vitest global setup — runs before any test module is evaluated.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@localhost:5432/zhijiao_test";

// env validator 在 import time 跑；测试必须把所有 required env 备齐
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.ACCESS_JWT_SECRET ??= "test-only-access-secret-at-least-32-bytes-long-padding";
process.env.OTP_PEPPER ??= "test-only-otp-pepper-16+chars";  // 16+ 字节
process.env.AI_USE_MOCK ??= "true";
process.env.SMS_USE_MOCK ??= "true";
process.env.WECHAT_OAUTH_USE_MOCK ??= "true";
process.env.E2E_TEST_HOOKS ??= "0";
```

- [ ] **步骤 1.4：更新 `apps/web/e2e/global-setup.ts`**

把 spawn child 的 env 块里的 `OTP_PEPPER: "e2e-pepper"`（10 字节，会被 `min(16)` 拒）改为：

```ts
OTP_PEPPER: "e2e-otp-pepper-min16",  // ≥ 16 字节
```

其它 env（ACCESS_JWT_SECRET 已经 37 字节、所有 USE_MOCK=true、REDIS_URL、WECHAT_H5_APPID）不需要动。

> 注意：global-setup spawn 的是 `next start`，是个独立进程；它继承父进程 env 但**手动**覆盖了一组 env。文件已经在 line 65-79 显式列出，缺啥往里加，别只改 `.env.local`。

- [ ] **步骤 1.5：更新 `.env.example`**

确认包含（如缺则补；存量不动）：
- `ACCESS_JWT_SECRET=dev-only-access-secret-please-replace-32+bytes-padding`（≥ 32）
- `OTP_PEPPER=dev-only-otp-pepper-16chars+`（≥ 16）
- `AI_USE_MOCK=true`（dev 默认）
- `SMS_USE_MOCK=true`
- `WECHAT_OAUTH_USE_MOCK=true`

- [ ] **步骤 1.6：写测试 `apps/web/tests/integration/env-validation.test.ts`**

每条 case 用 `vi.resetModules()` + `vi.stubEnv` 隔离：
- 缺 `ACCESS_JWT_SECRET` → `import("../../server/env")` reject
- `ACCESS_JWT_SECRET` 长度 31 → reject
- `OTP_PEPPER` 长度 15 → reject
- `WECHAT_OAUTH_USE_MOCK=false` 且 `WECHAT_H5_APPID` 缺 → reject
- `SMS_USE_MOCK=false` 且任一 `ALIYUN_SMS_*` 缺 → reject
- `AI_USE_MOCK=false` 且 `DASHSCOPE_API_KEY` 缺 → reject
- 全 mock + 关键 secret 齐 → resolve，`env.ACCESS_JWT_SECRET` 可读

- [ ] **步骤 1.7：跑全套 web 测试（不只是 env 那一条）**

```bash
pnpm.cmd --filter @zhijiao/web test
```

期望全绿——这一步验证步骤 1.3 的 tests/setup.ts 改动已经把所有现有测试需要的 env 备齐。

- [ ] **步骤 1.8：跑 E2E 验证 global-setup 改动**

```bash
pnpm.cmd --filter @zhijiao/web test:e2e
```

期望 3/3——验证步骤 1.4 的 OTP_PEPPER 改动让 spawn 的 next start 进程能通过 env validator。

- [ ] **步骤 1.9：boot fail-close 探针（PowerShell）**

```powershell
Move-Item .env.local .env.local.bak
Copy-Item .env.example .env.local
# 用编辑器把 .env.local 里的 ACCESS_JWT_SECRET 那行删掉或注释（不要用 cat/sed）
pnpm.cmd --filter @zhijiao/web dev
# 期望：进程立刻 throw，stderr 列出 zod issue（"ACCESS_JWT_SECRET must be >= 32 bytes" 之类）
# Ctrl+C 之后恢复：
Move-Item .env.local.bak .env.local -Force
```

- [ ] **步骤 1.10：commit**

```bash
git add apps/web/server/env.ts apps/web/server/auth-service.ts apps/web/server/context.ts \
  apps/web/app/api/auth/refresh/route.ts apps/web/app/(auth)/wechat/start/route.ts \
  apps/web/server/routers/auth.ts apps/web/tests/integration/env-validation.test.ts \
  apps/web/tests/setup.ts apps/web/e2e/global-setup.ts .env.example
git commit -m "feat(env): zod-validated env at boot; fail-close on missing secrets/mock-real mismatch (Task 1, C1+C2)"
```

---

## Task 2：WeChat / SMS / AI mock 兜底消除 + callback path（C2 + C3）

**Files:**
- Modify: `packages/integrations/src/wechat/h5-oauth/build.ts`
- Modify: `packages/integrations/src/sms/build.ts`（如存在）
- Modify: `apps/web/lib/ai-client.ts`（同样反模式：`AI_USE_MOCK === "true" || !DASHSCOPE_API_KEY`）
- Create: `packages/integrations/tests/wechat-build.test.ts`
- Create: `apps/web/tests/unit/ai-client.test.ts`（如不存在）

- [ ] **步骤 2.1：改 `packages/integrations/src/wechat/h5-oauth/build.ts`**

按 spec §3.2 完整内容替换。要点：
- `WECHAT_OAUTH_USE_MOCK === "true"` 是进 mock 的唯一条件
- 非 mock 路径强校验 `WECHAT_H5_APPID` + `WECHAT_H5_SECRET`，缺则 `throw new Error`
- callback path：`${appUrl}/wechat/callback`（**不是** `/auth/wechat/callback`）

- [ ] **步骤 2.2：改 `packages/integrations/src/sms/build.ts`**

如存在，同样规约：
- `SMS_USE_MOCK === "true"` → MockSmsAdapter
- 否则强校验 `ALIYUN_SMS_*` 四件套，缺则 throw

如不存在 build.ts（SMS 是直接构造的），跳过。

- [ ] **步骤 2.2b：改 `apps/web/lib/ai-client.ts`**

把：

```ts
function buildAdapter(): ModelAdapter {
  if (process.env.AI_USE_MOCK === "true" || !process.env.DASHSCOPE_API_KEY) {
    return new MockAdapter();
  }
  return new DashScopeAdapter();
}
```

改成：

```ts
import { env } from "@/server/env";

function buildAdapter(): ModelAdapter {
  if (env.AI_USE_MOCK === "true") return new MockAdapter();
  // env validator 已保证 DASHSCOPE_API_KEY 非空（非 mock 时）
  return new DashScopeAdapter();
}
```

> Task 1 的 env validator 的 `.refine` 已经把"`AI_USE_MOCK=false` 且 `DASHSCOPE_API_KEY` 缺"判为 boot fail，所以这里不需要再 throw。但保留一层防御：如果有人将来 import 这个文件时绕过了 env validator（理论上不应该发生，因为 `import "server-only"`），DashScope adapter 自己的 constructor 会因为缺 key 而 throw。

测试 `apps/web/tests/unit/ai-client.test.ts`（如新增）：
- mock `env` 模块，`AI_USE_MOCK=true` → 返 MockAdapter
- `AI_USE_MOCK=false` + `DASHSCOPE_API_KEY=xxx` + `DASHSCOPE_BASE_URL=https://...` → 返 DashScopeAdapter
- env validator 已经测试过"`AI_USE_MOCK=false`时缺 key 抛"，这里不重复

- [ ] **步骤 2.3：新建 `packages/integrations/tests/wechat-build.test.ts`**

case：
- `{WECHAT_OAUTH_USE_MOCK:"true"}` → MockWechatH5Adapter（appId 默认 "wx-mock-app"）
- `{WECHAT_OAUTH_USE_MOCK:"true", WECHAT_H5_APPID:"wx-abc"}` → MockWechatH5Adapter（appId="wx-abc"）
- `{WECHAT_OAUTH_USE_MOCK:"false", WECHAT_H5_APPID:"x", WECHAT_H5_SECRET:"y", NEXT_PUBLIC_APP_URL:"https://zj.example"}` → RealWechatH5Adapter
- `{WECHAT_OAUTH_USE_MOCK:"false"}` → throws
- `{WECHAT_OAUTH_USE_MOCK:"false", WECHAT_H5_APPID:"x"}` → throws（缺 secret）
- Real adapter 的 `buildAuthorizeUrl({state:"s",scope:"snsapi_userinfo"})` 返回值含 `redirect_uri=https%3A%2F%2Fzj.example%2Fwechat%2Fcallback`（URL-encoded `/wechat/callback`）

- [ ] **步骤 2.4：跑测试**

```bash
pnpm.cmd --filter @zhijiao/integrations test
```

- [ ] **步骤 2.5：E2E 回归**

```bash
pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/auth-wechat.spec.ts
```

期望 3/3 仍通过（路径修改后端到端无回归）。

- [ ] **步骤 2.6：commit**

```bash
git add packages/integrations/src/wechat/h5-oauth/build.ts \
  packages/integrations/src/sms/build.ts \
  apps/web/lib/ai-client.ts \
  packages/integrations/tests/wechat-build.test.ts \
  apps/web/tests/unit/ai-client.test.ts
git commit -m "fix(integrations,web): explicit *_USE_MOCK-only gating across wechat/sms/ai; align wechat callback to /wechat/callback (Task 2, C2+C3)"
```

---

## Task 3：refresh 轮换原子化（I1）

**Files:**
- Modify: `packages/auth/src/session.ts`
- Create: `packages/auth/tests/session-race.test.ts`

- [ ] **步骤 3.1：替换 `rotateSession`**

按 spec §3.4 完整内容替换。结构：
1. 整段进 `prisma.$transaction`
2. 第一步 `updateMany(predicate=refreshTokenHash & revokedAt:null & expiresAt:{gt:now})` 抢占
3. `count !== 1` → 再 `findUnique` 判定 NO_SESSION / EXPIRED / REUSE_DETECTED；REUSE_DETECTED 还要 `updateMany(userId, revokedAt:null) → REUSE_DETECTED` 把该用户所有 active session 一锅端
4. `count === 1` → 已经持锁 → `findFirst(refreshTokenHash, revokedReason:ROTATED, orderBy:revokedAt:desc)` 取出 user 信息 → `create` 新 session（real hash 一次到位，无占位）

- [ ] **步骤 3.2：写 race test `packages/auth/tests/session-race.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { Persona, SessionRevokeReason } from "@prisma/client";
import { createSession, rotateSession } from "../src/session.js";
import { AuthError } from "../src/errors.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

async function seedUser() {
  return prisma.user.create({ data: { name: "race", persona: Persona.STUDENT, isMinor: false } });
}

describe("rotateSession concurrent race (I1)", () => {
  it("两条并发 refresh 同一 token → 一条成功 / 一条 REUSE_DETECTED，且最终 user 无 active session", async () => {
    const u = await seedUser();
    const { refreshToken } = await createSession(prisma, u.id, {});
    const results = await Promise.allSettled([
      rotateSession(prisma, refreshToken, {}),
      rotateSession(prisma, refreshToken, {}),
    ]);
    const tags = results.map(r =>
      r.status === "fulfilled" ? "fulfilled"
      : r.reason instanceof AuthError ? r.reason.reason
      : "other-error"
    );
    expect(tags.filter(t => t === "fulfilled").length).toBe(1);
    expect(tags.filter(t => t === "REUSE_DETECTED").length).toBe(1);

    // DB 真理：u 没有 active session（重放检测把新建那条也一并 revoke）
    const active = await prisma.session.count({ where: { userId: u.id, revokedAt: null } });
    expect(active).toBe(0);
  });

  it("串行 refresh 正常工作（回归保障）", async () => {
    const u = await seedUser();
    const { refreshToken: t1 } = await createSession(prisma, u.id, {});
    const { refreshToken: t2 } = await rotateSession(prisma, t1, {});
    const { refreshToken: t3 } = await rotateSession(prisma, t2, {});
    expect(t3).toBeTruthy();
    const active = await prisma.session.count({ where: { userId: u.id, revokedAt: null } });
    expect(active).toBe(1);
  });
});
```

> 跟 `packages/auth/tests/session.test.ts` 的既有风格保持一致：`import { prisma, resetDb } from "@zhijiao/db/test-utils"`，`beforeEach(resetDb)`，每个 it 自己 seedUser。**不要** 引入新 helper 名 `setupTestDb`。

- [ ] **步骤 3.3：跑测试**

```bash
pnpm.cmd --filter @zhijiao/auth test -- tests/session-race.test.ts
pnpm.cmd --filter @zhijiao/auth test -- tests/session.test.ts  # 回归
```

- [ ] **步骤 3.4：commit**

```bash
git add packages/auth/src/session.ts packages/auth/tests/session-race.test.ts
git commit -m "fix(auth): atomic refresh rotation via predicate-on-update; add concurrent race test (Task 3, I1)"
```

---

## Task 4：OTP 校验原子化 + 边界（I2 + G4）

**Files:**
- Modify: `packages/auth/src/otp.ts`
- Create: `packages/auth/tests/otp-race.test.ts`
- Create: `packages/auth/tests/otp-boundary.test.ts`

- [ ] **步骤 4.1：替换 `verifyOtp`**

按 spec §3.5 完整内容替换。结构：
1. `findFirst(consumedAt:null, expiredAt:null, expiresAt > now, orderBy createdAt desc)`
2. hash 比对
3. mismatch：`update(attempts: increment 1)` → 若 attempts >= 5 则 `update(expiredAt: now)` → 抛 `OTP_MAX_ATTEMPTS` / `OTP_INVALID`
4. hit：`updateMany(id, consumedAt:null, expiredAt:null) data:{consumedAt:now, attempts: increment 1}`，`count !== 1` → 抛 `OTP_INVALID`（并发已被另一条 consume）

- [ ] **步骤 4.2：写 race test `packages/auth/tests/otp-race.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { issueOtp, verifyOtp } from "../src/otp.js";
import { AuthError } from "../src/errors.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("verifyOtp concurrent race (I2)", () => {
  it("同码并发 verify → 一条成功 / 一条 OTP_INVALID，DB 上 consumedAt 只写一次", async () => {
    const { code } = await issueOtp(prisma, { phone: "+8613800000001", purpose: "LOGIN", pepper: "p" });
    const results = await Promise.allSettled([
      verifyOtp(prisma, "+8613800000001", code, "p"),
      verifyOtp(prisma, "+8613800000001", code, "p"),
    ]);
    const ok = results.filter(r => r.status === "fulfilled").length;
    expect(ok).toBe(1);

    const consumed = await prisma.otpRequest.count({
      where: { phone: "+8613800000001", consumedAt: { not: null } },
    });
    expect(consumed).toBe(1);
  });
});
```

- [ ] **步骤 4.3：写 boundary test `packages/auth/tests/otp-boundary.test.ts`**

骨架同 race test：`import { prisma, resetDb } from "@zhijiao/db/test-utils"` + `beforeEach(resetDb)`。

case：
- 错码 5 次 → 第 5 次抛 `OTP_MAX_ATTEMPTS`；第 6 次抛 `OTP_EXPIRED`（前一条已被 expiredAt 标死）
- 已 consumed 的 row 再 verify → `OTP_EXPIRED`（因为 findFirst 过滤掉 consumedAt != null）
- phone A 的 OTP 用 phone B 校验 → `OTP_EXPIRED`（findFirst 按 phone 过滤）
- 过期未消费 → `OTP_EXPIRED`（直接 `prisma.otpRequest.create` 一条 `expiresAt: new Date(Date.now() - 1000)`）

> 错码计数与 spec 行为：连续 5 次错 = 第 5 次返 `OTP_MAX_ATTEMPTS`。boundary test 用 `for (let i=0;i<4;i++) await expect(verifyOtp(wrongCode)).rejects.toMatchObject({reason: "OTP_INVALID"})` 拿到 4 次 `OTP_INVALID`，第 5 次拿 `OTP_MAX_ATTEMPTS`。

- [ ] **步骤 4.4：跑测试**

```bash
pnpm.cmd --filter @zhijiao/auth test -- tests/otp-race.test.ts
pnpm.cmd --filter @zhijiao/auth test -- tests/otp-boundary.test.ts
pnpm.cmd --filter @zhijiao/auth test -- tests/otp.test.ts  # 回归
```

- [ ] **步骤 4.5：commit**

```bash
git add packages/auth/src/otp.ts packages/auth/tests/otp-race.test.ts packages/auth/tests/otp-boundary.test.ts
git commit -m "fix(auth): atomic OTP verify via predicate-on-update; add race + boundary tests (Task 4, I2+G4)"
```

---

## Task 5：session-revoke 即时生效（I3，**DB 是唯一真理**）

> **review 决定**（2026-05-20）：本 plan 不引入 Redis 黑名单层。context 直接查 DB；revoke 写入侧不需要改（Plan 2 已经在写 `Session.revokedAt`）。理由见 spec §3.6。

**Files:**
- Modify: `apps/web/server/context.ts`（DB 查 Session 状态）
- Create: `apps/web/tests/integration/session-revoke-immediate.test.ts`

> 不在本 task 改 `packages/auth/src/session.ts`、`auth-service.ts`、`logout/route.ts`、`auth.ts:revokeSession`——这些 revoke 路径既有实现已经写 `Session.revokedAt`，是 DB 真理。Task 3 改了 `rotateSession` 也已经在写 `revokedReason: ROTATED`。

- [ ] **步骤 5.1：改 `apps/web/server/context.ts`**

把 verify 成功后的分支改成：

```ts
import { env } from "./env.js";
// ...
const v = await verifyAccess(at, env.ACCESS_JWT_SECRET);
if (!v.ok) {
  authError = v.reason;
} else {
  // 新增：DB 查 Session 真实状态（每个 authed 请求 +1 PK indexed lookup）
  const sess = await prisma.session.findUnique({
    where: { id: v.claims.sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!sess || sess.revokedAt != null || sess.expiresAt <= new Date()) {
    authError = "SESSION_REVOKED";
  } else {
    auth = v.claims;
  }
}
```

- [ ] **步骤 5.2：扩 `AuthError` 类型**

`apps/web/server/context.ts:7` 的 `AuthError` 联合类型加 `"SESSION_REVOKED"`：

```ts
export type AuthError = "ACCESS_EXPIRED" | "ACCESS_INVALID" | "NO_SESSION" | "SESSION_REVOKED";
```

trpc errorFormatter 不需改动——cause.reason 是直接透传到 `shape.data.reason`。

- [ ] **步骤 5.3：写 `apps/web/tests/integration/session-revoke-immediate.test.ts`**

骨架：

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { Persona, SessionRevokeReason } from "@prisma/client";
import { createCaller } from "./helpers/trpc-caller"; // 既有/新建——直接 createTRPCMsw / inline caller
import { createSession } from "@zhijiao/auth";
// ...

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("session revoke immediate (I3)", () => {
  it("logout 后旧 access JWT 立刻 401 SESSION_REVOKED", async () => {
    // 1. 创建用户 + session + 签 access JWT
    // 2. 第一次 caller.auth.me() → ok
    // 3. prisma.session.update({where:{id:sessionId}, data:{revokedAt: new Date(), revokedReason: USER_LOGOUT}})
    // 4. 再调 caller.auth.me() → reject，shape.data.reason === "SESSION_REVOKED"
  });
  it("admin revoke 路径同样即时", async () => { /* 类似，revokedReason: ADMIN_REVOKED */ });
  it("expired session（revokedAt=null 但 expiresAt 过去）同样 SESSION_REVOKED", async () => { /* ... */ });
  it("session 行被删（极端情况，理论不应发生）也 SESSION_REVOKED", async () => {
    // findUnique 返 null → SESSION_REVOKED
  });
});
```

> 如何构造 caller 调用：可参考既有 `apps/web/tests/integration/auth-otp.test.ts` 的模式（构造 cookies header → 调 createContext → 调 router caller）。如果既有 integration 测试没用 caller 模式而是真发 HTTP，可以照那个模式来。

- [ ] **步骤 5.4：跑测试**

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/integration/session-revoke-immediate.test.ts
```

- [ ] **步骤 5.5：commit**

```bash
git add apps/web/server/context.ts apps/web/tests/integration/session-revoke-immediate.test.ts
git commit -m "feat(auth): check Session.revokedAt on every authed request (DB-truth; no Redis cache) (Task 5, I3)"
```

---

## Task 6：bind callback 重校验 access JWT（I4）

**Files:**
- Modify: `apps/web/app/(auth)/wechat/callback/route.ts`
- Create: `apps/web/tests/integration/auth-wechat-bind.test.ts`

- [ ] **步骤 6.1：改 callback bind 分支**

按 spec §3.7。把 `if (!meta.userId) return redirectWithClear(...)` 之后插入：

```ts
const at = cookies[COOKIE_AT];
if (!at) return redirectWithClear(new URL("/login?next=/profile&bind=identity_required", url));
const v = await verifyAccess(at, env.ACCESS_JWT_SECRET);
if (!v.ok || v.claims.userId !== meta.userId) {
  return redirectWithClear(new URL("/profile?bind=identity_mismatch", url));
}
```

- [ ] **步骤 6.2：写 `apps/web/tests/integration/auth-wechat-bind.test.ts`**

case：
- 用户 A 起 bind flow，state.userId=A，cookie 带 A 的 JWT → callback → 302 /profile?bind=ok，DB 有 A 的 WECHAT_H5 AuthIdentity
- 用户 A 起 bind flow，state.userId=A，cookie 带 B 的 JWT → callback → 302 /profile?bind=identity_mismatch，DB 无新 AuthIdentity
- 用户 A 起 bind flow，cookie 缺 → callback → 302 /login?next=/profile&bind=identity_required，DB 无写入
- 同 openid 已绑 A，A 再 bind → noop（302 /profile?bind=noop）
- 同 openid 已绑 B，A 尝试 bind → conflict（302 /profile?bind=conflict）

- [ ] **步骤 6.3：跑测试**

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/integration/auth-wechat-bind.test.ts
```

- [ ] **步骤 6.4：commit**

```bash
git add apps/web/app/(auth)/wechat/callback/route.ts \
  apps/web/tests/integration/auth-wechat-bind.test.ts
git commit -m "fix(wechat): re-verify access JWT in bind callback (state.userId no longer trusted alone) (Task 6, I4)"
```

---

## Task 7：register / refresh 限频接入（G1）

**Files:**
- Modify: `apps/web/server/routers/auth.ts`（register mutation）
- Modify: `apps/web/app/api/auth/refresh/route.ts`
- Create: `apps/web/tests/integration/auth-register-ratelimit.test.ts`
- Create: `apps/web/tests/integration/auth-refresh-ratelimit.test.ts`

- [ ] **步骤 7.1：register 接 `RULE_REGISTER_IP`**

按 spec §3.8 改 `auth.register` mutation：事务前 `takeRule(store, RULE_REGISTER_IP, ctx.ip)`，failMode=open，Redis 挂时仍允许（与现有 OTP 模式对齐——OTP 是 fail-close，register 是 fail-open）。

- [ ] **步骤 7.2：refresh 接 `RULE_REFRESH`（key=IP）**

按 spec §3.8 改 `/api/auth/refresh/route.ts`：

```ts
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // 限频闸门：放在 cookie 校验之前。理由：refresh token 单次轮换，token-hash 永远打不到同一个桶；
  // IP-based 才是抗"同源大量 refresh 滥用"的有意义维度。
  const store = new RedisRateLimitStore(redis);
  try {
    const r = await takeRule(store, RULE_REFRESH, ip);
    if (!r.allowed) {
      return new NextResponse(
        JSON.stringify({ ok: false, reason: "REFRESH_TOO_FREQUENT" }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
      );
    }
  } catch (e) {
    if (e instanceof RateLimitBackendDownError) {
      return new NextResponse(JSON.stringify({ ok: false, reason: "RATELIMIT_BACKEND_DOWN" }), { status: 500 });
    }
    throw e;
  }

  const cookies = parseCookies(req.headers.get("cookie"));
  const rt = cookies[COOKIE_RT];
  if (!rt) return json401("NO_SESSION");
  // ... rest unchanged
}
```

- [ ] **步骤 7.3：写 ratelimit tests**

`auth-register-ratelimit.test.ts`：
- 同 IP（测试里 ctx.ip 默认 `"unknown"`，所有调用共享桶）第 1..5 次注册（即使每次构造的 nonce 不同也无所谓——限频闸门在事务前）→ 不限频
- 第 6 次 → 抛 `TRPCError code:TOO_MANY_REQUESTS`，cause.reason=`REGISTER_TOO_FREQUENT`

`auth-refresh-ratelimit.test.ts`（关键：用 IP 当 key 后这个测试才可实现）：
- 同 IP 第 1..6 次 POST `/api/auth/refresh`（每次都带 fake refresh token cookie，token 本身会 401，但**这测的是限频闸门触发顺序**——闸门在 cookie 校验之前）→ 每次返 401 `NO_SESSION`（限频未触发）
- 第 7 次 → 返 429 `REFRESH_TOO_FREQUENT`（限频闸门先于 cookie 校验）
- 期望 `Retry-After` header 存在

> **为什么用 fake token**：refresh token 是 32 字节随机 base64url + 单次轮换。我们无法在测试里"用真 token 调 7 次"——第 2 次就 REUSE_DETECTED 了。但限频规则定义是抗"同源大量请求滥用"（无论 token 是否合法）；测试用 fake token 7 次同时验证：① 限频闸门在 cookie 校验之前；② 第 7 次返 429 而不是 401。这正好对应了"对抗滥用"的目标。

> **测试基础设施**：可直接 import `POST` from `apps/web/app/api/auth/refresh/route.ts`，构造 `new Request("http://x/api/auth/refresh", {method:"POST", headers:{cookie:"...", "x-forwarded-for":"1.2.3.4"}})`，循环 7 次。如果不行就在测试里用 `fetch` 打真 dev server——但前者更轻量。

- [ ] **步骤 7.4：跑测试**

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/integration/auth-register-ratelimit.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/auth-refresh-ratelimit.test.ts
```

- [ ] **步骤 7.5：commit**

```bash
git add apps/web/server/routers/auth.ts apps/web/app/api/auth/refresh/route.ts \
  apps/web/tests/integration/auth-register-ratelimit.test.ts \
  apps/web/tests/integration/auth-refresh-ratelimit.test.ts
git commit -m "feat(auth): wire RULE_REGISTER_IP and RULE_REFRESH ratelimits (Task 7, G1)"
```

---

## Task 8：middleware guard 测试（G2）

**Files:**
- Create: `apps/web/tests/integration/middleware-guard.test.ts`

> **既有 middleware 行为**（`apps/web/middleware.ts:3`）：**只保护** `/profile`、`/error-book`、`/teacher`、`/parent`、`/admin`。**`/tutor` 不在 matcher**——由 tRPC `authedProcedure` 在数据路径上拦。本 task 只测既有 matcher 覆盖的真实路径，不要测 `/tutor`。

- [ ] **步骤 8.1：写 middleware test**

```ts
import { describe, it, expect } from "vitest";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

describe("middleware route guard (G2)", () => {
  const PROTECTED = ["/profile", "/error-book", "/teacher", "/parent", "/admin"];
  const UNPROTECTED = ["/", "/login", "/register", "/tutor"];  // tutor 不在 matcher

  it.each(PROTECTED)("无 access cookie 访问 %s → 重定向 /login", async (path) => {
    const req = new NextRequest(`http://localhost:3000${path}`);
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).toContain(`next=${encodeURIComponent(path)}`);
  });

  it.each(PROTECTED)("有 access cookie 访问 %s → 通过（middleware 不解 JWT）", async (path) => {
    const req = new NextRequest(`http://localhost:3000${path}`, {
      headers: { cookie: "__Host-zj_at=anything-even-garbage" },
    });
    const res = await middleware(req);
    // NextResponse.next() 的 status 为 200
    expect(res.status).toBeLessThan(300);
  });

  it.each(UNPROTECTED)("无 access cookie 访问 %s → middleware 不动它", async (path) => {
    const req = new NextRequest(`http://localhost:3000${path}`);
    const res = await middleware(req);
    expect(res.status).toBeLessThan(300);
  });
});
```

> middleware 是轻 guard：**只看 cookie 是否存在**，不解 JWT、不查 DB。如果未来扩展，对照 Plan 2 spec §6 看是否要回拉。本 task 不改 middleware 行为，只新增覆盖。

- [ ] **步骤 8.2：跑测试**

```bash
pnpm.cmd --filter @zhijiao/web test -- tests/integration/middleware-guard.test.ts
```

- [ ] **步骤 8.3：commit**

```bash
git add apps/web/tests/integration/middleware-guard.test.ts
git commit -m "test(web): integration coverage for middleware route guard (Task 8, G2)"
```

---

## Task 9：全量回归 + CLAUDE.md 更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **步骤 9.1：全量回归（对照 Pre-Task baseline，PowerShell）**

```powershell
"" | Out-File final-runs.txt -Encoding utf8
foreach ($i in 1..3) {
  "=== Final Run $i ===" | Out-File final-runs.txt -Encoding utf8 -Append
  $tc = pnpm.cmd exec turbo typecheck --force 2>&1
  $tc | Select-Object -Last 5  | Out-File final-runs.txt -Encoding utf8 -Append
  $tt = pnpm.cmd exec turbo test --force 2>&1
  $tt | Select-Object -Last 10 | Out-File final-runs.txt -Encoding utf8 -Append
}
"=== E2E ===" | Out-File final-runs.txt -Encoding utf8 -Append
$e2e = pnpm.cmd --filter @zhijiao/web test:e2e 2>&1
$e2e | Select-Object -Last 10 | Out-File final-runs.txt -Encoding utf8 -Append

# diff 一下 baseline 看是否有新 flake
Compare-Object (Get-Content baseline-runs.txt) (Get-Content final-runs.txt)
```

**通过标准**：3 轮全绿。如果 baseline 已有 flake 且本 plan 未把 flake 列为修复范围，则最终结果允许"flake 表现不变"——但不允许变密、不允许出现新的 flake 测试名。如果出现新 flake，**回查最后一个 commit 是否是诱因**，必要时回滚。

- [ ] **步骤 9.2：手工 boot 探针 + revoke 探针**（PowerShell）

```powershell
# A. env fail-close 探针（与 Task 1 步骤 1.9 同）
Move-Item .env.local .env.local.bak
Copy-Item .env.example .env.local
# 编辑器把 .env.local 里 ACCESS_JWT_SECRET 那行删掉或注释
pnpm.cmd --filter @zhijiao/web dev
# 期望进程立刻 throw，输出 zod issue 列表
Move-Item .env.local.bak .env.local -Force
```

```
# B. revoke 即时生效手工探针（I3）
# 1. 在另一个终端：pnpm.cmd dev
# 2. 浏览器登录 13800000001 → 进入 /profile 或任意 authed 页
# 3. devtools 复制 __Host-zj_at cookie 的值（记作 $OLD_AT）
# 4. 浏览器里 logout（DB 上 Session.revokedAt 被写）
# 5. 用 curl/Invoke-RestMethod 把 $OLD_AT 作为 cookie 发回服务器，调一个 authed tRPC endpoint：
#    Invoke-RestMethod 'http://localhost:3000/api/trpc/auth.me' `
#      -Headers @{ Cookie = "__Host-zj_at=$OLD_AT" }
# 6. 期望：返回 401，body 含 reason="SESSION_REVOKED"
#    （而不是 200——本 plan 之前 access JWT 在 access TTL 内还能用 15 分钟）
```

> **不要**测 `/tutor`：`/tutor` 不在 `middleware.ts` 的 PROTECTED_PREFIXES 里（既有行为，对 by design——tRPC `authedProcedure` 是数据路径上的 auth gate）。I3 的真正断言路径是 tRPC authed procedure，例如 `auth.me`；middleware 探针请用 `/profile`。
>
> 探针 B 比测试更接近真实部署行为，但耗时；如果 Task 5 步骤 5.3 的 integration test 已覆盖，探针 B 是 nice-to-have，不必 block commit。

- [ ] **步骤 9.3：更新 `CLAUDE.md`**

`## 开始实现时（已落地）` 节追加：

```markdown
- **Plan 2 Hardening**（env validator + 原子化 refresh/OTP + 会话吊销即时 + bind 身份重校验 + 限频接入 + race tests + 仓库卫生）—— 见 `docs/superpowers/plans/2026-05-20-plan2-hardening.md`
```

`常用命令` 节后追加新章节：

```markdown
### Merge 后必跑（不是绿测试就行）
1. `git status --short --branch` 干净（无 `??`）；若有 `.claude/worktrees/<old-plan>/` 残留 → 先 `git worktree list` 看 git 是否还认它：认就 `git worktree remove`（必要时 `git worktree prune`）；不认则 PowerShell `Remove-Item -Recurse -Force -LiteralPath` 物理删（确认不是当前 worktree 之后）
2. `pnpm.cmd exec turbo typecheck --force`（不走 cache）
3. `pnpm.cmd exec turbo test --force`（不走 cache；@zhijiao/ai router 测试偶发 flake，单包重跑确认；若稳定 flake → 开独立 plan）
4. E2E：`pnpm.cmd --filter @zhijiao/web test:e2e`（单独跑，**不要**与 typecheck/test 并发——会写 `.next` 冲突）
5. env 探针：把 `.env.local` 的 `ACCESS_JWT_SECRET` 注释掉再 `pnpm.cmd --filter @zhijiao/web dev`，期望进程立刻 throw
6. 路由契约：grep `apps/web/app/**/route.ts` 与 `packages/integrations/src/**/build.ts` 里写的 callback URL 对账
7. revoke 语义：手动 logout 后把旧 `__Host-zj_at` 重新塞回，调一个 authed tRPC endpoint（例 `auth.me`），期望 401 `SESSION_REVOKED`。**不要测 `/tutor`**——它不在 middleware 保护范围；要测 middleware 走 `/profile`
8. test 库与 prod 库分离：E2E 跑在 `zhijiao_test` 库（`apps/web/e2e/global-setup.ts:13`），首次必须先在 PowerShell 用 `$env:DATABASE_URL='postgresql://...zhijiao_test'; pnpm.cmd db:seed; Remove-Item Env:\DATABASE_URL` 灌 seed
9. PowerShell 调用约定：本机 execution policy 拦 `.ps1`，所有命令一律 `pnpm.cmd`（不是 `pnpm`），否则会报 "running scripts is disabled"
```

`下一步候选 Plan` 节改：

```markdown
**下一步候选 Plan**：
- Plan 3: Credit 计费体系 + 微信支付沙箱（替换 `creditPlaceholder` 占位中间件）
- Plan 4: 举一反三 + 错因分析（VariantGroup + ErrorBookEntry + 三阶变式生成）
- Plan 5: 真接阿里云 SMS + 微信公众号公开（ICP 备案 + Plan 2 Hardening 必须 ship 之后；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
```

- [ ] **步骤 9.4：commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): post-hardening status + merge-acceptance checklist (Task 9)"
```

---

## 验收标准（Definition of Done）

- [ ] Pre-Task 的 baseline-runs.txt 已记录并入 PR 描述
- [ ] 所有 Task 0–9 的 commit 已落地
- [ ] `git status --short --branch` 干净（无 `??`）
- [ ] Task 9 步骤 9.1 的"连跑 3 次 typecheck + test"final-runs.txt 已记录，对照 baseline 没有新 flake / flake 没变密
- [ ] `pnpm.cmd --filter @zhijiao/web test:e2e` 3/3 通过
- [ ] env fail-close 探针通过（删 ACCESS_JWT_SECRET → boot throw）
- [ ] revoke 即时探针通过（logout 后旧 cookie 401 SESSION_REVOKED）
- [ ] callback path grep（`buildAuthorizeUrl` 返回值 + 实际路由）对得上 `/wechat/callback`
- [ ] Spec §1.1 表里 8 个 ID（C1-C3 / I1-I4 / G1）全部对应 commit message 编号可追溯
- [ ] CLAUDE.md 已更新；Plan 5 已显式标注"等 Plan 2 Hardening ship 后"
- [ ] **没有**任何代码路径有 "缺 env → 静默 mock"、"Redis miss → 视作 active"、"`process.env.X ?? ""` 兜底"这类反模式遗留（grep 验证）

---

## 合并策略

- [ ] **PR review**：建议至少一轮 user / subagent 审计（可以再请 spec §1 中的"auth 安全" subagent 复审本 PR diff，确认 C1-C3 / I1-I4 都修干净）
- [ ] **squash merge**：保留 Task 0–9 的 9 条 commit 历史走 merge commit（非 squash），方便回滚单个 task
- [ ] **merge 后**：执行 spec §3.10 的"Merge 验收清单"7 条，全过才宣布 Plan 2 Hardening 闭环
- [ ] **worktree 清理**：合并后 `git worktree remove .claude/worktrees/plan-2-hardening`；按本 plan 的 Task 0 ignore 规则，无残留可清

---

## 附录 A：执行顺序与依赖

Pre-Task（baseline 复现，flake 决策）→ Task 0（卫生）→ Task 1（env，**所有后续 task 依赖**）→ Task 2（mock/callback path + ai-client）→ Task 3（refresh 原子）→ Task 4（OTP 原子）→ Task 5（revoke 即时；DB 查询，**只依赖 Task 1 的 env**）→ Task 6（bind 身份，**依赖 Task 1 的 env**）→ Task 7（限频接入）→ Task 8（middleware 测试）→ Task 9（回归 + 文档）

3-7 之间互相独立，原则上可并行 worktree 推进；本 plan 保守按串行写。

## 附录 B：失败模式与回滚

- **Task 1 boot throw 影响 dev 流**：恢复 `.env.local` 或临时把 `env.ts` 里的 `throw` 改成 `console.warn`（不要进 commit）；首要原因通常是 tests/setup.ts / e2e/global-setup.ts 没把对应 env 备齐（参 Task 1 步骤 1.3/1.4）
- **Task 3/4 race tests flake**：Postgres `Read Committed` 隔离级一般稳定；若机器 IO 偶发抖动，重跑；若稳定 flake，spec §7 的"风险"列表已经声明这是 Postgres 标准行为，应该是测试本身 / testcontainers 配置问题
- **Task 5 每请求多 1 次 DB 查询导致 p99 升高**：MVP 阶段 PK 唯一查询亚毫秒，不应该有可观察影响；如果真的成瓶颈（不太可能），加 Redis cache 时必须 **cache miss/error → fall back DB query**，不允许"miss = active"
- **回滚单个 task**：`git revert <commit>` 不影响其它 task，因为每个 commit 文件不重叠（Task 1 的 env import 是例外——若 revert Task 1，须同时 revert Task 5 / 6 中对 `env.ACCESS_JWT_SECRET` 的引用）
