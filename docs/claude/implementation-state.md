# 实现现状（各 Plan 落地后的工作知识）

> 本文件从 `CLAUDE.md` 拆出（CLAUDE.md 超 40k 性能阈值）。它是各 Plan 落地后的承重工作知识 ——
> 承载红线、不变量、设计代价。**新 Plan 落地后在此追加现状段，不要写回 CLAUDE.md。**
> 真源仍是 docx 需求文档与各 `docs/superpowers/plans/*.md`。

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
- 关键：`sourceRefType=VARIANT_ITEM` 经 `findUniqueOrThrow` 解析 `VariantItem.questionId`（Plan 12 cleanup 后恒非空），EXACT/ALIAS 直接 LINKED 到 variant Question 的 `QuestionKPLink`，未命中的 UNMATCHED 行也记 variant question id。永不自动污染 **parent** QuestionKPLink；判分流条件是 sourceRefType 不是 source（旧 `VARIANT_TO_PARENT_NEEDS_REVIEW` 两路分支已于 cleanup 退役，见下方「VariantItem 升格现状」段）
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

**KP 树现状**（Plan 13）：
- 单 `math` subject 4 层树（学段 L1 / 领域 L2 / 主题 L3 / KP 叶子 L4），全部 `KnowledgePoint` 行靠 `parentId` 连，无 schema migration。
- 数据真源：`packages/db/prisma/seed/kp-data/{junior,primary,senior}-math.ts`（叶子内联 aliases）+ `index.ts` 聚合 `mathKpRoots`；`types.ts` 纯 `validateKpData`（全局 code 唯一 / alias 唯一 / alias 只挂叶子，命中即 throw）。
- `0_curriculum.ts` 通用 `seedSubjectKpTree` 深度优先 upsert（按 `subjectId_code` 幂等，容器 difficulty 取 default 3）；seed 入口先跑 `validateKpData`。`3_kp_aliases.ts` 改为消费 `collectLeafAliases(mathKpRoots)` 单一真源（`update:{kpId}` 安全因校验已防跨 KP 冲突）。
- reconciler `loadSubjectCandidates` 仅叶子进 name/code EXACT 池（容器永不命中 → 不污染 Plan 11 按 kpId 聚合的掌握度）；`kpById` 仍含全部节点供 ALIAS cross-subject 防御。
- 现有 4 KP（`math-g8-linear-eq*`）code 保留不变、实迁挂到 `初中→数与代数` 下。**全学段已做透（树 185 KP）**：小学（义教课标四领域）/ 初中（数与代数·图形与几何·统计与概率·综合与实践全覆盖）/ 高中（普高课标四主线 + 预备知识）。仅初中"综合与实践"与小学/高中同名领域留极少占位。后续扩树 = 往 `kp-data/*.ts` 加 `KpNode` 节点即被校验/seed/匹配，不需新 plan。
- 设计取舍（不拆 subject）：跨学段同名节点（"函数"）无法 EXACT/ALIAS 自动匹配是**正确保守行为**（落 UNMATCHED 等 LLM/人工），首发初中-only 下代价≈0。

**VariantItem 升格现状**（Plan 12 + 2026-06-01 cleanup）：
- `VariantItem.questionId` 现为 **NOT NULL**，恒指向 `Question(source="VARIANT_GENERATED")`；新生成变式同事务双写 Question + VariantItem。
- `reconcileHintsSync` 对 `sourceRefType=VARIANT_ITEM` 用 `findUniqueOrThrow` 解析 `VariantItem.questionId`，**所有分支**（LINKED + UNMATCHED）的 match 行均记**变式题 id**；EXACT/ALIAS 直接 LINK 到变式题 QuestionKPLink。红线 #2 = 永不写 **parent** QuestionKPLink（仍成立）。
- 异步 `applyLlmResult` 对变式高置信命中与其它 source 一致 **自动 LINK** 到变式题，不再进人工 review。
- `KpReconcileReviewReason.VARIANT_TO_PARENT_NEEDS_REVIEW` 为 **tombstone**：无代码读写，Postgres 无 DROP VALUE 故保留。`variant-backfill-questions` 脚本/测试已退役（NOT NULL 后无 null 可补）。`kp-backfill-variant-items` 仍有效。
- `VARIANT_GENERATED` 与 `USER_ADHOC` 同为 owner-only；注销 scrub `createdByUserId=null` 保留行作统计样本。

