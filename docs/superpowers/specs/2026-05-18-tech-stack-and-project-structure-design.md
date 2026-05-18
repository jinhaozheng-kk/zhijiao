---
title: 智教 — 技术栈与项目结构设计 (Spec)
date: 2026-05-18
status: approved
scope: tech-stack-and-project-structure
audience: 实施者（Claude Code）、用户（产品/架构审核者）
source: 来自 brainstorming session（C:\Users\17798\.claude\plans\lively-gathering-hummingbird.md）
---

# 智教 · 技术栈与项目结构设计

## 0. 文档信息

**目标**：把规划阶段的需求与架构文档（`AI教育网站需求与架构文档_中国K12市场_2026-05-18.docx`）转化为一组可落地的技术与结构决策，作为后续 implementation plan 的输入。

**范围**：
- ✅ 包含：技术栈选型、仓库布局、数据模型分组、AI 编排骨架、鉴权与权限、外部集成、Credit 计费体系、本地开发流、生产部署架构、ICP 备案路径、CI/CD、测试与评测策略、明确不做的边界
- ❌ 不包含：具体功能的页面 UI 设计、prompt 文本初稿、详细 API 接口签名、知识图谱具体填充内容（这些属于后续 spec 或 implementation plan 范畴）

**前置依赖**：
- 需求与架构文档（中文版：`需求与架构文档.md`，原始 docx 为唯一真源）
- CLAUDE.md（项目方向与合规约束概览）
- 架构图（`mermaid-diagram.png`）

---

## 1. 决策摘要

### 1.1 brainstorming 锁定的决策

| 议题 | 结论 | 关键影响 |
|---|---|---|
| **谁写代码** | Claude Code 写，用户做产品/架构层审核与改需求 | 优先 TypeScript-first、主流框架、文档密集生态；避开冷门技术 |
| **部署区域** | 国内面向 K12 用户，必须 ICP 备案 | 阿里云为主、国产 LLM（通义千问主+DeepSeek 备）、微信生态强制集成、ICP 备案 2-4 周关键路径 |
| **前端端形态** | 先 Web/H5 走 MVP，小程序作为 Phase 2/3 补 | API 一开始按 BFF-friendly 设计（REST + JWT/token、无 session cookie） |
| **节奏与质量** | 2-3 个月走通核心闭环，质量优先 | AI 编排层认真建（prompt 版本位、模型路由、评测框架 day 1 留位）；知识图谱 schema 一次定到位 |
| **选用方案** | **方案 A：Next.js 全栈 monorepo + 阿里云 + 通义千问** | 见 §1.2 |
| **计费模型** | **Credit 点数制 + 充值/订阅补点**（替换原 freemium 设计） | 与 LLM 调用成本直接挂钩，付费意愿与价值感强 |

### 1.2 方案 A 概要

- **前端**：Next.js 14 (App Router) + Tailwind + shadcn/ui，单一 `apps/web` 应用，用 Route Groups 物理隔离四中心
- **后端 + RPC**：Next.js Route Handlers + tRPC（同 process，无独立后端服务）
- **运营后台**：独立 Next.js 应用 `apps/admin`，权限模型、UI、上线节奏与用户端解耦
- **数据库**：阿里云 RDS PostgreSQL（含 pgvector 扩展用于向量检索）
- **缓存与队列**：阿里云 Tair (Redis 协议兼容) + BullMQ 作 background jobs
- **对象存储**：阿里云 OSS；本地开发用 MinIO 模拟
- **LLM**：通义千问（DashScope）主，DeepSeek 备；OCR 用阿里云通用文字识别
- **包管理 + monorepo**：pnpm workspaces + Turborepo
- **类型 + ORM**：TypeScript 全栈 + Prisma
- **结构化输出校验**：Zod
- **测试**：Vitest + Playwright + 自建 LLM eval harness（**不引入 LangChain**，自建薄编排层）
- **CI/CD**：阿里云云效（Yunxiao）+ 阿里云 ACR
- **生产**：早期 ECS x 4（web×2 + admin×1 + worker×1）+ RDS + Tair + OSS + SLB；月活破 1 万再迁 ACK

