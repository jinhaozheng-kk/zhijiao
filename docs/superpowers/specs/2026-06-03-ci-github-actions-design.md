# CI（GitHub Actions）设计 — typecheck + test on push/PR

**日期**：2026-06-03 ｜ **分支**：`ci-bootstrap`（绿了 `--no-ff` 合 master）

## 背景与目标

代码 2026-06-03 上 GitHub（`origin → https://github.com/jinhaozheng-kk/zhijiao.git`，master 已推）。MVP 两件（靶向训练 + 图片/OCR）已收完，转入 launch-prep。**第一步**：把现有回归（`turbo typecheck` + `turbo test`）接到 CI，每次 push / PR 自动跑，给回归信号。

为什么先做这个：代码刚上 GitHub、不被 ICP 备案卡、低风险高价值、是其它 launch-prep 步（Dockerfile / prod 配置 / 真集成）的质量基础。

**目标**：一个最小、稳定的 CI，在所有分支 push 与 PR 上跑 typecheck + 全量 unit/integration test 并给红/绿信号。

## 范围

- **In**：`.github/workflows/ci.yml`（typecheck + test 单 job）；修 `setup-test-dbs.ts` 跨平台；按需注入 test env。
- **Out（明确不做，YAGNI）**：E2E job、lint/format gate、Dockerfile、prod 基建配置、真集成激活、turbo 远端缓存、node 版本 matrix、PR 强制合并 gate。

## 架构 / Workflow

- 新增 `.github/workflows/ci.yml`，单 job `test`，`runs-on: ubuntu-latest`。
- **触发**：`on: push`（所有分支）+ `pull_request`。不设 PR 强制 gate —— 沿用本地 `--no-ff` 合并优先的流，CI 仅作信号、不挡合并。
- **DB/Redis 起法（选定方案 A：复用 docker compose）**：CI step 跑 `docker compose up -d`，复用现有 `docker-compose.yml`（`pgvector/pgvector:pg16` + `redis:7-alpine`，均带 healthcheck）。容器名 `zhijiao-postgres` 正好匹配 `setup-test-dbs.ts` 的 `docker exec` 回退 → 无需额外装 host `psql` client；`docker/postgres-init/*.sql` 自动执行；行为与本地 `pnpm setup` 完全一致。
- **步骤**：
  1. `actions/checkout@v4`
  2. `docker compose up -d`，轮询等 postgres/redis healthy
  3. `actions/setup-node@v4`（node 20）+ `corepack enable` → 锁 `pnpm@9`（与 `package.json` `packageManager` 一致）
  4. `pnpm install --frozen-lockfile`（缓存 pnpm store，命中后秒级）
  5. `pnpm test:setup`（建 + `migrate deploy` 6 个 per-package test DB：`zhijiao_test_{ai,auth,db,integrations,web,billing}`）
  6. `pnpm typecheck`（turbo，8 包）
  7. `pnpm test`（turbo，8 包 / web 100 文件）
- **失败语义**：任一步非零退出 → job 红 → GitHub 标记失败。

## 必改代码（CI 在 Linux 跑的硬前提）

- `packages/db/scripts/setup-test-dbs.ts:66`：`execSync("pnpm.cmd --filter @zhijiao/db db:migrate:deploy")` 的 `pnpm.cmd` 在 Linux runner 上不存在 → 必炸。改为跨平台 bin 选择：`const bin = process.platform === "win32" ? "pnpm.cmd" : "pnpm"`（复用 `package.json` 中 `demo:reset` / `verify:demo` 已有的同款写法）。

## 实现时核（不一定要改，落地时确认）

- **pgvector extension**：确认 `CREATE EXTENSION vector` 建于何处（prisma migration 或 `schema.prisma` 的 `postgresqlExtensions`）。本地 `pnpm setup` 既能跑通测试，说明已有机制建好；CI 复用同一 compose + `migrate deploy` 路径 → 预期零额外动作，落地时看一眼 migration 兜底。
- **test env 来源**：核 `apps/web/tests/setup.ts` 及各包 test 配置里 test-DB 连接串 / `REDIS_URL` 的来源，按需在 workflow 注入（如 `REDIS_URL=redis://localhost:6379`；`PGHOST/PGPORT/PGUSER/PGPASSWORD` 默认即匹配 compose）。**无需主库 `db:migrate`** —— 测试只连 `test:setup` 建的 6 个 test DB。

## 验证方式

- 本机为 Windows，**无法本地复刻 Linux CI 路径**；CI 只能在 CI 上调。
- 落地节奏：修 `setup-test-dbs.ts` → 写 `ci.yml` → 在 `ci-bootstrap` 分支 push → 看 Actions → 按日志迭代（常见红点：test env 缺失 / pgvector extension / 容器就绪等待）→ 一次完整跑绿后 `--no-ff` 合 master。
- **验收标准**：`ci.yml` 在 `ci-bootstrap` 分支上一次完整跑绿 —— `turbo typecheck` 8/8 + `turbo test` 8/8（web 100 文件）。

## 风险 / 未决

- 各包 test-DB 连接串来源需落地核实，可能需在 workflow 注入若干 env；属可控的迭代收敛项。
- 首次 CI 易遇 env / extension / 容器就绪类红点 —— 正是放在 `ci-bootstrap` 分支反复 push 调试、不污染 master 的原因。