**未成年同意现状**（Plan 14a）：
- `<14` 判定：`User.birthYear`（自报年份，STUDENT 注册必填）→ `isUnder14(birthYear)`（`apps/web/server/lib/consent.ts` 纯函数，保守 `当前年−birthYear ≤ 14` 宁可多触发）。`User.guardianConsentStatus`（`NOT_REQUIRED`/`PENDING`/`GRANTED`，默认 NOT_REQUIRED）是承重字段，进 `ctx.auth`（与 isMinor 同查询，不进 JWT）。
- 硬门禁：`requireGuardianConsent` 中间件（`assertConsentOk` 纯函数判定）拦 `PENDING` → `FORBIDDEN/GUARDIAN_CONSENT_REQUIRED`。**双覆盖**：折进 `chargedProcedure`（所有付费动作一处覆盖）+ `consentGatedProcedure`（非付费数据 router：error/analytics/assignment 读写）。**白名单**：`auth.*` / `family.*`（同意流程本身）继续裸 `authedProcedure`。
- 同意获取（复用 Plan 11 FamilyLink）：`<14` child（`guardianConsentStatus !== "NOT_REQUIRED"`）经 `family.bindByCode({ code, guardianConsent:true })` 由家长（PARENT 账号）勾选同意 → 同事务写 `GuardianConsent`（method=`FAMILY_LINK_BIND`，scope=`FULL_SERVICE`）+ 激活 child `GRANTED`。每个监护人各记一行（多监护人累积）；`needsConsent` 按 `!== NOT_REQUIRED` 不是 `=== PENDING`，否则第二监护人对已 GRANTED child 不记同意。
- 撤回：`family.revoke`（任一方可撤，沿用 Plan 11）同事务写 `GuardianConsent.revokedAt` + 若 child 失去全部有效 consent → 回 `PENDING`（重新门禁）。child `GRANTED` 当存在 ≥1 个 `revokedAt=null` consent。
- UX：edge `middleware.ts` 读不到 DB 状态（不进 JWT），故 enforcement 全在 tRPC 层；客户端 `providers.tsx` 的 `QueryCache/MutationCache onError` 捕获 `GUARDIAN_CONSENT_REQUIRED` → 跳 `/guardian-consent`（童发码引导页）。注册表单（STUDENT 出生年份）与家长端绑定（监护人同意勾选框）均已接 UI。
- PII（扩 Plan 6）：注销 child 删其 consent + payload 计数；注销 guardian 删其作 guardian 的 consent + 受影响 child 失去全部有效 consent 回 PENDING；导出含本人 consent（guardian id masked）+ birthYear；注销 scrub `birthYear=null`；payload guard 禁词加 `birth_year`/`birthYear`/`guardian_user_id`/`child_user_id`。
- 两默认（已确认）：既有无 birthYear 用户 grandfather（NOT_REQUIRED 不硬锁）；birthYear 仅 STUDENT 必填，TEACHER/PARENT 视为成年。
- E2E seed：`dev-student-05`(13800000010, birthYear 2015→PENDING) 发码、`dev-parent-03`(13800000011) 绑定，专给 `guardian-consent.spec.ts`。

