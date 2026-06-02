# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库内工作时提供指引。

> **派生文档**（为控制本文件体积，超 40k 字符的工作知识已外移，触碰相关模块前先读）：
> - 各 Plan 落地后的实现现状（红线 / 不变量 / 设计代价）→ `docs/claude/implementation-state.md`
> - Merge 后必跑的回归探针清单 → `docs/claude/merge-verification.md`

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
- **Plan 13**（KP 树扩充：全学段单 math subject 4 层树 学段→领域→主题→叶子、分学段手写数据文件 + validateKpData 全局 code/alias 唯一校验、通用 seedSubjectKpTree loader、reconciler leaf-only EXACT 守卫、现有 4 KP 实迁 code 不变）—— 见 `docs/superpowers/plans/2026-05-30-kp-tree-expansion.md`，spec 在 `docs/superpowers/specs/2026-05-30-kp-tree-expansion-design.md`
- **Plan 14a**（未成年人监护人同意 <14 硬门禁：birthYear 自报 + isUnder14 保守判龄、guardianConsentStatus 承重字段进 ctx.auth、GuardianConsent 审计表、requireGuardianConsent 中间件 + chargedProcedure/consentGatedProcedure 双门禁、复用 FamilyLink bindByCode 写同意、revoke 回 PENDING、PII 覆盖、注册/家长端 UI）—— 见 `docs/superpowers/plans/2026-05-30-minor-guardian-consent.md`，spec 在 `docs/superpowers/specs/2026-05-30-minor-guardian-consent-design.md`
- **Plan 14c**（通用 PII 扫描器·落库前脱敏：`packages/domain/src/pii.ts` 纯核 scanPii/redactPii 手机号 + 身份证 MOD-11、全占位掩码只返计数、输入侧 tutor.ask/error.diagnose body 喂 AI+落库前脱敏、输出侧 router.ts 全部 5 处 parse+persist 咽喉脱敏）—— 见 `docs/superpowers/plans/2026-05-31-pii-scanner.md`，spec 在 `docs/superpowers/specs/2026-05-31-pii-scanner-design.md`
- **Plan 14b**（DSAR 数据主体请求 + SLA：`DsarRequest` 工单表、数据副本自助导出 + 注销 OPS-CLI 履行的 hybrid 模型、`<14` 注销经绑定监护人站内审批、OTP 重验 + `verifyOtp` purpose 隔离、export fail-CLOSE 限频、REJECTED 回显理由、15 工作日/30 自然日封顶 SLA、`dsar.*` 监护人门禁白名单、PII 扩展 scrub reason + 悬挂收口 + export 段 schemaVersion 2026-05-31）—— 见 `docs/superpowers/plans/2026-05-31-dsar-data-subject-requests.md`，spec 在 `docs/superpowers/specs/2026-05-31-dsar-data-subject-requests-design.md`
- **Plan 12 cleanup**（VariantItem.questionId NOT NULL + 退役 legacy reconcile 分支：`findUniqueOrThrow` 解析 + 同步/异步双路径均 LINK 变式题自身 Question + `VARIANT_TO_PARENT_NEEDS_REVIEW` 降为 tombstone + 退役 `variant-backfill-questions` 脚本）—— 见 `docs/superpowers/plans/2026-06-01-plan12-cleanup.md`，spec 在 `docs/superpowers/specs/2026-06-01-plan12-cleanup-design.md`
- **Plan 16**（demo-ready 产品打磨：门禁 `/demo` 演示中心 + 学生/教师/家长三身份快速入口、确定性中文 §4 种子 `server/demo/seed.ts`（初二3班·一次函数与方程/不等式·3 KP·L1/L2/L3 变式）+ `verifyDemoData` 最小数量校验、`isDemoRuntimeAllowed` 生产兜底门禁（`NODE_ENV!=="production"` 或 `E2E_TEST_HOOKS=1`）、role-aware AppShell/RoleNav/DemoModeBanner + `ui/` 基础组件 + 状态面板、`lib/error-copy.ts` + `lib/assignment-copy.ts` 合规中文文案/枚举映射、`demo:reset`/`verify:demo` 脚本 + demo E2E、reset 后清 analytics 缓存）—— 见 `docs/superpowers/plans/2026-06-02-demo-ready-product-hardening.md`，spec 在 `docs/superpowers/specs/2026-06-02-demo-ready-product-hardening-design.md`。**遗留项已全部收口**（见下方 follow-up 与 residuals 两条）。
- **Plan 16 follow-up**（§9/§10 残留收口：`server/shell-identity.ts` 从会话解析身份 → async `AppShell` 显示当前身份徽标 + 角色从 persona 派生、12 页去掉写死 role/demoMode；`navForRole(role, classroomId?)` 教师导航锚点进班级工作台（修好原指向 `/teacher` 的死链 AI 预览）；`ui/skeleton.tsx` 骨架屏接入 5 个客户端数据视图；`ui/ai-generating-panel.tsx` + tutor/变式流的「AI 生成中」面板与「重试」入口；vitest esbuild jsx automatic + `.test.tsx` 渲染测试）—— 见 `docs/superpowers/plans/2026-06-02-plan16-shell-state-followup.md`，spec 在 `docs/superpowers/specs/2026-06-02-plan16-shell-state-followup-design.md`
- **Plan 16 residuals**（收口最后两项：`/api/demo/enter` 由带副作用 GET 改为 POST（303，从 `/demo` 表单提交）避免预取/CSRF；demo 种子学生作业改 `GRADED`（与已批改答案 + 错题回流一致，符合 Plan 10 状态机）+ `verifyDemoData` 同步）—— 无独立 spec/plan，属 Plan 16 收尾
- **靶向训练 v1**（免费·复用优先的薄弱点练习会话：`TrainingAttempt` 表 + `TrainingItemSource` 枚举；analytics `PerfSample.sourceWeight` + `profileForStudent` 降权混入自评样本闭合 训练→学情；`training.startSession`（FOCUS 排序自错题本+变式、不足回退 dueForReview、空态 INSUFFICIENT_DATA）+ `submitAttempt`（自评、KNOW 推进复习阶梯、跨用户 NOT_FOUND）；抽出共享 `advanceReviewLadder`；`/training` hint-first 自评 UI + 训练导航 + 画像 CTA）—— 见 `docs/superpowers/plans/2026-06-03-targeted-training.md`，spec 在 `docs/superpowers/specs/2026-06-03-targeted-training-design.md`

