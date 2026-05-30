# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库内工作时提供指引。

## 仓库状态

**规划阶段 —— 尚无源代码。** 当前目录仅包含产品/架构规格说明：

- `AI教育网站需求与架构文档_中国K12市场_2026-05-18.docx` —— 权威需求与架构文档（中文，**唯一真源**）
- `需求与架构文档.md` —— 由 docx 自动转换的 Markdown 版本，便于在 Claude Code / 编辑器中直接浏览（含全部章节与表格）
- `mermaid-diagram.png` —— docx 中引用的高层架构图

**docx 为唯一真源（source of truth）。** Markdown 与 CLAUDE.md 都是派生视图——当其与 docx 冲突时，以 docx 为准，并同步更新派生文件。

**尚未决定的事项（不要擅自假设）**：具体技术栈选型（React / Vue / Next、FastAPI / Spring / Nest）、数据库厂商、LLM 提供商、仓库布局（单仓 vs 多仓）、包管理器。在执行任何脚手架搭建前，先与用户确认。

## 一句话产品定位

面向中国 K12 市场的 AI 学教平台，核心闭环：**AI 答疑 → 错因分析 → 举一反三 → 靶向训练 → 错题本 → 学情反馈**。三类受众：学生（5–12 年级，优先初中数学）、教师（一键出卷、分层作业）、以及围绕 中考/高考 节点构建品牌势能的"命题趋势预测"专题面。**产品定位明确不是"拍照搜答案"** —— 强调教授可迁移的方法论。

## 规划架构（四大业务中心 + 共享基础设施）

![架构图](./mermaid-diagram.png)

1. **学生学习中心** —— 答疑、错因分析、举一反三、靶向训练、错题本、学情洞察
2. **教师教学中心** —— 一键出卷、练习单、分层作业、解题讲解
3. **命题趋势预测中心** —— 趋势报告、考点热度图、预测练习卷、考后复盘
4. **内容增长中心** —— SEO/试用入口、分享卡片、专题落地页

四大中心之下的共享基础设施：
- **AI 编排层**：Prompt 管理、RAG 检索、工具调用、模型路由、OCR（处理拍照/截图/公式图片输入）
- **知识层**：与课标对齐的知识图谱，串联 *题目 → 知识点（KP）→ 能力 → 错因 → 训练路径*
- **数据层**：关系型数据库 + 向量数据库 + 对象存储 + 日志/分析
- **后端服务**：账号、题库、试卷、内容、支付、消息、RBAC 权限

**知识图谱是承重结构** —— 几乎所有个性化能力（举一反三、错因分析、学情画像、组卷、命题预测）都从中读取。把它的 schema 当作横切设计问题来处理，而不是某个模块的功能。

## 领域术语（代码与 UI 中请严格沿用以下措辞）

| 术语 | 含义 |
|---|---|
| `AI答疑` | 结构化讲解输出：题目重述 → 涉及知识点 → 分步推理 → 常见陷阱 → 完整答案（可折叠展开） |
| `举一反三` | 三层变式训练：L1 同结构 / L2 改条件或形式 / L3 跨题型与现实情境融合 |
| `错因分析` | 根因分类：概念混淆、读题失误、公式误用、计算疏漏、迁移不足 |
| `错题本` | 自动归类的错题归集，附间隔复习提醒 |
| `学情` | 学生掌握度 + 薄弱点 + 趋势画像；面向学生与家长的呈现方式不同 |
| `知识图谱` | 题↔知识点↔能力↔错因↔训练路径的图结构 |
| `一键出卷` | 教师按 年级 / 学科 / 教材版本 / 知识点 / 难度 / 题型 / 导出格式 参数化生成试卷 |
| `命题趋势预测` | 命题趋势研判输出；合规要求见下节 |
| `双向细目表` | 试卷附带的 知识点 × 能力 × 题型 × 分值 × 难度 的二维矩阵 |

## 合规与措辞规则（这些约束既影响营销，也影响代码）

下列限制会直接影响 Prompt 模板、UI 文案、功能命名、校验逻辑 —— 一旦代码库建立，需沉淀为共享常量/Lint 规则：

- **绝不**宣传"提供直接答案""替代独立思考""可用于完成作业"。答疑默认 UX 必须是 **提示先行（hint-first）**，而非答案先行。
- 命题预测中心：**绝不**使用"押中原题"或暗示内幕信息的措辞。**许可表述**：趋势研判、考点方向分析。预测内容需带版本号、考前发布、**考后公开复盘对账**。
- 任何营销与产品文案中，**不得**出现提分/分数/通过保证（依据北京市市场监管局对教培广告的相关规定）。
- 不得使用恐吓或制造焦虑的文案，尤其针对学生与家长。
- 适用未成年人保护规则：更安全的默认值、按学段调整表达（小学=生活类比；初中=题型归类；高中=方法迁移），并提供家长可见的沟通通道。

## 角色与权限（规划）

`student`（提问/答题/收藏/重做）、`teacher`（生成/修改/导出/保存试卷）、`parent`（只读简版进度报告）、`operations`（运营专题页与命题预测报告）、`admin`（配置、权限、日志、模型版本）。**RBAC 自第一天起设计** —— 家长只读视图与运营策展内容不是后期补丁。

## 规划外部集成

支付：微信支付、支付宝。认证：隐含微信登录。LLM 提供商规格中未锁定 —— 候选包括 通义千问 / 文心 / DeepSeek / GPT 级模型；编排层明确要求 **模型路由**。CDN、分析、对象存储厂商未指定。

## MVP 分阶段路线（来自规格）

1. AI答疑 + 错因分析 + 举一反三 + 教师 一键出卷（验证核心闭环）
2. 靶向训练 + 错题本 + 分层作业 + 练习单生成（提升留存）
3. 命题预测中心 + 预测卷 + 考后复盘（围绕 中考/高考 的品牌爆点）
4. 学情报告 + 班级分析 + 区域研究合作（平台化扩展）

**建议首发垂直方向：初中数学**（题型结构清晰、举一反三价值高、教师组卷使用频次高）。

## 开始实现时（已落地）

