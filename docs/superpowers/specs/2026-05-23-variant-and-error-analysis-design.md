---
title: 智教 — Plan 4 举一反三 + 错因分析 设计 Spec
date: 2026-05-23
status: draft (awaiting user review)
scope: ErrorBookEntry + VariantGroup + 三阶变式生成 + 错因分类 + 间隔复习；chargedProcedure 拆 chargeMiddleware
audience: 实施者（Claude Code）、用户（产品/架构审核者）
source: 上轮 brainstorm 被 /clear 清空；本稿基于评审反馈的 4 条必修项 + Plan 3 风格补齐
verification_prereqs:
  - Plan 1 已落地（master commit 38ebe6e 之前）
  - Plan 2 + 2 Hardening 已落地（master commit cc2c43b）
  - Plan 3 已落地（master commit f87db1b）—— ErrorBookEntry / VariantGroup 复用 chargedProcedure 计费
prod_ship_prereqs:
  - 无独占 prereq；本 plan 完全在 Plan 3 计费/合规框架内
---

# 智教 · Plan 4 举一反三 + 错因分析 设计

## 0. 文档信息

**目标**：把"错因分析 → 错题本 → 举一反三"这条产品核心闭环（CLAUDE.md §三大业务中心 → 学生学习中心）从空架子落到代码。

关键交付：
1. `ErrorBookEntry` 表 + `VariantGroup` / `VariantItem` 表（schema 增量，零侵入 Plan 1–3）
2. `error.diagnose`（错因分析 + 写入错题本，扣 1 credit）
3. `variant.generateForEntry`（基于错题本 entry 生成三阶变式，扣 3 credits）
4. `error.list` / `error.getById` / `error.dueForReview` / `error.markReviewed` / `error.archive` / `error.delete` 错题本 CRUD + 间隔复习
5. `chargeMiddleware(kind)` 抽取：Plan 3 的 `chargedProcedure(kind)` 拆成可与"前置 ctx 注入中间件"组合的 middleware

**两个 blocker 级别的设计要点（评审反馈，本稿首要修复）**：

| # | Blocker | 本稿修复位置 |
|---|---|---|
| 1 | `variant.generateForEntry` 的"先查 entry 再扣费"与现有 `chargedProcedure` 结构冲突 —— 当前实现 chargedProcedure 直接套 authedProcedure，不能在扣费之前插入 entry 校验中间件 | §5.3 `chargeMiddleware(kind)` 抽取 + §4.2 流程 + §8.2 显式测例（entry 不存在 / 跨用户 → 不写 DEBIT ledger） |
| 2 | DELETED 语义在"终态/回收站/可见性"三处自相矛盾 | §3.3 + §4.4 定死：DELETED 终态 + 列表/详情/复习/dueForReview 默认不可见 + 无 UI 复活路径 + 文案"从错题本移除" |

**两个 UI surface 修复**：

| # | 反馈 | 修复 |
|---|---|---|
| A | `error.diagnose` 应返回 `entryId`，让 ErrorAnalysisCard 能链接到错题详情 | §5.1.1 输出契约 + §4.1 流程 step 5 |
| B | `error.dueForReview` 空状态需要 `nextReviewAt`，前端才能算 "下次复习 +Xd" | §5.1.4 输出契约 + §6.3 算法 |

**作用域不在本稿（推迟）**：
- AI 模型选型 / Prompt 模板版本管理细节（沿用 Plan 1 `@zhijiao/ai` PromptTemplate + ModelCall 工艺，本稿只列 task_kind）
- 教师端"分层作业"基于错题本 entry 的扩展（独立 plan）
- 学情画像 / 趋势报告（独立 plan）
- 错题导出 / 错题分享卡片（独立 plan）

## 1. 决策摘要

| # | 议题 | 决策 | 关键影响 |
|---|---|---|---|
| 1 | 错因分类口径 | 5 类固定枚举：`CONCEPT_CONFUSION / READING_ERROR / FORMULA_MISUSE / CALCULATION_SLIP / TRANSFER_GAP` + `OTHER` 兜底 | 与 CLAUDE.md 域语言表对齐；AI 必须输出枚举内 ID，非 free-text；JSON schema 强约束 |
| 2 | 错题本归并 | 同一 (userId, questionId) 只允许一条 ACTIVE/ARCHIVED；DELETED 不算（partial unique index） | dedupe；DELETED 后重新 `diagnose` 同题 = 新 entry（终态不复活） |
| 3 | DELETED 终态 | `status=DELETED` 后所有 student-facing 入口（list/getById/dueForReview/markReviewed/archive/重新 diagnose 的复用路径）一律视为不存在 | 不做"回收站"UI；不暴露 `status=DELETED` 过滤参数；审计行 DB 保留 |
| 4 | entry 校验时机 | **必须在扣费之前**：authedProcedure → validateEntryOwnership → chargeMiddleware → mutation body | entry 不存在 / 跨用户 → 抛 NOT_FOUND，**不写 DEBIT ledger**；与"用户未拿到 service 时不收费"一致 |
| 5 | 变式生成粒度 | 三阶 L1/L2/L3 一次性出 3 道 → 一个 VariantGroup 锁价 3 credits | 一次扣 3 credits（priceOf `VARIANT_GROUP_GEN`），失败补偿覆盖全 3 道；不支持"补生成第 4 道" |
| 6 | 间隔复习算法 | 5 段固定间隔（1d / 3d / 7d / 14d / 30d）+ 第 5 段后 cap 30d；用户标记掌握后 `nextReviewAt` 推到下一段 | MVP YAGNI；不上 SM-2；前端只需 `dueToday[]` + `nextReviewAt` 两字段；不做"漏复习惩罚"调档 |
| 7 | 变式合规 | 同 tutor.ask：AI 输出走 `ComplianceRejectedError` 白名单；非合规拒绝时不补偿 | 沿用 Plan 3 §1.8 fail-open 补偿语义；用户拿到了 deterministic 拒绝即视为服务交付 |
| 8 | 中间件抽取 | `chargedProcedure(kind) = authedProcedure.use(chargeMiddleware(kind))` 拆成糖语法；新增 `chargeMiddleware(kind)` 独立 factory | Plan 3 调用点（tutor.ask）零 diff；Plan 4 可用 `authedProcedure.use(validateEntryOwnership).use(chargeMiddleware(kind))` |

## 2. 架构

3 块薄增量，零侵入 Plan 1/2/3 现有 schema 与代码。

```
┌─────────────────────────────────────────────────────────────┐
│                       apps/web (tRPC)                       │
│                                                             │
│  routers/error.ts        (NEW)                              │
│  ├ diagnose              chargedProcedure(ERROR_ANALYSIS)   │
│  ├ list                  authedProcedure                    │
│  ├ getById               authedProcedure                    │
│  ├ dueForReview          authedProcedure                    │
│  ├ markReviewed          authedProcedure                    │
│  ├ archive               authedProcedure                    │
│  └ delete                authedProcedure                    │
│                                                             │
│  routers/variant.ts      (NEW)                              │
│  └ generateForEntry      authedProcedure                    │
│                              .use(validateEntryOwnership)   │
│                              .use(chargeMiddleware(VAR..))  │
│                                                             │
│  server/trpc.ts          (REFACTOR)                         │
│  ├ chargeMiddleware(kind)        ← 抽取                     │
│  ├ chargedProcedure(kind)        ← 改为糖语法               │
│  └ validateEntryOwnership        ← 新中间件                 │
└────────────────────────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┴───────┐
              ▼                              ▼
┌─────────────────────────────┐ ┌──────────────────────────────┐
│ packages/ai (扩展)          │ │ packages/db (Prisma) — delta │
│                             │ │                              │
│ src/tasks/                  │ │ ErrorBookEntry              │
│ ├ error-analysis.ts (NEW)   │ │ VariantGroup                │
│ │  diagnoseError({          │ │ VariantItem                  │
│ │    stemMd, studentGrade,  │ │ enums: ErrorRootCause /      │
│ │    actualAnswerMd?,       │ │        ErrorBookStatus /     │
│ │    correctAnswerMd?,      │ │        VariantLevel          │
│ │  })                       │ │                              │
│ │   → { rootCause,          │ │ partial unique index:        │
│ │       reasoning,          │ │   (user_id, question_id)     │
│ │       suggestedKps[] }    │ │   WHERE status IN            │
│ └ variant-generation.ts NEW │ │     ('ACTIVE', 'ARCHIVED')   │
│    generateVariants({       │ └──────────────────────────────┘
│      anchorStemMd,
│      anchorRootCause,
│      anchorKps[],
│      studentGrade,
│    })
│     → { items: [           ┌──────────────────────────────┐
│         L1, L2, L3         │ packages/billing (零改动)    │
│       ] }                  │                              │
│   每道变式：{               │ pricing.ts 已含              │
│     level, stemMd,         │   VARIANT_GROUP_GEN=3        │
│     solutionMd,            │   ERROR_ANALYSIS=1           │
│     knowledgePointHints[]  │ chargeForAction / compensate │
│   }                        │ 直接复用                     │
└─────────────────────────────┘ └──────────────────────────────┘
```

**模块边界**：

