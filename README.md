# 智教 · 教师 AI 生产力平台

> 先把教师备课、出卷、课件做成可控的 AI 工作台。

## 当前方向

项目在 2026-06-04 完成产品重心调整：从“学生 AI 学习闭环（答疑 / 错因 / 举一反三 / 训练 / 错题本 / 学情）”转向“教师生产力工具”。学生端能力进入维护态，后续只在支撑教师工具、数据沉淀或存量闭环稳定时继续投入。

当前两条产品主线：

- **AI 出卷（Plan 17）**：教师按年级、学科、知识点、题型、难度、题量生成练习卷；支持题库优先复用、AI 补缺、答案解析、双向细目表、打印 / 另存 PDF。
- **AI 课件（Plan 18）**：教师按年级、知识点和教学目标生成五段式课件（导入 / 讲解结构 / 例题 / 易错点 / 课堂练习）；支持分段编辑、状态确认、打印。

## 仓库当前状态

- ✅ Monorepo 骨架（pnpm + Turborepo）
- ✅ Postgres 16 (pgvector) 本地 docker
- ✅ Prisma 数据模型：Identity / Curriculum / Question Bank / AI Audit / Billing / Classroom / Assignment 等基础能力
- ✅ `packages/domain`：RBAC + 合规黑词 + PII 处理
- ✅ `packages/ai`：router + DashScope 适配 + 多任务 prompt / mock 基础
- ✅ `apps/web`：认证、钱包、学生端存量闭环、教师作业、画像、E2E 与 production skeleton 已落地
- ✅ Plan 17 AI 出卷 spec + implementation plan 已写
- ✅ Plan 18 AI 课件 spec 已写，implementation plan 待补
- ⬜ AI 出卷工作流实现
- ⬜ AI 课件工作流实现
- ⬜ 公网生产上线所需 ICP、域名/TLS、真实短信/微信/OSS、生产 secrets 与备份策略

## 文档

- `CLAUDE.md` —— Claude Code 工作指引
- `docs/claude/implementation-state.md` —— 已落地 Plan 的承重实现知识
- `docs/product/product-direction.md` —— 2026-06-04 后的产品方向锚点
- `需求与架构文档.md` —— 需求与架构 Markdown；已按教师生产力方向更新，原 docx 作为历史快照
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
pnpm setup          # 复制 .env.example -> .env.local + docker compose + db migrate + seed
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

## 当前开发重点

- Plan 17：补 Paper / PaperItem 模型、`PAPER_GEN` prompt/schema/mock、`paper.*` tRPC、教师出卷 UI、预览编辑和打印页。
- Plan 18：补 Courseware / CoursewareSection 模型、`LESSON_PLAN_GEN` prompt/schema/mock、`courseware.*` tRPC、课件列表/生成/分段编辑/打印页。
- 学生端、家长端、预测中心和公网发布能力暂不扩展，只保持稳定和必要维护。

## 已知环境限制

- **Windows + 中文路径环境**：本仓库目录名是 `智教`（含中文），需要 `docker-compose.yml` 顶层包含 `name: zhijiao`，目前已包含。
- **Windows native Postgres 冲突**：如果机器上跑了 PostgreSQL Windows 服务（`postgresql-x64-16` 之类），它会占用 5432 端口让 Docker 容器接不进来；停止该 Windows 服务即可。
- **Prisma migrate 在某些 Windows 环境失败**：`prisma migrate dev/deploy` 调用的 `schema-engine-windows.exe` 可能被 AV/防火墙阻断（症状：P1000，没有实际 TCP 连接）。绕过办法是用 `prisma migrate diff` 生成 SQL，再用 `docker exec psql` 应用。CI/Linux 环境无此问题。