技术栈与项目结构详见 `docs/superpowers/specs/2026-05-18-tech-stack-and-project-structure-design.md` §1.2。
本仓库已完成：
- **Plan 1**（仓库脚手架 + Identity/Curriculum/Question Bank/AI Audit schemas + TUTOR_TURN 端到端）—— 见 `docs/superpowers/plans/2026-05-18-foundation-and-tutor-turn.md`
- **Plan 2**（真鉴权：手机号 OTP + 微信 H5 OAuth 骨架 + Session/JWT + tRPC）—— 见 `docs/superpowers/plans/2026-05-19-real-auth.md`，spec 在 `docs/superpowers/specs/2026-05-19-real-auth-design.md`
- **Plan 2 Hardening**（env validator + 原子化 refresh/OTP + 会话吊销即时生效 + bind 身份重校验 + register/refresh 限频接入 + race tests + 跨 package 测试 DB 隔离 + 仓库卫生）—— 见 `docs/superpowers/plans/2026-05-20-plan2-hardening.md`，spec 在 `docs/superpowers/specs/2026-05-20-plan2-hardening-design.md`
- **Plan 3**（Credit 计费 + 微信支付 V3 沙箱：Mock 主路径 + Real V3 骨架 + chargedProcedure + 未成年月度上限 + OPS 调账 + pino 结构化日志）—— 见 `docs/superpowers/plans/2026-05-21-credit-and-wechat-pay-sandbox.md`，spec 在 `docs/superpowers/specs/2026-05-21-credit-and-wechat-pay-sandbox-design.md`
- **Plan 4**（举一反三 + 错因分析：ErrorBookEntry + VariantGroup + 三阶变式 + chargeMiddleware 抽取 + E2E 覆盖闭环）—— 见 `docs/superpowers/plans/2026-05-23-variant-and-error-analysis.md`，spec 在 `docs/superpowers/specs/2026-05-23-variant-and-error-analysis-design.md`
- **Plan 6**（PII 治理：用户注销 / 数据导出 / 去标识化 / GC sweep / support 静态页 / OPS CLI + 外部 scheduler 文档）—— 见 `docs/superpowers/plans/2026-05-26-pii-governance.md`，spec 在 `docs/superpowers/specs/2026-05-26-pii-governance-design.md`
- **Plan 8**（答疑题面持久化 + ErrorAnalysisCard 接入答疑闭环：tutor.ask 接受自由输入并 upsert USER_ADHOC Question + 返 questionId + TutorForm 接 ErrorAnalysisCard）—— 见 `docs/superpowers/plans/2026-05-25-tutor-question-bank-and-error-card-integration.md`，spec 在 `docs/superpowers/specs/2026-05-25-tutor-question-bank-and-error-card-integration-design.md`
- **Plan 9**（知识点 reconciler：hint→KP 结构化映射 + KpReconcileMatch 审计队列 + CLI 异步 LLM/review）—— 见 `docs/superpowers/plans/2026-05-25-kp-reconciler.md`，spec 在 `docs/superpowers/specs/2026-05-25-kp-reconciler-design.md`
- **Plan 12**（VariantItem 升格成独立 Question：VARIANT_GENERATED Question + variant question KP link + backfill CLI + owner-only access）—— 见 `docs/superpowers/plans/2026-05-27-variant-question-promotion.md`，spec 在 `docs/superpowers/specs/2026-05-27-variant-question-promotion-design.md`
- **Plan 10**（教师端分层作业 + AI 出题系统：seeded classroom、变量计费、AI 草稿、发布/提交/批改状态机、错题本回流、AssignmentPerformance、教师/学生 UI、E2E、PII 补丁）—— 见 `docs/superpowers/plans/2026-05-27-teacher-tiered-assignments.md`，spec 在 `docs/superpowers/specs/2026-05-27-teacher-tiered-assignments-design.md`
- **Plan 11**（学情画像 / 趋势 + 家长绑定：`packages/analytics` 纯核 + 只读查询壳、KP 掌握度三档 + 数据不足态、学生付费 AI 学习建议、5min 缓存纯 TTL、学生发码/家长绑定 FamilyLink、三端画像 UI、PII 覆盖 FamilyLink、E2E）—— 见 `docs/superpowers/plans/2026-05-29-learning-portrait-and-trends.md`，spec 在 `docs/superpowers/specs/2026-05-29-learning-portrait-and-trends-design.md`

**学情画像现状**（Plan 11）：
- 新建 `packages/analytics`：`core.ts` 纯函数（`aggregateMastery` / `aggregateClassDiagnosis` / `scoreOf` / `decayWeight` / `tierOf`，零 runtime dep，**不**依赖 redis/ai/server-only）+ `queries.ts` 只读 Prisma 聚合（`profileForStudent` / `classDiagnosis`）。掌握度主源是 `AssignmentPerformance.kpIds`（绕开稀疏的 QuestionKPLink）；时间衰减半衰期 30 天；`UNGRADED` 行被过滤不计。
- 掌握度三档 + 数据不足态：`weightedSampleSize < 1.0 → INSUFFICIENT_DATA(score=null)`；否则 `score<0.5 FOCUS / <0.8 PROGRESSING / 否则 SOLID`。**合规**：数据不足 KP 绝不渲染成 `0% 红块`；`FOCUS` 措辞用"重点巩固方向"、配色用蓝（`bg-sky-100`，聚焦）非红（失败）。色块措辞常量在 `apps/web/lib/mastery-copy.ts`。
- `analytics.profile.mine`（本人完整画像）/ `profile.get`（家长→`familyView` 剥离子集 / 教师→完整 profile / 无关系→`NOT_FOUND`，经 `requireProfileAccess`）/ `profile.generateAdvice`（付费 `LEARNING_ADVICE_GEN` 1 credit，链 `authed→chargeMiddleware`，AI 输出合规扫描走 Plan 4 白名单不补偿）/ `classroom.diagnosis`（经 `requireTeacherClassroom`）。`studentUserId`/`classroomId` 用 `z.string().min(1)` **不是** `.cuid()`——seeded dev/E2E id 非 cuid，access helper 才是真正的门禁。
- `requireProfileAccess`（`apps/web/server/lib/profile-access.ts`）：self/parent(ACTIVE FamilyLink)/teacher(共享 classroom)/无关系→`NOT_FOUND(PROFILE_NOT_ACCESSIBLE)`，绝不用 FORBIDDEN（与 `validateEntryOwnership`/`validateQuestionAccess` 同款存在性侧信道防御）。REVOKED link 视同无权。
- 家长简版 `familyView`（`learning-projection.ts`）：剥掉每-KP 分数/overallScore，只给 SOLID/PROGRESSING/FOCUS 三档计数 + 知识点名。
- 缓存：`learning-cache.ts` 纯 5min TTL（`ANALYTICS_TTL_SEC=300`），无主动失效；JSON-safe 直接 `JSON.stringify`，损坏缓存丢弃重算。已知设计代价：`generateAdvice` 数据不足早退发生在 charge **之后**→ 产生 `DEBIT+COMPENSATION` 配对（净额不变），MVP 接受。
- family-link：学生 `family.createInviteCode`（数据主体持发起权，Redis 15min TTL 单次码）→ 家长 `family.bindByCode`（upsert：复活 REVOKED / 幂等 ACTIVE，单次用尽 del，自绑拒绝）/ `listMyChildren`（仅 ACTIVE）/ `revoke`（任一方可撤，非双方→`NOT_FOUND`）。`FamilyLink` 两 FK `onDelete:Restrict` + `@@unique([parentUserId, studentUserId])`。
- UI：学生 `/portrait`（掌握度色块 + 时间窗 + 付费 AdviceCard）、`/family-link`（发码）；家长 `/parent`（绑定 + 子女列表）、`/parent/children/[childId]`（familyView 三档计数）；教师班级页嵌"班级学情诊断" + `/teacher/students/[studentId]` 单生画像。
- AI：`LEARNING_ADVICE` taskKind（qwen-plus）+ `generateLearningAdvice`（复用 `runJsonTaskWithAudit`，prompt `learning-advice/v1.md` 方法论导向、无提分/分数/通过/恐吓措辞）。`MockAdapter` 加 `学习顾问` 关键词默认返值，E2E/集成走 mock 不需注入。
- PII（扩 Plan 6）：注销事务删该用户作 parent/student 的全部 `FamilyLink`（payload 只记 `familyLinks` 计数）；导出含本人 `familyLinks`（`role`/`counterpartUserId`/`status`，不含对方 PII）；payload guard 禁词集加 `parent_user_id`/`student_user_id`/`counterpartUserId`。
- E2E 专用 seed 用户：`dev-student-04`(13800000008) 发码方、`dev-parent-02`(13800000009) 绑定方（与 `learning-portrait.spec` 用的 `dev-student-03`(007) 隔离，避免并行 worker 抢同手机号 OTP）。E2E hook `/api/e2e-hooks/analytics` 仅 `E2E_TEST_HOOKS=1` 开启。