- **`packages/db`** —— 加 3 表 3 enum + 一条 partial unique index（raw SQL 在 migration 里）；不动现有表
- **`packages/ai`** —— 加两个 task：`ErrorAnalysis` / `VariantGeneration`；沿用 Plan 1 `ModelCall` + `PromptTemplate` 工艺；输出 zod schema 强约束；`ComplianceRejectedError` 复用
- **`packages/billing`** —— **零改动**；`PRICING` map 已含 `ERROR_ANALYSIS=1` / `VARIANT_GROUP_GEN=3`（Plan 3 附录 A 已留位）
- **`apps/web` 胶水** —— 加 2 个 router + 1 个 trpc.ts refactor（拆 chargeMiddleware + 加 validateEntryOwnership）；UI 加错题本页 + 变式生成入口

**与 Plan 3 工艺一致**：
- `chargedProcedure` → `chargeMiddleware` 抽取后，Plan 3 既有调用点（`tutor.ask`）零行 diff
- 失败补偿 / 白名单非补偿 / metadata 标记 / structured log 全部复用 Plan 3 实现
- 输入校验 `clientRequestId: z.string().uuid()` 强制；idemKey 命名约定 `debit:<kind>:<userId>:<clientRequestId>` 保持
- per-package test DB 沿用现有 6 个，不新增（`ErrorBookEntry`/`VariantGroup` 测在 `zhijiao_test_db` + `zhijiao_test_web`）
- 合规拒绝同 tutor.ask：`ComplianceRejectedError` → `cause: { reason: "COMPLIANCE_REJECTED", original: e }` → `shouldCompensate` 白名单识别

## 3. 数据模型 delta

加 **3 张表** + **3 个新 enum** + **1 个 partial unique index**（raw SQL）。

### 3.1 Enum

```prisma
enum ErrorRootCause {
  CONCEPT_CONFUSION     // 概念混淆：定义/性质理解错
  READING_ERROR         // 读题失误：漏条件、误读条件
  FORMULA_MISUSE        // 公式误用：套错公式 / 用错适用域
  CALCULATION_SLIP      // 计算疏漏：纯算术 / 符号 / 移项错
  TRANSFER_GAP          // 迁移不足：知识点会但情境换了用不出来
  OTHER                 // 兜底：AI 无法分类时；产品上需后续 reclassify
}

enum ErrorBookStatus {
  ACTIVE     // 默认错题本视图；进复习队列；error.list 默认只返此态
  ARCHIVED   // 用户主动归档：从默认错题本"移走"。不进默认 list / 不进 dueForReview。
             // 仅在"归档页"显式 error.list({ status: "ARCHIVED" }) 才可见。
             // 仍属 student-facing（可读详情 / 可生成变式 / 可 archive(false) 拉回 ACTIVE）。
  DELETED    // 终态；所有 student-facing 入口视为不存在；DB 行保留作审计
}

enum VariantLevel {
  L1   // 同结构同知识点；改数字 / 改具体值
  L2   // 改条件 / 改题型表象（选择→填空 / 填空→解答）但同知识点
  L3   // 跨题型与现实情境融合；要求知识点迁移
}
```

### 3.2 表

```prisma
model ErrorBookEntry {
  id                  String           @id @default(cuid())
  userId              String           @map("user_id")
  questionId          String           @map("question_id")
  status              ErrorBookStatus  @default(ACTIVE)

  // AI 错因分析输出
  rootCause           ErrorRootCause
  rootCauseReasoning  String           @db.Text @map("root_cause_reasoning")
  // 学生实际作答（diagnose 时可选；若没传则 AI 只基于"对的答案 vs 题目"分析）
  actualAnswerMd      String?          @db.Text @map("actual_answer_md")

  // 间隔复习状态
  reviewCount         Int              @default(0) @map("review_count")
  // 下次到期复习时间；null = ARCHIVED/DELETED 时不再排
  nextReviewAt        DateTime?        @map("next_review_at")
  lastReviewedAt     DateTime?         @map("last_reviewed_at")

  // 审计
  diagnoseLedgerId    String?          @map("diagnose_ledger_id")
  // 同一题被 diagnose 多次：保留最新一次 ModelCall.id；历史在 ModelCall 表可查
  lastDiagnoseCallId  String?          @map("last_diagnose_call_id")

  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt      @map("updated_at")

  // FK 不设 CASCADE：与 Wallet/CreditLedger 同安全默认
  // 用户注销 / 题目下线时不应自动删错题；PII / 题库治理在独立 plan
  user                User             @relation(fields: [userId], references: [id], onDelete: Restrict)
  question            Question         @relation(fields: [questionId], references: [id], onDelete: Restrict)
  variantGroups       VariantGroup[]

  // ❌ 故意不加 @@unique([userId, questionId])
  //    DELETED entry 允许与新 ACTIVE entry 共存；用 partial unique index 在 migration 里加
  @@index([userId, status, nextReviewAt])  // dueForReview
  @@index([userId, status, createdAt(sort: Desc)])  // list
  @@index([questionId])                    // 反向查"这道题被哪些用户错过"（运营用，非必需）
  @@map("error_book_entries")
}

model VariantGroup {
  id              String         @id @default(cuid())
  entryId         String         @map("entry_id")
  userId          String         @map("user_id")  // 冗余便于过滤；与 entry.userId 一致
  // 锁价：生成时的 priceOf("VARIANT_GROUP_GEN")，便于历史定价审计
  creditsCost     Int            @map("credits_cost")
  debitLedgerId   String         @unique @map("debit_ledger_id")
  modelCallId     String?        @map("model_call_id")
  createdAt       DateTime       @default(now()) @map("created_at")

  entry           ErrorBookEntry @relation(fields: [entryId], references: [id], onDelete: Restrict)
  items           VariantItem[]

  @@index([entryId, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
  @@map("variant_groups")
}

model VariantItem {
  id            String        @id @default(cuid())
  groupId       String        @map("group_id")
  level         VariantLevel
  position      Int           // 1/2/3 在 group 内顺序展示
  stemMd        String        @db.Text @map("stem_md")
  solutionMd    String        @db.Text @map("solution_md")
  // AI 给出的知识点 hint（与课标对齐的字符串列表；非 FK，便于灵活）
  // 后续 plan 接入 KnowledgePoint 时可加 reconciler 把 hint 映射到 KP id
  knowledgePointHints String[] @default([]) @map("knowledge_point_hints")

  createdAt     DateTime      @default(now()) @map("created_at")

  group         VariantGroup  @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([groupId, level])   // 一个 group 每个 level 只一道
  @@index([groupId, position])
  @@map("variant_items")
}
```

**`User` 关联补充**（packages/db/prisma/schema.prisma User model 加一行）：

```prisma
// === Plan 4 ===
errorBookEntries   ErrorBookEntry[]
```

不动 Plan 3 的 `wallet` 关联。

### 3.3 设计关键点

**partial unique index（dedupe 但允许 DELETED 共存）**：

Prisma 5 schema 不直接支持带 `WHERE` 的 partial unique，故在 migration 文件里追加 raw SQL：

```sql
-- migrations/<timestamp>_plan4_error_book/migration.sql 末尾
CREATE UNIQUE INDEX "error_book_entries_user_question_active_idx"
  ON "error_book_entries" ("user_id", "question_id")
  WHERE "status" IN ('ACTIVE', 'ARCHIVED');
```

**为什么是 partial 而非全表 unique**：
- DELETED entry 是审计行；同一题用户先错→删→再错应该可以
- 全表 unique 会让"删后再 diagnose 同题"撞 UNIQUE，要么前端报错（坏 UX），要么实现绕过（坏代码）
- partial 让 schema 自然表达"业务唯一性"而非"DB 唯一性"

**P2002 风险**：理论上两次并发 `diagnose` 同一 (user, question) 可能撞 partial unique。处理方式：在 `error.diagnose` 实现里 catch P2002 → re-read 已存在的 ACTIVE/ARCHIVED entry → 返回该 entry id（替代新建）。详 §4.1 step 5.

**`diagnoseLedgerId` 与 `debitLedgerId`**：
- `ErrorBookEntry.diagnoseLedgerId` —— 最近一次 diagnose 扣费的 ledger row（更新时覆盖旧值）
- `VariantGroup.debitLedgerId` —— 本次生成扣费的 ledger row（UNIQUE，与 `creditLedger.idemKey` 形成双闸；同一 clientRequestId 不会落两个 VariantGroup）

**`nextReviewAt` 为 nullable**：
- ACTIVE entry → 非 null（创建时 = createdAt + 1d）
- ARCHIVED entry → null（不入复习队列；归档动作时显式置 null）
- DELETED entry → null（同上）

**索引设计**：
- `(userId, status, nextReviewAt)` —— `error.dueForReview` 主查（`WHERE userId=X AND status='ACTIVE' AND nextReviewAt <= now ORDER BY nextReviewAt ASC`）
- `(userId, status, createdAt DESC)` —— `error.list`（按 status filter 然后倒序）
- `(questionId)` —— 反查"这道题被错过几次"（运营 / 教师 / 命题趋势 plan 复用）

**`VariantItem.knowledgePointHints` 暂用 `String[]`**：
- 不接 `QuestionKPLink` 风格的 FK，因为：(a) AI 输出的是自然语言 KP 描述，不一定能精确映射到现有 `KnowledgePoint` id；(b) Plan 1 的 KP 树仍在搭建中
- 后续"学情画像 / 智能组卷"plan 可加 reconciler：把 hint 字符串映射到 KP id