## 实现现状

各 Plan 落地后的工作知识（红线 / 不变量 / 设计代价）已拆到 **`docs/claude/implementation-state.md`** —— 触碰相关模块前先读对应"现状"段（学情画像 Plan 11 / 教师作业 Plan 10 / 计费 / 鉴权 / 错题本变式 Plan 4 / 答疑持久化 Plan 8 / 知识点 Plan 9 / KP 树 Plan 13 / VariantItem Plan 12 / 未成年同意 Plan 14a / PII 扫描器 Plan 14c / DSAR Plan 14b / PII 治理 Plan 6 / 靶向训练 / E2E 现状）。新 Plan 落地后在该文件追加，不写回本文件。

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

## Merge 后必跑（不是"绿测试"就行）

73 条回归探针已拆到 **`docs/claude/merge-verification.md`** —— 每次 merge 后逐条核对；新探针追加到该文件，不写回本文件。

**下一步候选 Plan**（Plan 4 + Plan 6 + Plan 8 + Plan 9 + Plan 10 + Plan 11 + Plan 12 + Plan 13 + Plan 14a + Plan 14b + Plan 14c + Plan 16 + 靶向训练 v1 已落地）：
- **图片/OCR 输入**（发布计划里 MVP 收尾的下一项：答疑/错题支持拍照/截图/公式图片，OCR 接入编排层）—— 上线前最后一个 MVP 闭环项
- Plan 5: 真接阿里云 SMS + 微信公众号（ICP 备案通过后；**且 Plan 2 Hardening 必须先 ship**；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
- Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 商户证书；激活 `RealWechatPayAdapter.unifiedOrder` + `verifyNotify`）—— **Plan 3 prod ship prereq**
- Plan 15: USER_ADHOC × PUBLISHED canonical dedup / 题库去重 / PUBLISHED 复用 / 统计归并（Plan 8 §6.2 punt）
- Plan 17: 生产 AI 出卷（Plan 16 §6 预览卡占位；当前仅 roadmap）
- Plan 18: 生产 AI 课件（Plan 16 §6 预览卡占位；当前仅 roadmap）
