# 智教 · K12 教师 AI 生产力平台

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14.2-black?logo=next.js" alt="Next.js 14">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/tRPC-11-2596BE" alt="tRPC">
  <img src="https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma" alt="Prisma">
  <img src="https://img.shields.io/badge/Postgres-16%20%2B%20pgvector-4169E1?logo=postgresql&logoColor=white" alt="Postgres">
  <img src="https://img.shields.io/badge/Turborepo-2-EF4444?logo=turborepo&logoColor=white" alt="Turborepo">
  <img src="https://img.shields.io/badge/License-proprietary-lightgrey" alt="License">
</p>

面向中国 K12 市场的 **AI 教育平台**，目前的产品重心是"**把教师备课、出卷、课件做成可控的 AI 工作台**"——不是替老师写一堆花哨文案，而是把出卷、课件这两个高频、可验收的备课环节做成结构化、可编辑、可打印的流水线。

2026-06-04 产品方向调整后，项目从"学生 AI 学习闭环"转向"教师生产力工具"：学生端能力（答疑 / 错因 / 举一反三 / 训练 / 错题本 / 学情画像）进入维护态，只在支撑教师工具与数据沉淀时继续投入。

**当前两条产品主线（均已落地）：**

- **Plan 17 · AI 出卷**：教师按年级、学科、知识点、题型、难度、题量生成练习卷；题库优先复用 + AI 补缺；支持答案解析、双向细目表、预览编辑与打印 / 另存 PDF。
- **Plan 18 · AI 课件**：教师按年级、知识点、教学目标生成五段式课件（导入 / 讲解结构 / 例题 / 易错点 / 课堂练习）；支持分段编辑、状态确认与打印。