## 4. 核心 Flows

### 4.1 error.diagnose（错因分析 + 写入错题本）

**Sequence**：

```
学生 UI               error.diagnose (chargedProcedure)        ErrorBookEntry     AI (error-analysis)
   │                          │                                       │                     │
   ├── diagnose({             │                                       │                     │
   │     questionId,          │                                       │                     │
   │     actualAnswerMd?,     │                                       │                     │
   │     clientRequestId,     │                                       │                     │
   │   }) ───────────────────▶│                                       │                     │
   │                          │ 1. ensureWallet                       │                     │
   │                          │ 2. cost = priceOf("ERROR_ANALYSIS")=1 │                     │
   │                          │ 3. chargeForAction({idemKey: debit:   │                     │
   │                          │      error_analysis:userId:cri,...}) │                     │
   │                          │    ├ predicate-on-update              │                     │
   │                          │    ├ ledger.insert DEBIT              │                     │
   │                          │    │  → debit.ledgerId                │                     │
   │                          │    └ (idemKey 撞 UNIQUE → CONFLICT)   │                     │
   │                          │ 4. try {                              │                     │
   │                          │      // 拉题面 + 正确答案              │                     │
   │                          │      const q = db.question.findUniqueOrThrow│              │
   │                          │      // AI 分析                       │                     │
   │                          │      const ai = await diagnoseError({ ─────────────────────▶│
   │                          │        stemMd: q.stemMd,              │                     │
   │                          │        correctAnswerMd: q.answer..,   │                     │
   │                          │        actualAnswerMd,                │                     │
   │                          │        studentGrade,                  │                     │
   │                          │      })                               │                     │
   │                          │      // {rootCause, reasoning, kps[]} │                     │
   │                          │      // 5. UPSERT entry (partial uniq)│                     │
   │                          │      const entry = await tx.$transaction(...)              │
   │                          │        // a) findFirst { userId, questionId,                │
   │                          │        //               status: { in: [ACTIVE, ARCHIVED] }}│
   │                          │        // b) if exists → update rootCause/.../diagnoseLedgerId│
   │                          │        // c) else → create with nextReviewAt = now + 1d   │
   │                          │      ─────────────────────────────────▶│                    │
   │                          │      try {                            │                     │
   │                          │        ...上面 a/b/c                  │                     │
   │                          │      } catch (P2002 on partial idx)   │                     │
   │                          │        // 并发 diagnose 撞 partial uniq → re-read 已存在的 │
   │                          │        // ACTIVE/ARCHIVED entry → 走 update path           │
   │                          │      return entry.id                  │                     │
   │                          │    }                                  │                     │
   │                          │    catch (e) {                        │                     │
   │                          │      // 同 tutor.ask 行为：           │                     │
   │                          │      // ComplianceRejectedError → 不补│                     │
   │                          │      // 其它 → fail-open 补偿         │                     │
   │                          │    }                                  │                     │
   │◀── { entryId,            │                                       │                     │
   │     rootCause,           │                                       │                     │
   │     rootCauseReasoning,  │                                       │                     │
   │     suggestedKps[],      │                                       │                     │
   │     nextActions[] }      │                                       │                     │
```

**5 步细节**：

1. **`chargedProcedure("ERROR_ANALYSIS")`** 跑 §5.3 抽出的 chargeMiddleware。扣费成功后注入 `ctx.debit = { ledgerId }`。

2. **拉题面**：`prisma.question.findUniqueOrThrow({ where: { id: input.questionId }, include: { answer: true } })`；不存在 → `NOT_FOUND` 抛错 → chargeMiddleware 默认补偿（题不存在不是合规拒绝，是用户传错或 race）。

3. **AI 调用**：`packages/ai` 新 task `error-analysis`；JSON schema 强约束输出 `{ rootCause: ErrorRootCause, reasoning: string, suggestedKnowledgePoints: string[] }`；模型路由复用现有；ModelCall 落审计行（taskKind=`ERROR_ANALYSIS`）。

4. **合规过滤**：AI 输出走 `ComplianceFilter`（packages/ai 现有 pipeline）；命中即抛 `ComplianceRejectedError`；chargeMiddleware 白名单识别不补偿。

5. **UPSERT entry**（核心）：

   ```ts
   async function upsertEntryOnDiagnose(tx, { userId, questionId, ai, debitLedgerId, modelCallId, actualAnswerMd }) {
     const existing = await tx.errorBookEntry.findFirst({
       where: { userId, questionId, status: { in: ["ACTIVE", "ARCHIVED"] } },
     });
     if (existing) {
       const updated = await tx.errorBookEntry.update({
         where: { id: existing.id },
         data: {
           // 重新 diagnose 把 ARCHIVED 拉回 ACTIVE（用户主动重学）
           // 不复活 DELETED（DELETED 不在 findFirst 范围内，不会被 update）
           status: "ACTIVE",
           rootCause: ai.rootCause,
           rootCauseReasoning: ai.reasoning,
           actualAnswerMd: actualAnswerMd ?? existing.actualAnswerMd,
           diagnoseLedgerId: debitLedgerId,
           lastDiagnoseCallId: modelCallId,
           // nextReviewAt 不重置 —— 用户已经在复习节奏中，不应因重新分析回退
           // 如 nextReviewAt 为 null（之前 ARCHIVED），重置为 now + 1d
           nextReviewAt: existing.nextReviewAt ?? new Date(Date.now() + DAY_MS),
         },
       });
       return updated;
     }
     try {
       return await tx.errorBookEntry.create({
         data: {
           userId, questionId,
           status: "ACTIVE",
           rootCause: ai.rootCause,
           rootCauseReasoning: ai.reasoning,
           actualAnswerMd,
           diagnoseLedgerId: debitLedgerId,
           lastDiagnoseCallId: modelCallId,
           nextReviewAt: new Date(Date.now() + DAY_MS),
         },
       });
     } catch (e) {
       if (isErrorBookPartialUniqueP2002(e)) {
         // 并发 race：另一条 diagnose 同时新建了 entry。re-read 走 update path
         const winner = await tx.errorBookEntry.findFirstOrThrow({
           where: { userId, questionId, status: { in: ["ACTIVE", "ARCHIVED"] } },
         });
         return await tx.errorBookEntry.update({
           where: { id: winner.id },
           data: {
             rootCause: ai.rootCause,
             rootCauseReasoning: ai.reasoning,
             diagnoseLedgerId: debitLedgerId,
             lastDiagnoseCallId: modelCallId,
           },
         });
       }
       throw e;
     }
   }

   // 抽出 helper 防止 `&& ... || ...` 运算符优先级踩坑：
   //   错的写法（regex 分支会绕过 instanceof + code 判断）：
   //     a && b && c || d
   //   = (a && b && c) || d   ← d 单独成立就 true
   // 显式 parens + 单一返回，避免实现者复制时手抖。
   function isErrorBookPartialUniqueP2002(e: unknown): boolean {
     if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
     if (e.code !== "P2002") return false;
     const meta = e.meta as { target?: string | string[] } | undefined;
     const target = meta?.target;
     const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
     // partial unique index 名见 migration（§3.3）
     return targetStr.includes("user_question_active");
   }
   ```

**为什么 ARCHIVED → ACTIVE 是允许的**（不与 blocker 2 冲突）：

ARCHIVED 不是终态。它表达"用户暂时不想看这条"。重新 diagnose 等于"我想重新学这道题" → 自然拉回 ACTIVE 队列。这与 DELETED 终态不复活的语义正交：DELETED entry 在 findFirst 的 status filter 之外，根本看不到。

**输出契约**：详 §5.1.1。关键是 `entryId` **必返**，让 ErrorAnalysisCard 能 `<Link href={"/error-book/" + entryId}>` 跳详情。

### 4.2 variant.generateForEntry（基于错题本 entry 生成三阶变式）

**Sequence**：