**PII 扫描器现状**（Plan 14c）：
- 纯核 `packages/domain/src/pii.ts`：`redactPii(text)→{ redacted, hits:{phone,idCard} }` + `scanPii(text)→PiiHits`，零依赖纯函数。手机号 `(?<!\d)1[3-9]\d{9}(?!\d)`（数字边界，避免命中更长数学串中段）；身份证 18 位结构化正则（6 地区 + `(?:19|20)\d{2}` 年 + 合法月日 + 3 序 + 校验位）**且** GB 11643 MOD-11 校验位通过才脱敏（校验失败的长数字不误伤）。**全占位掩码** `[手机号]`/`[身份证号]`；**只返类型计数、绝不返回命中原值**（防 PII 流进日志/审计）。先身份证（更长更具体）后手机号。
- 输入侧：`tutor.ask`（题面 `questionStem`）/ `error.diagnose`（学生自由作答 `actualAnswerMd`）在 body 内脱敏一次，**同时喂 AI 与 upsert/持久化**，模型与 DB 都拿不到原值。命中时 `logger.info({ event:"pii_redacted_input" })` 只记计数。
- 输出侧：`packages/ai/src/router.ts` 在 adapter 返回后、`JSON.parse(response.content)` 前 `response.content = redactPii(...).redacted`。注意 **5 处** parse+persist 站点都要脱敏：`runJsonTaskWithAudit`（learningAdvice/assignment 等）+ tutor/errorAnalysis/variant/kpReconcile 各自的 inline 重试循环（这 4 个不走 runJsonTaskWithAudit，是 plan 的错误假设，实现时补齐）。占位符不含引号/括号，落在 JSON 字符串值内仍合法。
- 边界：纯文本变换不抛错、不阻断、不额外计费、不回扫存量数据；MOD-11 测试号必须真有效（`440524198001010013` 年 1980 有效；plan 原列 `...188...` 年 1880 被 `(?:19|20)` 正则拒收已修正）。

**DSAR 现状**（Plan 14b）：
- `DsarRequest` 工单表（type `EXPORT`/`DELETION`，status `AWAITING_GUARDIAN`/`PENDING`/`COMPLETED`/`REJECTED`/`CANCELED`）为数据主体请求真源，区别于运营发起的 `OpsActionLog`。partial unique idx `dsar_one_open_deletion_idx`（raw SQL）保证一个用户至多一条未结 DELETION。service 在 `apps/web/server/lib/dsar.ts`（**不带 `import "server-only"`** —— 被 tsx CLI import，server-only default 会 throw），被 `dsar` router 与 CLI 共用。
- **hybrid 履行**：EXPORT 自助即时（`exportMine` → `$transaction` 内 `exportUserData` + 记 COMPLETED 工单 → 浏览器 Blob 下载）；DELETION 工单化（成年 OTP 重验 → `PENDING`；`<14` → `AWAITING_GUARDIAN` 须绑定监护人 `approveChildDeletion` 站内审批转 `PENDING`；无绑定监护人 → `DSAR_GUARDIAN_REQUIRED` 引导人工渠道）。OPS CLI `dsar:list/fulfill/reject` 履行。
- **合规红线**：`dsar.*` 全裸 `authedProcedure`（监护人门禁白名单，否则 PENDING-consent `<14` 连导出/注销都做不了）。REJECTED 经 `myRequests.rejectionReason` 回显理由（PIPL 第 50 条第 2 款）。SLA `dueAtFor = min(15 工作日, +30 自然日)`。
- **安全**：`RULE_DSAR_EXPORT` **fail-CLOSE** cap 2/天（全量 PII 导出高敏，Redis 挂宁可拒不放任 dump）；`RULE_DSAR_VERIFY_PH` 专用桶；`verifyOtp(...,purpose)` 隔离（LOGIN 码不能授权注销）；`fulfillDeletion` 未成年闸门凭 `guardianApprovedByUserId` 数据可验证（非 CLI 荣誉旗标）+ live `isMinor` 复核。
- **关键实现坑**：`fulfillDeletion` **不**嵌套 `$transaction`（`deactivateUser` 自带交互事务，Prisma 5 不可嵌套）；且 `deactivateUser` 事务内已把 open DELETION 翻 COMPLETED（悬挂收口），故 `fulfillDeletion` 顺序调用后只 `findUnique` 断言终态 COMPLETED，不再 predicate-on-update（否则误报 concurrently-resolved）。入口 `status!==PENDING` 守卫挡顺序双 fulfill。
- **PII（扩 Plan 6）**：注销 scrub 本人 `DsarRequest.reason=null` **保留行**（SLA 审计证据）+ 悬挂 open DELETION 收口 COMPLETED；`payload.scrubbed.dsarRequests` 计数；export 加 `dsarRequests` 段（无 reason/resolutionNote 自由文本）+ `schemaVersion` 升 `2026-05-31`；payload 守词加 `dsar_reason`/`resolution_note`。
- 无手机号（WeChat-only）→ `DSAR_NO_PHONE` 走人工渠道。UI 在 `/account/privacy`（persona-neutral，`middleware.ts` PROTECTED_PREFIXES + matcher 加 `/account`）+ 家长 `/parent/children/[childId]` 审批块。E2E 用独占成年 seed `dev-student-06`(13800000012)。**显式未做**：PIPL 第 46 条更正权、完成态 SMS 通知、服务端导出落盘副本。

