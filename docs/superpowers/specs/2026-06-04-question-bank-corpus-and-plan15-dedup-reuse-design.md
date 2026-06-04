# 题库语料供给 + Plan 15 去重/复用/统计归并 —— 设计文档

- 日期：2026-06-04
- 状态：待实现
- 关联：Plan 8（答疑题面持久化 / `normalizedStemHash` / `upsertUserAdhocQuestion`）、Plan 13（KP 树）、Plan 14a（监护人同意）、Plan 14c（PII 脱敏）
- 范围标识：子项目 A（题库语料 + Plan 15）。Plan 17（生产 AI 出卷）是独立子项目，另写 spec。

## 1. 背景与目标

Plan 15（USER_ADHOC × PUBLISHED canonical 去重 / PUBLISHED 复用 / 统计归并）此前被 punt，理由是**语料供给不足**：PUBLISHED 题库仅 3 条 fixture，对其做 normalized-stem 匹配命中率 ≈ 0，归并统计也无消费者。

本设计先解锁前置（真实题库语料），再让去重/复用有真实命中面并落地一个明确的消费者：

1. **语料供给**：原创一批真题级初中数学 PUBLISHED 题入库（WebSearch 真题仅作考点/题型/难度**参考**，落库为**原创等价题**以规避版权）。
2. **去重 + 复用**（参考小猿搜题的"匹配题库→秒回缓存解答"模型，但复用的是 **hint-first 结构化讲解**而非答案优先，守住 CLAUDE.md "非拍照搜答案、方法论优先"红线）：学生 `tutor.ask` 命中 PUBLISHED 范题时，不再新建 USER_ADHOC 重复题；复用范题上缓存的讲解，缓存命中则零 AI 调用、零扣费。
3. **统计归并**：命中量（热度）与错题归集挂到 canonical 范题，作为统计的真实消费者。

### 非目标（本期不做）

- 向量 / 模糊 / 语义近似匹配。v1 仅 `normalizedStemHash` 精确匹配。
- 跨 USER_ADHOC 的去重重构（现有同 user 同 stem partial unique idx 不动）。
- 题库批量导入 CLI（JSON/CSV）。语料用 seed 数据文件落，导入管道列为后续。
- Plan 17 AI 出卷。

## 2. A1：语料供给（原创 PUBLISHED 题库）

### 2.1 来源与合规

- 用 WebSearch 检索初中数学（优先一次函数 / 方程 / 不等式及邻近主题）真题，**仅提取考点分布、题型结构、难度基准**作为命题参考。
- 落库内容是**原创等价题**，不逐字照搬任何受版权保护的真题。符合 CLAUDE.md 合规章节对商业题库的保守取向。

### 2.2 数据文件

新增 `packages/db/prisma/seed/question-bank/junior-math.ts`，导出题目数组（仿 `kp-data/*.ts` 模式，纯数据 + 校验）：

```ts
export interface SeedQuestion {
  externalKey: string;        // 稳定幂等 key（如 "qb-junior-linear-eq-001"）
  stemMd: string;
  type: QuestionType;         // 沿用现有枚举：SINGLE_CHOICE / MULTI_CHOICE / FILL_BLANK / CALCULATION / PROOF / ESSAY
  optionsJson?: unknown;      // CHOICE 题选项
  difficulty: number;         // 1–5
  answerMd: string;           // 标准答案
  solutionMd: string;         // 分步解析
  kpCodes: string[];          // 关联 KP 叶子 code（须存在于 KP 树，seed 时校验）
}
```

- 规模：~40 道，覆盖现有 KP（`math-g8-linear-eq*`）+ 邻近叶子。
- 纯校验 `validateSeedQuestions`：`externalKey` 全局唯一、`kpCodes` 非空且每个 code 在 `mathKpRoots` 叶子集合内（命中即 throw，仿 `validateKpData`）。

### 2.3 Loader

新增 seed 步骤（在 KP 树 seed 之后，依赖 KP 已存在）：

- 先跑 `validateSeedQuestions`。
- 对每题：`normalizedStemHash = sha256(normalizeStem(stemMd))`（复用 Plan 8 的 `normalizeStem`：trim + 折叠空白，不 lowercase）。
- 幂等 upsert：按 `externalKey` 找现有 Question（在 stem 里不存 externalKey，故另存——见 2.4），upsert `Question(source="PUBLISHED", status=PUBLISHED, normalizedStemHash, subjectId=math)` + `QuestionAnswer` + `QuestionKPLink`（weight 默认 1.0）。
- 校验脚本 `verify:question-bank`：断言 PUBLISHED（source="PUBLISHED"）题数 ≥ 30 且每题有 answer + ≥1 KP link。