---

## 2. 仓库布局

### 2.1 目录树

```
D:\智教\
├── .git/                                # 待 git init
├── .gitignore
├── CLAUDE.md                            # 已存在；后续会更新「开始实现时」一节
├── 需求与架构文档.md                       # docx 自动转换的 markdown 视图
├── AI教育网站需求与架构文档_中国K12市场_2026-05-18.docx
├── mermaid-diagram.png                  # 业务架构图
│
├── docs/
│   ├── superpowers/specs/               # 本 spec 落点
│   └── adr/                             # 后续架构决策记录（ADR），按需建
│
├── pnpm-workspace.yaml
├── package.json                         # workspace 入口 + 顶层脚本
├── turbo.json                           # Turborepo 任务编排
├── tsconfig.base.json                   # 共享 TS 配置
├── .env.example                         # 所有 apps/packages 的 env 范本
├── docker-compose.yml                   # 本地 Postgres + Redis + MinIO
│
├── apps/
│   ├── web/                             # 唯一面向用户的 Next.js 应用
│   │   ├── app/                         # App Router
│   │   │   ├── (marketing)/             # 官网（首页、定价、关于、内容专题）
│   │   │   ├── (student)/               # 学生学习中心：答疑、举一反三、错题本、训练、学情
│   │   │   ├── (teacher)/               # 教师教学中心：一键出卷、试卷库、分层作业
│   │   │   ├── (forecast)/              # 命题趋势预测专题页
│   │   │   ├── (auth)/                  # 登录/注册/绑定微信
│   │   │   └── api/                     # Route Handlers（webhook、BFF endpoint、tRPC 入口）
│   │   ├── server/                      # tRPC routers（按四中心拆 router）
│   │   ├── components/                  # 应用专属组件（跨 app 复用的进 packages/ui）
│   │   └── ...
│   └── admin/                           # 运营后台（独立鉴权域、独立部署）
│                                        # 内容审核、预测报告发布、模型版本管理、credit 单价、用户管理
│
└── packages/
    ├── db/                              # Prisma schema + migrations + 类型导出
    ├── ai/                              # AI 编排层（router / prompt registry / RAG / OCR / eval）
    ├── domain/                          # 领域类型 + 常量：KP schema、错因枚举、合规黑词表、RBAC、credit 单价初稿
    ├── ui/                              # 共享 React 组件（shadcn/ui 风格，web 与 admin 复用）
    ├── integrations/                    # 阿里云 / 微信 / 支付宝 / SMS 等外部 SDK 封装
    ├── config/                          # 共享 eslint / prettier / tsconfig / tailwind preset
    └── testing/                         # 测试工具（fixtures、test DB helper、LLM mock、credit helper）
```

### 2.2 关键边界决策与理由

- **`apps/web` 单仓 vs 拆 student/teacher/marketing 三个 app**：单仓更适合早期；路由分组用 Next.js Route Groups `(student)` `(teacher)` `(marketing)` `(forecast)` 实现物理隔离。未来若任一端拆走，成本可控（约 1 天）。
- **`apps/admin` 独立 app**：运营/管理员的权限模型、UI 复杂度、上线节奏与用户端完全不同；从一开始就分开避免后期切割带来的耦合债务。
- **`packages/ai` 独立成包**：spec 明确把 AI 编排作为独立层；从代码结构强制这个边界；后期换 LLM 提供商或新增 evaluator 都改这一个包。
- **`packages/domain` 是合规与领域知识的家**：合规黑词表、错因枚举、RBAC 角色、知识点 schema、credit 单价初稿全在这里，导出给 web/admin/ai 共用——避免合规规则散落到各处。
- **不引入独立 `apps/api` 后端服务**：tRPC 跑在 Next.js 同 process，避免了 RPC 跨网络的延迟、序列化成本和契约维护。后期若 ai-worker 或定时任务量大再考虑拆 Python 旁挂。
- **`packages/integrations` 不再细拆**：把 aliyun/wechat/alipay 都收在一个包内部分子目录，避免早期过度切包；当某个子目录变重（如微信支付逻辑超 2k 行）再独立。