```
学生 UI               variant.generateForEntry              ErrorBookEntry   AI (variant-gen)   VariantGroup
   │                          │                                  │                │                 │
   ├── generate({             │                                  │                │                 │
   │     entryId,             │                                  │                │                 │
   │     clientRequestId,     │                                  │                │                 │
   │   }) ───────────────────▶│                                  │                │                 │
   │                          │ === Middleware 链 ===            │                │                 │
   │                          │ 1. authedProcedure: require auth │                │                 │
   │                          │ 2. validateEntryOwnership:       │                │                 │
   │                          │    ├ 从 rawInput 取 entryId      │                │                 │
   │                          │    ├ tx.findUnique({              │                │                 │
   │                          │    │    where:{id:entryId},       │                │                 │
   │                          │    │    include:{question:{       │                │                 │
   │                          │    │      include:{answer:true,   │                │                 │
   │                          │    │      knowledgePoints:{       │                │                 │
   │                          │    │        include:{kp:true}     │                │                 │
   │                          │    │      }}}}})                  │                │                 │
   │                          │    ├ entry == null → NOT_FOUND   │                │                 │
   │                          │    ├ entry.userId !== ctx.user → NOT_FOUND（不区分存在性）          │
   │                          │    ├ entry.status === DELETED →  │                │                 │
   │                          │    │  NOT_FOUND（终态不暴露）     │                │                 │
   │                          │    └ inject ctx.entry            │                │                 │
   │                          │ 3. chargeMiddleware("VARIANT_GROUP_GEN")           │                 │
   │                          │    ├ ensureWallet                │                │                 │
   │                          │    ├ cost = priceOf = 3          │                │                 │
   │                          │    ├ chargeForAction({idemKey:   │                │                 │
   │                          │    │   debit:variant_group_gen:   │                │                 │
   │                          │    │   userId:cri})              │                │                 │
   │                          │    └ inject ctx.debit            │                │                 │
   │                          │                                  │                │                 │
   │                          │ === Procedure body ===           │                │                 │
   │                          │ 4. const ai = await generateVariants({ ───────────────────────────▶│
   │                          │      anchorStemMd: ctx.entry.question.stemMd,                       │
   │                          │      anchorRootCause: ctx.entry.rootCause,                          │
   │                          │      anchorKps: ctx.entry.question.knowledgePoints.map(...),        │
   │                          │      studentGrade: ctx.auth.gradeLevel,                             │
   │                          │    })                            │                │                 │
   │                          │   // { items: [{level,stem,sol,kps}×3] }                             │
   │                          │ 5. await tx.$transaction:        │                │                 │
   │                          │    ├ group = VariantGroup.create({                │                 │
   │                          │    │    entryId, userId,         │                │                 │
   │                          │    │    creditsCost: 3,          │                │                 │
   │                          │    │    debitLedgerId: ctx.debit.ledgerId,                          │
   │                          │    │    modelCallId,             │                │                 │
   │                          │    │  })                         │                │                 │
   │                          │    └ items = VariantItem.createMany(3 条)                           │
   │                          │ 6. return { groupId, items }     │                │                 │
   │◀── { groupId,            │                                  │                │                 │
   │     items: [3] }         │                                  │                │                 │
```

**关键点**：

- **entry 校验在扣费之前**（评审 blocker 1）：
  - entry 不存在 → `validateEntryOwnership` 抛 `NOT_FOUND` / `ENTRY_NOT_FOUND`，**不会执行到 chargeMiddleware**，DEBIT ledger 不写
  - entry.userId !== ctx.user → `NOT_FOUND` / `ENTRY_NOT_FOUND`（与"不存在"合并到同一返码，避免存在性泄露 —— 实际逻辑见 §5.3 validateEntryOwnership）
  - entry.status === DELETED → `NOT_FOUND` / `ENTRY_NOT_FOUND`（终态对学生不可见，与上同码合并）

- **`validateEntryOwnership` 是 Plan 4 新增**（§5.3）：
  ```ts
  export const validateEntryOwnership = t.middleware(async ({ ctx, next, getRawInput }) => {
    const raw = await getRawInput();
    const parsed = z.object({ entryId: z.string().cuid() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "缺少 entryId",
        cause: { reason: "ENTRY_ID_REQUIRED" },
      });
    }
    const entry = await ctx.db.errorBookEntry.findUnique({
      where: { id: parsed.data.entryId },
      include: {
        question: {
          include: {
            answer: true,
            knowledgePoints: { include: { kp: true } },
          },
        },
      },
    });
    // ❗ 一次性返 NOT_FOUND 不区分"不存在/跨用户/已删"，避免泄露存在性：
    if (!entry || entry.userId !== ctx.auth.userId || entry.status === "DELETED") {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "错题不存在",
        cause: { reason: "ENTRY_NOT_FOUND" },
      });
    }
    return next({ ctx: { ...ctx, entry } });
  });
  ```

- **ARCHIVED entry 也允许生成变式**：用户可能归档了但还想做练习；不强制 ACTIVE。`validateEntryOwnership` 不卡 ARCHIVED。

- **失败补偿**：generateVariants 抛错 → chargeMiddleware 默认补偿 3 credits。`ComplianceRejectedError` 不补偿（同 tutor.ask）。

- **VariantGroup.debitLedgerId UNIQUE** 形成双闸：即使前端误重试同一 clientRequestId（chargeMiddleware 已经返 CONFLICT），即使 race 漏过去，Group 表也只会落一条。

### 4.3 error.markReviewed（间隔复习更新）

**算法**（§6.3 公式表）：

```ts
const REVIEW_INTERVALS_MS = [
  1 * DAY_MS,    // first review: +1d
  3 * DAY_MS,    // +3d after 1st
  7 * DAY_MS,
  14 * DAY_MS,
  30 * DAY_MS,   // cap; 第 5 段之后都是 +30d
];

function nextReviewAtAfter(reviewCountAfter: number, now: Date): Date {
  const idx = Math.min(reviewCountAfter, REVIEW_INTERVALS_MS.length) - 1;
  // reviewCountAfter=1（刚 mark 第 1 次） → idx=0 → +1d ✗ 错了
  // 修：刚 mark 完第 N 次 → 下次间隔用第 N 段
  const safeIdx = Math.min(reviewCountAfter - 1, REVIEW_INTERVALS_MS.length - 1);
  return new Date(now.getTime() + REVIEW_INTERVALS_MS[Math.max(safeIdx, 0)]);
}
```

不区分"用户点掌握/没掌握"两个按钮 —— MVP 只有"已复习"动作（点了就推到下一段）。后续 plan 可加分级（Plan 1 备注的 SM-2 风格 ease factor）。

**Procedure**：

```ts
markReviewed: authedProcedure
  .use(validateEntryOwnership)
  .input(z.object({ entryId: z.string().cuid() }))
  .mutation(async ({ ctx }) => {
    // ctx.entry 已注入；ACTIVE 才进队列
    if (ctx.entry.status !== "ACTIVE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "仅 ACTIVE 错题可标记已复习",
        cause: { reason: "ENTRY_NOT_ACTIVE" },
      });
    }
    const now = new Date();
    const reviewCountAfter = ctx.entry.reviewCount + 1;
    const updated = await ctx.db.errorBookEntry.update({
      where: { id: ctx.entry.id },
      data: {
        reviewCount: reviewCountAfter,
        lastReviewedAt: now,
        nextReviewAt: nextReviewAtAfter(reviewCountAfter, now),
      },
    });
    return { entry: toEntryView(updated) };
  }),
```

不扣费（复习按钮不应该收费）。

### 4.4 error.delete（DELETED 终态）

**Blocker 2 修复落地点**：

```ts
delete: authedProcedure
  .use(validateEntryOwnership)
  .input(z.object({ entryId: z.string().cuid() }))
  .mutation(async ({ ctx }) => {
    // 已 DELETED 的 entry 在 validateEntryOwnership 阶段就抛 NOT_FOUND，到这里不会出现
    await ctx.db.errorBookEntry.update({
      where: { id: ctx.entry.id },
      data: {
        status: "DELETED",
        nextReviewAt: null,    // 立刻退出复习队列
      },
    });
    return { ok: true };
  }),
```

**配套不变量**：
- `error.list` / `error.dueForReview` / `error.getById` / `error.markReviewed` / `error.archive` 通过 `validateEntryOwnership` 或同款 `status: { in: ["ACTIVE", "ARCHIVED"] }` filter 自动排除 DELETED
- UI 不提供"恢复"/"回收站查看"任何入口
- 文案："从错题本移除"（非"删除"以降低误触焦虑，但语义就是 DELETED）

**审计访问**：运营 / 命题趋势 plan 如需查"被删过的错题"走 ops-only 接口或直 SQL；不进 student / teacher 任何 surface。

### 4.5 error.archive（ACTIVE → ARCHIVED；可逆）

```ts
archive: authedProcedure
  .use(validateEntryOwnership)
  .input(z.object({ entryId: z.string().cuid(), archived: z.boolean() }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.entry.status === "DELETED") {
      // validateEntryOwnership 已挡，理论不达；防御性
      throw new TRPCError({ code: "NOT_FOUND", cause: { reason: "ENTRY_NOT_FOUND" } });
    }
    const target: ErrorBookStatus = input.archived ? "ARCHIVED" : "ACTIVE";
    if (ctx.entry.status === target) {
      return { entry: toEntryView(ctx.entry) };  // idempotent
    }
    const updated = await ctx.db.errorBookEntry.update({
      where: { id: ctx.entry.id },
      data: {
        status: target,
        // 归档：清空 nextReviewAt（退出复习队列）
        // 取消归档：恢复为 now + 1d 重新进队列（不复用旧 nextReviewAt 因为可能是历史值）
        nextReviewAt: target === "ARCHIVED" ? null : new Date(Date.now() + DAY_MS),
      },
    });
    return { entry: toEntryView(updated) };
  }),
```

ARCHIVED ↔ ACTIVE 双向可逆；不扣费。

## 5. API Surface

### 5.1 tRPC `error` 路由（apps/web/server/routers/error.ts）

```ts
export const errorRouter = router({
  diagnose,        // §5.1.1
  list,            // §5.1.2
  getById,         // §5.1.3
  dueForReview,    // §5.1.4
  markReviewed,    // §4.3
  archive,         // §4.5
  delete: deleteEntry,  // §4.4（"delete" 是 JS reserved-ish；导出名 deleteEntry，键 "delete"）
});
```

#### 5.1.1 `error.diagnose`