### 2.4 externalKey 落点

`Question` 现无 `externalKey` 字段。为幂等需要稳定外键，加可空列：

```prisma
model Question {
  // ...
  externalKey String? @unique @map("external_key")   // 仅 seed/导入题用；USER_ADHOC/VARIANT 为 null
}
```

- `@unique` 允许多个 null（Postgres 行为），不影响 USER_ADHOC/VARIANT。
- seed loader 用 `upsert({ where: { externalKey } })` 实现幂等。

## 3. A2：去重 + 复用

### 3.1 匹配

- 在 `tutor.ask` 落 USER_ADHOC **之前**，用脱敏后题面的 `normalizedStemHash` 查 PUBLISHED canonical：
  `findFirst({ where: { source: "PUBLISHED", status: "PUBLISHED", normalizedStemHash: hash } })`。
- 为查询性能加索引：`@@index([source, status, normalizedStemHash])`（或 partial idx）。
- v1 仅精确 hash 匹配。多个 PUBLISHED 撞同 hash 取最早一条（稳定）。

### 3.2 讲解缓存表

hint-first 讲解按学段调整表达，故缓存 key 含学段 band，**仅同 band 复用**：

```prisma
enum GradeBand { PRIMARY JUNIOR SENIOR NEUTRAL }

model QuestionExplanationCache {
  id           String    @id @default(cuid())
  questionId   String    @map("question_id")
  gradeBand    GradeBand @map("grade_band")
  tutoringJson Json      @map("tutoring_json")   // 缓存的 hint-first 结构化输出
  modelCallId  String?   @map("model_call_id")   // 审计：生成此缓存的 ModelCall
  createdAt    DateTime  @default(now()) @map("created_at")

  question     Question  @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@unique([questionId, gradeBand])
  @@map("question_explanation_caches")
}
```

- band 映射：`studentGrade` 输入（缺则 `user.gradeLevel`，再缺则 `NEUTRAL`）→ G5–G6=PRIMARY / G7–G9=JUNIOR / G10–G12=SENIOR。
- `tutoringJson` 存通过 PII 脱敏 + 合规校验后的讲解（与现有 `router.ts` 输出侧脱敏一致；缓存的内容已是脱敏后的）。

### 3.3 中间件链重构

当前 `tutor.ask` = `authedProcedure → validateTutorInputCompliance → chargeMiddleware("TUTOR_ASK")`，**未挂** `requireGuardianConsent`（绕过 `chargedProcedure` 糖时漏挂）。缓存命中要跳过扣费，故 consent 必须与扣费解耦。新链：

```
authedProcedure
  → requireGuardianConsent          // 新增；consent 独立于扣费，缓存命中的免费路径仍受门禁
  → validateTutorInputCompliance    // 不变
  → tutorReuseAndCharge             // 替换裸 chargeMiddleware
```

`tutorReuseAndCharge` 中间件：

1. `getRawInput()` 取 `questionStem` + `studentGrade`。
2. `redactPii(questionStem)` → `redactedStem`；`hash = sha256(normalizeStem(redactedStem))`；`gradeBand = bandOf(studentGrade ?? user.gradeLevel)`。
3. `try`：查 canonical（3.1）；命中则查 `QuestionExplanationCache(canonicalId, gradeBand)`。`catch`：fail-open，按"无范题"处理（置 `canonicalId=null`）。
4. 分支：
   - 缓存命中 → `ctx.tutorReuse = { hit: true, canonicalId, cached, redactedStem }`，**不扣费**，`next()`。
   - 否则 → `ctx.tutorReuse = { hit: false, canonicalId, gradeBand, redactedStem }`，调用从 `chargeMiddleware` 抽出的 `applyCharge(ctx, "TUTOR_ASK", clientRequestId)`，`next()`。

> 重构约束：从 `chargeMiddleware` 抽出 `applyCharge` 纯逻辑供条件调用，`chargeMiddleware` 自身行为不变（error/variant 等既有调用点零 diff）。`chargedProcedure` 不变。

### 3.4 resolver 三分支

1. **缓存命中**：返回 `{ questionId: canonicalId, ...cached }`。不调 AI、不建 Question。热度计数 +1（3.5）。
2. **命中范题、缓存 miss**：调 AI 生 hint-first（沿用现有 PII/合规/审计管线）→ 成功才 `upsert QuestionExplanationCache({ questionId: canonicalId, gradeBand, tutoringJson, modelCallId })`（`@@unique` 幂等）→ 返回 `{ questionId: canonicalId, ... }`。**不建 USER_ADHOC**。热度 +1。AI 失败 → 不写缓存、不建题，沿用既有补偿退费。
3. **无范题**（`canonicalId == null`）：现状路径完全不变——`upsertUserAdhocQuestion` + AI + `reconcileHintsSync`。回归测试守门。