---

## 3. 数据模型 + AI 编排层

### 3.1 Prisma 数据模型分组

按职责分组，单一 `schema.prisma` 内部用 `// === 模块 ===` 注释 + 表名前缀划分。

| 模块 | 关键表 | 备注 |
|---|---|---|
| **Identity & RBAC** | `User`（phone, wechat_openid, wechat_unionid, email?, password_hash?）、`UserRole`、`ParentChildLink`、`Session` | 多角色支持（家长+学生绑定常见） |
| **Curriculum** | `Subject`、`CurriculumVersion`（人教版/北师大版/...）、`Chapter`（章节树）、`KnowledgePoint`（KP 树 + 难度）、`Ability`（计算/推理/建模/迁移）、`ErrorType`（错因枚举入库）、`KPRelation` | 课标骨架 |
| **Question Bank** | `Question`（stem_md, stem_image_keys, type, difficulty, status）、`QuestionOption`、`QuestionAnswer`（含 solution_md）、`QuestionKPLink`、`QuestionAbilityLink`、`QuestionEmbedding`（pgvector）、`VariantGroup` + `QuestionVariant`（L1/L2/L3） | 题库 |
| **Learning Records** | `Conversation`、`Message`（含 tokens / latency / model_version）、`Attempt`、`ErrorBookEntry`（含 next_review_at 间隔复习）、`TrainingPack` + `TrainingPackItem` | 学生行为 |
| **Teacher Artifacts** | `Paper`、`PaperConfig`（出卷参数 JSON）、`PaperQuestion`、`PaperExport` | 教师产出 |
| **Forecast Center** | `ForecastReport`（带 version）、`HeatMap`（按 KP 打热度）、`ForecastPaper`、`PostExamReview`（考后对账） | 预测中心 |
| **Content & Ops** | `ContentArticle`、`OperationLog` | 内容增长 + 运营/管理员行为审计 |
| **AI Audit & Eval** | `PromptTemplate`（版本位）、`ModelCall`（全量调用日志）、`EvalCase`、`EvalRun` | AI 编排可追溯 + 评测 |
| **Billing & Credit** | `CreditAccount`、`CreditTransaction`（全量流水）、`CreditPrice`（版本化单价）、`SubscriptionPlan`、`Subscription`、`RecurringAuth`、`CreditReservation`、`Order` | 见 §4.4 |

### 3.2 关键 schema 决策

- **`ErrorType` 入库而不是 enum**：错因分类会演化（spec 初列 5 类，实际会细化到 20+），硬编码 enum 改动成本高
- **`QuestionEmbedding` 单独表 + `model_version` 字段**：换 embedding 模型时需要并存两版数据做迁移期间的双写双读
- **`ModelCall` 同步写入**：spec 明确「可追溯日志」要求，**不要** fire-and-forget；用事务保证一致性。日质量级 TB 级再考虑分表归档
- **`stem_md` + `stem_image_keys[]`** 分离：题干文本走 Postgres，图片走 OSS key 引用，**绝不**在 DB 存 base64
- **`Conversation.context_kind`** 区分会话来源（答疑、错题分析、变式互动），方便上下文复用与限流分类

### 3.3 `packages/ai` 编排层结构

```
packages/ai/src/
├── router.ts          # callModel({ task, messages, opts }) 单入口
├── tasks.ts           # TaskKind 枚举与默认路由配置
├── adapters/
│   ├── dashscope.ts   # 通义千问（主，同 VPC 低延迟）
│   ├── deepseek.ts    # DeepSeek（fallback，性价比高）
│   └── aliyun-ocr.ts  # 阿里云 OCR
├── prompts/           # 文件化、git 版本化
│   ├── tutoring/v1.md
│   ├── variant-gen/v1.md
│   ├── error-diagnosis/v1.md
│   ├── paper-gen/v1.md
│   └── forecast/v1.md
├── registry.ts        # 加载 prompts + 指纹化 + 懒同步到 PromptTemplate 表
├── schemas.ts         # Zod schemas 描述每个 task 的预期输出
├── rag.ts             # retrieveSimilarQuestions / retrieveKPContext
├── eval/              # 评测用例 + harness（每类 task 50+ 用例，周跑）
└── workers/           # BullMQ 后台任务（embedding、变式批跑、预测报告编译）
```

