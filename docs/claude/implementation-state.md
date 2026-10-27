# 实现现状（各 Plan 落地后的工作知识）

> 本文件从 `CLAUDE.md` 拆出（CLAUDE.md 超 40k 性能阈值）。它是各 Plan 落地后的承重工作知识 ——
> 承载红线、不变量、设计代价。**新 Plan 落地后在此追加现状段，不要写回 CLAUDE.md。**
> 当前产品方向真源是 `需求与架构文档.md`、`docs/product/product-direction.md` 与各 `docs/superpowers/{specs,plans}/*.md`。原 2026-05-18 docx 是历史快照，不再覆盖 2026-06-04 后的教师生产力转向。

**产品重心转向现状**（2026-06-04）：
- 项目重心已从“学生 AI 学习闭环（答疑 / 错因 / 举一反三 / 训练 / 错题本 / 学情）”转向“教师生产力工具”。学生端进入维护态：除稳定性、合规、安全、存量闭环和支撑教师工具的数据需求外，不继续扩展学生端新能力。
- 近期产品主线只有两条：Plan 17 `AI 出卷` 和 Plan 18 `AI 课件`。两者均已落地——Plan 17 第一突破口、Plan 18 第二支柱。
- Plan 17 `AI 出卷` 已落地：独立 `Paper`/`PaperItem`，复用现有 `PAPER_GEN` 固定计费，题库 best-effort 复用 + AI 补 gap，`PAPER_GENERATED` owner-only，双向细目表渲染时计算，打印页浏览器另存 PDF。
- Plan 18 已有 spec：独立 `Courseware`/`CoursewareSection`，复用 `LESSON_PLAN_GEN` 固定 3 credits，五段强校验（INTRO / EXPLANATION / EXAMPLE / PITFALL / EXERCISE），分段编辑，打印页，例题/练习 inline markdown 不落 `Question`。
- 新实现默认遵守扣费链顺序：`.input(...) -> requireTeacherPersona -> requireGuardianConsent -> chargeMiddleware(...) -> resolver`，畸形输入和非教师身份不得先扣费。

**Launch-prep 现状**（2026-06-04）：
- Launch readiness acceptance 已按「先 B 后 A」完成：private prod-style Docker dry run 通过（compose config、web/migrator build、Postgres/Redis healthy、16 个 migration、`/readiness` DB+Redis ok、`/login` 200），local demo/internal-test 通过（`demo:reset`/`verify:demo` 13 checks、focused demo/product E2E、full web E2E 24/24、`turbo typecheck --force`、`turbo test --force`、高风险 merge probes）。落地修复：storage real-mode env gate 覆盖、migrator 改为在 `/app/packages/db` 执行 `pnpm exec prisma migrate deploy`。验收报告见 `docs/ops/launch-readiness-report.md`。公网发布仍被 ICP、域名/TLS、真实短信/微信/OSS、生产 secrets 与备份策略阻塞。
- GitHub Actions CI 已落地并在 `master` 绿：push / PR 跑 `turbo typecheck`、`turbo test`、Playwright E2E、Docker image build。关键 CI 坑已修：Windows `.cmd` spawn 走 `execSync + PNPM_BIN`；`pnpm/action-setup` 必须早于 `setup-node cache: pnpm`；CI 全新 install 必须显式 `pnpm --filter @zhijiao/db db:generate`。
- E2E 已接入 CI：workflow 起 `pgvector/pgvector:pg16` + `redis:7-alpine`，跑 `test:setup` 后执行 web E2E；失败时上传 Playwright artifacts。`docker compose` cleanup 放在 `always()` step。
- Web production image 已落地：根 `Dockerfile` 构建 Next standalone web image；`NEXT_OUTPUT_STANDALONE=1` 只在 Docker build 打开，避免污染普通 `next build`。`apps/web/public/.gitkeep` 保证 standalone copy 目标稳定。
- Production deploy skeleton 已落地：`.env.production.example`、`docker-compose.prod.yml`、`Dockerfile --target migrator`、`docs/ops/production-deploy.md`。prod compose 暴露 web，Postgres/Redis 只在内部网络；`migrate` 用 profile 单独跑 `db:migrate:deploy`；compose config 和 web/migrator image build 已进 CI。
- Prod ops guardrails 已落地：`/readiness` 做 DB `SELECT 1` + Redis `PING` 依赖探针，web healthcheck 和 E2E server bootstrap 都改轮询 `/readiness`；`docs/ops/production-deploy.md` 补 first-deploy smoke、migration 前备份、恢复流程。实际 prod compose smoke 暴露并修掉两坑：可选 URL env 的空字符串必须按 unset 处理（否则 `.env.production.example` 的空 `WECHAT_PAY_NOTIFY_HOST` 会 fail）；Docker runner 阶段也必须装 `openssl`，否则 Prisma runtime 误选 `debian-openssl-1.1.x` query engine。
- 已验证：local prod-style smoke 可启动临时 prod Postgres/Redis、跑 16 个 migration、启动 web，`/login` 返回 200 且 web container healthy；临时 prod volumes 已 `down -v` 清掉。master merge commit `2cc143a` 的 CI run `26890807958` 已 success。
- 仍不是公网生产上线：ICP、域名/证书、真实短信、微信 OAuth、微信支付商户/APIv3/证书、OSS bucket/CDN、生产 secrets 注入与备份策略仍需独立推进；当前 production skeleton 只是可演练部署骨架。

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

**AI 出卷现状**（Plan 17）：
- 数据模型：独立 `Paper` / `PaperItem`，教师自有、不绑定班级；`PaperStatus` 只有 `DRAFT` / `READY`，`PaperItemSource` 只有 `BANK` / `AI_GENERATED`。`PaperItem` 保存题面、答案、解析、分值、难度、认知层级、KP hints 的快照；`Question.cognitiveLevel` 与 `Question(source="PAPER_GENERATED")` 支撑后续复用和 owner-only 访问。
- AI 与计费：复用既有 `PAPER_GEN` taskKind，固定 5 credits；链顺序是 `.input(...) -> requireTeacherPersona -> requireGuardianConsent -> chargeMiddleware("PAPER_GEN") -> resolver`。非教师在扣费前 `FORBIDDEN` 且不写 DEBIT；KP 与 subject 不匹配发生在扣费后但会补偿，净余额不变且不落 Paper。
- 生成链：`selectBankQuestions` 先按 subject/KP/题型/难度 best-effort 命中题库；不足题量才调 `AiRouter.generatePaper` 补 gap。BANK 命中不阻塞 AI gap；全 AI 出卷落 `Paper` + `PaperItem` + `Question(PAPER_GENERATED)`，每题默认 5 分，可在预览页调分。
- 权限：`requireTeacherPersona` 是教师入口门禁；`validatePaperOwnership` 对 `get/markReady/removeItem/updateItemPoints` 做 owner-only，跨教师/不存在合并 `NOT_FOUND/PAPER_NOT_FOUND`，避免存在性侧信道。`PAPER_GENERATED` 已加入 `validateQuestionAccess` owner-only 集，其他用户拿 questionId 经 `error.diagnose` 探测时返回 `NOT_FOUND`。
- UI：`/teacher/papers` 列表、`/teacher/papers/new` 参数表单、`/teacher/papers/[paperId]` 预览编辑、`/teacher/papers/[paperId]/print` 打印页已可用；教师导航 `AI 出卷` 指向 `/teacher/papers`，班级页原 Plan 17 占位卡已改为真实入口。打印页仍走 `paper.get` 权限链，DRAFT/READY 均可访问。
- 双向细目表：由 `buildSpecTable` 渲染时聚合 `KP × cognitiveLevel × type × difficulty`，返回 rows + `totalCount` + `totalPoints`；不额外持久化，避免调分/删题后的派生数据漂移。
- PII：注销教师删除其 `Paper`（级联 `PaperItem`），同时将本人 `PAPER_GENERATED Question.createdByUserId` 置 null 保留题目行；`exportUserData` 加 `papers` 白名单段（title/status/paramsJson/createdAt/items 的 stem/type/answer/solution/points/difficulty/cognitiveLevel/kpHints），不导出他人 Paper。
- **统考排版/结构化（2026-06-07）**：`paper.generate` 入参由 `questionTypes`+`count` 改为 `sections[{type,count,pointsPerItem}]` + `durationMinutes` + `textbookVersion`；分值以教师设定为准（不采信 AI 返回 points）。考试时长/教材版本只进 `paramsJson`，**无 schema 变更/无 migration**。大题分组用纯函数 `apps/web/lib/paper-exam-layout.ts`（`buildExamLayout`）在渲染时计算（题型序 选择→多选→填空→计算→证明→解答、中文大题号「一二三」、全卷连续小题号、大题小计、同/异分值 caption）。打印页 `/teacher/papers/[id]/print` 学生卷/教师卷双视图（`exam-paper-components.tsx`）：学生卷=卷头块+密封线(打印态)+客观题答题栏+填空横线+解答题留空；教师卷=逐题穿插答案/解析/评分标准+卷末双向细目表。题库按题型分别 best-effort 命中、不足才 AI 补缺；mock `buildMockPaper` 按 prompt 内 `SECTIONS_JSON` 机读行（全角冒号）出题。`selectBankQuestions`/`persistGeneratedPaper` 签名未变；旧 Paper（旧 paramsJson）向后兼容渲染。教材版本=轻量标签+prompt 提示（无题库筛选维度）。
- **已知 follow-up**：直接 `goto` 打印页 URL（冷导航/刷新/书签）在 E2E 中曾返回 NOT_FOUND；E2E 改走预览页「打印/导出」链接。需后续确认登录用户直接访问 `/teacher/papers/:id/print` 是否被错误重定向/拒绝（疑似 harness cookie 时序，亦可能是真实刷新 UX bug）。

