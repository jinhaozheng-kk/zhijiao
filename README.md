# 智教 · AI K12 学习与教学平台

> 一道题，学会一类题。

## 仓库当前状态

- ✅ Monorepo 骨架（pnpm + Turborepo）
- ✅ Postgres 16 (pgvector) 本地 docker
- ✅ Prisma 数据模型：Identity / Curriculum / Question Bank / AI Audit
- ✅ `packages/domain`：RBAC + 合规黑词
- ✅ `packages/ai`：router + DashScope 适配 + tutoring prompt v1
- ✅ `apps/web`：landing + tutor 页面，端到端可跑通（mock 或真 DashScope）
- ⬜ 真实鉴权（手机号/微信）—— 后续 plan
- ⬜ Credit 计费 —— 后续 plan
- ⬜ 变式生成、错题本、出卷、预测中心 —— 后续 plan
- ⬜ admin app —— 后续 plan
- ⬜ 部署、ICP、CI/CD —— 后续 plan

## 文档

- `CLAUDE.md` —— Claude Code 工作指引
- `需求与架构文档.md` —— 全量需求规格（docx 派生）
- `docs/superpowers/specs/` —— 设计 spec
- `docs/superpowers/plans/` —— 实施 plan

## 本地开发

### 前置依赖
- Node.js 20+ LTS
- pnpm 9+
- Docker Desktop

### 一键启动

```bash
git clone <repo>
cd 智教
pnpm setup          # 复制 .env.example → .env.local + docker compose + db migrate + seed
pnpm dev            # 启动 apps/web (3000)
```

`.env.local` 默认会用 mock AI 适配器；要用真 DashScope，设置 `DASHSCOPE_API_KEY` 并把 `AI_USE_MOCK=false`。

### 测试账号（seed 创建）

| 角色 | id | phone |
|---|---|---|
| 学生 | dev-student-01 | 13800000001 |
| 教师 | dev-teacher-01 | 13800000002 |
| 家长 | dev-parent-01 | 13800000003 |
| 运营 | dev-ops-01 | 13800000004 |
| 管理员 | dev-admin-01 | 13800000005 |

（本 plan 没接真鉴权；server action 默认使用 `DEV_USER_ID` env 指定的学生身份）

### 常用脚本

```bash
pnpm dev                    # 启动所有 app
pnpm test                   # 全量单测 + 集测
pnpm --filter @zhijiao/web test:e2e   # E2E
pnpm db:migrate             # apply 新 migration
pnpm db:seed                # 重 seed
pnpm db:studio              # Prisma Studio 浏览数据
pnpm typecheck              # 全量 TS 检查
```

## 已知限制（Plan 1 范围）

- `pnpm db:seed` 的 question seed 不是 idempotent，重跑会重复插入
- 没有真鉴权；所有用户身份都是硬编码 `dev-student-01`
- 没有 Credit / 订阅 / 支付
- AI 仅实现 TUTOR_TURN；变式生成、错因分析等留待后续
- **Windows + 中文路径环境**：本仓库目录名是 `智教`（含中文），需要 `docker-compose.yml` 顶层包含 `name: zhijiao` 已包含
- **Windows native Postgres 冲突**：如果机器上跑了 PostgreSQL Windows 服务（`postgresql-x64-16` 之类），它会占用 5432 端口让 Docker 容器接不进来；停止该 Windows 服务即可（Docker 不需要它）
- **Prisma migrate 在某些 Windows 环境失败**：`prisma migrate dev/deploy` 调用的 `schema-engine-windows.exe` 可能被 AV/防火墙阻断（症状：P1000，没有实际 TCP 连接）。绕过办法是用 `prisma migrate diff` 生成 SQL，再用 `docker exec psql` 应用。CI/Linux 环境无此问题。