### 3.4 编排层核心模式

- **单入口 `callModel`**：所有 LLM 调用必须经过；同步写 `ModelCall`；自动 retry-on-JSON-parse-fail（最多 2 次）
- **Prompt 文件化 + 数据库懒同步**：审计需求由数据库满足，开发体验由文件版本控制满足
- **Zod 校验所有结构化输出**：避免 LLM 漂移直接污染下游
- **不引入 LangChain/LlamaIndex**：原因——其抽象层与 spec 的细粒度可观测/可路由要求经常冲突；Claude 写原生 SDK 调用更稳；自建薄封装代码量可控（< 2k 行）

### 3.5 合规强制点（编译时 + 运行时）

- `packages/domain/compliance.ts` 导出：
  - `FORBIDDEN_PHRASES`（押中原题、保证提分、100% 命中等）
  - `FORECAST_LANGUAGE_RULES`（许可表述 vs 禁止表述）
  - `MINOR_CONTENT_DEFAULTS`（适龄默认值）
  - `MARKETING_LINT_RULES`
- Prompt 模板用 partial 引入合规规则文本，规则改动自动传播
- `ForecastReport` / `ContentArticle` pre-publish hook 跑黑词 lint
- 答疑响应流末加一道 post-filter 校验

---

## 4. 鉴权、RBAC、外部集成、Credit 体系

### 4.1 多入口登录

| 入口 | 方式 | 备注 |
|---|---|---|
| H5（微信内打开） | 公众号网页授权（snsapi_userinfo） | 拿 openid + 昵称头像，自动创建/匹配 User |
| H5（任意浏览器）/ PC | 手机号 + 短信验证码 | 短信走阿里云 SMS |
| PC | 微信开放平台扫码 | 拿 unionid，与同一 User 关联 |
| 全端 | 账户内绑定多种方式 | 同一 User 关联多 identity |

### 4.2 Token 策略

- Access token（JWT, 15 min）+ Refresh token（30 d, **每次使用轮换**）
- Web 端：access token 走 `httpOnly` cookie + CSRF token；refresh 走同样 cookie 路径
- 移动端/小程序（未来）：两 token 都走 `Authorization: Bearer ...` header
- 后端同时接受两种来源（中间件统一抽取）
- Refresh token 的 hash + device fingerprint + 最后使用时间存 `Session` 表；可在「设备管理」页一键踢登

### 4.3 RBAC

**角色 → 权限映射，固化在代码中**（不放 DB，避免运行时被改）：

```ts
// packages/domain/rbac.ts
export type Role = 'STUDENT' | 'TEACHER' | 'PARENT' | 'OPS' | 'ADMIN'
export type Permission = 'STUDENT_ASK' | 'TEACHER_GEN_PAPER' | 'OPS_PUBLISH_FORECAST' | ...
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = { ... }
```

**tRPC 中间件**：
- `publicProcedure` — 任何人可访问
- `authedProcedure(role?)` — 必须登录 + 可选角色检查
- `permissionProcedure(perm)` — 检查权限位
- `creditedProcedure(actionKind)` — 包裹 reserve → 执行 → commit/release

**家长权限的特殊处理**：
- `ParentChildLink` 限定家长仅能看绑定子女
- 家长所有查询强制 join `ParentChildLink` 并校验 `parent_user_id = current_user.id`
- 放在 `packages/domain/access-control.ts` 提供 `scopedToChildren(parentId): Prisma.WhereInput` 复用工具

### 4.4 Credit 计费体系

**核心数据表**：

