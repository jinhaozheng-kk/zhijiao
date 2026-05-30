# Plan 11 — 学情画像 / 趋势 + 家长绑定 设计

> Source of truth：`需求与架构文档.md`「学生学习中心 → 学情洞察」「教师教学中心 → 班级分析」+ CLAUDE.md 合规/未成年约束。
> 派生计划：`docs/superpowers/plans/2026-05-29-learning-portrait-and-trends.md`。

## §0 范围与不做

**做**：
- 三端 `学情` 画像：学生本人 / 家长（已绑定子女，只读简版）/ 教师（班级诊断 + 单学生）。
- KP 掌握度三档颜色块（+ 数据不足态），即查即算 + Redis 5min 缓存。
- 学生端按需付费的 AI 学习建议（1 credit，`LEARNING_ADVICE_GEN`）。
- 内嵌 family-link 最小绑定：**学生发码 / 家长绑定**（已拍板），可撤销。
- 收口 Plan 10 教师 dashboard 的班级诊断 stub。
- Plan 6 PII：注销删 FamilyLink；导出含本人 link。

**不做**（留后续 plan）：
- SM-2/FSRS 之类自适应复习算法（错题本仍用 Plan 4 的 5 段固定梯）。
- 趋势预测中心（Plan 3 路线里的命题趋势）——本 plan 的"趋势"仅指学生掌握度随时间的变化窗口，不是中考/高考命题预测。
- <14 监护人代办、PIPL 完整 SLA（Plan 14）。
- KP 树扩充（Plan 13）；本 plan 直面 KP 稀疏并优雅降级。

## §1 模块切分（Path A — 已拍板）

新建 `packages/analytics`（纯计算包）+ apps/web 内的缓存/投影/建议/接入层。

```
packages/analytics  (新包，只读计算，无 Redis / 无 AI / 无合规)
  - core.ts        aggregateMastery() / aggregateClassDiagnosis()  纯函数，喂 fixture 可单测
  - queries.ts     profileForStudent(prisma,...) / classDiagnosis(prisma,...)  薄查询壳，集成测
  - types.ts       AnalyticsWindow / MasteryTier / LearningProfile / ClassDiagnosis

apps/web/server/lib
  - learning-cache.ts       Redis 5min，key by (kind,id,window)；纯 TTL 无主动失效
  - learning-projection.ts  familyView(profile)  → 家长简版 stripped subset
  - learning-advice.ts      buildAdviceInput(profile) + 调 aiRouter.generateLearningAdvice
  - profile-access.ts       requireProfileAccess(db, viewerId, targetId) → 'self'|'parent'|'teacher' | throw NOT_FOUND

apps/web/server/routers
  - analytics.ts   profile.mine / profile.get / profile.generateAdvice / classroom.diagnosis
  - family.ts      createInviteCode / bindByCode / listMyChildren / revoke

UI（全部走 client component + tRPC，与 /assignments 同款；不在 server component 里读 session）
  - (student)/portrait        本人画像 + AdviceCard（付费按钮）
  - (student)/family-link      生成邀请码
  - parent (改 stub)           子女列表 + 绑定表单
  - parent/children/[childId]  子女简版画像（familyView）
  - teacher/classes/[id]       班级诊断区（收口 Plan 10 stub）
  - teacher/students/[id]      单学生完整画像
```

**边界硬约束**：
1. `packages/analytics` **绝不** import Redis / AI / 合规 / server-only。`core.ts` 是纯函数（喂 plain rows）；`queries.ts` 接 `PrismaClient` 做只读聚合（集成测，对 per-package test DB）。"纯函数式单测"特指 `core.ts`，不是整包——§前序讨论里"无 IO 又接 PrismaClient"的矛盾就这样收口。
2. 缓存层在 apps/web 内、`packages/analytics` 之外 → 算法可在 e2e/调试时绕过 Redis 直跑。
3. 三端共用同一份 `LearningProfile`：家长视图 = `familyView(profile)`，教师查单学生 = `profile` 原样 + 前端禁用"生成学习建议"。零重复算法。
4. `routers/family.ts` 与 `routers/analytics.ts` 互不 import；只通过 `profile-access.ts` 的 FamilyLink 读取间接耦合。

## §2 数据来源与 mastery 算法（§前序承诺的 §3）

### 2.1 主数据源：AssignmentPerformance

掌握度**主**来源是 `AssignmentPerformance`（Plan 10）：它在批改时已把 `kpIds[]` 去规范化写入，且带 `gradeStatus`（CORRECT/PARTIAL/WRONG）+ `createdAt`。这绕开了 `QuestionKPLink` 稀疏问题——performance 行的 KP 归属是落库时定的，不依赖 KP 树覆盖度。

每条 performance = 一个对某些 KP 的"作答信号"：
- `score(CORRECT)=1.0`，`score(PARTIAL)=0.5`，`score(WRONG)=0.0`
- 一条 performance 的 `kpIds` 里**每个** kpId 都吃这条信号（一题多 KP 时信号分摊到各 KP）。