> 这是一个仍在演进的工程仓库：生产部署骨架与 CI 已就绪，但**公网生产上线仍被 ICP、域名/TLS、真实短信/微信/OSS 凭据、生产 secrets 与备份策略阻塞**。详见 [第 17 节](#17-已知限制与上线阻塞)。

---

## 目录

- [1. 产品定位](#1-产品定位)
- [2. 功能矩阵](#2-功能矩阵)
- [3. 技术栈](#3-技术栈)
- [4. 总体架构](#4-总体架构)
- [5. 目录结构](#5-目录结构)
- [6. 快速开始](#6-快速开始)
- [7. 环境变量](#7-环境变量)
- [8. 测试账号](#8-测试账号)
- [9. 常用脚本](#9-常用脚本)
- [10. 数据模型](#10-数据模型)
- [11. AI 层设计](#11-ai-层设计)
- [12. 认证、权限与合规](#12-认证权限与合规)
- [13. 计费与支付](#13-计费与支付)
- [14. 质量保障](#14-质量保障)
- [15. 部署](#15-部署)
- [16. 文档索引](#16-文档索引)
- [17. 已知限制与上线阻塞](#17-已知限制与上线阻塞)
- [18. 许可](#18-许可)

---

## 1. 产品定位

中国 K12 场景下，教师的真实痛点是备课时间被出卷、做课件、批改、学情分析切碎。市面上的 AI 教育产品大多面向学生（拍照搜题、AI 答疑），而"教师侧的 AI 生产力"仍缺少把结果做成**可交付物**（一份能打印的卷子、一份能上课的课件）的产品。

智教的选择是：

1. **先做教师侧的高频交付物**：出卷与课件，结果结构化（不是一段聊天记录）、可编辑、可打印；
2. **AI 只做"补缺"**：题库能复用的优先复用，AI 只补缺口，降低 token 成本与不可控性；
3. **成本与合规前置**：所有 AI 调用走统一 router + 审计 + 计费；未成年人数据有监护人同意、月度消费上限、PII 治理与数据主体请求（DSAR）流程；
4. **学生端不扩张**：已有的学生闭环保持稳定，作为教师工具的数据来源与演示支撑。

## 2. 功能矩阵

### 教师端（主线）

| 能力 | 说明 | 状态 |
| --- | --- | --- |
| AI 出卷 | 按年级 / 学科 / 知识点 / 题型 / 难度 / 题量生成试卷，题库复用 + AI 补缺，答案解析、双向细目表、打印 | ✅ 已落地 |
| 出卷预览编辑 | 调分、删题、改题、标记 READY；按 owner 校验 | ✅ |
| AI 课件 | 五段式课件生成（导入 / 讲解 / 例题 / 易错 / 练习），严格结构校验 | ✅ |
| 课件分段编辑 | 逐段编辑、markReady、打印页 | ✅ |
| 作业管理 | 分层作业生成、整卷审核、发布、内容快照锁定 | ✅ |
| 人工批改 | 逐题批改、错因标注、回写错题本与学情 | ✅ |
| 班级学情诊断 | 按知识点聚合掌握度、三档分层 | ✅ |
| 学生画像 | 单学生掌握度块、时间窗口、付费学习建议 | ✅ |

### 学生端 / 家长端（维护态）

| 能力 | 说明 | 状态 |
| --- | --- | --- |
| AI 答疑 | 文本 + 图片（OCR）答疑，带额度计费 | ✅ 存量 |
| 错因分析 / 举一反三 | 错题解析、变式题生成与训练 | ✅ 存量 |
| 错题本 / 复习 | 错题归档、复习视图 | ✅ 存量 |
| 学情画像 | 掌握度三档 + 学习建议（付费 AI） | ✅ |
| 家长绑定 | 邀请码绑定子女、家长简版视图（去除具体分数） | ✅ |
| 钱包 / 充值 | 学分账本、充值、未成年人月限额 | ✅ |
| 监护人同意 | 未成年人注册/使用前置同意流程 | ✅ |
| 账户与隐私 | 数据导出、注销、DSAR 工单、PII 清理 | ✅ |

### 平台侧

- RBAC（角色 / 权限）、合规黑词扫描、PII 扫描与脱敏；
- AI 调用审计（`ModelCall` / `PromptTemplate`）、统一计费与补偿；
- Demo 中心（`DEMO_MODE`）、E2E hooks（仅测试环境开启）、`/readiness` 健康检查；
- 运营动作日志（`OpsActionLog`）。

## 3. 技术栈

| 层 | 技术 | 版本 / 说明 |
| --- | --- | --- |
| 包管理 / 构建 | **pnpm 9 + Turborepo 2** | monorepo，`apps/*` + `packages/*` |
| 运行时 | Node.js 20+（生产镜像 22） | `engines.node >= 20` |
| Web | **Next.js 14.2.5**（App Router）+ React 18.3 | standalone 输出用于 Docker |
| 语言 | TypeScript 5.4 | 全仓库类型检查 |
| API | **tRPC 11 RC** + TanStack Query 5 + superjson | 端到端类型安全 |
| 数据库 | **PostgreSQL 16 + pgvector** | 本地 Docker / 生产 compose |
| ORM | **Prisma 5.18** | 39 个 model、886 行 schema、16 个 migration |
| 缓存 / 限流 | **Redis 7** | OTP nonce、注册 payload、微信 state、限流 |
| 校验 | Zod 3.23 | 输入 / AI 输出 schema |
| 鉴权 | `jose`（HS256 JWT）+ Session/OTP | 手机号 OTP、微信 H5 OAuth |
| 日志 | pino 8 | 结构化日志、脱敏 |
| 样式 | Tailwind CSS 3.4 | — |
| AI | **DashScope（阿里云通义千问）** + Mock 适配器 | 统一 router / 任务注册 / 审计 |
| 短信 / 存储 / 支付 | 阿里云短信、阿里云 OSS、**微信支付 v3** | 均支持 mock/real 双适配 |
| 测试 | **Vitest 1.6**（单测 + 集成）+ **Playwright 1.45**（E2E） | 184 个测试文件、19 个 E2E spec |
| CI | GitHub Actions | typecheck + test + E2E + Docker build |

## 4. 总体架构

```mermaid
flowchart LR
    subgraph Client[浏览器]
        U[学生 / 教师 / 家长 / 运营]
    end
    U -->|Next.js App Router| W[apps/web]
    W -->|tRPC| API[server/routers]
    API --> AUTH[packages/auth<br/>OTP / JWT / Session / 限流]
    API --> DOM[packages/domain<br/>RBAC / Persona / PII / 合规]
    API --> BILL[packages/billing<br/>Wallet / Ledger / 月限额 / 微信支付]
    API --> AI[packages/ai<br/>Router / Tasks / Prompts / Audit]
    API --> ANA[packages/analytics<br/>掌握度 / 班级诊断]
    API --> DB[(PostgreSQL 16<br/>+ pgvector)]
    API --> RDS[(Redis 7)]
    AI -->|DashScope 或 Mock| LLM[通义千问]
    BILL -->|微信支付 v3 或 Mock| WX[微信支付]
    AUTH -->|阿里云短信或 Mock| SMS[短信]
    API -->|OSS 或 Mock| OSS[对象存储]
```

设计要点：

- **mock / real 双适配**：AI、短信、微信 OAuth、微信支付、OSS 都有 mock 实现，本地开发零外部凭据即可跑通；生产用环境变量切换真实适配器。
- **AI 调用统一出口**：`packages/ai` 的 router 负责选模型、加载 prompt、校验输出 schema、写审计记录；业务代码不直接调 SDK。
- **计费在 resolver 之前**：新接口统一使用 `.input(...) → requireTeacherPersona → requireGuardianConsent → chargeMiddleware(...) → resolver` 顺序，权限/入参校验在扣费之前，失败会发生补偿（DEBIT + COMPENSATION 配对）。
- **合规内建**：RBAC、黑词扫描、PII 扫描/脱敏、监护人同意、DSAR 都是普适中间件/领域函数，而不是某个页面里的补丁。

## 5. 目录结构

```text
zhijiao/
├─ apps/
│  └─ web/                          # Next.js 应用（页面 + tRPC 服务端）
│     ├─ app/                       # App Router 路由：学生端、教师端、家长端、auth、API
│     │  ├─ (student)/              # 学生闭环：tutor / error-book / training / portrait / wallet / family-link
│     │  ├─ teacher/                # 教师端：classes / assignments / papers / coursewares
│     │  ├─ parent/                 # 家长端：子女列表 / 简版画像
│     │  ├─ (auth)/                 # 登录、注册、OTP、微信 OAuth 回调
│     │  └─ api/                    # tRPC、上传、微信支付回调、E2E hooks、readiness
│     ├─ server/                    # tRPC router、中间件、权限校验、服务层
│     ├─ tests/                     # Vitest 单测/集成 + Playwright E2E
│     └─ scripts/                   # 运维脚本（对账、注销、导出、PII 清理、DSAR、demo）
├─ packages/
│  ├─ ai/                           # AI router、DashScope/Mock 适配、任务、schema、prompt、审计
│  ├─ analytics/                    # 纯函数掌握度聚合 + Prisma 查询 + 缓存
│  ├─ auth/                         # JWT、Session、OTP、注册 payload、微信 state、限流
│  ├─ billing/                      # 钱包、学分账本、定价、月限额、微信支付通知、清理任务
│  ├─ db/                           # Prisma client、schema、migration、seed
│  ├─ domain/                       # RBAC、persona、PII、合规、年级
│  └─ integrations/                 # 短信 / OSS / 微信 OAuth / 微信支付（mock + real）
├─ docs/
│  ├─ claude/                       # 实现现状、合并验证
│  ├─ ops/                          # 生产部署、上线检查、备份恢复、PII 调度、启动阻塞项
│  ├─ product/                      # 产品方向锚点
│  └─ superpowers/{specs,plans}/    # 各 Plan 的设计与实施计划
├─ docker/                          # Postgres 初始化脚本
├─ .github/workflows/ci.yml         # CI：typecheck / test / E2E / Docker build
├─ docker-compose.yml               # 本地 Postgres + Redis
├─ docker-compose.prod.yml          # 生产编排（web / migrate / postgres / redis）
├─ Dockerfile                       # 多阶段：deps → builder → migrator → runner（Node 22 standalone）
├─ .env.example / .env.production.example
├─ CLAUDE.md                        # AI 编码助手工作指引
└─ 需求与架构文档.md                 # 需求与架构（docx 为历史快照）
```

## 6. 快速开始

### 前置依赖

- **Node.js 20+**（推荐 LTS）
- **pnpm 9+**（`npm i -g pnpm` 或 `corepack enable`）
- **Docker Desktop**（Postgres 16 + pgvector、Redis 7）

### 一键启动

```bash
git clone <repo-url> zhijiao
cd zhijiao
pnpm setup     # 复制 .env.example → .env.local + docker compose up -d + install + migrate + seed + 测试库
pnpm dev       # 启动 apps/web（http://localhost:3000）
```

`pnpm setup` 依次执行：

1. `cp .env.example .env.local`；
2. `docker compose up -d`（启动 `zhijiao-postgres`、`zhijiao-redis`）；
3. `pnpm install`；
4. `pnpm db:migrate`（16 个 migration）；
5. `pnpm db:seed`（创建测试账号与演示数据）；
6. `pnpm test:setup`（准备测试数据库）。

默认 `AI_USE_MOCK=false` 但 `DASHSCOPE_API_KEY` 是占位符——**没配真实 Key 时请在 `.env.local` 里把 AI 切到 mock**：`AI_USE_MOCK=true`。短信、微信 OAuth、微信支付、OSS 默认都是 mock，无需额外凭据。

### 本地访问

- Web：http://localhost:3000
- Demo 中心：http://localhost:3000/demo（需 `DEMO_MODE=1`）
- 健康检查：http://localhost:3000/readiness
- Prisma Studio：`pnpm db:studio`

## 7. 环境变量

关键配置（完整见 `.env.example` / `.env.production.example`）：

| 分组 | 变量 | 说明 |
| --- | --- | --- |
| 数据库 | `DATABASE_URL` / `DATABASE_URL_TEST` | Postgres 连接串（本地默认 `postgresql://postgres:postgres@localhost:5432/zhijiao`） |
| 缓存 | `REDIS_URL` | 限流、OTP nonce、注册 payload、微信 state |
| AI | `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL` / `AI_USE_MOCK` | DashScope 凭据与 mock 开关 |
| 鉴权 | `ACCESS_JWT_SECRET` / `OTP_PEPPER` | JWT 签名密钥、OTP 哈希 pepper（生产必须换） |
| 短信 | `ALIYUN_SMS_ACCESS_KEY_ID` / `_SECRET` / `SIGN_NAME` / `TEMPLATE_CODE` / `SMS_USE_MOCK` | 阿里云短信，dev 默认 mock |
| 微信登录 | `WECHAT_H5_APPID` / `WECHAT_H5_SECRET` / `WECHAT_OAUTH_USE_MOCK` | 微信 H5 OAuth |
| 微信支付 | `WECHAT_PAY_USE_MOCK` / `WECHAT_PAY_APPID` / `WECHAT_PAY_MCHID` / `WECHAT_PAY_API_V3_KEY` / `WECHAT_PAY_PRIVATE_KEY` / `WECHAT_PAY_CERT_SERIAL` / `WECHAT_PAY_PUB_KEY_FILE` / `WECHAT_PAY_NOTIFY_HOST` | v3 支付凭据；mock 模式只需 `MOCK_WECHAT_PAY_SECRET` |
| 存储 | `STORAGE_USE_MOCK` / `ALIYUN_OSS_*` | OSS 桶与凭据 |
| 计费 | `CREDIT_PER_YUAN` / `MINOR_MONTHLY_LIMIT_YUAN` | 人民币→学分换算、未成年人月限额 |
| 应用 | `NEXT_PUBLIC_APP_URL` / `DEMO_MODE` / `E2E_TEST_HOOKS` / `LOG_LEVEL` | 前端 URL、Demo 开关、E2E hooks（生产必须关） |

> ⚠️ 生产环境必须：更换 `ACCESS_JWT_SECRET` / `OTP_PEPPER`、关闭所有 `*_USE_MOCK`、关闭 `DEMO_MODE` 与 `E2E_TEST_HOOKS`、使用真实 OSS / 微信支付 / 短信凭据。

## 8. 测试账号

`pnpm db:seed` 会创建以下账号（手机号登录，dev 环境 OTP 可在控制台/日志看到）：

| 角色 | userId | 手机号 |
| --- | --- | --- |
| 学生 | `dev-student-01` | 13800000001 |
| 教师 | `dev-teacher-01` | 13800000002 |
| 家长 | `dev-parent-01` | 13800000003 |
| 运营 | `dev-ops-01` | 13800000004 |
| 管理员 | `dev-admin-01` | 13800000005 |

E2E 还使用 `dev-student-03/04`、`dev-parent-02` 等隔离账号，避免并行 worker 抢同一手机号的 OTP。

## 9. 常用脚本

```bash
pnpm dev                          # turbo dev，启动所有 app
pnpm build                        # turbo build
pnpm lint                         # turbo lint
pnpm typecheck                    # 全量 TS 检查
pnpm test                         # 全量单测 + 集成（Vitest）
pnpm test:e2e                     # 全量 E2E（Playwright，会先 next build）
pnpm --filter @zhijiao/web test:e2e   # 只跑 web E2E

pnpm db:migrate                   # 应用新 migration
pnpm db:seed                      # 重新 seed
pnpm db:studio                    # Prisma Studio
pnpm test:setup                   # 准备测试数据库

pnpm demo:reset                   # 重置 Demo 数据（需要 DEMO_MODE=1）
pnpm verify:demo                  # 校验 Demo 数据状态
```

Web 包内还有运维脚本：`kp:reconcile-pending`、`kp:review`、`user:deactivate`、`user:export`、`pii:gc-sweep`、`dsar:list/fulfill/reject`。

## 10. 数据模型

Prisma schema 共 39 个 model（`packages/db/prisma/schema.prisma`，886 行），按领域分：

| 领域 | 主要 model |
| --- | --- |
| 身份与权限 | `User`、`UserRole`、`AuthIdentity`、`Session`、`OtpRequest`、`OpsActionLog` |
| 课程与题库 | `Subject`、`KnowledgePoint`、`Question`、`QuestionAnswer`、`QuestionKPLink`、`KpAlias`、`KpReconcileMatch` |
| 出卷 / 课件 | `Paper`、`PaperItem`、`Courseware`、`CoursewareSection` |
| 班级与作业 | `Classroom`、`ClassroomMember`、`Assignment`、`AssignmentTier`、`AssignmentItem`、`StudentAssignment`、`AssignmentAnswer`、`AssignmentPerformance` |
| 错题与训练 | `ErrorBookEntry`、`VariantGroup`、`VariantItem`、`TrainingAttempt` |
| 计费与支付 | `Wallet`、`CreditLedger`、`TopupOrder`、`WechatPayEvent` |
| AI 审计 | `PromptTemplate`、`ModelCall` |
| 合规与家庭 | `GuardianConsent`、`FamilyLink`、`DsarRequest` |

数据库启用 **pgvector** 扩展，为后续知识点 / 题目语义检索与去重预留能力。

## 11. AI 层设计

`packages/ai` 是唯一允许调用大模型的地方：

```text
packages/ai/src/
├─ router.ts        # 任务 → 模型路由、调用、schema 校验、审计
├─ registry.ts      # taskKind 注册表
├─ tasks.ts         # TASK_MODEL_MAP（如 PAPER_GEN、LESSON_PLAN_GEN → qwen-max）
├─ schemas.ts       # 各任务输出 Zod schema
├─ audit.ts         # ModelCall / PromptTemplate 审计
├─ adapters/
│  ├─ dashscope.ts  # 真实适配（OpenAI 兼容接口）
│  ├─ mock.ts       # 本地 mock，按关键词返回固定结果
│  └─ types.ts
└─ prompts/         # 版本化 prompt（每任务一个目录，v1.md）
```

已注册的 9 个任务 prompt：

| prompt | 用途 |
| --- | --- |
| `tutoring/v1.md` | 学生答疑 |
| `tutoring-image/v1.md` | 图片答疑（OCR + 讲解） |
| `assignment-question-gen/v1.md` | 分层作业出题 |
| `paper-gen/v1.md` | AI 出卷（题库补缺） |
| `lesson-plan-gen/v1.md` | 五段式课件生成 |
| `variant-generation/v1.md` | 举一反三变式题 |
| `error-analysis/v1.md` | 错因分析 |
| `learning-advice/v1.md` | 学习建议（付费） |
| `kp-reconciliation/v1.md` | 知识点别名归并对账 |

设计约束：

- **结构化输出**：每个任务有明确的 Zod schema，AI 返回不合法会失败/重试，而不是把脏数据写库；
- **固定扣费**：`PAPER_GEN` 5 credits、`LESSON_PLAN_GEN` 3 credits，任务失败走补偿；
- **合规扫描**：prompt 输出会过合规黑词扫描（不承诺提分、不制造焦虑等），命中则拒绝落库；
- **mock 可跑**：本地/CI 无 API Key 也能跑通全流程（`AI_USE_MOCK=true`）。

## 12. 认证、权限与合规

### 认证

- 手机号 OTP 登录（阿里云短信 / mock），OTP 使用 `OTP_PEPPER` 哈希存储；
- 微信 H5 OAuth 登录（mock / real），state 存 Redis 防 CSRF；
- HS256 JWT access token（`jose`）+ 服务端 Session（支持撤销原因）；
- 限流基于 Redis（生产）/ 内存（测试），规则在 `packages/auth/ratelimit/rules.ts`。

### 权限

- `packages/domain/rbac.ts`：角色 → 权限映射；
- `packages/domain/persona.ts`：学生 / 教师 / 家长 / 运营 / 管理员 persona 判定；
- 资源级所有权校验（paper / courseware / error-book entry / question access），跨用户访问统一返回 `NOT_FOUND` 以避免存在性侧信道。

### 合规（K12 场景重点）

- **未成年人保护**：注册/使用前需监护人同意（`GuardianConsent`）；未成年人钱包有月度消费上限（`MINOR_MONTHLY_LIMIT_YUAN`）；
- **PII 治理**：`packages/domain/pii.ts` 负责敏感字段扫描与脱敏；日志与导出走白名单；`pii:gc-sweep` 定期清理；
- **DSAR**：数据主体请求工单（`DsarRequest`），支持列出 / 受理 / 拒绝；
- **注销**：`user:deactivate` 事务清理关联数据；
- **合规黑词**：AI 输出与用户输入都会过 `compliance.ts` 的黑词扫描。

## 13. 计费与支付

- **学分制**：`Wallet` 余额 + `CreditLedger` 账本（DEBIT / CREDIT / COMPENSATION 等），所有扣费可追溯；
- **定价**：`packages/billing/pricing.ts` 维护任务价格；`CREDIT_PER_YUAN` 控制人民币兑换比例；
- **充值**：`TopupOrder` + 微信支付 v3（`packages/integrations/wechat-pay`），回调验签、事件去重、证书轮换；
- **失败补偿**：AI 任务失败或参数不匹配时写 COMPENSATION，净额为 0；
- **对账脚本**：`kp:reconcile-pending`、`kp:review` 处理挂起/异常订单；
- **mock 模式**：`WECHAT_PAY_USE_MOCK=true` 时用 `MOCK_WECHAT_PAY_SECRET` 模拟支付回调，本地可完整走充值流程。

## 14. 质量保障

| 项目 | 内容 |
| --- | --- |
| 单元 / 集成测试 | **184 个测试文件**（Vitest），覆盖 auth、billing、ai router、各业务 router、合规、PII、DSAR |
| E2E | **19 个 Playwright spec**：登录、答疑、错题本、训练、画像、家庭绑定、监护人同意、钱包充值、教师作业/出卷/课件、DSAR、Demo 验收等 |
| 类型检查 | `pnpm typecheck`（turbo，全仓库 tsc） |
| Lint | `pnpm lint`（turbo + Next ESLint） |
| CI | GitHub Actions：起 Postgres/Redis → 安装 → Prisma generate → 测试库 → typecheck → test → E2E → Docker build（web + migrator） |
| 测试基建 | `pnpm test:setup` 用 `migrate deploy` 准备测试库；E2E hooks 仅在 `E2E_TEST_HOOKS=1` 时开启 |

CI 关键实现细节（避免踩坑）：

- Windows 下 `.cmd` 用 `execSync + PNPM_BIN` 启动；
- `pnpm/action-setup` 必须早于 `setup-node` 的 `cache: pnpm`；
- 全新安装后必须显式 `pnpm --filter @zhijiao/db db:generate`，否则依赖 Prisma 类型的包 typecheck 失败；
- Playwright 失败时上传 `test-results` 与 `playwright-report`。

## 15. 部署

### 本地 Docker（开发）

```bash
docker compose up -d    # postgres: pgvector/pgvector:pg16 + redis:7-alpine
```

### 生产编排（骨架已就绪）

```bash
# 1) 准备生产环境变量
cp .env.production.example .env.production
# 2) 构建镜像（Node 22 多阶段：deps → builder → runner standalone）
docker compose --env-file .env.production -f docker-compose.prod.yml build
# 3) 跑 migration（migrate profile，独立容器）
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate run --rm migrate
# 4) 启动 web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web
```

生产编排包含：`web`（Next standalone，仅暴露 3000）、`migrate`（prisma migrate deploy）、`postgres`、`redis`（均只在内部网络，带 healthcheck / 持久卷）。

- 健康检查：`GET /readiness` 检查 DB `SELECT 1` + Redis `PING`；
- Docker 镜像基于 `node:22-bookworm-slim`，runner 阶段安装 `openssl`（Prisma 引擎依赖）；
- 部署文档：`docs/ops/production-deploy.md`、上线检查：`docs/ops/launch-readiness-report.md`、备份恢复：`docs/ops/backup-restore-rehearsal.md`。

## 16. 文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/claude/implementation-state.md` | 各 Plan 落地后的承重实现知识（最权威的实现现状） |
| `docs/product/product-direction.md` | 2026-06-04 后的产品方向锚点 |
| `docs/ops/production-deploy.md` | 生产部署步骤 |
| `docs/ops/launch-readiness-report.md` | 上线准备验收报告（Docker dry run、E2E、migration） |
| `docs/ops/public-launch-blockers.md` | 公网发布阻塞项 |
| `docs/ops/backup-restore-rehearsal.md` | 备份恢复演练 |
| `docs/ops/pii-scheduling.md` | PII 清理调度 |
| `docs/superpowers/specs/` | 各 Plan 的设计 spec（技术方案与取舍） |
| `docs/superpowers/plans/` | 各 Plan 的实施计划（约 30 份） |
| `需求与架构文档.md` | 需求与架构总览（docx 为历史快照） |
| `CLAUDE.md` / `AGENTS.md` | AI 编码助手工作指引 |

## 17. 已知限制与上线阻塞

### 产品与工程

- **公网生产未上线**：ICP 备案、域名/证书、真实短信、微信 OAuth、微信支付商户号与 APIv3 证书、OSS bucket/CDN、生产 secrets 注入与备份策略仍需单独推进；当前 production skeleton 是可演练的部署骨架。
- **学生端进入维护态**：不再扩展新能力，只保证稳定、合规与支撑教师工具。
- **题库覆盖有限**：出卷的题库复用是 best-effort，缺口由 AI 生成，题库规模决定成本与质量下限。
- **班级 roster 管理 UI 未做**：目前主要依赖 seed 测试班级，真实学校的班级/学生导入流程尚未产品化。
- **没有真实学校试点数据**：AI 生成质量、教师改稿率、打印排版等仍需真实场景验证。
- **仓库未附带 LICENSE**：默认保留所有权利；商业使用前需明确授权。

### Windows 环境已知问题

- **中文目录名**：本仓库目录名含中文时，`docker-compose.yml` 顶层需要 `name: zhijiao`（已包含）；
- **Postgres 端口冲突**：如果本机跑着 PostgreSQL Windows 服务（`postgresql-x64-16`），会占用 5432 导致 Docker 容器连不上，停掉该服务即可；
- **Prisma migrate 失败（P1000）**：Windows 下 `schema-engine-windows.exe` 可能被 AV/防火墙阻断；绕过方式是 `prisma migrate diff` 生成 SQL 后用 `docker exec psql` 应用（CI/Linux 无此问题）。

## 18. 许可

本仓库未附带 LICENSE 文件，默认保留所有权利（proprietary）。代码、文档与产品设计仅供学习与内部使用；如需商用或二次分发，请先获得作者授权。

第三方依赖遵循各自许可证（Next.js MIT、Prisma Apache-2.0、tRPC MIT、Tailwind MIT 等）；阿里云 DashScope、阿里云短信/OSS、微信支付遵循其平台服务条款。