**教师分层作业现状**（Plan 10）：
- `Classroom` / `ClassroomMember` / assignment lifecycle schema 已落地；当前只 seed 测试班级，不做 roster 管理 UI。
- `ASSIGNMENT_QUESTION_GEN` 按生成题量扣教师钱包；跨班级 / 不存在 classroom 不写 DEBIT。
- AI 生成题进入 `Assignment` DRAFT；教师整份审核、保存标题、发布；发布后内容快照锁定。
- 学生只看到自己的 `StudentAssignment` tier；只能提交 assigned tier item，重复提交返回状态冲突。
- 教师人工批改；`WRONG` / `PARTIAL` 要 root cause，写回错题本并 upsert `AssignmentPerformance`；全部答案批改后 `StudentAssignment` 进入 `GRADED`。
- `/teacher`、`/teacher/classes/...`、`/teacher/assignments/...` 和 `/assignments` 学生端闭环已可用；E2E hook `/api/e2e-hooks/assignment` 仅 `E2E_TEST_HOOKS=1` 开启。

**计费现状**：
- `packages/billing` 新建：ensureWallet / chargeForAction（predicate-on-update + idemKey 防重，原子化）/ compensate（写 COMPENSATION ledger + refId 指回 DEBIT）/ applyWechatPayNotify（P2002 idemKey 重读 → ALREADY_PAID；P2002 transactionId 重读 → DUPLICATE_TRANSACTION_ID；spec §4.1 状态机；FAILED→PAID 拒绝走 TERMINAL_STATE_CONFLICT）/ expireStaleOrders / adminAdjust（OPS 调账；负 delta 也走 predicate-on-update 防透支 → InsufficientBalanceForAdjustError）/ sumMonthlyTopupCents（Asia/Shanghai 自然月 + CREATED+PENDING by createdAt + PAID by paidAt）
- `chargedProcedure(kind)` 替换 `creditPlaceholder`；input 强制 `clientRequestId: uuid`；idemKey = `debit:<kind>:<userId>:<clientRequestId>`；fail-open 补偿（默认补，`ComplianceRejectedError`/`cause.reason === "COMPLIANCE_REJECTED"` 白名单不补，debit row 写 `metadata.compensationStatus = "not_compensated_whitelisted"`）。**tRPC v11 注意**：`next()` 返回 `MiddlewareResult`，不会 throw —— 必须 `if (!result.ok) ...`，try/catch 不会跑
- `wallet.topupCreate`：`RULE_TOPUP_CREATE_{IP,USER}` **fail-CLOSE**（Redis 挂 → INTERNAL_SERVER_ERROR / `TOPUP_RATE_LIMIT_UNAVAILABLE`，不让无限连发）→ ensureWallet → 未成年 200元/自然月 → CREATED → `adapter.unifiedOrder` → PENDING → `adapter.signalOrderReady`（no-reject 契约）。`outTradeNo` = `zj_<userPrefix8>_<12 url-safe>`
- `/api/wechat-pay/notify`：先无条件 `WechatPayEvent`（PENDING）作审计 → `adapter.verifyNotify` → `applyWechatPayNotify` → 200。仅 `applyWechatPayNotify` 重抛非 P2002 时 500，spec §4.3
- `WechatPayAdapter`：Mock 三模 (`sync` / `async-delayed` / `manual`) HMAC-SHA256 + Real V3 骨架（throw 直到 ICP 备案 + 商户号 + APIv3 + 证书到位激活，独立 plan）。Adapter 接口 `signalOrderReady(outTradeNo, amountCents)` 由 `topupCreate` 在 `status=PENDING` 落地后显式调用；`unifiedOrder` 严禁触发 mock notify
- env 校验扩 9 字段 + 2 refine（mock 模式也强制 `WECHAT_PAY_APPID/MCHID` 因 webhook 三联校验；real 模式强制 6 个真接 credentials）
- 自建 pino 8 logger 在 `apps/web/server/logger.ts`（server-only；redact cookie/auth/rawBody/signature），通过 `setBillingLogger(...)` 注入到 `@zhijiao/billing` 包；Ctx 加 `requestId`（沿用 X-Request-Id 或生成 UUID v4） + `auth.isMinor`（从 DB 查，不进 JWC 避免 token 失效）
- 测试 fixture 用户每个有 100 credits 起始余额（`packages/db/prisma/seed/1_test_users.ts`，idemKey `topup:seed:<userId>`，幂等）

**Plan 3 *未*完成的事 —— prod ship 前必须做**：
- ICP 备案 + 微信商户号申请 + APIv3 密钥 + 商户证书 / `WECHAT_PAY_USE_MOCK=false` 配套 6 个 real env
- Real adapter 激活：实现 `unifiedOrder` 走 V3 prepay API + `verifyNotify` 走 RSA-SHA256 + PlatformCertProvider 真接（独立 plan）