### 2.2 次数据源：ErrorBookEntry（best-effort 弱信号）

`ErrorBookEntry`（ACTIVE）经 `question.knowledgePoints`（QuestionKPLink）映射到 KP，作为"近期错题计数"展示（`recentErrorCount`）。**不进 mastery score**（避免 KP 稀疏污染掌握度）——只当一个补充展示维度。无 QuestionKPLink 的错题自然不计入，不报错。

### 2.3 时间衰减 + 窗口

- `AnalyticsWindow`：`D30` / `D90`（默认）/ `ALL`。窗口是**硬截断**（filter createdAt）。
- 衰减：半衰期 `HALF_LIFE_DAYS = 30`；`w_i = 0.5 ** (ageDays_i / 30)`。
- 每 KP：`weightedScore = Σ(w_i·score_i) / Σ(w_i)`；`weightedSampleSize = Σ(w_i)`；`rawSampleSize = count`。

### 2.4 三档 + 数据不足（合规友好）

| tier | 条件 | 中文（按学段在 UI 调整，见 §3） | 颜色块 |
|---|---|---|---|
| `INSUFFICIENT_DATA` | `weightedSampleSize < 1.0` | 数据不足，继续练习后解锁 | 灰 |
| `FOCUS` | `weightedScore < 0.5` | 重点巩固方向（**不**写"薄弱/差"） | 蓝 |
| `PROGRESSING` | `0.5 ≤ score < 0.8` | 稳步提升 | 琥珀 |
| `SOLID` | `score ≥ 0.8` | 掌握扎实 | 绿 |

**合规红线**：数据不足 KP **绝不**渲染成 `0% 掌握` 红块（既误导又制造焦虑，违反 CLAUDE.md）。`FOCUS` 措辞用"重点巩固方向"，颜色用蓝（聚焦）而非红（失败）。

### 2.5 班级诊断聚合

按 KP 跨学生：`avgScore` = 该 KP 所有有数据学生 `weightedScore` 的均值；`focusStudentCount` = 在该 KP 落 FOCUS 档的学生数；`classTier` 由 `avgScore` 套同一阈值。排序 focus-first。

## §3 合规约束（§前序承诺的 §4）

合规不止盖 AI 建议层，**静态画像渲染也受约束**（CLAUDE.md）：

1. **AI 学习建议输出**：走 AI router 既有 `findForbidden` 后置扫描 → `ComplianceRejectedError` → chargeMiddleware 白名单不补偿（沿用 Plan 4 契约，debit row metadata `compensationStatus="not_compensated_whitelisted"`）。
2. **`generateAdvice` 无自由文本输入**（输入是从本人 profile 派生的 KP 名 + tier），故不需单独的 input-compliance 中间件；中间件链 = `authedProcedure.use(chargeMiddleware("LEARNING_ADVICE_GEN"))`，与 `error.diagnose` 同构（charge → AI，输出扫描兜底）。
3. **静态文案**：三档措辞中性、按学段调整（小学=生活类比；初中=题型归类；高中=方法迁移），无提分/分数/通过保证，无恐吓。学段 copy 由前端按 `gradeLevel` 选词，常量集中在 `apps/web/lib/mastery-copy.ts`。
4. **家长简版**：`familyView` 剥掉每-KP 数字百分比，只给"扎实 N 项 / 提升中 N 项 / 建议关注：<KP 名列表>"+ 鼓励性总结，无排名、无分数。

## §4 计费

- 新增 `ActionKind = "LEARNING_ADVICE_GEN"`，`PRICING.LEARNING_ADVICE_GEN = 1`。
- 新增 `TaskKind = "LEARNING_ADVICE"`，`TASK_MODEL_MAP.LEARNING_ADVICE = "qwen-plus"`。
- 仅 `profile.generateAdvice`（学生本人）扣费；画像查询（mine/get/diagnosis）**不**扣费（纯查询）。
- `clientRequestId: uuid` 强制；`idemKey = debit:learning_advice_gen:<userId>:<cri>`（沿用 chargeMiddleware）。

## §5 family-link 流程（§前序承诺的 §5；学生发码/家长绑定）

### 5.1 schema

```prisma
enum FamilyLinkStatus { ACTIVE  REVOKED }

model FamilyLink {
  id            String           @id @default(cuid())
  parentUserId  String           @map("parent_user_id")
  studentUserId String           @map("student_user_id")
  status        FamilyLinkStatus @default(ACTIVE)
  createdAt     DateTime         @default(now()) @map("created_at")
  revokedAt     DateTime?        @map("revoked_at")
  parent        User @relation("ParentLinks",  fields: [parentUserId],  references: [id], onDelete: Restrict)
  student       User @relation("StudentLinks", fields: [studentUserId], references: [id], onDelete: Restrict)
  @@unique([parentUserId, studentUserId])
  @@index([studentUserId, status])
  @@index([parentUserId, status])
  @@map("family_links")
}
```
`onDelete: Restrict`（与 ErrorBookEntry 同款安全默认）——注销由 Plan 6 service 显式删，不靠级联。