```ts
diagnose: chargedProcedure("ERROR_ANALYSIS")
  .input(z.object({
    questionId: z.string().cuid(),
    actualAnswerMd: z.string().max(5000).optional(),
    clientRequestId: z.string().uuid(),  // 强制；与 Plan 3 chargedProcedure 约定一致
  }))
  .mutation(async ({ ctx, input }): Promise<{
    entryId: string;
    rootCause: ErrorRootCause;
    rootCauseReasoning: string;
    suggestedKnowledgePoints: string[];
    nextActions: Array<"GENERATE_VARIANTS" | "REVIEW_LATER" | "ASK_TUTOR">;
  }> => {
    const question = await ctx.db.question.findUniqueOrThrow({
      where: { id: input.questionId },
      include: { answer: true, knowledgePoints: { include: { kp: true } } },
    });

    const aiRouter = getAiRouter(ctx.auth.userId);
    let ai;
    try {
      ai = await aiRouter.diagnoseError({
        stemMd: question.stemMd,
        correctAnswerMd: question.answer?.contentMd ?? null,
        actualAnswerMd: input.actualAnswerMd ?? null,
        studentGrade: ctx.auth.gradeLevel ?? null,
      });
    } catch (e) {
      if (e instanceof ComplianceRejectedError) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "错因分析未通过合规检查",
          cause: { reason: "COMPLIANCE_REJECTED", original: e },
        });
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "错因分析失败",
        cause: { reason: "ERROR_ANALYSIS_INTERNAL", original: e },
      });
    }

    const entry = await ctx.db.$transaction(tx => upsertEntryOnDiagnose(tx, {
      userId: ctx.auth.userId,
      questionId: input.questionId,
      ai,
      debitLedgerId: ctx.debit.ledgerId,
      modelCallId: ai.modelCallId,
      actualAnswerMd: input.actualAnswerMd,
    }));

    return {
      entryId: entry.id,
      rootCause: entry.rootCause,
      rootCauseReasoning: entry.rootCauseReasoning,
      suggestedKnowledgePoints: ai.suggestedKnowledgePoints,
      nextActions: ["GENERATE_VARIANTS", "REVIEW_LATER", "ASK_TUTOR"],
    };
  }),
```

**ctx.debit 由 chargeMiddleware 注入**：见 §5.3 抽取后 middleware 在 next() 之前 `return next({ ctx: { ...ctx, debit: { ledgerId } } })`。

**UI 反馈 A 落地点**：`entryId` 是必返字段，ErrorAnalysisCard 直接渲染 `<Link href={\`/error-book/${entryId}\`}>查看错题详情</Link>`。

#### 5.1.2 `error.list`

```ts
list: authedProcedure
  .input(z.object({
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),  // ❌ 故意不允许 DELETED
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
  }))
  .query(async ({ ctx, input }) => {
    // 产品语义（§3.1 注释）：默认错题本视图 = 仅 ACTIVE。
    // ARCHIVED 是"从默认错题本移走"，归档页才显式查 status: "ARCHIVED"。
    // DELETED 永远不可见（zod 已不接受此值；本路径不会触达 DELETED）。
    const where = {
      userId: ctx.auth.userId,
      status: input.status ?? "ACTIVE",
    };
    const entries = await ctx.db.errorBookEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: { question: { select: { id: true, stemMd: true, type: true } } },
    });
    const nextCursor = entries.length > input.limit ? entries.pop()!.id : null;
    return { entries: entries.map(toEntryView), nextCursor };
  }),
```

**`status` zod 不含 DELETED**：即使前端伪造 `status=DELETED` 也过不了 zod；同时 `where.status` fallback 是白名单。两道闸。

#### 5.1.3 `error.getById`

```ts
getById: authedProcedure
  .use(validateEntryOwnership)
  .input(z.object({ entryId: z.string().cuid() }))
  .query(async ({ ctx }) => {
    // validateEntryOwnership 已挡 DELETED / 跨用户 / 不存在 → NOT_FOUND
    // ctx.entry.question / answer / knowledgePoints 已 include
    const variantGroups = await ctx.db.variantGroup.findMany({
      where: { entryId: ctx.entry.id },
      orderBy: { createdAt: "desc" },
      include: { items: { orderBy: { position: "asc" } } },
    });
    return {
      entry: toEntryView(ctx.entry),
      question: toQuestionView(ctx.entry.question),
      variantGroups: variantGroups.map(toVariantGroupView),
    };
  }),
```

#### 5.1.4 `error.dueForReview`

```ts
dueForReview: authedProcedure
  .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
  .query(async ({ ctx, input }) => {
    const now = new Date();
    const userId = ctx.auth.userId;
    const dueToday = await ctx.db.errorBookEntry.findMany({
      where: {
        userId,
        status: "ACTIVE",
        nextReviewAt: { lte: now },
      },
      orderBy: { nextReviewAt: "asc" },
      take: input.limit,
      include: { question: { select: { id: true, stemMd: true, type: true } } },
    });

    // UI 反馈 B：dueToday 空时算"下次 +Xd"
    let nextReviewAt: Date | null = null;
    if (dueToday.length === 0) {
      const future = await ctx.db.errorBookEntry.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          nextReviewAt: { gt: now },
        },
        orderBy: { nextReviewAt: "asc" },
        select: { nextReviewAt: true },
      });
      nextReviewAt = future?.nextReviewAt ?? null;
    }

    return {
      dueToday: dueToday.map(toEntryView),
      nextReviewAt,  // 仅 dueToday 为空时有值；其余情况 null
    };
  }),
```

**UI 渲染规则**（spec 给前端的契约）：
- `dueToday.length > 0` → 渲染列表
- `dueToday.length === 0 && nextReviewAt !== null` → `下次复习 +${ceil((nextReviewAt - now)/86400e3)} 天后`
- `dueToday.length === 0 && nextReviewAt === null` → `错题本里还没有需要复习的题`

### 5.2 tRPC `variant` 路由（apps/web/server/routers/variant.ts）

```ts
import {
  authedProcedure,
  chargeMiddleware,         // ← 抽取后
  validateEntryOwnership,   // ← 新中间件
  router,
} from "../trpc.js";

export const variantRouter = router({
  generateForEntry: authedProcedure
    .use(validateEntryOwnership)               // ① entry 校验（不存在/跨用户/已删 → 不扣费）
    .use(chargeMiddleware("VARIANT_GROUP_GEN"))// ② 扣 3 credits（debit ledger 写）
    .input(z.object({
      entryId: z.string().cuid(),
      clientRequestId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      // ctx.entry / ctx.debit 已分别由两个 middleware 注入
      const aiRouter = getAiRouter(ctx.auth.userId);
      let ai;
      try {
        ai = await aiRouter.generateVariants({
          anchorStemMd: ctx.entry.question.stemMd,
          anchorRootCause: ctx.entry.rootCause,
          anchorKps: ctx.entry.question.knowledgePoints.map(l => ({
            id: l.kpId,
            name: l.kp.name,
            difficulty: l.kp.difficulty,
          })),
          studentGrade: ctx.auth.gradeLevel ?? null,
        });
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "变式生成未通过合规检查",
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "变式生成失败",
          cause: { reason: "VARIANT_GEN_INTERNAL", original: e },
        });
      }

      const result = await ctx.db.$transaction(async tx => {
        const group = await tx.variantGroup.create({
          data: {
            entryId: ctx.entry.id,
            userId: ctx.auth.userId,
            creditsCost: 3,
            debitLedgerId: ctx.debit.ledgerId,
            modelCallId: ai.modelCallId,
          },
        });
        await tx.variantItem.createMany({
          data: ai.items.map((it, idx) => ({
            groupId: group.id,
            level: it.level,
            position: idx + 1,
            stemMd: it.stemMd,
            solutionMd: it.solutionMd,
            knowledgePointHints: it.knowledgePointHints ?? [],
          })),
        });
        return tx.variantGroup.findUniqueOrThrow({
          where: { id: group.id },
          include: { items: { orderBy: { position: "asc" } } },
        });
      });

      return { group: toVariantGroupView(result) };
    }),
});
```

**不引入 `variant.list`** —— 历史变式从 `error.getById(entryId).variantGroups` 拿。

### 5.3 `chargeMiddleware` 抽取 + `validateEntryOwnership`（apps/web/server/trpc.ts refactor）

**Blocker 1 修复落地点**。当前 trpc.ts L83-203 是 `chargedProcedure(kind)` 直接套 `authedProcedure.use(async {...})`。改成：