| 表 | 字段要点 |
|---|---|
| `CreditAccount` | user_id (PK), balance, lifetime_purchased, lifetime_consumed, lifetime_bonus, version (乐观锁) |
| `CreditTransaction` | id, user_id, type, amount(正/负), reason, related_kind, related_id, created_at, balance_after — **全量流水审计** |
| `CreditPrice` | id, action_kind, points_cost, version, effective_from — **版本化价目表** |
| `SubscriptionPlan` | id, name, monthly_credits, monthly_price_cny, perks_json, status |
| `Subscription` | user_id, plan_id, status, current_period_start/end, auto_renew, payment_method |
| `RecurringAuth` | user_id, provider, agreement_id, status — 微信/支付宝自动扣费协议 |
| `CreditReservation` | id, user_id, action_kind, points, status, created_at, expires_at — **预扣表**，防超扣 |
| `Order` | 充值/订阅订单，PENDING/PAID/REFUNDED |

**`CreditTransaction.type` 枚举**：`PURCHASE` / `SUBSCRIPTION_REFILL` / `CONSUME` / `REFUND` / `BONUS` / `EXPIRATION` / `ADMIN_ADJUST`

**`action_kind` 单价初稿**（运营后台可改，每改一次新建 version）：

| Action | 初稿点数 | 说明 |
|---|---|---|
| `TUTOR_TURN` | 1 | 答疑一轮（含 OCR + LLM） |
| `ERROR_DIAGNOSIS` | 1 | 错因分析 |
| `VARIANT_L1_GEN` | 0 | 同结构变式（基础体验免点，留住） |
| `VARIANT_L2_GEN` | 2 | 改条件/形式变式 |
| `VARIANT_L3_GEN` | 3 | 跨题型迁移变式 |
| `PAPER_GEN` | 5 | 一键出卷（按题量浮动可改） |
| `FORECAST_PAPER_GEN` | 10 | 预测卷生成 |
| `FORECAST_REPORT_VIEW` | 0 | 报告本身免费引流；下载 PDF 收点 |

**点数获取路径**：注册赠 30 点（一次性）/ 邀请双方各 20 点 / 错题反馈等数据回流奖励 / 充值套餐（¥9.9=100 / ¥29=300 / ¥99=1200）/ 月订阅（¥19/月 含 300 点 + L1 变式不计点；¥39/月 含 800 点 + 错题本高级复习）

**扣点流程**（保证不超扣 + 失败回滚）：

```ts
// packages/ai/router.ts 内
async function callModel({ task, ... }) {
  const reservation = await reserveCredits(userId, task)   // 行锁 + balance -= cost
  try {
    const result = await adapter.call(...)
    await commitCredits(reservation.id)                     // CONSUME 流水落地
    return result
  } catch (e) {
    await releaseCredits(reservation.id)                    // balance += cost，REFUND 流水
    throw e
  }
}
```

- 预扣 5 分钟超时，cron 自动 release 过期未 commit 的
- 余额不足抛 `InsufficientCreditsError`，前端弹「订阅或充值」CTA
- 价目表版本化：调用时锁定当时单价，后续运营调价不影响历史账

**订阅自动补点**：
- 每日 cron 检查 `Subscription.current_period_end <= today`，触发 renewal
- 成功 → 充入 `monthly_credits` 写 `SUBSCRIPTION_REFILL` 流水 + 滚动周期
- 失败 → 进入 7 天 `GRACE_PERIOD`（保留权限不补点）；过期后状态变 `EXPIRED`，仍可消费已有余额

**合规与运营**：
- 充值消费记录前端可查（《我的钱包》）
- 充值发票：接入阿里云电子发票
- 未成年人单笔 ≤ ¥50 / 月度 ≤ ¥200（参考游戏防沉迷数额，按学段调整）
- 退款政策：未消费点数原路退回，已消费部分不退；客服通道在运营后台触发 `ADMIN_ADJUST`

### 4.5 外部集成包结构