**鉴权现状**：
- 自建 JWT（jose HS256）+ Prisma `Session` 表（含 rotate + reuse detection）+ Redis（限频 / OTP nonce / register payload / wx state）
- 手机号 OTP：阿里云 SMS 真接代码留好，开发态 `SMS_USE_MOCK=true` 走 console；E2E 走 Redis 内的 `e2e-hooks/last-otp` test endpoint
- 微信 H5 OAuth：完整路由 + adapter 接口；`MockWechatH5Adapter` 默认，真接公众号留下个 plan
- `Role` 仅 `OPS / ADMIN`；`Persona`（STUDENT/TEACHER/PARENT）是 onboarding 默认入口，不再是权限门槛；`PAPER_GEN / LESSON_PLAN_GEN / PPT_GEN / TUTOR_ASK / ERROR_BOOK_VIEW_OWN` 对所有登录用户开放
- tRPC v11 全量落地；`apps/web/app/(student)/tutor/actions.ts` 已删除，改走 `tutor.ask` procedure；`DEV_USER_ID` 已下线

**错题本 / 变式现状**（Plan 4）：
- `ErrorBookEntry` 三态：ACTIVE / ARCHIVED / DELETED。**DELETED 是终态**，UI 不提供任何"恢复 / 回收站"入口；DB 行保留作审计。文案统一用"从错题本移除"，不用"删除"
- partial unique idx `(user_id, question_id) WHERE status IN ('ACTIVE', 'ARCHIVED')`（raw SQL 在 migration 末尾追加，Prisma 5 schema 不支持），允许 DELETED 与新 ACTIVE 共存 —— 移除后再 diagnose 同题是**新** entry，不是复活
- `error.list` 默认仅 ACTIVE；归档页须显式 `status: "ARCHIVED"`；zod 枚举**不含 DELETED**（探活也拒）
- `chargeMiddleware(kind)` 抽出独立 factory；`chargedProcedure(kind) = authedProcedure.use(chargeMiddleware(kind))` 糖语法保留，Plan 3 调用点（`tutor.ask`）零行 diff
- `validateEntryOwnership` 中间件：entry 不存在 / 跨用户 / 已删 → 合并 `NOT_FOUND / ENTRY_NOT_FOUND`，**绝不**用 FORBIDDEN 区分（避免存在性侧信道）；注入 `ctx.entry`（含 question + answer + KP）省一次 DB round trip
- `variant.generateForEntry` middleware 链：`authedProcedure → validateEntryOwnership → chargeMiddleware("VARIANT_GROUP_GEN")` —— **entry 校验在扣费之前**，鬼魂 / 跨用户 / 畸形 ID / DELETED 四种失败不写 DEBIT ledger（spec Blocker 1，Task 5 显式 4 测例守门）
- 间隔复习：5 段固定（1d / 3d / 7d / 14d / 30d cap）；MVP 不上 SM-2 / FSRS。markReviewed 推进；archive(true) 清 nextReviewAt 退出队列；archive(false) 复活时 seed nextReviewAt=now+1d 重新入队
- AI: `ERROR_ANALYSIS`（1 credit）+ `VARIANT_GROUP_GEN`（3 credits，一次出 L1/L2/L3 三道）。`rootCause` 6 类 enum 强约束 / `level` 三档强约束 / JSON parse 失败走 retry 2 次再 PARSE_FAILED。合规 `ComplianceRejectedError` 走 Plan 3 既有白名单不补偿（debit row metadata `compensationStatus: "not_compensated_whitelisted"`）
- E2E hook `/api/e2e-hooks/error-book`：仅 `E2E_TEST_HOOKS=1` 开启（env zod 默认 "0"，普通环境 404 disabled），POST `{phone, scenario}` 准备 4 个 deterministic 场景（empty / active / due / future）+ reset 钱包到 balance=100。给 `apps/web/e2e/error-book.spec.ts` 用，不暴露给客户端
- **ErrorAnalysisCard 已接 TutorForm**（Plan 8 落地后状态）：`tutor.ask` 现返 `questionId`，`TutorForm` 在讲解输出之下 mount `ErrorAnalysisCard` 直接传 questionId + actualAnswer 快照。Plan 4 原 punt 项已收口
- **`next build` prereq**（Task 6 followup `ca69470`）：用 `useSearchParams()` 的 client component 必须用 `<Suspense>` 包裹（否则 Next 14 build 报 missing-suspense-with-csr-bailout）；JSX 文本里的 `"` 必须 `&quot;`（`react/no-unescaped-entities`）。`tsc --noEmit` 查不出这两类问题，必须用 `next build` 验

**答疑题面持久化现状**（Plan 8）：
- `tutor.ask` middleware 链：`authedProcedure → validateTutorInputCompliance → chargeMiddleware("TUTOR_ASK")`。compliance 在扣费**前**；违禁词命中 → `BAD_REQUEST / INPUT_COMPLIANCE_REJECTED`，不扣费、不写 Question、不调 AI
- AI 成功才落 USER_ADHOC `Question`（spec §3.3 顺序），避免 AI 失败沉淀孤儿题
- `Question` 加 `createdByUserId String?` (`onDelete: SetNull` —— 注销时归属可抹；与 `ErrorBookEntry.questionId @Restrict` 业务含义不同) + `normalizedStemHash String?`
- partial unique idx `(created_by_user_id, normalized_stem_hash) WHERE source='USER_ADHOC' AND IS NOT NULL`，同 user + 同 stem 去重；不同 user 同 stem 各建一行；PUBLISHED 不复用（spec §6.2 显式 punt）
- `upsertUserAdhocQuestion` 签名接 `PrismaClient`（不是 `TransactionClient`）—— P2002 catch 内重读不能在已 abort 的 tx 内跑（Postgres 25P02 "current transaction is aborted"）；race 安全由 partial unique idx 在 DB 级保证。流程：findFirst → create → P2002 顶层 client 重读赢家 / 未命中原样抛（不依赖 `meta.target` 字面，比 Plan 4 `isErrorBookPartialUniqueP2002` 更抗 Prisma 版本差异）
- `normalizeStem`: 仅 `trim() + 折叠空白`，**不** lowercase（数学大小写可有义）
- `TutorForm`: 加可选"我的作答（可选）"折叠 + `diagnoseActualAnswer` 快照绑定本次讲解 + 讲解后 mount ErrorAnalysisCard 传 questionId + 快照
- 超长 stem (>4000) 走 zod 兜底而非合规分支，会产生 `DEBIT + COMPENSATION` 配对（净余额不变），与违禁词路径不同；test 断言要分清两者
- E2E `tutor-error-book-link.spec.ts` 用 dev-student-02 (`13800000006`)，避开 tutor.spec=001 / error-book.spec=004 / wallet 既有用户
- **hotfix P1**（review 反馈）：`error.diagnose` 加 `validateQuestionAccess` 中间件，扣费前守门 `USER_ADHOC.createdByUserId === ctx.auth.userId`；跨用户 / 不存在的 questionId 合并 `NOT_FOUND / QUESTION_NOT_FOUND`，不写 DEBIT。链顺序 `authedProcedure → validateQuestionAccess → chargeMiddleware("ERROR_ANALYSIS")`
- **hotfix P2**（review 反馈）：新增 `error.findEntryForQuestion` 只读 query；`ErrorAnalysisCard` mount 时 seed 已存在的 ACTIVE/ARCHIVED entry 到 result 态，避免对同题重复点 diagnose 二次扣费。DELETED 视同 null（终态语义）
- **hotfix P2 #1**（review 反馈）：`TutorForm` 给 `<ErrorAnalysisCard key={data.questionId} ... />`，换题强制 remount 重置 state，避免 A 题分析结果残留到 B 题