```ts
// ============== 中间件层 ==============

/**
 * 扣费中间件 —— 必须在 authedProcedure 之后链用。
 * 在 `next()` 之前扣 priceOf(kind) credits 并把 debit row id 注入 ctx.debit；
 * 在 `next()` 之后按 shouldCompensate 决定补偿或留 debit。
 *
 * 用法：
 *   authedProcedure.use(chargeMiddleware("TUTOR_ASK"))
 *   authedProcedure.use(validateEntryOwnership).use(chargeMiddleware("VARIANT_GROUP_GEN"))
 *
 * 与 chargedProcedure 的关系：chargedProcedure(kind) = authedProcedure.use(chargeMiddleware(kind))
 * 的糖语法（仅为保持 Plan 3 调用点零 diff）。
 */
export const chargeMiddleware = (kind: ActionKind) =>
  t.middleware(async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      // 防御性：理论由 authedProcedure 已挡；万一调用方漏链 authedProcedure 在 chargeMiddleware 之前
      throw new TRPCError({ code: "UNAUTHORIZED", cause: { reason: "NO_SESSION" } });
    }
    const raw = await getRawInput();
    const parsed = z.object({ clientRequestId: z.string().uuid() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "请求缺少 clientRequestId（UUID）",
        cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" },
      });
    }
    const { clientRequestId } = parsed.data;

    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    const cost = priceOf(kind);
    const idemKey = `debit:${kind.toLowerCase()}:${ctx.auth.userId}:${clientRequestId}`;

    let debit: Awaited<ReturnType<typeof chargeForAction>>;
    try {
      debit = await chargeForAction(ctx.db, {
        walletId: wallet.id, kind, cost, idemKey,
        createdByUserId: ctx.auth.userId,
      });
    } catch (e) {
      if (e instanceof ActionAlreadyChargedError) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该请求已处理，请勿重复提交",
          cause: { reason: "ACTION_IDEMPOTENCY_HIT" },
        });
      }
      throw e;
    }
    if (debit.kind === "INSUFFICIENT_BALANCE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "余额不足",
        cause: { reason: "INSUFFICIENT_BALANCE", required: cost, balance: debit.balance },
      });
    }

    // 注入 ctx.debit 供 procedure body 写入 refTable/refId
    const result = await next({ ctx: { ...ctx, debit: { ledgerId: debit.ledgerId } } });
    if (result.ok) return result;

    const e = result.error;
    if (shouldCompensate(e)) {
      await compensate(ctx.db, {
        originalLedgerId: debit.ledgerId,
        walletId: wallet.id, cost, kind,
        reason: errorReason(e),
      });
    } else {
      // 现有 Plan 3 不补偿分支逻辑（metadata + structured log）原样保留
      // ... (与现 trpc.ts L150-200 一致，省略避免重复) ...
    }
    return result;
  });

/**
 * Plan 3 糖语法 —— 保留以保证 tutor.ask 等既有调用点零 diff。
 */
export const chargedProcedure = (kind: ActionKind) =>
  authedProcedure.use(chargeMiddleware(kind));

/**
 * Plan 4 新增 —— 校验 entry 归属并注入 ctx.entry。必须在 chargeMiddleware **之前** 链用：
 *   authedProcedure.use(validateEntryOwnership).use(chargeMiddleware("VARIANT_GROUP_GEN"))
 * 这样 entry 不存在/跨用户/已删时抛 NOT_FOUND，**不**会进入 chargeMiddleware，DEBIT ledger 不写。
 */
export const validateEntryOwnership = t.middleware(
  async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", cause: { reason: "NO_SESSION" } });
    }
    const raw = await getRawInput();
    const parsed = z.object({ entryId: z.string().cuid() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "缺少 entryId",
        cause: { reason: "ENTRY_ID_REQUIRED" },
      });
    }
    const entry = await ctx.db.errorBookEntry.findUnique({
      where: { id: parsed.data.entryId },
      include: {
        question: {
          include: {
            answer: true,
            knowledgePoints: { include: { kp: true } },
          },
        },
      },
    });
    // 三种情况合并 NOT_FOUND 防止存在性泄露：
    //   a) entry 不存在
    //   b) entry.userId 与 ctx.auth.userId 不同（跨用户）
    //   c) entry.status === DELETED（终态对学生不可见）
    if (!entry || entry.userId !== ctx.auth.userId || entry.status === "DELETED") {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "错题不存在",
        cause: { reason: "ENTRY_NOT_FOUND" },
      });
    }
    return next({ ctx: { ...ctx, entry } });
  },
);
```

**Ctx 类型扩展**（apps/web/server/context.ts 加 `debit?: { ledgerId: string }` 和 `entry?: ErrorBookEntryWithRelations`；做成 optional 因为大多数 procedure 用不到）。或在 trpc.ts 用 middleware 的 ctx 扩展机制（`next({ ctx: {...} })` 已经返回类型推断的 ctx），不用全局加字段。tRPC v11 推断够强，可以走第二种路径。

**为什么不把 `validateEntryOwnership` 与 `chargeMiddleware` 合并成一个 "entryChargedProcedure"**：
- 关注点分离：entry 校验是 access control，扣费是 billing；两者独立可测、可单独复用
- 未来扩展：可能有 entry-aware 但不扣费的 procedure（如 `error.markReviewed` 单独用 validateEntryOwnership）；也可能有扣费但 entry 在别处的 procedure（tutor.ask 与 entry 无关）

## 6. 限频 / Env / 合规

### 6.1 限频

| 接口 | 规则 | 理由 |
|---|---|---|
| `error.diagnose` | **不接**额外限频 | 已被 chargedProcedure（1 credit/次）+ 余额上限保护；低价但 AI 成本占大头，加限频成本/收益不划算 |
| `variant.generateForEntry` | **不接**额外限频 | 同上；3 credits/次 已显著抑制刷请求 |
| `error.list` / `getById` / `dueForReview` | **不接** | 纯读，DB 索引覆盖；用户体验优先 |
| `error.markReviewed` / `archive` / `delete` | **不接** | 单 entry mutation，DB 锁兜底 |

**与 Plan 3 工艺一致**：限频只加在"创建外部资源 / 风险大 / 易被刷"的 surface（topupCreate 是因为生成 outTradeNo + 调 mock notify URL）；chargedProcedure 类靠余额+合规闸门。

### 6.2 Env

**零新增 env 字段**。所有需要的常量（`REVIEW_INTERVALS_MS` 等）写代码常量。

未来如要做"间隔复习算法可配置"，再加 `REVIEW_INTERVALS_DAYS` env（推迟到独立 plan）。

### 6.3 间隔复习算法

| reviewCount（mark 之后） | nextReviewAt（相对 now） |
|---|---|
| 1（刚 mark 第 1 次复习） | +1d |
| 2 | +3d |
| 3 | +7d |
| 4 | +14d |
| ≥ 5 | +30d（cap） |

**初次创建（diagnose）**：`nextReviewAt = createdAt + 1d`，`reviewCount = 0`。这与"第 1 次 mark 后 +1d"是同一节点，自然衔接。

**ARCHIVED → ACTIVE（archive: false）**：`nextReviewAt = now + 1d`，`reviewCount` 不重置（保留历史复习强度信息）。

**ACTIVE diagnose（重新分析）**：`nextReviewAt` 保留（不回退节奏）；如 entry 之前是 ARCHIVED（`nextReviewAt = null`），设回 `now + 1d`。

**漏复习不调档**：MVP 不实现"超期未复习则下次间隔缩短"。简单到位。

### 6.4 合规 / 措辞规则

**输出层（AI 响应）**：

| 任务 | 合规约束 | 实现 |
|---|---|---|
| `ErrorAnalysis` | `rootCauseReasoning` 不得出现"包过/必考/押中"等措辞 | `packages/ai/compliance/filter.ts` 现有规则集（Plan 1）继续命中 |
| `ErrorAnalysis` | 不得给出"全段直接答案 + 求解步骤"，应聚焦"为什么错" | Prompt 模板里 system 段强约束 + 输出 JSON schema 把 reasoning 限制在错因解释 |
| `VariantGeneration` | 同 tutor.ask 全部合规规则；不许包含直接答案先于解题步骤 | 复用 tutor.ask 的合规 pipeline |
| `VariantGeneration` | L3 现实情境融合时不得使用恐吓 / 焦虑 / 与未成年人不适宜话题 | system prompt + 输出层 filter |

**UI 层（措辞）**：

| 位置 | 措辞 |
|---|---|
| 删除按钮 | "从错题本移除"（非"删除"） |
| 复习页空状态 | "错题本里还没有需要复习的题" / "下次复习 +Xd 后"（不"已掌握"等暗示性词） |
| 变式生成按钮 | "生成相似题练手" / "举一反三"（不"刷题神器"等承诺类） |
| 错因卡片 | "本题错因可能是 …" / "建议加强 …"（不"该题必错原因" 等确定性表达） |

CLAUDE.md "合规与措辞规则" 全部条目继承；本 plan 不放宽任何一条。

### 6.5 合规拒绝（ComplianceRejectedError）行为

| 接口 | ComplianceRejectedError 发生时 | 用户感知 |
|---|---|---|
| `error.diagnose` | 不补偿（同 tutor.ask；用户拿到了 deterministic 拒绝） | 显示"分析未通过合规检查" + 1 credit 已扣 |
| `variant.generateForEntry` | 不补偿（同上） | 显示"变式生成未通过合规检查" + 3 credits 已扣 |
| 其它非合规失败（AI 超时 / parse 失败 / DB 错） | 补偿（fail-open） | 退还 credits + 显示"请稍后重试" |

**审计行为**：不补偿时在 `creditLedger.metadata` 写 `{ compensationStatus: "not_compensated_whitelisted", errorClass: "ComplianceRejectedError" }`，并 `logger.warn`（Plan 3 工艺继承，零改动）。

## 7. 测试矩阵

### 7.1 测试基础设施