**AI 课件现状**（Plan 18）：
- 数据模型：独立 `Courseware` / `CoursewareSection`，教师自有、不绑班级；`CoursewareStatus` 只有 `DRAFT` / `READY`；`CoursewareSectionType` 固定五值 `INTRO/EXPLANATION/EXAMPLE/PITFALL/EXERCISE`，`@@unique([coursewareId, position])`。例题/课堂练习仅作段 `contentMd`（Markdown），**不落 Question**（与 Plan 17 出卷区别）。
- AI 与计费：复用既有 `LESSON_PLAN_GEN` taskKind（`TASK_MODEL_MAP` 映 `qwen-max`），固定 3 credits；链顺序 `.input(...) -> requireTeacherPersona -> requireGuardianConsent -> chargeMiddleware("LESSON_PLAN_GEN") -> resolver`。非教师扣费前 `FORBIDDEN` 不写 DEBIT；KP 与 subject 不匹配在扣费后但补偿净零、不落 Courseware。
- 五段强校验：`LessonPlanGenerationOutputSchema` `.length(5)` + superRefine 保证恰好五段且五类型各一（缺/重/六段都拒）。`scanLessonPlanGenerationForForbidden` 复用 `findForbidden`（与 paper/assignment 同一禁词扫描）。mock 按 system message 关键词 `课件生成助手` 派发 `DEFAULT_LESSON_PLAN`。
- 落库顺序：`persistGeneratedCourseware` 按 `LESSON_SECTION_ORDER` 重排，position 固定 1..5（**不信任 AI 返回顺序**），schema 已保证五类型各一所以缺段会抛。
- 权限：`requireTeacherPersona` 教师入口门禁；`validateCoursewareOwnership` 对 `get/markReady/updateSection` owner-only，跨教师/不存在合并 `NOT_FOUND/COURSEWARE_NOT_FOUND`，注入 `ctx.courseware`（含 sections 按 position）。
- UI：`/teacher/coursewares` 列表、`/teacher/coursewares/new` 参数表单（年级 + KP 多选 + 可选教学目标）、`/teacher/coursewares/[id]` 预览分段编辑 + markReady、`/teacher/coursewares/[id]/print` 打印页已可用；教师导航 `AI 课件` 改指 `/teacher/coursewares`（不再 preview），班级页 `#ai-courseware` 占位卡改为「去做课件」真实入口。打印页走 `courseware.get` 权限链，DRAFT/READY 均可访问。
- PII：注销教师删除其 `Courseware`（级联 `CoursewareSection`），无 Question 牵连；`exportUserData` 加 `coursewares` 白名单段（title/status/gradeLevel/createdAt + sections 的 type/title/contentMd），不导出他人 Courseware。

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
- **env 校验 + 本地 env-loading 坑**（Plan 2 Hardening / 2026-06-03 实测）：`apps/web/server/env.ts` 在 module-load 跑 `Env.safeParse(process.env)`，失败即 `throw`（无静默兜底）；`NEXT_PHASE==="phase-production-build"`（即 `next build`）走 placeholder 旁路**不**校验，只有 dev/start 真验。zod `.refine()`（AI/SMS/OAuth/Pay/Storage 真接闸门）**仅在 base object `.parse()` 成功后才跑**——base required（`DATABASE_URL/REDIS_URL/NEXT_PUBLIC_APP_URL/ACCESS_JWT_SECRET/OTP_PEPPER`）缺一，base parse 先失败、refine 永不执行。**裸 `next dev` 不读仓库根 `.env.local`**：Next 只从 cwd（`pnpm --filter` 下 = `apps/web`）读 `.env.local`，而仓库 `.env.local` 在**根** `D:\智教\`（`apps/web` 下没有），故 base env 实际来自 shell/OS 进程环境——本地手动验 fail-close（merge-verification 探针 5/9）须 inline 注入完整 base env，不能只靠改根 `.env.local`。

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

**E2E 现状**：全量 `pnpm.cmd --filter @zhijiao/web test:e2e` 现可**一次跑绿**（**27/27，19 个 spec 文件**；以 `playwright test --list` 的 `Total` 为准——单 chromium project、零 skip，list 数即 run 数）。**此数字是 source of truth，并在 `docs/claude/merge-verification.md` 探针 4 镜像一份；增/删任一 spec 后两处同步改。** 承重的三件事，缺一会重新 flake：
- `e2e/helpers/login.ts`：OTP 发送被 per-IP 限频（`RULE_OTP_SEND_IP` cap 10 / 1 token 每 6s / fail-close）拒时，stagger 重试（jitter backoff ≈ refill 间隔）而不是首次失败即挂；每次重试 `goto("/login")` 取干净态；并 `test.setTimeout` 抬高运行中 test 的上限好让 backoff 放得下。
- `playwright.config.ts` `workers: 1`：串行消除并行 worker 抢回血 token 的饿死（重试的 login 把刚回血的 token 输给别的 worker）；串行反而更快（并行版把时间烧在 backoff 上）。
- `e2e/global-setup.ts` `resetE2eRateLimits()`：每次跑前清 Redis 里 `otp:send:*`/`otp:verify:*`/`register:*`/`refresh:*` 桶——否则限频桶跨运行残留，第 N 次跑把桶抽干、第 N+1 次起步即空（同样输入两次跑一绿一红）。
- 注：`e2e/product-tour.spec.ts` **是 git-tracked、确实在套件内跑**（属那 24 个之一，单 `test()` 串起 student→teacher→parent 三段；`playwright.config.ts` 不 ignore 它）。只有它产出的截图目录 `tour-shots/` 是未追踪本地产物，别误提交。（旧版本误记「product-tour 未追踪/不在套件内」已纠正 2026-06-03。）

**Demo-ready product hardening status (Plan 16):**
- `/demo` is gated by `DEMO_MODE=1` and issues real sessions for fixed demo identities.
- Demo data is reset by `pnpm demo:reset` and verified by `pnpm verify:demo`.
- Main student/teacher/parent paths share the 初二数学 demo story and use the polished product shell.
- Plan 16 originally showed AI 出卷 and AI 课件 as preview entries; Plan 17 replaced AI 出卷 with the production `/teacher/papers` workflow, and Plan 18 replaced AI 课件 with the production `/teacher/coursewares` workflow. Both teacher nav entries are now real direct links (no preview badge).

**靶向训练现状（targeted training v1）：**
- 免费、复用优先：`training.*` 走 `consentGatedProcedure`（**不** chargedProcedure），不调 AI。题源只读学生自己的 ACTIVE 错题 + 已生成变式（`VariantItem`→其晋升 Question 的 KP link），按 FOCUS KP 排序；不足 `MIN_TARGETED=3` 时回退 `dueForReview`，全空返 `INSUFFICIENT_DATA`。会话上限 `SESSION_ITEM_CAP=8`。
- 回写学情：`TrainingAttempt`（自评 CORRECT/WRONG + `kpIds` **快照自会话目标 KP**，不靠题目自身 QuestionKPLink——绕开 USER_ADHOC/变式题关联稀疏）。`profileForStudent` 加读它作 `sourceWeight=0.5` 降权 `PerfSample`（自评比教师批改软）；`core.ts` 仅加 `sourceWeight` 一字段乘进衰减权重，仍纯。**不进 `classDiagnosis`**（自主练习不喂班级诊断）。
- **刻意不复用 `AssignmentPerformance`**：那表绑教师作业生命周期 + 班级诊断扫描，混入自练行会污染语义。`TrainingAttempt` 是独立表。
- 复习阶梯：`submitAttempt` 在 KNOW + ERROR_BOOK + ACTIVE entry 时调共享 `advanceReviewLadder`（从 `error.markReviewed` 抽出，`lib/error-book.ts`）推进；UNSURE 不动。`markReviewed` 已改用同一 helper（行为不变，回归 67 测护住）。
- 合规：hint-first 揭示 + 自评制（会/还不熟）、无分数/提分/压力文案。
- 设计代价 / 已知留白：KP-linkage 稀疏使"按 FOCUS KP 精准取题"覆盖面偏小（靠 dueForReview 回退兜底）；调度 Plan 9 reconciler 可增强题池，列为范围外后续。缓存沿用 analytics 5min TTL，自评回写最多 5min 后反映到画像。

**图片/OCR 拍照答疑现状（image tutor v1）：**
- 架构：mock-first 对象存储 adapter + authed 上传路由存图 → 单次多模态 qwen-vl 调用（一次同时**转写题面 + hint-first 讲解**）→ 转写文本喂回既有文本管线（落 USER_ADHOC Question + reconcile + ErrorAnalysisCard）。plan/spec=`docs/superpowers/{plans,specs}/2026-06-03-image-ocr-tutor*`。
- 对象存储（`packages/integrations/src/storage/`）：`StorageAdapter` 接口 `put(key,bytes,contentType)` / `getBytes(key)`；`MockStorageAdapter` + **进程级 `sharedMockStorageAdapter` 单例**（上传路由写、AI 读须见同一份字节，仿 `sharedTestSmsAdapter`）；`AliyunOssAdapter` 是 stub，`put/getBytes` 抛 `NOT_IMPLEMENTED`，**post-ICP 独立 plan 激活**（仿微信支付 real 骨架）。`buildStorageAdapter(env)`：`NODE_ENV==="test"` 或 `E2E_TEST_HOOKS==="1"` → 返 **shared mock**（关键：上传与读须同实例）；`STORAGE_USE_MOCK==="true"` → 新建 mock；否则 real。env 加 `STORAGE_USE_MOCK`（default `"true"`）+ 5 个 `ALIYUN_OSS_*` 可选 + refine（非 mock 模式五项必填，仿 `WECHAT_PAY_USE_MOCK=false`）。
- 计费：`TUTOR_ASK_IMAGE = 2 credits`（vision 溢价，文本 `TUTOR_ASK` 仍 1）。
- AI：`TUTOR_ASK_IMAGE` taskKind → `qwen-vl-plus`；`AdapterRequest.imageDataUrls?: string[]`，dashscope adapter 把 data URL 作 OpenAI-兼容 content parts 追加到**最后一条 user 消息**（仅 real 模式 `AI_USE_MOCK=false` 触发；测试走 mock）；`TutoringImageOutputSchema = TutoringOutputSchema.extend({ stemTranscript })`；`router.tutorImage()` 复用 `runJsonTaskWithAudit`（其 request 类型扩 `imageDataUrls?`）；forbidden 扫描覆盖 `stemTranscript`；mock 派发关键词 `拍照辅导助手` → `DEFAULT_TUTORING_IMAGE`；prompt `prompts/tutoring-image/v1.md`（忠实转写=Markdown+LaTeX、转写内不解题；再出 hint-first；`{studentGrade}` 方法迁移；无提分/分数/通过/恐吓；只输出 JSON）。
- Question：`upsertUserAdhocQuestion` 接 `stemImageKeys?: string[]`，**仅 create 时落** `?? []`；既有 dedup 早退不动 —— 同 stem 复 upsert 保留首图（v1 接受）。
- 上传路由 `apps/web/app/api/uploads/tutor-image/route.ts`（`runtime="nodejs"` + `force-dynamic`）：`getShellIdentity()` 鉴权 → 无身份 401/`UNAUTHENTICATED`；FormData `file`；类型白名单 jpg/png/webp 否则 400/`UNSUPPORTED_TYPE`；5MB 上限 → `TOO_LARGE`；**owner-scoped key** `adhoc/<userId>/<uuid>.<ext>`，返 `{ imageKey }`。`apps/web/lib/storage.ts` memoized `getStorage()`（`import "server-only"`）。
- `tutor.askImage`：链 `authedProcedure → chargeMiddleware("TUTOR_ASK_IMAGE")`（2 credits）。**红线 = owner-only 双门禁**：key 前缀须 `adhoc/<userId>/` **且** 字节须存在，两者均失败合并 `NOT_FOUND/IMAGE_NOT_FOUND`（不开存在性侧信道，与 `validateEntryOwnership` 同款）。contentType 按扩展名推；`ComplianceRejectedError` → `BAD_REQUEST/COMPLIANCE_REJECTED`（Plan 3 白名单不补偿），其它 AI 错 → `INTERNAL/TUTOR_IMAGE_INTERNAL`。**PII 后置脱敏**：单次多模态调用前没有文本可前置扫（图片字节本身入模型），故对 `stemTranscript` 落库前脱敏（AI 路由已在 parse 前脱敏 response + 扫违禁）；命中 `logger.info({event:"pii_redacted_input", source:"TUTOR_ASK_IMAGE"})` 只记计数。落 USER_ADHOC Question(`stemImageKeys=[key]`) → `reconcileHintsSync` best-effort（失败 warn 不破坏主流程）→ 返 `{...tutoring, stemTranscript: 脱敏后, questionId}`（剥 `modelCallId`）。
- UI（`TutorForm.tsx`）：file input（`accept="image/*" capture="environment"`）→ `fetch /api/uploads/tutor-image` → `tutor.askImage`；pending 渲 `AiGeneratingPanel label="识别题目并讲解中…"`；可编辑转写 textarea（`tutor-transcript`）+「纠正题面，按文本重答」（`tutor-image-correct`）把转写写进 stem 并走 **1-credit 文本 `tutor.ask`**（vision 只付一次）；共享 `view = data ?? imageData` 让输出块 + `ErrorAnalysisCard` 两路径共渲（图片路径 `actualAnswerMd=undefined`）。`error-copy.ts` 加 `UNSUPPORTED_TYPE/TOO_LARGE/FILE_REQUIRED` 中文文案。
- E2E `e2e/image-tutor.spec.ts` 用独占 seed 手机 **13800000005**（dev-admin-01，persona STUDENT，100 credits）——`13800000004` 已被 error-book + targeted-training 占用，并行 worker 抢同手机号 OTP 会 flake。mock storage + mock AI 全确定性。
- 设计代价 / 已知留白：真 OSS 未激活（`AliyunOssAdapter` stub，post-ICP）；单次多模态调用 → 转写脱敏是**后置**非前置（原图字节本身会到模型，vision 场景接受）；同 stem 复 upsert 保留首图。`error.diagnose`（按文本重答路径）仍只对文本作答前置脱敏。

**中考风格出卷现状**（2026-06-08）：
- `JUNIOR_MATH_ZHONGKAO_GENERIC_V1` 不新增 Prisma schema / migration；命题蓝图作为生成快照写入 `Paper.paramsJson.blueprint`，并继续沿用 `Paper` / `PaperItem`。
- 默认结构为 24 题 120 分：选择题 10×3、填空题 6×3、解答题 6+6+8+8+10+10+12+12；解答题统一映射为 `ESSAY`，保持单一“大题”观感。
- slot 是分值、难度、能力层级、KP、作答区高度和压轴标记的权威来源；生成回来的题按题型顺序 zip 到 slot 后，`points` / `difficulty` / `cognitiveLevel` 以 slot 覆盖 AI 自报值。
- v1 生成策略仍是按题型小批量生成，不改成逐题接口。自动审题 BLOCKER 当前策略为整卷失败并走既有扣费补偿；逐题重生留后续版本。
- `DIFFICULTY_DRIFT` 审题规则已移除：批量生成阶段 AI 自报难度与具体 slot 难度不可比，当前只在 slot 落地后覆盖难度，未来 per-slot 生成后再恢复。
- 中考模式使用 `paper-gen/v2.md` 的风格规则和 slot hints；普通手动 sections 出卷仍走 v1 prompt。
- 新增合规黑词覆盖“押题 / 必考 / 预测题 / 原题还原 / 考前答案”等表达。教师卷显示题目来源标记，学生卷不显示。
- 打印页读取 `paramsJson.blueprint.slots` 透传 `answerAreaHint` / `isCapstone`，学生卷作答区高度为 short 2.4cm、medium 5cm、large 8.5cm、extraLarge 11.5cm，压轴题强制分页。
- 预览页显示模板名、蓝图结构和 review warnings；生成表单新增“一键生成中考风格卷”入口。
- E2E 状态：新增 teacher-paper 中考闭环后，当前总量为 27/27（以 `pnpm.cmd exec playwright test --list` 的 `Total` 为准，需和 `merge-verification.md` 同步）。

**AI 模型路由现状**（2026-10-26）：
- 背景：用真实 DashScope 对出卷/课件 prompt 做了对照实测，确认三件事——① 代码里锁的 `qwen-max` 是旧世代快照（目录同族快照为 2024 年的 `qwen-max-0107/1201`，当前旗舰为 `qwen3.8-max`）；② `qwen3.8-max` / `qwen3.7-max` / `deepseek-v4-pro` **全是思考型模型**，默认先输出 reasoning tokens；③ 生成类任务开 thinking 是负收益：10 道选择题 thinking-on 187s / 8.2k tokens（其中推理 5.7k）/ 解析中位 80 字，thinking-off 38s / 2.5k tokens / 解析中位 154 字——更慢更贵且正文更短。
- `AdapterRequest` 扩三字段：`enableThinking?: boolean`（`undefined` = 不发送，兼容非思考模型与第三方）、`timeoutMs?: number`、沿用 `imageDataUrls`。`DashScopeAdapter` 现在：默认**流式**（`AI_STREAM=false|0` 关闭）以规避长生成的首字节超时；请求级 timeout 透传（默认 `AI_REQUEST_TIMEOUT_MS`，兜底 600s）；`enable_thinking` 仅当调用方显式给值时发送（`qwen-max` 实测接受该参数，但第三方未必）；构造函数支持注入 `client`（测试用）。**坑**：`chat.completions.create` 取出后必须 `bind`，否则 openai SDK 内部 `this._client` 未定义（`TypeError: Cannot read properties of undefined (reading '_client')`）。
- 任务配置从裸 `TASK_MODEL_MAP` 升级为 `TASK_CONFIG: Record<TaskKind, { model; enableThinking?; timeoutMs? }>`；`resolveTaskConfig(kind)` 为运行时真源，支持 env 覆盖 `AI_MODEL_<KIND>` / `AI_THINKING_<KIND>`（on/off）/ `AI_TIMEOUT_MS_<KIND>`；`TASK_MODEL_MAP` 保留为**默认值快照**（不随 env 变化，仅供兼容旧引用）。`AiRouter.taskBase()` 统一解析，`modelOverride` 仍最高优先级。
- 默认值：生成类（`PAPER_GEN` / `FORECAST_PAPER_GEN` / `LESSON_PLAN_GEN`）仍 `qwen-max` + `enableThinking:false` + `timeoutMs:600_000`；切换新一代模型用 env（`.env.example` / `.env.production.example` 已给注释样例），**先核对百炼单价再改生产流量**（一张 24 题卷 nothink 约 11k output tokens，对照 `PAPER_GEN` 5 credits = ¥0.5 收入）。
- 下架模型修复：`TUTOR_ASK_IMAGE` `qwen-vl-plus` → `qwen3-vl-plus`（前者已不在百炼目录，真模式会 404）；`EMBEDDING` `text-embedding-v2` → `qwen3.7-text-embedding`。注意：**compatible-mode 不支持 embeddings**（`qwen3.7-text-embedding` 调 `/chat/completions` 返回 404），RAG 落地时需走 DashScope 原生 embeddings 端点；当前仓库无 `EMBEDDING` 调用方。
- 红线：长输出实测可到单题解析 13,025 字（4 道解答题一次生成花 204s / 12.7k tokens）→ 解析长度上限**必须**做进 schema 硬门，只靠 prompt 约束不住。
- 测试：`packages/ai/tests/tasks-config.test.ts`（8 cases，env 覆盖/非法值/旧 id 断言）+ `packages/ai/tests/dashscope-adapter.test.ts`（6 cases，流式聚合/usage/enable_thinking/超时/多模态，注入 fake client 不联网）。E2E 与集成测试仍走 `MockAdapter`，不受影响。
- 待办（下一阶段）：schema 质量门（题量精确匹配、选项=4、答案解析一致性、解法长度上下限、禁「如图」/字面 `\n`/`\[`）+ `paper-gen/v3`、`lesson-plan-gen/v3` prompt 落地 + 12 场景评测基线。

**出卷质量门与选项渲染现状**（2026-10-26）：
- **通用出卷补审题门**：此前只有中考 blueprint 路径跑 `reviewAssembledPaper`，普通出卷无任何审题。新增 `reviewGeneratedPaper`（`apps/web/server/lib/paper-review.ts`）做与题位无关的检查：
  - BLOCKER（整次生成失败 + 既有扣费补偿，`PAPER_REVIEW_BLOCKED`）：空答案、空解析、AI 选择题完全没有选项、命中禁用措辞。
  - WARNING（落 `paramsJson.reviewWarnings`，预览页顶部横幅 + 对应题卡黄框）：选项数 ≠ 4、填空题带选项、答案字母越界、AI 痕迹、题干过长、解析过短（选择/填空 < 40 字、计算/证明/解答 < 120/150 字）、依赖插图（「如图」）、同模板近似重复（数字归一化后同一题干 → 只改数字的重复题）。
  - 生成顺序：`dedupePaperItems`（原 `uniquePaperItems` 导出）后按最终 position 审题，保证 warning 指向的题号与落库一致。
- **预览页选项修复**：`paper-preview-view.tsx` 的类型与渲染此前都没有 `optionsJson`（打印页有、预览页没有）。现抽 `apps/web/components/paper-item-options.tsx` 共享组件，预览与打印共用（打印页原局部 `OptionsList` 删除），保证字母序 A/B/C/D、换行与空值行为一致。
- **真实根因：选项被模型写成一行**。实测 qwen-max 会把 4 个选项输出成 `"A. 5个 B. 6个 C. 7个 D. 8个"` 单行字符串，`coerceOptionArray` 原来只按换行 / LaTeX `\[10pt]` 切分 → 落库成 `["5个 B. 6个 C. 7个 D. 8个"]` 一个选项，打印/预览都变成一行。现在补「行内 A./B./C./D. 标记」切分（支持 `（A）…` 全角括号、`；` 分隔），要求字母严格按 A→B→C→D 递增才切（避免误伤题干里的孤立 "B."），并剥离前缀与分隔符残留。
- **测试**：`apps/web/tests/unit/paper-review-generated.test.ts`（12 例）+ `apps/web/tests/unit/paper-item-options.test.tsx`（4 例）+ `packages/ai/tests/paper-coercion.test.ts` 新增 5 例（整行选项/全角括号/反例不误切/数组前缀剥离）；`role-nav.test.ts` 与密码登录 WIP 的「账号」导航同步（4 条断言）。
- 验证：`apps/web` 单测 25 文件 132 例全绿；全仓 `turbo typecheck` 8/8；真机（demo 教师 → 真实 qwen-max 生成 10 题卷 39s）预览页 6 道选择题各 4 个选项分行渲染，审题 warnings 由 18 条噪点降为 7 条真实「解析偏短」。

**「一键中考风格卷」生成失败的根因与修复**（2026-10-26 深夜）：
- 现象：教师点「一键生成中考风格卷」→ 156 秒后 `PAPER_REVIEW_BLOCKED`（已自动退还 credits）。日志显示一次请求打了 5 次 AI（初始 3 段 + 2 轮修复），说明修复轮重复生成也清不掉 blocker。
- 离线复算（从 `model_calls.request_json/response_json` 还原 5 次调用）定位根因：**qwen-max 把 4 个选项输出成一个字符串，且分隔符是字面量 `\n`（反斜杠+n 两个字符）而不是真换行**，例如 `"options": "A. 5\nB. 8\nC. 10\nD. 12"`（JSON 层呈现为 `\\n`）。`coerceOptionArray` 只按真换行 / LaTeX `\[10pt]` 切 → 得到 1 个选项 → 中考蓝图 10 个 `SINGLE_CHOICE` slot 全部 `CHOICE_OPTION_COUNT` BLOCKER；修复轮同 prompt 再生成，格式一模一样，2 轮后整卷失败。题量/题型/答案本身都是对的，纯粹是**转义换行未归一化**。
- 修复分三层（缺一层都会复发）：
  1. **解析层归一化**（`packages/ai/src/schemas.ts`）：新增 `normalizeAiText` 把字面量 `\n` / `\r\n` 还原成真换行——紧跟选项标记（`\nB.` / `\n（C）`）的优先还原；其它位置用 `(?![a-zA-Z])` 保护 LaTeX 命令（`\neq` / `\nabla` / `\not`）。`coerceOptionArray`、`stemMd/answerMd/solutionMd/rubricMd` 全部过一遍；新增 `stripTrailingOptionBlock` 去掉题干尾部重复抄写的选项块（模型有时把选项同时写进 stem）。`PaperGenItemSchema` 改为 `.transform()` 做统一归一。
  2. **修复轮带缺陷反馈**：`PaperGenerationInputSchema` 加可选 `qualityInstructions`，`AiRouter.generatePaper` 把指令拼进 user content；`paper.ts` 的 `repairInstructionsFor(blockers)` 把 blocker code 翻成可执行要求（options 必须 4 项 JSON 数组 / 禁止字面量 `\n` / 题干不抄选项 / 补 answerMd·solutionMd / type 对齐 / 填空不带 options …）。此前修复轮只是「同 prompt 再来一次」，格式类缺陷必然复现。
  3. **失败可解释**：`apps/web/server/trpc.ts` 的 `errorFormatter` 白名单透出 `cause.blockers` / `cause.shortfallByType`（此前 client 读 `shortfallByType` 永远是 undefined，是个潜在 bug）；生成表单按 blocker code 映射中文原因（选项格式异常/缺答案/缺解析/题型不一致/填空带选项/合规措辞），不再是笼统一句。
- 验收（真机同路径）：同一操作 **156s 失败 → 44.8s 成功**；24 题全部落库、`status=READY`、10 道选择题各 4 个选项（`jsonb_array_length` 合计 40）、`reviewBlockers`/`reviewWarnings` 均为空；预览页 10 个选项容器、打印页正常。
- 测试：`paper-coercion` +3（字面量 `\n` / `\r\n` / LaTeX 不误伤）、`paper-gen-schema` +4（选项切分/题干去重/正文换行/LaTeX 保护）、`paper-repair-instructions` 4 例；`apps/web` 全量单测 26 文件 136 例、`packages/ai` 相关 4 文件 39 例全绿；全仓 typecheck 8/8。
- 已知遗留：修复前已落库的旧卷 optionsJson 仍是坏的（对象是历史 DRAFT 演示数据），新生成不受影响；如需回填可写一次性脚本重跑 `coerceOptionArray`。

**补充：同一 bug 的第二/第三波变体与最终策略**（2026-10-26 23:10）：
- 修完「字面量 `\n`」后用户复测仍失败，继续从 `model_calls` 离线复算，抓到另外两种变体：
  1. **`<br>` 分隔**：`"options": "A. 2千克<br>B. 4千克<br>C. 5千克<br>D. 10千克"`（qwen-max 用 HTML 换行拼选项）；
  2. **修复轮畸形 JSON**：`"options": "["` + 非法键（模型被"必须是数组"的指令带偏，输出坏结构）。
- 期间还试过 **`paper-gen/v3.md`**（在 prompt 里强调 options 必须 JSON 数组并给示例）：实测 qwen-max 反而更容易输错 JSON（PARSE_FAILED，一次是位置 9218 语法错误，一次是 `items[0].answerMd/solutionMd/difficulty` 全丢），把错误类型从"可归一化的格式问题"升级成"整次 500"。**已删除 v3 文件并回退到 v2**，结论：这类不稳定必须由解析层兜底，不能靠 prompt 施压。
- 最终 `coerceOptionArray` 支持 6 类真实格式（全部有测试）：
  1) 真换行 / LaTeX `\[10pt]`；2) 字面量 `\n` / `\\n` / `\r\n`（1–2 个反斜杠，保护 LaTeX `\neq` 等）；3) `<br>` / `<br/>` / `<br />` / `&lt;br&gt;` / `<p>` 等 HTML 标签；4) 二次编码的 JSON 数组字符串（`"[\"A. x\",…]"`）；5) 单元素数组里装着整串选项；6) 无任何分隔符时按 A→B→C→D 严格顺序兜底切分。另加 `stripTrailingOptionBlock` 去掉题干尾部重复选项块。
- 另加**重试提示**：`generatePaper` 的 `retryMessage` 明确要求「字符串内禁止未转义换行/引号、options 必须是 4 个字符串的数组、只输出 JSON」，提升 JSON 坏掉时的自愈率。
- 真机验收（连续 3 次点「一键中考风格卷」）：**3/3 成功**，44.1s / 44.8s / 46.8s；每次 24 题、10 个选项容器全部 4 项、`blockers=0`、`warnings=0`。
- 测试基线：`apps/web` 26 文件 136 例、`packages/ai` 相关 4 文件 45 例（`paper-coercion` 20 例覆盖 6 类格式）全绿；全仓 typecheck 8/8。

**浙江省中考版式改造**（2026-10-26 23:40）：
- 目标：按 **2025 年浙江省初中学业水平考试（省级统考）数学卷**真实格式出卷。查证后的真实结构：
  - 一、选择题 10 小题 × 3 分 = 30 分；二、填空题 6 小题 × 3 分 = 18 分；三、解答题 8 小题 = 72 分，分值梯度 **8/8/8/8/8/10/10/12**（第 24 题为压轴）；满分 120、考试时间 120 分钟。
  - **试题卷与答题纸分离**（答案写答题纸上，试题卷不留作答区）；选择题选项一行排列；卷头为「浙江省初中学业水平考试 / 数 学 试 题 卷」+ 姓名/准考证号 + 注意事项。
- 蓝图（`apps/web/lib/zhongkao-blueprint.ts`）：解答题分值阶梯由旧的 `6/6/8/8/10/10/12/12` 改为浙江口径 `8/8/8/8/8/10/10/12`；难度阶梯 `[2,2,3,3,3,4,4,5]`；`capstoneTail` 由 2 改为 **1**（仅第 24 题压轴）；模板 label 改为「浙江省中考数学卷式（2025 省级统考）v1」（`styleTemplate` id 不变，旧卷兼容）。
- 文案（`apps/web/lib/paper-copy.ts`）：`EXAM_REGION_LABEL/EXAM_STAGE_LABEL/EXAM_SUBJECT_LABEL`、浙江口径 `EXAM_NOTICE`（4 条）、`ANSWER_SHEET_NOTICE`、`examSectionNote`（选择题「不选、多选、错选均不得分」/解答题「解答应写出文字说明、证明过程或演算步骤」）、`answerSheetHeight`（8 分 6cm / 10 分 8cm / 12 分 10cm）。
- 打印（`print/exam-paper-components.tsx` 重写 + `paper-print-view.tsx`）：
  - 三个文档 Tab：**试题卷 / 答题纸 / 参考答案（含解析）**；`ExamHeader` 按 variant 渲染浙江卷头与各自注意事项；`SealLine` 保留装订线。
  - 试题卷：三大题标题 + 题量分值说明 + 固定表述；选择题选项**一行排列**（`flex-wrap`）；解答题小题号后标（X分）；**不留作答区**；填空题题干无横线时补一条。
  - 答题纸（新增 `AnswerSheetDocument`）：选择题 10 列填涂格（每题 A/B/C/D 空圈）、填空题横线、解答题按分值给作答框并 `break-inside: avoid`；按题号连续排版、不为压轴题强制分页。
  - 参考答案：题目 + 答案 + 解析 + 评分标准 + 卷末双向细目表（单独分页）。
  - 打印 CSS 加 `@page { size: A4; margin: 13mm 12mm }`。
- 真机验收（真实生成 + Playwright 打印 PDF 数页）：24 题 / 120 分，分值序列 `3×16,8,8,8,8,8,10,10,12`，blockers/warnings 均为 0；**试题卷 4 页 / 答题纸 4 页 / 参考答案 6 页 A4**（与真实浙江卷试题卷 4 页一致；答题纸相当于 A3 双面 2 张）。
- 同批修复：模型用 `\[1ex]`/`\[0.5em]` 等非 pt 单位作选项分隔导致选项里残留间距命令 → `OPTION_SEPARATOR` 支持 `pt|ex|em|cm|mm`，`stripOptionPrefix`/文本 transform 清理残留；`paper-coercion` 补 2 例。
- ~~已知差距（下一步）：真实浙江卷几何/函数题大量依赖**插图**~~ → 已落地，见下节「浙江卷配图」。
- 测试：`zhongkao-blueprint.test.ts`（分值阶梯/压轴数）、`exam-paper-components.test.tsx`（试题卷不留作答区/答题纸填涂与作答框高度）已同步；`apps/web` 全量单测 26 文件 141 例全绿，全仓 typecheck 8/8。

**浙江卷配图能力（几何/坐标系图形 DSL + 自研 SVG 渲染）**（2026-10-26 23:55）：
- 背景：真实浙江卷几何/函数题大量带图，纯文字卷「如图但没图」是最大形态差距。**不让模型直接输出 SVG**（不可校验、有注入风险），改为「受约束图形 DSL + 前端确定性渲染」。
- 数据契约（`packages/ai/src/schemas.ts`）：
  - `GeometryFigureSchema`：`kind:"GEOMETRY"` + `points[{id,x,y}]`（0–100 画布，y 向下）+ `segments[{from,to,dashed?}]` + `circles[{cx,cy,r}]` + `labels[{text,x,y}]`；
  - `CoordinateFigureSchema`：`kind:"COORDINATE"` + `axes{xMin,xMax,yMin,yMax}`（数据坐标）+ 同套 points/segments/circles/labels；
  - `FigurePointIdSchema` 限制点名为字母开头 ≤6 字符；未知 `kind` 一律拒绝；`FigureGenerationOutputSchema.figure` 可为 `null`（本题不需要配图）。
- AI 任务：新增 `TaskKind.PAPER_FIGURE_GEN`（qwen-max、thinking off、timeout 120s、temperature 0.2）+ prompt `prompts/paper-figure/v1.md`；独立于主出卷调用（配图 JSON 崩了不会毁整卷），审计写 `model_calls`。
- **并行/幂等**：`paper.generate` 落库后 best-effort 补图，最多 8 题、并发 3；失败只 `logger.warn` 并保留原审题 warning。图存 `Paper.paramsJson.figures = { "<1-based position>": FigureSpec }`，不改 schema/migration；补图成功后同步移除对应题的 `FIGURE_DEPENDENT` warning。
- **模型输出容错（关键）**：实测 qwen-max 会偷懒给简写 `points:["A","B","C"]`、`segments:["AB","BC","CA"]`、`labels:["5","13"]`（8/8 PARSE_FAILED），因此 `normalizeFigureSpec` 做宽松归一化后再生效：
  - 点：支持字符串数组 / `{A:{x,y}}` 映射 / `[x,y]` / `"x,y"`，缺坐标按点数自动布局（3 点三角、4 点矩形、5+ 正多边形）；
  - 线段：支持 `"AB"` 字符串、`{start,end}`、`{points:[A,B]}`；点不存在时渲染层静默跳过；
  - 标签：只保留**有明确坐标**的 label（简写标签无位置，自动摆放会把「90°」放到边中间误导，直接丢弃；条件题干里已有）；
  - 坐标系：`axes` 缺省 -5..5；若点没有真实数据坐标则**降级为 GEOMETRY**，避免把自动布局坐标当数据坐标画。
- 渲染（`apps/web/components/paper-figure.tsx`）：白名单图元（line/circle/text/defs）确定性渲染，无 `dangerouslySetInnerHTML`；几何图自动求包围盒等比缩放到 0–100 画布（容忍越界坐标）；坐标系图按 axes 等比映射、画网格/坐标轴/箭头/刻度/点标签；**兜底**：`segments` 为空且点 ≥2 时按点名顺序自动连线（≥3 闭合），保证至少画出三角形/四边形。
- 版式接入：打印「试题卷 / 参考答案」在题目下方居中渲染（试题卷 3.8cm、教师卷 3.2cm 宽，SVG 显式 `width:100%/aspect-ratio:1:1` 防 flex 压扁）；预览页题卡同样展示；答题纸**不放图**（浙江卷答题纸本来就没有图）。
- 实测（真实生成，选几何 KP）：80s 出卷 + **8 张图全部生成并渲染**（三角形等），试题卷 **5 页** / 答题纸 **4 页** / 参考答案 **7 页**；`blockers=0`、`warnings=0`；修复前渲染成散点的问题由「SVG 未显式定宽高 + 无 segments」两个原因共同导致，已修。
- 测试：`packages/ai/tests/paper-figure-schema.test.ts`（12 例：严格校验 + 简写归一化 + 坐标系降级）、`apps/web/tests/unit/paper-figure.test.tsx`（6 例：几何/坐标系渲染、越界坐标、null、figureForPosition）；`apps/web` 全量单测 **27 文件 147 例**、`packages/ai` 相关 44 例全绿；全仓 typecheck 8/8。
- 设计代价 / 留白：图形是**示意图**（按点名自动布局，不是严格按题干边长比例作图）；模型只给点名时无法还原真实比例；图与题干的一致性仍依赖 prompt + 教师核对（审题只校验结构不校验图形语义）；补图是额外平台成本（每题一次短调用，不额外扣教师 credits）。

**函数图象曲线渲染（抛物线/直线/双曲线）**（2026-10-27 00:15）：
- DSL 扩展：`CoordinateFigureSchema` 增加 `curves: [{ expression, dashed? }]`，表达式只允许数字 / x / `+ - * / ^` / 括号 / `sqrt(...)` / `abs(...)`（`FigureCurveSchema` 校验必须含 x）。
- **安全红线**：`apps/web/lib/function-curve.ts` 手写词法 + 递归下降解析器，**绝不 eval / new Function**；字符白名单只做粗筛，`sin/log/process.exit` 等未知标识符由解析器显式拒绝并返回 null。支持隐式乘法 `2x`、`2(x+1)`、`x(x-1)`、右结合乘方 `2^3^2`、全角 `＝ − × ÷` 归一化。
- 取样：`sampleCurve(expression, axes, 240)` 在 axes 范围内取样，遇无定义/`|y|` 超范围/渐近线跳变自动断段（`y=1/x` 在 x=0 断成两段，不画竖线），输出数据坐标折线；渲染层映射为 `<polyline>`（无 NaN）。
- 两条来源，**确定性优先**：
  1. `apps/web/lib/paper-figure-derive.ts`：题干含显式解析式（`y=x^2-4x+3`，支持 LaTeX `$…$`、上标 ²）时**本地推导** COORDINATE 图（采样+分位裁剪自动选坐标轴范围），不花 AI 调用、图像更准；
  2. 无解析式的几何题仍走 `PAPER_FIGURE_GEN` AI 配图（prompt 升版 **paper-figure/v2**，在 prompt v1 已注册进 DB 的情况下按仓库规范**只能新建 v2**，不能原地改 v1；撞 PromptVersionConflictError 的教训已记录）。
- 候选筛选：强信号（如图/抛物/坐标/图像/交点）优先 + 几何/函数/统计类题干 → 最多 8 题；模型对每题仍可返回 `figure:null`；新增 `isUsefulFigure` 过滤「2 个点/空图」等无效图，避免卷面变差。
- 实测（函数知识点，真实生成）：**8 张配图、其中 7 条函数曲线**成功渲染；试题卷 **5 页** / 答题纸 **4 页** / 参考答案 **8 页**；出卷 50.8s（含补图）；`pageerrors` 无。
- 测试：`apps/web/tests/unit/function-curve.test.ts`（12 例：求值/隐式乘法/乘方右结合/sqrt/abs/危险表达式拒绝/渐近线断段）、`paper-figure-derive.test.tsx`（9 例：LaTeX 题干提取、轴范围、非函数题不配图、polyline 渲染）、`paper-figure.test.tsx` 增 2 例（曲线渲染/非法表达式跳过）；`apps/web` 全量 **29 文件 170 例**、`packages/ai` **17 文件 117 例**全绿，typecheck 8/8。
- ~~仍然存在的**最大版式差距**：题干/答案里的 LaTeX 在打印页仍是原始文本~~ → 已接入 KaTeX，见下节。

**KaTeX 数学公式渲染（服务端）**（2026-10-27 00:20）：
- 依赖：`apps/web` 增加 `katex`（0.19.1，自带类型，未装 @types/katex）；`app/layout.tsx` 全局引入 `katex/dist/katex.min.css`（Next 会处理 node_modules 里的字体资源）。
- 切分器（`lib/math-segments.ts`，纯函数）：只处理试卷常见数学标记，不引入 Markdown 全量解析——
  - `$...$` 行内、`$$...$$` 块级、`\(...\)` 行内、`\[...\]` 块级；
  - 货币写法（`售价 $5 元` 未闭合）不会被误判；空公式 `$ $` 不产生空段；换行保留在文本段。
- 组件（`components/math-text.tsx`）：`katex.renderToString` **服务端渲染**（Node/浏览器均可，打印与预览共用）；`trust:false`（禁 `\href`/`\url`/原始 HTML）+ `throwOnError:false`（坏公式显示错误样式而非白屏）+ try/catch 兜底回退原文；唯一 `dangerouslySetInnerHTML` 来自 KaTeX 受控输出，普通文本走 React 子节点（无拼接 HTML、无 XSS）。
- 接入范围：打印「试题卷 / 参考答案」的题干、选项、答案、解析、评分标准；预览页题干/选项/答案/解析；选择题选项组件 `PaperItemOptions` 统一走 MathText。答题纸无题干不涉及。
- 实测（复用已生成的真实函数卷）：预览页 **110 个公式**、试题卷 **25 个公式**全部渲染为 KaTeX；页数不变（试题卷 5 / 答题纸 4 / 参考答案 8）；无页面错误；PDF 中数学字体正常嵌入。观感从「`$y = 3x - 2$` 原始文本」变为标准数学排版（斜体变量、上下标、分数）。
- 测试：`math-segments.test.ts`（8 例：行内/块级/`\\(…\\)`/货币不误判/空公式/换行）、`math-text.test.tsx`（6 例：KaTeX 输出、display 模式、非法公式不抛错、HTML 转义无 XSS、null 兜底）、`paper-item-options.test.tsx` 同步（选项文本已包 MathText）；`apps/web` 全量 **31 文件 184 例**、`packages/ai` **17 文件 117 例**全绿，typecheck 8/8。
- 说明 / 留白：只覆盖「试卷模块」；答疑对话、题库详情等其他页面若也要公式排版，可直接复用 `<MathText>`。Markdown 的加粗/列表等结构语法仍未支持（当前 AI 输出以纯文本+LaTeX 为主，暂不构成主要问题）。

**`<MathText>` 铺开到学习端页面**（2026-10-27 00:28）：
- 已接入（题干/答案/解析/课件正文/错因分析等所有含数学文本的位置）：
  - 错题本：`error-book/[entryId]/entry-detail.tsx`（题目、参考答案、变式题干、变式解析）；
  - 训练：`(student)/training/session-view.tsx`（题干、解析）；
  - 作业：`assignments/[studentAssignmentId]/submit-form.tsx`（题干）、`result/page.tsx`（题干、参考答案）、`teacher/assignments/[assignmentId]/edit/draft-editor.tsx`（题干/答案/解析）；
  - 课件：`teacher/coursewares/[id]/courseware-preview-view.tsx` 与 `print/courseware-print-view.tsx`（正文）；
  - 答疑/画像：`tutor/error-analysis-card.tsx`（错因分析）、`portrait/advice-card.tsx`（建议）。
- 列表摘要（错题本列表/复习页/变式摘要）不渲染公式：新增纯函数 `plainPreview(raw, maxLength)`（去掉 `$…$` 标记、合并空白、截断），避免把公式截一半显示成乱码；`truncate` helper 改为复用它。
- 冒烟（demo 学生真实登录）：`/training`、`/error-book`、`/error-book/<entry>`、`/tutor`、`/portrait` 全部 0 pageerror；MathText 组件正常挂载（demo 数据本身多为纯文本，公式渲染由试卷页 110/25 个公式的实测覆盖）。
- 测试：`math-segments.test.ts` 追加 `plainPreview` 3 例；`apps/web` 全量 **31 文件 187 例**全绿，typecheck 8/8。

**试卷内容质量：prompt v4 + 确定性质量门 + 12 场景评测基线**（2026-10-27 00:35）：
- prompt：新增 `packages/ai/src/prompts/paper-gen/v4.md`（v3 已被历史实验占用且不能原地改，故升 v4），路由中考路径 `promptVersion = "v4"`。v4 只在 v2 稳定的格式段之上追加**内容质量硬性要求**：解答题分步解析 ≥150 字、评分标准按分值拆点、选择题 4 个互异选项且禁用「以上都对」、题干不依赖插图、公式用简单 KaTeX、同一卷内禁止只改数字的近似重复题。历史教训保留：不在 prompt 里给 options JSON 示例（会逼出非法 JSON），格式继续由 `coerceOptionArray` 兜底。
- 确定性质量门（`apps/web/server/lib/paper-review.ts` `reviewPaperSlot`，中考路径）：
  - **BLOCKER** `SHORT_SOLUTION`：解答题解析 <80 字 → 触发既有修复轮（`repairInstructionsFor` 新增对应指令：分步 ≥4 步、≥150 字、评分标准按分值拆点）；
  - **WARNING**：`SHORT_SOLUTION_WARN`（80–150 字/客观题 <20）、`MISSING_RUBRIC`、`CHOICE_OPTIONS_DUPLICATE`、`CHOICE_ALL_OF_ABOVE`、`CHOICE_ANSWER_NOT_LETTER`、`STEM_TOO_SHORT`（<12 字）。
  - 通用（非中考）路径保持原策略（短解析只 WARNING），避免影响旧场景。
- 兼容：`packages/ai/src/adapters/mock.ts` 的 mock 题与 `paper-generate-zhongkao.test.ts` 的本地 mock 都改为「解答题长解析 + 评分标准」，否则依赖 mock 的集成/E2E 会被新质量门误伤；`getAiRouter` 的 `promptVersion` 类型从 `"v1"|"v2"` 放宽为 `string`。
- **12 场景评测基线**：新增 `apps/web/scripts/eval-paper-quality.mjs`（可复用工具，真实出卷 + 直接查 DB 统计）：
  - 场景覆盖：一次函数/二次函数/二次函数图象/勾股定理/三角形/圆/四边形/全等三角形/相似三角形/解直角三角形 + 代数几何混合 + 函数统计混合；
  - 指标：成功率、耗时、题数/总分、选择题 4 选项比例、解答题解析长度中位数、评分标准覆盖率、blockers/warnings 及代码、配图数；结果写 `docs/claude/eval/paper-quality-<date>.json`；
  - 用法：`cd apps/web && node scripts/eval-paper-quality.mjs [--limit=N]`（需 dev server + Postgres + 真实 DashScope）。
- 首场实测（v4，一次函数单 KP）：**成功**，24 题/120 分，选择题 4 选项 10/10，**解答题解析中位数 193 字**（改造前同口径 53–99 字），评分标准 8/8，warnings=1（SHORT_SOLUTION_WARN）。全量 12 场景结果见下方（跑完回填）。
- **全量 12 场景基线结果（2026-10-27 01:34，v4 + 质量门）**：
  - **12/12 成功**（100%），平均耗时 **73.9s**；每卷均 24 题 / 120 分；
  - 选择题 4 选项比例 **100%**（120/120 题）；
  - 解答题解析长度中位数 **平均 177 字**（各场景 128–230，全部 ≥113，远优于改造前 53–99）；
  - 解答题评分标准覆盖率 **100%**（96/96 题）；blockers 全 0；
  - warnings 主要是 `SHORT_SOLUTION_WARN`（80–150 字区间，各场景 0–7 条），说明模型已基本满足「≥80 字」硬门，但「≥150 字/分步完整」还需继续加强（下一轮可把阈值抬到 120 字做 BLOCKER 或按分值分档）；
  - **本轮 figures=0**：v4 prompt 要求「题干不依赖插图、用文字写全条件」，配图模型对这类自足题干多返回 `figure:null`（figure 调用 35 次 SUCCESS 但多数主动放弃）；属于策略副作用，下一轮需调整配图 prompt/候选策略（例如几何题即使不写「如图」也要求配示意图），并补一条「几何题干 → 优先配图」的规则。
  - 结果文件：`docs/claude/eval/paper-quality-2026-10-26.json`；运行日志 `docs/claude/eval/eval-progress.log`。
- 测试：`paper-review.test.ts`（20 例，含新增 7 个质量门用例）、`paper-repair-instructions.test.ts`（5 例，含 SHORT_SOLUTION 指令）全绿；`packages/ai` 17 文件 117 例全绿；`apps/web` 全量 **32 文件 195 例**全绿，typecheck 8/8。

**评测脚本 API 化 + 12 场景基线（2026-10-27 13:28）**：
- pps/web/scripts/eval-paper-quality.mjs 改为**直接调 tRPC**（从 DB 取学科/知识点 id，POST /api/trpc/paper.generate），不再点 UI chips（历史问题：chips 选中态依赖默认选中集，单 KP 场景会被静默退化；长跑还会 session 过期连环失败）；每场景失败若是未登录会自动重新登录重试；结果文件名带时间戳 + paper-quality-latest.json。
- 场景改为每个 3–5 个 KP（24 题一张卷，单 KP 会被重复率门 400 拦下）：代数/一次函数/二次函数/三角形勾股/四边形/圆相似/解直角三角形/函数方程/概率统计/代数几何/二次函数几何/综合模拟。
- 全量基线：**11/12 成功（91.7%）**，平均 128.4s；每卷 24 题/120 分；选择题 4 选项 **100%**；解答题解析中位数均值 **216 字**；评分标准覆盖 100%；**配图合计 48 张**（几何场景 1–8 张/卷）。唯一失败：圆与相似（PAPER_GEN 解析失败 3 次，属模型 JSON 抖动，非脚本问题）。

**出卷成功率提级（2026-10-27 15:04）**：
- **备用模型兜底**：TaskConfig 新增 `fallbackModel`（可 `AI_FALLBACK_MODEL_<KIND>` 覆盖），出卷/配图默认 qwen3.8-max；`runJsonTaskWithAudit` 第一次 JSON 解析失败后自动切备用模型重试（对应约 8% 的模型 JSON 抖动失败）。
- **软质量门降级放行**：`downgradeSoftBlockers` —— 修复轮后若只剩 `SHORT_SOLUTION` 这类软问题，不再整卷失败（避免扣费+补偿体验），降级为 `SHORT_SOLUTION_DOWNGRADED` WARNING 放行；空答案/题型错/禁用措辞等硬缺陷仍整卷失败。
- **评测场景扩宽**：每场景 4–5 个 KP（单 KP/窄 KP 24 题会被「重复率过高」门 400 拦下），更贴近真实中考卷知识点覆盖度。
- **终验：12/12 成功（100%）**，平均 95.5s；选择题 4 选项 100%；解答题解析中位数均值 190 字；评分标准 100%；配图合计 46 张（几何场景 2–7 张/卷）。
**答案正确性抽检（PAPER_ANSWER_VERIFY）**（2026-10-27 15:25）：
- 新增 AI 任务 `PAPER_ANSWER_VERIFY`（默认 **qwen3.8-max**，与出卷 qwen-max 异构；fallback qwen-max，thinking off，240s），prompt `paper-answer-verify/v1.md`：第二模型只判答案/解析数学正确性，输出 `CORRECT/WRONG/UNCERTAIN + reason`。
- verdict 归一化：兼容英文大小写与中文（正确/错误/不确定），无法识别归为 UNCERTAIN；必须覆盖输入每道题。
- tRPC `paper.checkAnswers({paperId})`（teacher + ownership）：一次抽检最多 24 题，结果落 `paramsJson.answerCheck`，`WRONG` 追加 `ANSWER_MISMATCH` WARNING（不阻断打印，供教师核对）。
- 基线脚本 `apps/web/scripts/verify-answer-accuracy.mjs [N=5]`：对最近 N 份试卷调用抽检，输出 wrong/uncertain 比例与样例，写 `docs/claude/eval/answer-accuracy-latest.json`。
- 单测：`packages/ai/tests/answer-verify.test.ts` 3 例（verdict 归一化/字段校验/第二模型调用与题目转写）；与既有 44 例 ai 单测全绿，typecheck 8/8。
- **真实基线未跑**：本机 Docker/WSL 引擎在本轮反复卡死（`wsl --update` 一度修好，随后再次不健康），DB 不可达；环境恢复后执行：
  `cd apps/web && node scripts/verify-answer-accuracy.mjs 5`
  即可得到 WRONG/UNCERTAIN 比例（只读抽检，不重新出卷，成本远低于出卷）。
**答案抽检可用性（教师预览页）**（2026-10-27 15:27）：
- 预览页新增「AI 答案抽检」按钮（`data-testid=answer-check-button`）：点击调用 `paper.checkAnswers`，结果落库并刷新页面。
- 新增展示组件 `apps/web/components/answer-check-panel.tsx`：显示抽检总数/正确/存疑/无法判定、存疑题号+理由，红色/绿色状态区分，并明确「AI 只作参考，以教师核对为准」。
- 抽检结果同时进入 `reviewWarnings`（`ANSWER_MISMATCH`），与既有审题 warning 一起在预览页顶部提示。
- 单测 `apps/web/tests/unit/answer-check-panel.test.tsx` 4 例；typecheck 8/8。
- **真实端到端未跑**：Docker/WSL 再次不可用（`zhijiao-postgres` unhealthy、5432 端口关闭）。恢复后建议顺序：`docker compose up -d` → 等 healthy → `pnpm dev` → 打开任意试卷预览页点「AI 答案抽检」，或跑 `node scripts/verify-answer-accuracy.mjs 5` 拿 WRONG/UNCERTAIN 基线。