```
packages/integrations/src/
├── aliyun/
│   ├── oss.ts          # 文件上传、预签名 URL、删除
│   ├── dashscope.ts    # 通义千问 SDK 客户端（被 packages/ai 引用）
│   ├── ocr.ts          # 通用文字识别
│   └── sms.ts          # 短信验证码
├── wechat/
│   ├── h5-oauth.ts     # 公众号网页授权
│   ├── pc-qr.ts        # 开放平台扫码登录
│   ├── pay.ts          # 微信支付（JSAPI / Native / H5）
│   └── verify.ts       # 回调签名校验
├── alipay/
│   └── pay.ts          # 支付宝支付
└── shared/
    └── webhook.ts      # 通用回调验签 + 幂等 + 重放保护
```

**支付流程要点**：
- 订单走 `Order` 表：`PENDING → PAID → REFUNDED`
- 支付回调：**异步通知 + 主动查询双保险**，5 分钟未到主动 query
- 自动续费：微信支付「自动扣费协议」+ 支付宝「周期扣款」，统一抽象成 `RecurringAuth`

### 4.6 密钥与凭证管理

- 阿里云 AccessKey：全用 RAM 子账号 + 最小权限策略
- 微信支付 v3 商户私钥 + 平台证书：自动轮换 cron（每月检查）
- 本地开发：`.env.local`（gitignore）
- 生产：阿里云 KMS + Secrets Manager；应用启动时从 KMS 拉取，存内存；**绝不**进 docker image
- CI/CD：云效流水线通过 RAM role 访问 KMS

---

## 5. 本地开发流、生产部署与 ICP 路径

### 5.1 本地开发

**前置依赖**：
- Node.js 20+ LTS
- pnpm 9+
- Docker Desktop（起 Postgres + Redis + MinIO）
- Git

**一键启动**：

```bash
pnpm install          # 安装所有 workspace 依赖
pnpm setup            # 复制 .env.local + docker-compose up -d + db migrate + db seed
pnpm dev              # 起 apps/web (3000) + apps/admin (3001) + worker
```

**`.env.example`**（节选）：

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zhijiao
REDIS_URL=redis://localhost:6379

S3_ENDPOINT=http://localhost:9000
S3_BUCKET=zhijiao-dev
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio-secret

DASHSCOPE_API_KEY=sk-xxx
ALIYUN_OCR_ACCESS_KEY_ID=...
ALIYUN_OCR_ACCESS_KEY_SECRET=...

WECHAT_APPID=wx-test-xxx
WECHAT_SECRET=...
WECHAT_PAY_MCH_ID=sandbox-xxx
WECHAT_PAY_PRIVATE_KEY_PATH=./certs/wechat/apiclient_key.pem

JWT_ACCESS_SECRET=dev-only-secret
JWT_REFRESH_SECRET=dev-only-secret

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Seed 数据**（`packages/db/prisma/seed/`）：
- `0_curriculum.ts` — 1 学科（初中数学）+ 人教版 + 全部章节 + 知识点树
- `1_test_users.ts` — 各角色测试账号（密码统一 `dev123`）+ 充满 credit
- `2_questions_sample.ts` — 100 题（按章节均匀分布，含答案与解析）
- 全部 idempotent（重跑不重复）

**Prisma 工作流**：
- `pnpm db:migrate dev --name <change>` — 开发态
- `pnpm db:migrate deploy` — CI/CD 调用
- `pnpm db:studio` — 本地数据浏览

### 5.2 ICP 备案（关键路径，2-4 周，最早启动）

1. **域名注册**（建议 `.cn` 或 `.com.cn`）—— **第一周内做**
2. **公司主体备案** —— 阿里云一键备案，约 7-10 工作日审批
3. **网站备案**（首页可访问性核验）—— 期间用 staging 域名开发
4. **公安备案**（备案通过后 30 日内）

**期间策略**：开发在内部域名 `staging.zhijiao.internal` 完成；备案通过当天 DNS 切到生产 IP；备案信息变更（增子域名）每次需 1-3 工作日。

### 5.3 生产架构（早期，月活 < 1 万）