- **不新增** per-package test DB；`ErrorBookEntry`/`VariantGroup` 测放 `zhijiao_test_db`（schema 测）和 `zhijiao_test_web`（integration / router 测）
- `packages/ai/tests/`：加 `error-analysis.test.ts` / `variant-generation.test.ts`（mock model adapter；断言 JSON schema 强制输出）
- `apps/web/tests/integration/`：加 `error-diagnose.test.ts` / `variant-generate-for-entry.test.ts`（用 prisma 真 DB；mock AI adapter）
- `apps/web/e2e/`：加 `error-book-end-to-end.spec.ts`（diagnose → 列表 → 详情 → 生成变式 → 标记复习 → 删除）

### 7.2 必须覆盖的关键 race / 边界

#### Blocker 1 显式测例（用户必要求）

- **entry 不存在时不写 debit ledger row**：
  ```ts
  // arrange: 用户 A 100 credits；构造一个**语法合法但库里不存在**的 cuid
  //   const ghostEntryId = "clghost000000000000000000";   // 25 字符，c+小写字母数字；通过 z.string().cuid()
  //   await prisma.errorBookEntry.findUnique({ where: { id: ghostEntryId } }) === null
  // act: variant.generateForEntry({ entryId: ghostEntryId, clientRequestId: uuid })
  // assert:
  //   - 返 NOT_FOUND / ENTRY_NOT_FOUND（DB lookup 后的分支，不是 zod 拒绝）
  //   - prisma.creditLedger.findMany({ where: { walletId: A.walletId } }) 数量与 baseline 一致
  //   - 没有 idemKey="debit:variant_group_gen:A.id:cri" 的行
  //   - wallet.balance === 100（未扣）
  ```

  **⚠ 不要用 `"ck-nonexistent"` 这类非法 cuid 做"不存在"测例**：含 `-` 或长度不够时会被 `z.string().cuid()` 提前拦截，走 `BAD_REQUEST / ENTRY_ID_REQUIRED` 分支，根本没到 DB lookup → 测不到 Blocker 1 目标行为（"DB 查询返 null 时不扣费"）。zod 拦截是更早一层的安全网，由下一条测例单独覆盖。

- **malformed entryId → BAD_REQUEST，不扣费**：
  ```ts
  // arrange: 用户 A 100 credits
  // act: variant.generateForEntry({ entryId: "not-a-cuid", clientRequestId: uuid })
  // assert:
  //   - 返 BAD_REQUEST / ENTRY_ID_REQUIRED（zod 拒绝）
  //   - wallet.balance === 100（未扣；middleware 链未进 chargeMiddleware）
  //   - prisma.creditLedger.findMany({ where: { walletId: A.walletId } }) 与 baseline 一致
  ```
  双闸的意义：DB lookup 闸（前一条测例）+ zod 闸（本条测例）合起来保证"任何路径下，entry 校验未通过则不扣费"。

- **跨用户 entry 时不写 debit ledger row**：
  ```ts
  // arrange: 用户 A 100 credits；用户 B 有合法 ACTIVE entry entryOfB
  // act: A 调 variant.generateForEntry({ entryId: entryOfB, clientRequestId: uuid })
  // assert:
  //   - 返 NOT_FOUND / ENTRY_NOT_FOUND（与"不存在"合并到同一返码，避免存在性泄露 —— 不是 FORBIDDEN）
  //   - ledger 不写 / 余额不变（同上四条）
  ```

#### Blocker 2 显式测例

- **DELETED entry 在所有 student-facing 入口不可见**：
  ```ts
  // arrange: entryId 已 status=DELETED
  // act + assert:
  //   - error.list() → 列表不含 entryId
  //   - error.list({ status: ACTIVE }) → 不含
  //   - error.list({ status: ARCHIVED }) → 不含
  //   - error.list({ status: DELETED }) → zod parse 失败（DELETED 不在 zod enum 内）
  //   - error.getById({ entryId }) → NOT_FOUND
  //   - error.dueForReview() → dueToday 不含 + nextReviewAt 不指向此条
  //   - error.markReviewed({ entryId }) → NOT_FOUND
  //   - error.archive({ entryId, archived: true }) → NOT_FOUND
  //   - error.delete({ entryId }) → NOT_FOUND（已 DELETED，validateEntryOwnership 挡）
  //   - variant.generateForEntry({ entryId, clientRequestId }) → NOT_FOUND + 不扣费
  ```

- **DELETED 后再 diagnose 同题 = 新 entry**：
  ```ts
  // arrange: (userId=A, questionId=Q) 已有 status=DELETED 的 entry E1
  // act: error.diagnose({ questionId: Q, clientRequestId: uuid })
  // assert:
  //   - 返 entryId !== E1.id（创建了新 ACTIVE entry E2）
  //   - prisma.errorBookEntry.findMany({ where: { userId, questionId } }) 返 2 条（E1 DELETED + E2 ACTIVE）
  //   - partial unique index 不阻止此操作（因 E1 不在 ACTIVE/ARCHIVED 范围）
  ```

#### UI 反馈 A 测例

- **error.diagnose 返回 entryId**：
  - 新建 path：assert 返 `entryId` 是新建的 entry id
  - 复用 path（已有 ACTIVE entry）：assert 返 `entryId` 是已存在的 entry id（不创新行）
  - 复用 path（已有 ARCHIVED entry）：assert 返已有 entry id + entry.status 变为 ACTIVE（resurrect from archive）

#### UI 反馈 B 测例

- **error.dueForReview 在 dueToday 为空时返 nextReviewAt**：
  ```ts
  // arrange: userId=A 有 1 条 ACTIVE entry，nextReviewAt = now + 5d
  // act: error.dueForReview()
  // assert:
  //   - dueToday.length === 0
  //   - nextReviewAt 是 now + 5d
  ```
- **完全没 ACTIVE entry 时 nextReviewAt === null**：
  ```ts
  // arrange: userId=A 只有 ARCHIVED / DELETED entries
  // act: error.dueForReview()
  // assert: dueToday 空 + nextReviewAt === null
  ```
- **同时有 dueToday 和 future entry 时 nextReviewAt === null**：
  ```ts
  // arrange: 有 dueToday entries
  // act + assert: nextReviewAt === null（仅 dueToday 空时才返）
  ```

#### 计费 / 幂等

- **同 clientRequestId 重试 variant.generateForEntry**：第 2 次返 `CONFLICT / ACTION_IDEMPOTENCY_HIT`；不再扣费；不新建 VariantGroup
- **同 clientRequestId 重试 error.diagnose**：同上
- **不同 clientRequestId 同 (userId, questionId) 并发 diagnose**：partial unique race；第 2 条 P2002 → 走 update path；最终 entry 只 1 条 ACTIVE；2 次 diagnose 扣 2 credits（两次 AI call 都被服务方提供）

#### 间隔复习算法

- **首次 mark**：`reviewCount` 0 → 1；`nextReviewAt` = lastReviewedAt + 1d
- **第 4 次 mark**：`reviewCount` 3 → 4；`nextReviewAt` = lastReviewedAt + 14d
- **第 10 次 mark**：`reviewCount` 9 → 10；`nextReviewAt` = lastReviewedAt + 30d（cap）

#### 合规

- **ComplianceRejectedError on diagnose**：不补偿；ledger 留 DEBIT；metadata.compensationStatus = "not_compensated_whitelisted"；errorClass = "ComplianceRejectedError"
- **ComplianceRejectedError on variant**：同上（3 credits 留）
- **非合规失败（AI 超时）on variant**：补偿；ledger 增一条 COMPENSATION（+3）；balance 回到 baseline

#### 状态机

- **ARCHIVED entry 不进 dueForReview**：纵使 nextReviewAt <= now，也不返
- **ARCHIVED entry 不进默认 list 视图**（§3.1 注释 + §5.1.2 实现）：
  - `error.list()`（不传 status）→ 结果不含此 entry
  - `error.list({ status: "ACTIVE" })` → 不含
  - `error.list({ status: "ARCHIVED" })` → **含**（这是归档页的唯一可见路径）
- **markReviewed 在 ARCHIVED entry 上**：PRECONDITION_FAILED / ENTRY_NOT_ACTIVE
- **archive idempotent**：连续两次 archive(true) 不抛、不改 updatedAt（用 short-circuit on same status）
- **variant.generateForEntry 在 ARCHIVED entry 上**：允许（不强制 ACTIVE；用户可能想做归档题）；正常扣费 + 生成

#### VariantGroup 完整性

- **VariantGroup.debitLedgerId UNIQUE**：DB 层防同 ledger row 被两个 group 引用；测试：手动伪造同 ledgerId 第二条 VariantGroup.create 撞 P2002
- **VariantItem.@@unique([groupId, level])**：测试一个 group 不能有两条 L1

### 7.3 路由契约

- `error.list` zod 不接受 `status: "DELETED"`：测试客户端伪造请求返 BAD_REQUEST
- `variant.generateForEntry` 缺 `clientRequestId`：BAD_REQUEST / CLIENT_REQUEST_ID_REQUIRED（chargeMiddleware 抛）
- `variant.generateForEntry` 缺 `entryId`：BAD_REQUEST / ENTRY_ID_REQUIRED（validateEntryOwnership 抛）
- `variant.generateForEntry` 缺两者：抛哪个？**应抛 `ENTRY_ID_REQUIRED`**（middleware 链顺序：validateEntryOwnership 在 chargeMiddleware 前）—— 测试断言