**PII 治理现状**（Plan 6）：
- OPS CLI：`user:deactivate <userId> [--reason TEXT] [--dry-run]` / `user:export <userId> --out <path.json>` / `pii:gc-sweep [--bucket short|medium|orphan|all] [--dry-run]`；全部走 shared service，不引入 apps/web 内置 cron
- 注销：User 行 soft-delete 作 tombstone；硬删 `ErrorBookEntry`（级联 `VariantGroup`/`VariantItem`）和用户 `USER_ADHOC Question`；删除 `AuthIdentity` + PHONE/GLOBAL 对应 `OtpRequest`；scrub Session / TopupOrder / ModelCall / KpAlias / KpReconcileMatch PII；Plan 12 后额外 scrub `VARIANT_GENERATED Question.createdByUserId=null` 但保留 Question 行；Plan 10 后删除该学生的 `StudentAssignment`（级联 `AssignmentAnswer`）和 `AssignmentPerformance`，payload 只记录计数；财务金额、订单号、ledger 保留
- 导出：`exportUserData` 只输出白名单 JSON；`AuthIdentity.providerUserId` 仅 masked；显式排除 `rawBody` / `requestJson` / `responseJson` / `ipCreated` / `userAgent` / 本地 outPath；Plan 10 后包含本人 `StudentAssignment`、`AssignmentAnswer`、`AssignmentPerformance` 白名单数据，不导出其它学生答案
- GC：short bucket 删除过期 OTP/Session；medium bucket scrub `WechatPayEvent.rawBody` 与 `TopupOrder.ipCreated/userAgent`；orphan bucket 删除过期未支付且无 ledger 引用的订单。外部 scheduler 配方在 `docs/ops/pii-scheduling.md`
- Auth guard：`USER_DEACTIVATED` 已进入 auth errors；`createContext` 对 deleted user 返回 `auth=null`，refresh route 清 cookies 并 401；注销后同手机号可重新注册新 User
- `OpsActionLog.payload` 只能写非 PII 摘要；新增 payload guard test 守门。业务代码不得直接 `prisma.user.delete()`，注销统一走 `deactivateUser`

**Plan 8 未完成的事 —— 等后续 plan**：
- ~~PII 扫描（手机号 / 身份证 regex）未在 Plan 6 做通用扫描器~~ → **Plan 14c 已落地**（`packages/domain/src/pii.ts` 通用 scanPii/redactPii，输入/输出双侧落库前脱敏）

**E2E 现状**：全量 `pnpm.cmd --filter @zhijiao/web test:e2e` 现可**一次跑绿**（16/16），不再需要分批。承重的三件事，缺一会重新 flake：
- `e2e/helpers/login.ts`：OTP 发送被 per-IP 限频（`RULE_OTP_SEND_IP` cap 10 / 1 token 每 6s / fail-close）拒时，stagger 重试（jitter backoff ≈ refill 间隔）而不是首次失败即挂；每次重试 `goto("/login")` 取干净态；并 `test.setTimeout` 抬高运行中 test 的上限好让 backoff 放得下。
- `playwright.config.ts` `workers: 1`：串行消除并行 worker 抢回血 token 的饿死（重试的 login 把刚回血的 token 输给别的 worker）；串行反而更快（并行版把时间烧在 backoff 上）。
- `e2e/global-setup.ts` `resetE2eRateLimits()`：每次跑前清 Redis 里 `otp:send:*`/`otp:verify:*`/`register:*`/`refresh:*` 桶——否则限频桶跨运行残留，第 N 次跑把桶抽干、第 N+1 次起步即空（同样输入两次跑一绿一红）。
- 注：`tour-shots/` 与 `e2e/product-tour.spec.ts` 是未追踪的本地可视化巡演产物，不在 CI 套件内，别误提交。