**知识点结构化现状**（Plan 9）：
- `QuestionKPLink` 仍是唯一权威映射，新表 `KpAlias`（subject 内 normalizedAlias 唯一）+ `KpReconcileMatch`（hint→kp 审计队列）做支撑
- `reconcileHintsSync(prisma, { questionId, hints, source, sourceRefType, sourceRefId })` 在 `tutor.ask` / `error.diagnose` / `variant.generateForEntry` 三处 body 接入，**await + try/catch**，失败不破坏主流程
- 同步只跑 EXACT (KP.name/code) → ALIAS 表 → 命中即 LINKED + upsert QuestionKPLink（weight=max(existing, 1.0)）
- 关键：Plan 12 后 `sourceRefType=VARIANT_ITEM` 分两路：`VariantItem.questionId` 非空时 EXACT/ALIAS 直接 LINKED 到 variant Question 的 `QuestionKPLink`；`questionId` 为空时仍走旧 `PENDING_REVIEW(reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW)` migration safety。永不自动污染 parent QuestionKPLink；判分流条件是 sourceRefType 不是 source
- 异步 LLM 走 `pnpm.cmd --filter @zhijiao/web kp:reconcile-pending [-- --limit N]`，三档 (≥0.85 / ≥0.6 / <0.6) 分流 LINKED / PENDING_REVIEW(LLM_CONFIDENCE_BAND) / DROPPED；matchId 对齐写回（不靠 rawHint）；LLM 漏返/重复 retry 2 次再 PARSE_FAILED；多返不属于本批 matchId 静默忽略
- 人工 review 走 `pnpm.cmd --filter @zhijiao/web kp:review`，单键 a/r/m <code>/alias <code>/s/q；service 层 `apps/web/server/lib/kp-reconcile.ts` 的 `approveMatch / rejectMatch / remapMatch / learnAliasAndLink / unlinkIfOrphan` 5 个函数可被未来 `/ops/kp-reconcile` Web 页面复用
- alias 冲突防御：`learnAliasAndLink` 检测 `(subjectId, normalizedAlias)` 已映射到不同 KP → 抛 `KpAliasConflictError`，不静默覆盖
- LLM 不计 Credit（系统维护任务），只写 `ModelCall(taskKind="KP_RECONCILE")`；`taskKind` 字面值，不引入 enum
- KpAlias 初始 seed 8 条 math 别名 (`packages/db/prisma/seed/3_kp_aliases.ts`)；后续靠 CLI `alias <code>` 慢慢沉淀
- backfill: `pnpm.cmd --filter @zhijiao/web exec tsx scripts/kp-backfill-variant-items.ts` 一次性扫现有 VariantItem.knowledgePointHints，幂等

**Plan 9 未完成的事 —— 等后续 plan**：
- Web `/ops/kp-reconcile` 页面（等真有 OPS / 教师角色）
- CLI 暴露 LINKED→REJECTED 反悔入口（只 export `unlinkIfOrphan` helper，文档化清理 SQL）
- cron 自动跑 `kp:reconcile-pending`（成本不可见，暂手动）
- KP 树扩充（独立 plan）

**VariantItem 升格现状**（Plan 12）：
- `VariantItem.questionId` 是 nullable 过渡字段，指向 `Question(source="VARIANT_GENERATED")`；新生成变式同事务双写 Question + VariantItem。
- `variant:backfill-questions` 负责历史 VariantItem 补 Question；backfill 后 `variant_items.question_id IS NULL` 应为 0。
- `reconcileHintsSync` 对 `sourceRefType=VARIANT_ITEM` 两阶段分流：有 `questionId` 直接 LINKED 到 variant Question；无 `questionId` 保留 `PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)` migration safety。
- `VARIANT_GENERATED` 与 `USER_ADHOC` 同为 owner-only；注销时 scrub `createdByUserId=null`，Question 行保留作统计样本。
- 历史 `VARIANT_TO_PARENT_NEEDS_REVIEW` 行升级为 LINKED + 补 QuestionKPLink 显式 punt 到 cleanup plan。

**PII 治理现状**（Plan 6）：
- OPS CLI：`user:deactivate <userId> [--reason TEXT] [--dry-run]` / `user:export <userId> --out <path.json>` / `pii:gc-sweep [--bucket short|medium|orphan|all] [--dry-run]`；全部走 shared service，不引入 apps/web 内置 cron
- 注销：User 行 soft-delete 作 tombstone；硬删 `ErrorBookEntry`（级联 `VariantGroup`/`VariantItem`）和用户 `USER_ADHOC Question`；删除 `AuthIdentity` + PHONE/GLOBAL 对应 `OtpRequest`；scrub Session / TopupOrder / ModelCall / KpAlias / KpReconcileMatch PII；Plan 12 后额外 scrub `VARIANT_GENERATED Question.createdByUserId=null` 但保留 Question 行；Plan 10 后删除该学生的 `StudentAssignment`（级联 `AssignmentAnswer`）和 `AssignmentPerformance`，payload 只记录计数；财务金额、订单号、ledger 保留
- 导出：`exportUserData` 只输出白名单 JSON；`AuthIdentity.providerUserId` 仅 masked；显式排除 `rawBody` / `requestJson` / `responseJson` / `ipCreated` / `userAgent` / 本地 outPath；Plan 10 后包含本人 `StudentAssignment`、`AssignmentAnswer`、`AssignmentPerformance` 白名单数据，不导出其它学生答案
- GC：short bucket 删除过期 OTP/Session；medium bucket scrub `WechatPayEvent.rawBody` 与 `TopupOrder.ipCreated/userAgent`；orphan bucket 删除过期未支付且无 ledger 引用的订单。外部 scheduler 配方在 `docs/ops/pii-scheduling.md`
- Auth guard：`USER_DEACTIVATED` 已进入 auth errors；`createContext` 对 deleted user 返回 `auth=null`，refresh route 清 cookies 并 401；注销后同手机号可重新注册新 User
- `OpsActionLog.payload` 只能写非 PII 摘要；新增 payload guard test 守门。业务代码不得直接 `prisma.user.delete()`，注销统一走 `deactivateUser`