## 8. 阶段顺序（Plan 4 内部 task 排序）

| # | Task | 说明 | 依赖 |
|---|---|---|---|
| 0 | 仓库卫生 / 起 worktree | 沿用 Plan 3 Task 0 工艺；`.claude/worktrees/plan-4-variant-and-error/` | — |
| 1 | Prisma migration | ErrorBookEntry / VariantGroup / VariantItem + 3 enums + 索引 + partial unique index (raw SQL append) | 0 |
| 2 | `packages/ai` 扩展 | `tasks/error-analysis.ts` + `tasks/variant-generation.ts`；PromptTemplate 落 DB；ModelCall 记录；JSON schema 强约束输出；ComplianceFilter 接入 | 1 |
| 3 | `apps/web/server/trpc.ts` refactor | 抽出 `chargeMiddleware(kind)` + 加 `validateEntryOwnership`；`chargedProcedure(kind)` 保留为糖语法；既有调用点（tutor.ask）零行 diff | 0 |
| 4 | `error` 路由 + integration tests | diagnose / list / getById / dueForReview / markReviewed / archive / delete；含 Blocker 2 显式测例（DELETED 不可见） | 1, 2, 3 |
| 5 | `variant` 路由 + integration tests | generateForEntry；含 Blocker 1 显式测例（entry 不存在/跨用户 → 不写 DEBIT） | 1, 2, 3 |
| 6 | UI（最小化） | `/error-book` 列表页 + `/error-book/[entryId]` 详情页 + `/error-book/review` 复习页 + ErrorAnalysisCard 改造（接入 entryId 链接）+ 变式生成入口 | 4, 5 |
| 7 | E2E | error-book-end-to-end.spec.ts（diagnose → 列表 → 详情 → 生成变式 → 标记复习 → 删除）+ variant-generate-on-deleted-entry.spec.ts | 4, 5, 6 |
| 8 | 全量回归 + CLAUDE.md 更新 | 仿照 Plan 3 Task 15；加 Plan 4 已落地条目 + Merge 验收清单 prereq | 7 |

依赖路径：1+2+3 → 4 / 5（并行）→ 6 → 7 → 8。预估 worktree 内 3-4 个工作日量（无外部集成、无 PII / 支付治理负担）。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| AI 错因分类输出不在 5 类 enum 内（free-text） | Prompt + JSON schema + zod 三道闸；OTHER 兜底；Compliance 路径会重试 1 次后转 OTHER |
| 变式 L1/L2/L3 区分不明（AI 输出语义混淆） | Prompt 模板 system 段用具体示例约束 level 边界；输出 schema 强制 `level: enum`；测试矩阵覆盖每级别一条正例 |
| partial unique index 跨 Prisma 版本兼容性 | 在 migration 文件里写 raw SQL（不靠 Prisma generate）；migration 提交时跑一次 `prisma migrate deploy` + 一次 `prisma db push` 双向验证 |
| `validateEntryOwnership` 漏失败路径（脏 ctx.entry 进 next）| middleware 写 `return next({ ctx: { ...ctx, entry } })`（spread ctx 保留其它字段）；测试断言"NOT_FOUND 时 next 不被调用" |
| 同 clientRequestId 撞 idemKey UNIQUE 但 entry 不同 → chargeMiddleware 返 CONFLICT 误导前端 | 文档明确 idemKey 与 entryId 解耦；前端规定"每次新点'生成变式'按钮都 randomUUID"；spec 写"clientRequestId 是请求标识，不是资源标识" |
| 用户 spam diagnose 同一 (userId, questionId) 把 ARCHIVED 一直拉回 ACTIVE | 每次 diagnose 扣 1 credit 已抑制；后续 plan 可加"短时间内重复 diagnose 同题不刷新 nextReviewAt"，MVP 不防 |
| 间隔复习算法太死板（用户希望按掌握度调档） | 显式 punt 到独立 plan（SM-2 / FSRS 风格）；MVP 保持简单 |
| VariantItem 解题步骤泄露答案于学生还未尝试时 | UI 默认折叠 solutionMd；点击"查看解析"才展开；spec §6.4 措辞规则在前端落地 |
| 错题数据膨胀（学生 1k+ entry → list 慢） | 索引覆盖 + cursor pagination + limit cap 50；后续可加"近 30 天活跃 entry"快速 view |

## 附录 A：计费与 PRICING

`packages/billing/src/pricing.ts` 已含（Plan 3 附录 A 留位）：

```ts
export const PRICING: Record<ActionKind, number> = {
  TUTOR_ASK: 1,
  PAPER_GEN: 5,
  LESSON_PLAN_GEN: 3,
  PPT_GEN: 5,
  VARIANT_GROUP_GEN: 3,
  ERROR_ANALYSIS: 1,
};
```

Plan 4 **零改动** pricing.ts；只接入 `VARIANT_GROUP_GEN` 与 `ERROR_ANALYSIS` 到 chargeMiddleware。

**定价合理性论证**：
- `ERROR_ANALYSIS = 1`：单题分析，单次 AI 推理（不含变式生成）；与 `TUTOR_ASK` 同量级
- `VARIANT_GROUP_GEN = 3`：一次性 3 道变式 + 3 段解答 + KP 标注；AI 推理量 ~3× tutor；定价相应放大
- 充值率 `CREDIT_PER_YUAN = 10`（Plan 3 env 默认）→ 1 元 = 10 credits → 错因分析 0.1 元/次 / 变式 0.3 元/次。在 ToC 心理价位区间内

## 附录 B：与 Plan 3 工艺一致性对照

| 工艺 | Plan 3 来源 | Plan 4 沿用 |
|---|---|---|
| `chargedProcedure(kind)` 中间件 | Plan 3 Task 9 / trpc.ts L83 | 拆为 `chargeMiddleware(kind)` + 糖语法 `chargedProcedure(kind)`；既有调用点零 diff |
| `clientRequestId: uuid` 强制 input | Plan 3 chargedProcedure | `error.diagnose` / `variant.generateForEntry` 复用 |
| idemKey 命名 `debit:<kind>:<userId>:<cri>` | Plan 3 §3.3 | Plan 4 直接套（`error_analysis` / `variant_group_gen` 走 toLowerCase） |
| Fail-open compensation + 白名单 `ComplianceRejectedError` 不补 | Plan 3 §1.8 + §5.3 | 完全继承；不重定义 shouldCompensate |
| `cause: { reason, original: e }` 错误形状 | Plan 3 tutor.ask 模式 | error.diagnose / variant.generateForEntry 一致 |
| Predicate-on-update 原子扣点 | Plan 3 §3.3 | chargeForAction 直接复用，零改动 |
| Append-only ledger + balanceAfter snapshot | Plan 3 §3.3 | DEBIT + COMPENSATION 行复用现有写入路径 |
| structured logger（pino server-only） | Plan 3 §6.6 | 复用；不补偿告警在 chargeMiddleware 内打 |
| per-package test DB 隔离 | Plan 3 Task -1 | 不新增；用 zhijiao_test_db + zhijiao_test_web |
| `import "server-only"` 防 client bundle | Plan 3 工艺 | router 文件首行；trpc.ts 已有 |
| Merge 验收清单（不只是绿测试） | Plan 3 §"Merge 后必跑" | spec §9 / Task 8 加 Plan 4 探针 |

## 附录 C：Merge 后必跑（Plan 4 增补）

接 CLAUDE.md "Merge 后必跑" 12 条之后加：

13. **chargeMiddleware 抽取后 tutor.ask 零行为变化**：
    ```bash
    pnpm.cmd --filter @zhijiao/web test -- tests/integration/tutor-ask-with-credit.test.ts
    ```
    应全绿，证明 Plan 3 既有计费行为未被 refactor 破坏。

14. **DELETED entry 不可见**：手动建一条 ACTIVE entry → `error.delete` → 调 `error.list / getById / dueForReview / markReviewed / archive`：全部应返 NOT_FOUND 或不含此条。grep:
    ```bash
    grep -rn "status.*DELETED" apps/web/server/routers/error.ts
    ```
    应只在 update set 处出现，不在 findMany/findUnique where 处出现（终态不能成为正向 filter 条件）。

15. **entry 校验在扣费前**：grep:
    ```bash
    grep -B 2 -A 5 "chargeMiddleware.*VARIANT_GROUP_GEN" apps/web/server/routers/variant.ts
    ```
    应在 `validateEntryOwnership` **之后**。如果两者顺序颠倒 → Blocker 1 复现。

16. **partial unique index 已落 DB**：
    ```bash
    docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d error_book_entries" | grep "user_question_active"
    ```
    应见 partial unique index 定义。

17. **error.diagnose 返回 entryId**：grep:
    ```bash
    grep -n "entryId:" apps/web/server/routers/error.ts | head
    ```
    应在 diagnose 返回类型出现；UI ErrorAnalysisCard 应有 `<Link href={`/error-book/${entryId}`}>`。

18. **error.dueForReview 在空状态返 nextReviewAt**：
    ```bash
    pnpm.cmd --filter @zhijiao/web test -- tests/integration/error-due-for-review-next.test.ts
    ```
    覆盖三种 nextReviewAt 形态：空 ACTIVE / 有 future / dueToday 非空。