### 5.2 发码（学生）

`family.createInviteCode`（authed mutation）：生成 8 字符 URL-safe 码 → Redis `SET family:invite:<code> = <studentUserId> EX 900`（15 分钟、一次性）。返回 `{ code, expiresInSec: 900 }`。数据主体（学生）持发起权——家长无法单方面挂靠任意学生。

### 5.3 绑定（家长）

`family.bindByCode`（authed mutation，input `{ code }`）：
- `GET family:invite:<code>` → 无 → `NOT_FOUND / INVITE_INVALID`。
- `studentUserId === viewerId` → `BAD_REQUEST / CANNOT_BIND_SELF`。
- `upsert FamilyLink` on `(parentUserId, studentUserId)`：不存在则建 ACTIVE；存在且 REVOKED → 复活成 ACTIVE（清 revokedAt）；已 ACTIVE → 幂等返回。
- `DEL family:invite:<code>`（单次用尽）。
- 返回子女简要 `{ studentUserId, name, gradeLevel }`。

### 5.4 列表 / 撤销

- `family.listMyChildren`（authed query，家长视角）：FamilyLink ACTIVE where parentUserId=self → 子女 `{ userId, name, gradeLevel }`。
- `family.revoke`（authed mutation，input `{ linkId }`）：link 不存在 / viewer 既非 parent 也非 student → `NOT_FOUND / LINK_NOT_FOUND`（存在性侧信道：双方之外的人看不到 link 存在）。任一方可撤销 → status REVOKED + revokedAt=now。

### 5.5 access helper

`requireProfileAccess(db, viewerId, targetId)`：
- `viewerId === targetId` → `'self'`。
- FamilyLink ACTIVE (parentUserId=viewer, studentUserId=target) → `'parent'`。
- viewer 是某 classroom 的 TEACHER 且 target 是同 classroom 的 STUDENT → `'teacher'`。
- 否则 → `NOT_FOUND / PROFILE_NOT_ACCESSIBLE`（**不**用 FORBIDDEN，避免暴露"此 userId 存在"）。

## §6 缓存

- `learning-cache.ts`：`getCached<T>(key, ttlSec, loader)`：`redis.get` 命中 `JSON.parse` 返回；未命中 `loader()` → `redis.set(key, JSON.stringify(v), "EX", 300)`。
- key：`analytics:profile:<userId>:<window>` / `analytics:class:<classroomId>:<window>`。
- **纯 TTL，无主动失效**：学生提交/批改后掌握度最多滞后 5min；班级诊断同理。MVP 可接受，写进文档。`generateAdvice` 基于（可能 5min 旧的）缓存 profile，可接受。
- `LearningProfile` / `ClassDiagnosis` 是纯 JSON-safe（数字/字符串/数组），`generatedAt` 用 ISO string，不放 Date 对象 → 直接 `JSON.stringify`，不需 superjson。

## §7 PII（Plan 6 增量）

- `deactivateUser`：事务内 `familyLink.deleteMany({ where: { OR:[{parentUserId},{studentUserId}] } })`；payload `deleted.familyLinks` 计数（只计数，无 PII）。
- `exportUserData`：新增 `familyLinks: [{ id, role:'parent'|'student', counterpartUserId, status, createdAt }]`（本人参与的 link；counterpart 是已绑定关系，原样导出 id 不 mask）。`schemaVersion` 不变（追加字段，向后兼容；导出消费方按存在性读）。
- `OpsActionLog.payload` guard：`familyLinks` 计数允许，禁止 parentUserId/studentUserId/name 等进 payload。

## §8 验收红线（落 CLAUDE.md「Merge 后必跑」）

1. `packages/analytics` 不依赖 redis/ai/server-only：`grep -rn "ioredis\|@zhijiao/ai\|server-only" packages/analytics/src` 应 0 命中。
2. 数据不足 KP 不渲染 0% / 不进 mastery：core 单测覆盖 `weightedSampleSize<1 → INSUFFICIENT_DATA, score=null`。
3. `requireProfileAccess` 无权返 NOT_FOUND（非 FORBIDDEN）：集成测覆盖 self/parent/teacher/stranger 四例。
4. `generateAdvice` 合规拒绝走白名单不补偿：集成测断言 debit 保留 + metadata。
5. family-link 学生发码、单次用尽、自绑拒绝、撤销后失效：集成测覆盖。
6. 注销删 FamilyLink、导出含本人 link、payload 无 PII：扩 Plan 6 既有三测。
7. 缓存 5min TTL + 绕过路径：集成测命中/未命中 + loader 调用次数。
</content>
</invoke>
