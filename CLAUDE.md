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
- PII 治理 plan：用户注销 / 去标识化 / `WechatPayEvent.rawBody` 保留期 / `TopupOrder` 孤儿订单清理策略
- ICP 备案 + 微信商户号申请 + APIv3 密钥 + 商户证书 / `WECHAT_PAY_USE_MOCK=false` 配套 6 个 real env
- Real adapter 激活：实现 `unifiedOrder` 走 V3 prepay API + `verifyNotify` 走 RSA-SHA256 + PlatformCertProvider 真接（独立 plan）

**鉴权现状**：
- 自建 JWT（jose HS256）+ Prisma `Session` 表（含 rotate + reuse detection）+ Redis（限频 / OTP nonce / register payload / wx state）
- 手机号 OTP：阿里云 SMS 真接代码留好，开发态 `SMS_USE_MOCK=true` 走 console；E2E 走 Redis 内的 `e2e-hooks/last-otp` test endpoint
- 微信 H5 OAuth：完整路由 + adapter 接口；`MockWechatH5Adapter` 默认，真接公众号留下个 plan
- `Role` 仅 `OPS / ADMIN`；`Persona`（STUDENT/TEACHER/PARENT）是 onboarding 默认入口，不再是权限门槛；`PAPER_GEN / LESSON_PLAN_GEN / PPT_GEN / TUTOR_ASK / ERROR_BOOK_VIEW_OWN` 对所有登录用户开放
- tRPC v11 全量落地；`apps/web/app/(student)/tutor/actions.ts` 已删除，改走 `tutor.ask` procedure；`DEV_USER_ID` 已下线

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

**下一步候选 Plan**：
- Plan 4: 举一反三 + 错因分析（VariantGroup + ErrorBookEntry + 三阶变式生成）—— 复用 chargedProcedure 处理 `VARIANT_GROUP_GEN` / `ERROR_ANALYSIS` 计费
- Plan 5: 真接阿里云 SMS + 微信公众号（ICP 备案通过后；**且 Plan 2 Hardening 必须先 ship**；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
- Plan 6: PII 治理（用户注销 / 去标识化 / `WechatPayEvent.rawBody` 保留期 / `TopupOrder` 孤儿订单清理）—— **Plan 3 prod ship prereq**
- Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 商户证书；激活 `RealWechatPayAdapter.unifiedOrder` + `verifyNotify`）—— **Plan 3 prod ship prereq**