```
                    [阿里云 DNS]
                          │
                          ▼
            [SLB + ACM HTTPS 证书 + WAF]
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   [ECS: web×2]      [ECS: admin×1]   [ECS: worker×1]
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   [RDS PostgreSQL]   [Tair Redis]      [OSS Bucket]
    (主+从, 同 region   (BullMQ 队列    (题图、卷子导出
    跨可用区, 7天备份)   + 缓存)          PDF、用户头像)
        │
        ▼
   [pgvector 扩展]
   (向量检索)

   旁路:
   ├── [SLS 日志服务]                  ── 应用日志、access log、ModelCall 审计
   ├── [Managed Prometheus + Grafana]  ── 应用指标、慢查询
   ├── [Sentry self-host on ECS]       ── 错误聚合
   └── [DashScope / OCR / SMS]         ── AI/外部服务，子网内调用
```

**为什么不上 K8s（ACK）**：早期 4 台 ECS 跑 docker-compose 完全够用，K8s 的运维成本（节点管理、ingress、cert-manager、HPA 调参）在 < 1 万 MAU 阶段是负债。**月活破 1 万再迁 ACK**。

**为什么不分离独立后端服务**：tRPC 跑在 Next.js 同 process，避免 RPC 跨网络的延迟、序列化成本和契约维护。Next.js 的 Node runtime 完全够用。

### 5.4 CI/CD

**平台**：**首选阿里云云效（Yunxiao）** —— 同区域、构建快、与 ACR 集成顺。备选 GitHub Actions（runner 在境外，push image 到国内 ACR 较慢）。

**流水线**：

```
PR:
  lint + typecheck + unit test + prisma format check + build dry-run

merge to staging:
  全套 CI + build docker image → push ACR (staging tag)
  → SSH 到 staging ECS pull + docker compose up -d (rolling)
  → Prisma migrate deploy
  → smoke test (HTTP 200 on /healthz)

merge to main:
  同上，但走 prod ECS + 蓝绿（SLB 切流）
  数据库 migration 先在 staging 验证，prod 部署单独人工审批闸
```

**环境**：`local` → `staging` → `prod`

### 5.5 备份与灾备

- RDS：每日全量备份 + 实时 binlog，保留 7 天；季度做一次 DR drill（恢复到独立实例验证）
- OSS：开启跨可用区冗余（ZRS）
- `ModelCall` 审计表：合规要求至少 6 个月可查，到期归档到 OSS

---

## 6. 测试与评测策略

### 6.1 分层测试

| 层 | 工具 | 覆盖范围 | CI |
|---|---|---|---|
| **单元** | Vitest | `packages/*` 纯逻辑（domain、credit 算账、prompt registry、adapter 解析） | ✅ 每 PR |
| **集成** | Vitest + Testcontainers (Postgres) | tRPC procedures + 真 DB + 假 LLM；覆盖鉴权、扣点、并发预扣冲突 | ✅ 每 PR |
| **E2E** | Playwright | 关键流：登录 → 答疑首屏流式 → 三阶变式 → 加错题本；教师出卷 → 导出；订阅支付（沙箱） | ✅ merge to staging |
| **LLM 评测** | 自建 harness | 每类 task 50+ golden cases，输出对比 rubric 评分 | ❌ 周跑 cron + prompt 改动触发 |
| **负载** | k6 | `callModel` 高并发预扣不超扣；首页 TTFB；流式响应稳定性 | ❌ 发版前手动 |
| **安全** | npm audit / 阿里云云安全中心 | 依赖 CVE、镜像漏洞 | ✅ 每日 cron |

**关键约定**：
- LLM 在 unit/integration 测试中**全部 mock**
- LLM 真调用只在 `packages/ai/eval` 里发生，独立预算监控
- 测试 DB 用 Testcontainers 真起 Postgres（与 pgvector 行为一致）

### 6.2 LLM 评测 harness

`packages/ai/eval/cases/<task>/` 下放 JSON 用例：