**Plan 8 未完成的事 —— 等后续 plan**：
- PII 扫描（手机号 / 身份证 regex）未在 Plan 6 做通用扫描器；当前靠字段级去标识化 + payload/export 守门

**常用命令**：

```bash
pnpm setup              # 一键起本地依赖（首次；含 test:setup）
pnpm dev                # 启动所有 app（含 apps/web 在 :3000）
pnpm test               # 全量 unit + integration
pnpm test:setup         # 建/迁 6 个 per-package test DB（zhijiao_test_{ai,auth,billing,db,integrations,web}）。首次跑测前必做；之后幂等
pnpm --filter @zhijiao/web test:e2e   # E2E；global-setup 会在启动前 seed zhijiao_test_web
pnpm typecheck          # TS 全量检查
pnpm db:migrate         # apply 新 migration（Windows 上可能需要 docker-exec 绕过，见 README）
pnpm db:seed            # 重新 seed（只灌主 zhijiao 库；unit/integration fixtures 由各 test 文件自填；E2E 由 global-setup seed）
pnpm db:studio          # Prisma Studio 浏览数据

# 单条测试：
pnpm --filter @zhijiao/ai test -- tests/router.test.ts
pnpm --filter @zhijiao/auth test -- tests/session.test.ts
pnpm --filter @zhijiao/billing test -- tests/wechat-notify.test.ts
pnpm --filter @zhijiao/web  test -- tests/integration/auth-register-race.test.ts
```

### Merge 后必跑（不是"绿测试"就行）