### 3.5 计费

- 缓存命中：**完全免费**（零 AI 调用，最贴近"秒回"体感）。
- 缓存 miss（含无范题）：正常 `TUTOR_ASK` 扣费。

## 4. A3：统计归并（消费者）

- **热度计数**：canonical 范题被复用/命中的次数。加轻量字段 `Question.reuseHitCount Int @default(0)`，resolver 分支 1/2 用原子 `increment` +1。作为题库运营 / 未来命题预测的真实信号 = 统计消费者。
- **错题归并**：学生对复用的范题加错题本时，`ErrorBookEntry.questionId` = canonical id（PUBLISHED）。现有 partial unique idx `(user_id, question_id)` 仍按用户隔离，无需改 schema。效果：同一范题的错题不再因每人各建 USER_ADHOC 而散落，自然归并到 canonical。
- `error.diagnose` 对 canonical PUBLISHED 已放行（`validateQuestionAccess` owner-only 仅 USER_ADHOC/VARIANT_GENERATED），无需改动。

## 5. 错误处理与边界

- canonical 查找 fail-open：中间件内 `try/catch`，DB 错按"无范题"走，绝不因优化失败阻断学生（记 `logger.warn`）。
- AI 失败（分支 2）：不写缓存、不建题，既有补偿规则退费。
- 并发双 miss（同 band 同范题）：双调 AI、双 upsert 缓存，靠 `@@unique([questionId, gradeBand])` 收敛；双方都已调 AI 故都扣费（罕见，可接受）。
- PII：缓存内容是脱敏 + 合规后的讲解；范题题面原创无 PII。脱敏失败/命中沿用 Plan 14c 行为（不抛错、只记计数）。
- 学段缺失：band=NEUTRAL，缓存在 NEUTRAL 桶内复用（无学段用户之间共享）。

## 6. Schema 变更汇总

1. `Question.externalKey String? @unique`（seed/导入幂等键）。
2. `Question.reuseHitCount Int @default(0)`（热度统计消费者）。
3. `Question` 加索引 `@@index([source, status, normalizedStemHash])`（canonical 查找）。
4. 新枚举 `GradeBand`。
5. 新表 `QuestionExplanationCache`（`@@unique([questionId, gradeBand])`）。

均为加列 / 加表 / 加索引，无破坏性迁移。

## 7. 测试

**单元**：`normalizeStem`/hash（已有）；`bandOf` 学段映射；`validateSeedQuestions`（重复 externalKey / 非法 kpCode 抛错）；`applyCharge` 抽取后行为不变。

**集成（@zhijiao/web）**：
- 命中范题 + 缓存 miss → 扣费、写 1 行缓存、**不建 USER_ADHOC**、返 canonicalId。
- 二次同 stem 同 band → 缓存命中、**零扣费**、**AI mock 断言未被调用**、返同 canonicalId + 缓存内容。
- 不同 band 同 stem → 各自 miss（2 行缓存）。
- 无范题 → USER_ADHOC 路径回归不变。
- `<14` 无 consent → 即便命中缓存仍 `GUARDIAN_CONSENT_REQUIRED`（consent 解耦验证）。
- canonical 查找 DB 错误 → fail-open 走 AI 路径仍成功。
- 热度计数：命中后 `reuseHitCount` 递增。
- `error.diagnose` 对 canonical 范题正常（访问放行回归）。

**数据**：`verify:question-bank` 断言 PUBLISHED 题数 ≥ 30、每题有 answer + ≥1 KP link。

## 8. 合规

- 语料原创、规避版权（§2.1）。
- 复用内容是 hint-first 结构化讲解（题目重述→知识点→分步推理→陷阱→答案，答案默认折叠），不是答案优先；不违反"非拍照搜答案"定位。
- 无提分 / 分数 / 通过文案；学段自适应表达（缓存按 band 隔离支撑此点）。

## 9. 后续 / punt

- 向量 / 语义近似匹配（扩大命中面）。
- PUBLISHED 题库批量导入 CLI（JSON/CSV）。
- 缓存失效 / 版本化（范题或 prompt 更新后刷新缓存）——v1 缓存长存，范题内容稳定。
- 跨学段 USER_ADHOC × PUBLISHED 的运营审阅面（OPS）。