```json
{
  "id": "tutoring-001",
  "task": "TUTOR_TURN",
  "input": { "question_stem": "...", "student_grade": "G8" },
  "rubric": [
    { "criterion": "未直接给最终答案", "weight": 0.3, "matcher": "no-direct-answer" },
    { "criterion": "包含分步思路", "weight": 0.3, "matcher": "has-steps" },
    { "criterion": "标注关键知识点", "weight": 0.2, "matcher": "mentions-kp" },
    { "criterion": "包含易错提示", "weight": 0.2, "matcher": "mentions-pitfall" }
  ],
  "kp_ids": ["kp-linear-eq-01"]
}
```

`matcher` 支持：正则、Zod schema 校验、LLM-as-judge（用更强模型评分）。结果存 `EvalRun` 表附在 prompt 版本上。

- **Phase 1**：每类 task 50+ 用例（数学初中段为主），周跑 + prompt 改动跑
- **Phase 2**：扩到 200+ 用例并加 LLM-as-judge

---

## 7. 明确**不做**的边界

| 类别 | 不做（至少 Phase 1-2） | 原因 |
|---|---|---|
| 产品 | 拍照搜答案（直接给答） | spec 明确禁止 |
| 产品 | 完整 LMS（学校教务、班级管理、教务系统） | spec 明确「首期暂不做」 |
| 产品 | 直播课、录播课 | 不在 spec 范围 |
| 产品 | 家校群、即时通讯 | 不在 spec 范围 |
| 产品 | 个性化学习路径推荐（强算法） | spec 列为 Phase 4 长期 |
| 端 | 微信小程序、原生 App | 已确认 Phase 2/3 |
| 语言 | 多语言（含繁体）| 简体中文唯一 |
| 学段学科 | 首期仅做：**初中数学（核心）**+ 小学高年级数学（轻量）+ 高一数学（轻量） | spec 推荐首发垂直；其他学科 Phase 3+ |
| 数据 | 大量引用版权题库 | 首期自有题库 + AI 生成题为主；引用公开题严格标注来源 |
| 算法 | 真正的「学情诊断模型」（统计/ML） | Phase 1 用启发式规则；Phase 4 再训模型 |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| ICP 备案延迟 | 域名第一周注册；主体备案与开发并行；staging 域名先用 |
| 通义千问限流/涨价 | router 留 DeepSeek 作 fallback；按 task 配 model（贵任务上大模型，便宜任务用 turbo） |
| pgvector 在 50 万+题量性能 | 上 IVFFlat/HNSW 索引；监控 query latency；达阈值评估迁 Milvus |
| LLM 输出污染下游 | Zod 强校验 + 黑词后过滤 + 高风险任务（预测、对外发布）走运营审核闸 |
| 未成年人合规 | 单笔 / 月度充值上限；家长可见消费记录；客服退款通道；内容审核兜底 |
| 微信生态变动 | `packages/integrations/wechat` 收所有微信调用；变动只改这一处 |
| Credit 超扣 / 并发冲突 | `CreditReservation` 预扣表 + Postgres 行锁；reservation 超时自动 release；流水全量审计可对账 |

---

## 9. 后续工作

1. **本 spec 经用户审核确认后**，由 brainstorming HARD-GATE 唯一允许的下一技能 `writing-plans` 接手，输出 implementation plan，覆盖：
   - 仓库初始化（`pnpm init` + workspace + 第一波 packages 骨架）
   - Prisma schema 第一版（仅 Identity + Curriculum + Question Bank 三个模块）
   - 第一个 AI task（TUTOR_TURN）的端到端可跑通
   - 本地开发 docker-compose + seed 数据
2. **CLAUDE.md 更新**：在写完 implementation plan 后更新「开始实现时」一节，把本 spec 的决策项写进去（替换原占位）
3. **ICP 备案**：本周内独立启动（与 implementation 并行），不要阻塞工程

---

## 附录 A：决策追溯

本 spec 各决策来源于 brainstorming session（Q1-Q4 + 5 节设计交互审核），plan 文件保留在 `C:\Users\17798\.claude\plans\lively-gathering-hummingbird.md`。