1. `git status --short --branch` 干净（无 `??`）；若有 `.claude/worktrees/<old-plan>/` 残留 → 先 `git worktree list` 看 git 是否还认它：认就 `git worktree remove`（必要时 `git worktree prune`）；不认则 PowerShell `Remove-Item -Recurse -Force -LiteralPath` 物理删（先确认不是当前 worktree）
2. `pnpm.cmd exec turbo typecheck --force`（不走 cache）
3. `pnpm.cmd exec turbo test --force`（不走 cache）。Task -1 之后 5 个 per-package test DB 切干净；如再出现稳定 flake 须开独立 plan
4. E2E：`pnpm.cmd --filter @zhijiao/web test:e2e`（**单独跑**，不要与 typecheck/test 并发 —— 会写 `.next` 冲突）
5. env 探针（fail-close）：把 `.env.local` 的 `ACCESS_JWT_SECRET` 注释掉再 `pnpm.cmd --filter @zhijiao/web dev`，期望进程立刻 throw 并列出 zod issue
6. 路由契约：grep `apps/web/app/**/route.ts` 与 `packages/integrations/src/**/build.ts` 里写的 callback URL，统一到 `/wechat/callback`
7. revoke 即时生效：手动 logout 后把旧 `__Host-zj_at` 重新塞回，调一个 authed tRPC endpoint（例 `auth.me`），期望 401 `SESSION_REVOKED`。**不要测 `/tutor`** —— 它不在 middleware 保护范围；要测 middleware 走 `/profile`
8. PowerShell 调用约定：本机 execution policy 拦 `.ps1`，所有命令一律 `pnpm.cmd`（不是 `pnpm`），否则报 "running scripts is disabled"
9. **mock 不漏到 prod**（Plan 3）：临时把 `apps/web/server/wechat-pay-adapter.ts` 改成 `useMock=false` 并删 real fields，跑 `pnpm.cmd --filter @zhijiao/web dev`，期望 env validator throw `/Real WeChat Pay requires/`
10. **idemKey 命名唯一**（Plan 3）：`grep -n "idemKey:" packages/billing/src apps/web/server`，每处必须为 `topup:` / `debit:` / `comp:` / `adjust:` / `topup:bootstrap:`（test fixture）之一前缀
11. **`adapter.unifiedOrder` 不 fire notify**（Plan 3）：`grep -n "fireMockNotify" packages/integrations/src/wechat-pay/mock.ts` 应只在 `signalOrderReady` 和 `fireMockNotify` 自身定义里出现，**不在 `unifiedOrder` 里**
12. **OPS 调账不能裸 SQL**（Plan 3）：`grep -E "UPDATE wallets|UPDATE \"wallets\""` 在 TS 业务代码应 0 命中（只允许出现在 spec/plan/README 说明文档）
13. **chargeMiddleware 抽取后 tutor.ask 零行为变化**（Plan 4 Task 3）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-tutor.test.ts` 应全绿，证明 Plan 3 既有计费行为未被 refactor 破坏
14. **DELETED entry 不可见**（Plan 4 §3.1 / §4.4）：手动 `error.delete` 后调 `error.list / getById / dueForReview / markReviewed / archive`：全部应返 `NOT_FOUND / ENTRY_NOT_FOUND` 或不含此条；`Select-String -Path apps/web/server/routers/error.ts -Pattern "status.*DELETED"` 应只在 `update.data.status = "DELETED"` 处出现，不在 findMany / findUnique where 处出现
15. **entry 校验在扣费前**（Plan 4 Blocker 1）：`Select-String -Path apps/web/server/routers/variant.ts -Pattern "chargeMiddleware.*VARIANT_GROUP_GEN" -Context 2,5` 应在 `validateEntryOwnership` **之后**；middleware 链顺序 `authedProcedure.use(validateEntryOwnership).use(chargeMiddleware(...))` 反了即 reopen Blocker 1
16. **partial unique idx 已落 DB**（Plan 4 §3.3）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d error_book_entries"` 应见 `error_book_entries_user_question_active_idx`，定义带 `WHERE status = ANY (ARRAY['ACTIVE'::"ErrorBookStatus", 'ARCHIVED'::"ErrorBookStatus"])`
17. **error.diagnose 返回 entryId**（Plan 4 §5.1.1 / UI Reback A）：`Select-String -Path apps/web/server/routers/error.ts -Pattern "entryId:"` 应在 diagnose 返回类型出现；`apps/web/app/(student)/tutor/error-analysis-card.tsx` 应渲染 `<Link href={"/error-book/" + entryId}>`
18. **error.dueForReview 三态**（Plan 4 §5.1.4 / UI Reback B）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/error-due-for-review.test.ts` 覆盖三种 nextReviewAt 形态（空 ACTIVE / 有 future / dueToday 非空）；UI 文案对应"还没有需要复习的题" / "下次复习 +Xd 后" / 列表
19. **E2E hook 不暴露给普通环境**（Plan 4）：`grep -n "E2E_TEST_HOOKS" apps/web/app/api/e2e-hooks/*/route.ts` 每个 route.ts 应有 `if (process.env.E2E_TEST_HOOKS !== "1") return 404`；env zod 默认 "0"，普通 dev / prod 全 404
20. **next build 类的隐式失败**（Plan 4 Task 6 followup）：`tsc --noEmit` 查不出 `<Suspense>` 漏包裹 / JSX `"` 未转义。merge 前必须跑 `pnpm.cmd --filter @zhijiao/web exec next build` 至少一次，否则下个 `test:e2e` 跑前 build 时才暴雷
21. **`tutor.ask` 输入扫描在扣费前**（Plan 8）：`Select-String -Path apps/web/server/routers/tutor.ts -Pattern "validateTutorInputCompliance|chargeMiddleware" -Context 0,2`，`validateTutorInputCompliance` 必须出现在 `chargeMiddleware("TUTOR_ASK")` 之前。反了即"违禁词输入也扣费"事故
22. **USER_ADHOC 去重 partial unique idx 已落 DB**（Plan 8 §2.4）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d questions"` 应见 `questions_user_adhoc_dedup_idx`，定义带 `WHERE source = 'USER_ADHOC' AND created_by_user_id IS NOT NULL AND normalized_stem_hash IS NOT NULL`
23. **ErrorAnalysisCard 从 tutor 页能跳到 `/error-book/[entryId]`**（Plan 8）：`pnpm.cmd --filter @zhijiao/web exec playwright test tutor-error-book-link.spec.ts` 应 2/2 passed
24. **PUBLISHED 题不被 USER_ADHOC 复用**（Plan 8 §6.2 设计代价）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/tutor-ask-published-untouched.test.ts` 应全绿。班级题库统计无法覆盖 ad-hoc 副本是已知设计代价
25. **error.diagnose 在扣费前校验 questionId 归属**（Plan 8 hotfix P1）：`Select-String -Path apps/web/server/routers/error.ts -Pattern "validateQuestionAccess|chargeMiddleware" -Context 0,2`，`validateQuestionAccess` 必须出现在 `chargeMiddleware("ERROR_ANALYSIS")` **之前**。反了即"跨用户拿 USER_ADHOC questionId 也能扣费 + 泄露 stem"；`pnpm.cmd --filter @zhijiao/web test -- tests/integration/error-diagnose-question-access.test.ts` 应全绿（4 测例：owner / cross-user USER_ADHOC / PUBLISHED / missing）
26. **error.findEntryForQuestion DELETED 视同 null**（Plan 8 hotfix P2）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/error-find-entry-for-question.test.ts` 应全绿（5 测例：null / ACTIVE / ARCHIVED / DELETED→null / 跨用户→null）。DELETED 是终态，partial unique idx 允许同题新 ACTIVE 与 DELETED 共存，卡片应把 DELETED 后的题视作"还没诊断"，不要漏改成 `notIn: ["DELETED"]` 之外的形态
27. **TutorForm 的 ErrorAnalysisCard 必须 key={data.questionId}**（Plan 8 hotfix P2 #1）：`Select-String -Path apps/web/components/TutorForm.tsx -Pattern "key=\{data.questionId\}"` 应命中；不然换题后会保留上一题的 rootCause + 详情链接。E2E `tutor-error-book-link.spec.ts` 第 3 测例守门
28. **`tutor-error-book-link.spec.ts` 必须用 per-run 唯一 stem**（Plan 8 hotfix P3）：`Select-String -Path apps/web/e2e/tutor-error-book-link.spec.ts -Pattern "freshStem|randomUUID"` 应命中。spec 不能用固定题面，否则第二次 `playwright test` 跑同 DB 时 `findEntryForQuestion` 命中已存在 entry → 卡片 mount 在 "已诊断" 态而不是 empty CTA → `error-analysis-card-empty` 期望失败。注：OTP 5/h burst 限频是另一个 pre-existing 问题，本 plan 不修
29. **Prisma schema 字段合并后先 regenerate client**：凡是 merge 包含 `packages/db/prisma/schema.prisma` 新字段 / enum / relation，主 worktree 先跑 `pnpm.cmd --filter @zhijiao/db db:generate`，再跑 `pnpm.cmd exec turbo typecheck --force`。否则 stale Prisma Client 会在 typecheck 报找不到新字段
30. **KpAlias subject 隔离 unique idx 落库**（Plan 9 §2.1）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d kp_aliases"` 应见 `UNIQUE (subject_id, normalized_alias)`。同 alias 跨 subject 允许，同 subject 内唯一
31. **三个 sync 调用点都包 try/catch**（Plan 9 §3.4.2 / 红线 #1）：`Select-String -Path apps/web/server/routers/tutor.ts,apps/web/server/routers/error.ts,apps/web/server/routers/variant.ts -Pattern "reconcileHintsSync" -Context 2,5` 每处必须出现在 `try { ... } catch` 块内 + `logger.warn` 兜底
32. **sourceRefType=VARIANT_ITEM 永不写 QuestionKPLink**（Plan 9 §3.3 / 红线 #2）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant.test.ts` 应全绿（含 BACKFILL+VARIANT_ITEM 测例守门 source vs sourceRefType 分流条件）
33. **LINKED→REJECTED 反悔入口未暴露**（Plan 9 §5.5 / 红线 #10）：`grep -rn "unlinkIfOrphan" apps/web/server/routers apps/web/scripts` 应 0 命中。Plan 9 只 export helper + 文档化清理 SQL；unit test import 它走 helper 不算"用户入口"
34. **backfill 脚本幂等**（Plan 9 §7.2）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-backfill.test.ts` 应全绿（覆盖第二次跑 alreadySeen 计数 + 行数不变）
35. **注销支持页 placeholder 不能误当正式信息**（Plan 6 §6.1）：`Select-String -Path apps/web/app/support/deactivate/page.tsx -Pattern "XXXXX|support@zhijiao.example"` 应命中；prod ship 前必须替换公众号 / 邮箱域名 / 运营主体 / ICP 号
36. **VariantGroup.entry 已改 Cascade**（Plan 6 §2）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d variant_groups"` 应见 `ON DELETE CASCADE`，保证注销删 ErrorBookEntry 时变式组/题跟随删除
37. **WechatPayEvent.rawBody 可 nullable**（Plan 6 §2）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d wechat_pay_events"` 应见 `raw_body` nullable；GC medium bucket 才能 scrub raw body
38. **业务代码不得直接 hard-delete User**（Plan 6 红线）：`rg -n "prisma\.user\.delete\(|users\.delete\(" apps/web/server packages/billing/src packages/auth/src` 应 0 命中；账号注销统一走 `deactivateUser`
39. **USER_DEACTIVATED auth guard 在位**（Plan 6 §3）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deleted-user-auth-guard.test.ts` 应全绿；refresh route 应 401 + 清 cookies
40. **OpsActionLog payload 不含 PII**（Plan 6 §2.4）：`pnpm.cmd --filter @zhijiao/web test -- tests/unit/pii-ops-action-log-payload.test.ts` 应全绿；禁止 phone/openid/rawBody/requestJson/outPath 等进入 payload
41. **PII GC dry-run smoke**（Plan 6 §5）：`pnpm.cmd --filter @zhijiao/web pii:gc-sweep --dry-run` 应打印 results 且不写 `OpsActionLog`
42. **VariantItem.questionId FK/unique 已落库**（Plan 12 §2）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d variant_items"` 应见 `question_id`、`variant_items_question_id_key`、`ON DELETE RESTRICT`
43. **VariantItem backfill 0 残留**（Plan 12 §4.4）：三条探针均应 count=0：`variant_items WHERE question_id IS NULL`；`variant_items JOIN questions WHERE q.source IS DISTINCT FROM 'VARIANT_GENERATED'`；`q.created_by_user_id IS NOT NULL AND q.created_by_user_id != vg.user_id`
44. **Promoted variant KP link 不污染 parent**（Plan 12 R2/R5）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant-promoted.test.ts` 应全绿，且断言 `KpReconcileMatch.questionId === QuestionKPLink.questionId === VariantItem.questionId`
45. **VARIANT_GENERATED owner-only**（Plan 12 §6）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-question-access-owner-only.test.ts` 应全绿；cross-user 返回 `NOT_FOUND / QUESTION_NOT_FOUND` 且不写 DEBIT
46. **Backfill CLI smoke**（Plan 12 §4）：`pnpm.cmd --filter @zhijiao/web variant:backfill-questions --dry-run` 应 exit 0；脚本不得 import `server/lib/question.js` 或 `server-only`
47. **Assignment 变量计费不越权扣费**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-generate-billing.test.ts` 应全绿；跨班级 / 不存在 classroom 不写 DEBIT。
48. **Assignment 权限不泄露存在性**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-permissions.test.ts` 应全绿；跨教师 / 跨学生返回 `NOT_FOUND` 而非 `FORBIDDEN`。
49. **Assignment 状态机锁定发布快照**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-state-machine.test.ts` 应全绿；发布后 `updateDraft` 返回 `ASSIGNMENT_STATE_CHANGED`。
50. **Assignment 批改回流错题本**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/assignment-error-book-writeback.test.ts` 应全绿；`WRONG` / `PARTIAL` 写回，`CORRECT` 不写回。
51. **Assignment PII 治理**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts tests/unit/pii-ops-action-log-payload.test.ts` 应全绿；注销删除学生作业提交/表现，导出只含本人白名单数据。
52. **Assignment E2E 闭环**（Plan 10）：`pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/assignment-lifecycle.spec.ts` 应全绿。
53. **analytics 包零基础设施依赖**（Plan 11 §8.1）：`grep -rn "ioredis\|@zhijiao/ai\|server-only" packages/analytics/src` 应 0 命中（纯计算包，redis/ai/projection/access 全留在 apps/web）。
54. **数据不足不渲染 0% / 不进 mastery**（Plan 11 §8.2）：`pnpm.cmd --filter @zhijiao/analytics test -- tests/core.test.ts` 应全绿，覆盖 `weightedSampleSize<1 → INSUFFICIENT_DATA, score=null`。色块用蓝 `bg-sky-100` 非红。
55. **requireProfileAccess 无权返 NOT_FOUND 不 FORBIDDEN**（Plan 11 §8.3）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/profile-access.test.ts` 应全绿（self/parent/teacher/stranger + REVOKED 失效 5 例）。
56. **analytics router 三视图 + 付费建议**（Plan 11）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/analytics-router.test.ts` 应全绿；家长得 `view`、教师得 `profile`、stranger `NOT_FOUND`、非教师 diagnosis `NOT_FOUND`、generateAdvice 扣 1 credit。**id 用 `z.string().min(1)` 不是 `.cuid()`**（seeded id 非 cuid）。
57. **family-link 发码/绑定/单次用尽/自绑拒绝/撤销失效**（Plan 11 §8.5）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/family-router.test.ts` 应全绿（5 例）。`FamilyLink` 两 FK `ON DELETE RESTRICT` + `@@unique([parent,student])`：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d family_links"` 核对。
58. **PII 覆盖 FamilyLink**（Plan 11 §8.6）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts tests/unit/pii-ops-action-log-payload.test.ts` 应全绿；注销删双向 link、导出含本人 link（不含对方 PII）、payload 禁词集含 `parent_user_id`/`student_user_id`/`counterpartUserId`。
59. **Plan 11 E2E**（§8）：`pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/learning-portrait.spec.ts e2e/family-link.spec.ts` 应 2/2 passed。**注**：全量 `test:e2e` 会因 per-IP OTP burst 限频（`RULE_OTP_SEND_IP` capacity=10 / `failMode:close`）在 login 处零散失败——pre-existing（红线 #28），按 spec 分批跑可绿，非 Plan 11 回归。

**下一步候选 Plan**（Plan 4 + Plan 6 + Plan 8 + Plan 9 + Plan 10 + Plan 11 + Plan 12 已落地）：
- Plan 5: 真接阿里云 SMS + 微信公众号（ICP 备案通过后；**且 Plan 2 Hardening 必须先 ship**；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
- Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 商户证书；激活 `RealWechatPayAdapter.unifiedOrder` + `verifyNotify`）—— **Plan 3 prod ship prereq**
- Plan 14: 未成年人特殊保护 / PIPL 完版（<14 监护人代办、数据副本/删除请求 SLA 完整化、通用 PII 扫描与运营 SOP）
- Plan 12 cleanup: `VariantItem.questionId NOT NULL` + 下线 nullable reconcile 分支 + 处理历史 `VARIANT_TO_PARENT_NEEDS_REVIEW` 行
- Plan 15: USER_ADHOC × PUBLISHED canonical dedup / 题库去重 / PUBLISHED 复用 / 统计归并（Plan 8 §6.2 punt）
- Plan 13: KP 树扩充（small / middle / high school math KP curation；当前 seed 仅 4 个 math KP，alias 表长得慢，Plan 9 上线一段时间后 UNMATCHED → DROPPED 比例高）
