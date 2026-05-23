# 智教 · Plan 4 举一反三 + 错因分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1/2/2H/3 之上加错因分析（`error.diagnose`）+ 错题本 CRUD（`error.list / getById / dueForReview / markReviewed / archive / delete`）+ 三阶变式生成（`variant.generateForEntry`），把 CLAUDE.md 学生学习中心闭环 "答疑 → 错因 → 举一反三 → 错题本 → 复习" 从空架子落到代码。

**Architecture:** 3 块薄增量，零侵入 Plan 1/2/3 现有 schema 与代码。
1. `packages/db` —— 加 3 表 3 enum + 一条 partial unique index（raw SQL）
2. `packages/ai` —— 加两个 task：error-analysis + variant-generation；沿用 Plan 1 PromptTemplate + ModelCall 工艺
3. `apps/web` —— `trpc.ts` refactor（抽 `chargeMiddleware` + 加 `validateEntryOwnership`） + 2 个 router（error / variant） + UI

**Tech Stack:**（不变）pnpm 9 / Turborepo / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 / Redis 7 / jose 5 / @trpc/server@11 / superjson / ioredis 5 / Vitest 1 / Testcontainers 10 / Playwright 1 / pino 8

**Spec:** `docs/superpowers/specs/2026-05-23-variant-and-error-analysis-design.md`（本 plan 的真理来源；遇到模糊回去查 spec）

**Source Audit:** 2026-05-23 spec 一轮 review（4 处定点修正：FORBIDDEN→NOT_FOUND / 测例非法 cuid 替换 / P2002 helper 抽取 / ARCHIVED 默认可见性）已收口

---

## ⚠️ 关键实现红线

1. **entry 校验在扣费之前**（spec Blocker 1 / §4.2 / §5.3）：`variant.generateForEntry` 的 middleware 链顺序必须是 `authedProcedure → validateEntryOwnership → chargeMiddleware(...)`。entry 不存在 / 跨用户 / 已删 → 抛 `NOT_FOUND / ENTRY_NOT_FOUND`，**不进 chargeMiddleware**，DEBIT ledger 不写。

2. **三种 entry 失败合并为同一返码**（spec §5.3）：`entry == null` / `entry.userId !== ctx.auth.userId` / `entry.status === "DELETED"` → 都抛 `NOT_FOUND` + `cause.reason = "ENTRY_NOT_FOUND"`。**绝不**返 `FORBIDDEN` 区分跨用户（会泄露存在性）。

3. **`chargedProcedure(kind)` 必须保留为糖语法**（spec §5.3）：`chargedProcedure(kind) = authedProcedure.use(chargeMiddleware(kind))`。Plan 3 调用点（`tutor.ask`）**零行 diff**。本 plan Task 3 必须显式跑 Plan 3 既有 tutor / billing 测试套件，证明零回归。

4. **DELETED 是终态**（spec §3.1 / §4.4 / Blocker 2）：所有 student-facing 入口（list / getById / dueForReview / markReviewed / archive / delete / variant.generateForEntry）一律返 `NOT_FOUND`。**UI 不提供任何"恢复" / "回收站"入口**。文案"从错题本移除"。审计行 DB 保留。

5. **ARCHIVED 默认不在列表视图**（spec §3.1 + §5.1.2）：`error.list()` 默认 `where.status = "ACTIVE"`；归档页必须显式传 `status: "ARCHIVED"`。`error.list` 的 zod `status` 枚举**不含 DELETED**。

6. **partial unique index 用 raw SQL** 在 migration 文件末尾追加（spec §3.3）：Prisma 5 schema 不直接支持 partial unique；必须手动 append。索引名 `error_book_entries_user_question_active_idx`，`WHERE status IN ('ACTIVE', 'ARCHIVED')`。

7. **`error.diagnose` 必返 `entryId`**（spec §5.1.1 / UI Reback A）：输出 schema 必含 `entryId: string`。前端 ErrorAnalysisCard 依据此渲染 "查看错题详情" 链接。

8. **`error.dueForReview` 空状态返 `nextReviewAt`**（spec §5.1.4 / UI Reback B）：当 `dueToday.length === 0` 时查下一条 ACTIVE entry 的 `nextReviewAt`；前端据此渲染 "下次复习 +Xd"。`dueToday.length > 0` 时 `nextReviewAt = null`。

9. **P2002 判断抽 helper**（spec §4.1 修订）：`isErrorBookPartialUniqueP2002(e: unknown): boolean` 单一返回，先 `instanceof + code === "P2002"` 早返，再用 `targetStr.includes(...)`。**绝不**写 `a && b && c || d`（运算符优先级会让 d 单独成立即 true）。

10. **`clientRequestId: z.string().uuid()` 强制**（spec §5.1 / §5.2 / 沿用 Plan 3）：`error.diagnose` 与 `variant.generateForEntry` 的 input 必须含 UUID v4 `clientRequestId`；缺则 `BAD_REQUEST / CLIENT_REQUEST_ID_REQUIRED`（由 chargeMiddleware 抛）。

11. **idemKey 命名约定**（沿用 Plan 3 §3.3）：`debit:error_analysis:${userId}:${cri}` / `debit:variant_group_gen:${userId}:${cri}`。`grep "idemKey:" packages/billing packages/ai apps/web` 应全部命中已存在前缀（topup / debit / comp / adjust / topup:bootstrap）。

12. **AI 输出 JSON schema 强约束**：`ErrorAnalysisOutputSchema` 与 `VariantGenerationOutputSchema` 用 zod 校验；`rootCause` 限定在 6 类 enum 内（`CONCEPT_CONFUSION / READING_ERROR / FORMULA_MISUSE / CALCULATION_SLIP / TRANSFER_GAP / OTHER`）；`level` 限定 `L1 / L2 / L3`；JSON 解析失败走 Plan 1 既有 retry-2-次 → PARSE_FAILED 路径。

13. **合规白名单不补偿**（沿用 Plan 3 §1.8 / §6.5）：`ComplianceRejectedError` 在 `error.diagnose` / `variant.generateForEntry` 抛时**不补偿**，ledger row metadata 写 `compensationStatus: "not_compensated_whitelisted"`。其余抛错默认补偿。**复用 Plan 3 现有 `shouldCompensate` / `errorReason`，不重定义**。

14. **每个 task 一个 commit**，commit message 引用 task 编号。

15. **PowerShell 调 pnpm 必须用 `pnpm.cmd`**（execution policy 拦 `.ps1`）。

16. **测试不许 `it.todo` / 空 body / 仅注释**。Vitest 把 `it.todo` 当 "todo 不失败"、`it("name", async () => {})` 空 body 也直接 passed —— 两种都会让"全绿"成为假绿。Task 4 / 5 每次 commit 前必须跑：
    ```powershell
    Select-String -Path apps/web/tests/integration -Pattern "it\.todo" -Recurse
    ```
    **期望 0 命中**。Vitest `Tests` 行也要确认是 `N passed (N)`、不含 `(M todo)` 计数。这是 Task 4 步骤 4.12 / Task 5 步骤 5.8 的 commit 前 guardrail。

17. **Prisma migration 顺序硬约束**：`migrate dev --create-only` → 追加 raw SQL → `migrate dev` apply。**禁止**先 `migrate dev` apply 再改 migration.sql（会产生 checksum drift）。详 Task 1 步骤 1.6-1.8。

---

## 范围

**本 plan 做**（对应 spec §1-§7 全部、§8 全部 task 0-8）：
- Prisma migration（ErrorBookEntry / VariantGroup / VariantItem + ErrorRootCause / ErrorBookStatus / VariantLevel enum + 索引 + partial unique index）+ `User.errorBookEntries` 关联
- `packages/ai` 加 `tasks/error-analysis.ts` + `tasks/variant-generation.ts`；prompts 落 `packages/ai/src/prompts/error-analysis/v1.md` + `variant-generation/v1.md`；`AiRouter.diagnoseError(...)` + `AiRouter.generateVariants(...)`
- `apps/web/server/trpc.ts` 抽出 `chargeMiddleware(kind)` factory + 加 `validateEntryOwnership` middleware；`chargedProcedure(kind)` 保留为糖语法
- `error` tRPC 路由 7 个 procedure：diagnose / list / getById / dueForReview / markReviewed / archive / delete
- `variant` tRPC 路由 1 个 procedure：generateForEntry（含 Blocker 1 两个验收测例）
- UI（最小化）：`/error-book` 列表页（带 ACTIVE / ARCHIVED tab） + `/error-book/[entryId]` 详情页（含变式列表 + 生成入口 + markReviewed/archive/delete 按钮）+ `/error-book/review` 复习页（dueToday + nextReviewAt 空状态）+ ErrorAnalysisCard 改造（接入 entryId 链接）
- E2E：error-book-end-to-end（diagnose → 列表 → 详情 → 生成变式 → 标记复习 → 删除）
- CLAUDE.md 更新 + Merge 验收清单 prereq 区分

**本 plan 不做**（spec §8 显式 punt）：
- 教师端"分层作业"基于错题本 entry 扩展（独立 plan）
- 学情画像 / 趋势报告 / 区域研究（独立 plan）
- 错题导出 / 错题分享卡片 / 家长可见视图（独立 plan）
- SM-2 / FSRS 风格自适应间隔复习算法（MVP 保持 5 段固定间隔；独立 plan）
- 知识点 reconciler（把 AI 输出的 KP hint 字符串映射到 `KnowledgePoint` id；独立 plan）
- 错题本批量导入 / 学生历史错题迁移（独立 plan）
- 重新分析"短时间内重复 diagnose 不刷新 nextReviewAt"防 spam（MVP 不防；扣费已抑制）

---

## 文件结构（新建 / 修改清单）

```
.gitignore                                                  # 不动
CLAUDE.md                                                   # 改：常用命令 + Merge 清单 + 已落地状态

# === packages/db ===
packages/db/
  prisma/schema.prisma                                      # 改：加 3 model + 3 enum + User.errorBookEntries 关联
  prisma/migrations/<timestamp>_plan4_error_book/           # 新（prisma migrate dev 生成）
    migration.sql                                           # 末尾手动追加 partial unique index 的 raw SQL

# === packages/ai 扩展 ===
packages/ai/
  src/
    tasks.ts                                                # 改：TaskKind 加 ERROR_ANALYSIS + VARIANT_GROUP_GEN（删 ERROR_DIAGNOSIS / VARIANT_L1/L2/L3_GEN 留位）
    schemas.ts                                              # 改：加 ErrorAnalysisInput/OutputSchema + VariantGenerationInput/OutputSchema
    router.ts                                               # 改：AiRouter 加 diagnoseError(...) / generateVariants(...) 方法
    index.ts                                                # 改：barrel 导出新 schema
    prompts/error-analysis/v1.md                            # 新
    prompts/variant-generation/v1.md                        # 新
  tests/
    error-analysis.test.ts                                  # 新（mock adapter；happy + 合规拒绝 + JSON 重试 + enum 强约束）
    variant-generation.test.ts                              # 新（mock adapter；happy + 三 level 顺序 + 合规拒绝 + JSON 重试）

# === apps/web ===
apps/web/
  server/trpc.ts                                            # 改：抽 chargeMiddleware(kind) + 加 validateEntryOwnership；chargedProcedure 保留糖语法
  server/lib/error-book.ts                                  # 新：upsertEntryOnDiagnose / nextReviewAtAfter / isErrorBookPartialUniqueP2002 / toEntryView / toVariantGroupView / DAY_MS / REVIEW_INTERVALS_MS
  server/routers/_root.ts                                   # 改：挂 error / variant 路由
  server/routers/error.ts                                   # 新：7 procedure
  server/routers/variant.ts                                 # 新：1 procedure
  app/(student)/error-book/page.tsx                         # 新：列表页（ACTIVE / ARCHIVED tab）
  app/(student)/error-book/[entryId]/page.tsx               # 新：详情页 + 变式列表 + 操作按钮
  app/(student)/error-book/review/page.tsx                  # 新：复习页（dueToday + 空状态 +Xd）
  app/(student)/error-book/entry-actions.tsx                # 新：client component（markReviewed / archive / delete + 生成变式 button）
  app/(student)/tutor/error-analysis-card.tsx               # 改（或新建，看现状）：调用 diagnose 后渲染 entryId 链接
  tests/integration/error-diagnose.test.ts                  # 新（happy / 已有 ACTIVE entry update / ARCHIVED 拉回 ACTIVE / DELETED 后再 diagnose 是新 entry / 并发 race P2002 / ComplianceRejected 不补偿 / entryId 返回）
  tests/integration/error-list.test.ts                      # 新（默认 ACTIVE / status=ARCHIVED / DELETED 不可见 / cursor pagination）
  tests/integration/error-get-by-id.test.ts                 # 新（happy / 跨用户 NOT_FOUND / DELETED NOT_FOUND / 含 variant groups）
  tests/integration/error-due-for-review.test.ts            # 新（dueToday 非空 / 空+future / 空+无future / ARCHIVED 不进队列）
  tests/integration/error-mark-reviewed.test.ts             # 新（间隔算法 5 段 / 第 10 次 cap 30d / ARCHIVED 抛 ENTRY_NOT_ACTIVE）
  tests/integration/error-archive.test.ts                   # 新（archive(true) / archive(false) 复活 / idempotent）
  tests/integration/error-delete.test.ts                    # 新（删后所有入口 NOT_FOUND / 删后再 diagnose 同题 = 新 entry）
  tests/integration/variant-generate-for-entry.test.ts      # 新（Blocker 1 三测例 + happy + ARCHIVED entry 允许 + 同 cri 重试 CONFLICT + ComplianceRejected 不补 + 默认补偿）
  # 注：不为 Task 3 引入 charge-middleware-refactor-regression.test.ts 占位文件。
  # Task 3 零回归证明依据是步骤 3.5 跑的既有 Plan 3 套件（charged-procedure-tutor/idempotency/compensation 等）；
  # Task 5 步骤 5.7 可选为 chargeMiddleware 写真直测，但只写有断言的测试，不留 it.todo。
  e2e/error-book-end-to-end.spec.ts                         # 新
```

---

## 前置：环境检查 + 分支

> **Shell 约定**：本 plan 所有命令默认 **PowerShell**。本机 execution policy 拦 `.ps1`，PowerShell 里直接 `pnpm` 会被解析到 `pnpm.ps1` 报 "running scripts is disabled"。所以 **全文一律用 `pnpm.cmd`**（npm 装出的 `.cmd` shim，PowerShell 和 git-bash 都能跑）。

```powershell
node --version       # >= 20
pnpm.cmd --version   # >= 9
docker --version     # Docker Desktop 在运行
```

- [ ] **步骤 P.1：从 master 起 worktree**

```powershell
git fetch origin
git switch master
git pull --ff-only
git worktree add .claude/worktrees/plan-4-variant-and-error -b plan-4-variant-and-error master
```

新窗口 `Set-Location .claude/worktrees/plan-4-variant-and-error`，后续命令都在 worktree 里跑。

- [ ] **步骤 P.2：起 docker、装依赖、迁主库**

```powershell
docker compose up -d
pnpm.cmd install
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd --filter @zhijiao/db db:migrate:deploy
pnpm.cmd db:seed
```

- [ ] **步骤 P.3：baseline 跑 3 次（确认 master 无 regression）**

```powershell
"" | Out-File baseline-runs.txt -Encoding utf8
foreach ($i in 1..3) {
  "=== Run $i ===" | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tc = pnpm.cmd exec turbo typecheck --force 2>&1
  $tc | Select-Object -Last 5  | Out-File baseline-runs.txt -Encoding utf8 -Append
  $tt = pnpm.cmd exec turbo test --force 2>&1
  $tt | Select-Object -Last 10 | Out-File baseline-runs.txt -Encoding utf8 -Append
}

"=== E2E ===" | Out-File baseline-runs.txt -Encoding utf8 -Append
$e2e = pnpm.cmd --filter @zhijiao/web test:e2e 2>&1
$e2e | Select-Object -Last 10 | Out-File baseline-runs.txt -Encoding utf8 -Append

Get-Content baseline-runs.txt
```

期望：3/3 typecheck 全绿；3/3 test 全绿；E2E 1 轮绿。若出现稳定失败 / flake 密集，**先停**——不进 Task 0，回 master 修，本 plan 暂缓。

---

## Task 0：仓库卫生（保证起跑点干净）

> **为什么先做**：worktree 起完后，确保 `.gitignore` 不漏掉本 plan 会产生的临时文件，`.claude/worktrees/` 残留也清掉。沿用 Plan 3 Task 0 工艺，无新概念。

**Files：**
- Modify: `.gitignore`（仅在缺 `.claude/worktrees/` / `baseline-runs.txt` / `*.log` 之一时追加；**不要**触碰其它行）

- [ ] **步骤 0.0：先看 `.gitignore` 是否已 dirty，区分本 plan 与遗留改动**

```powershell
git status --short -- .gitignore
git diff -- .gitignore
```

如果 `.gitignore` 已 dirty（master 起 worktree 时本仓库根 `.gitignore` 已有未提交改动），**必须**先看 diff：
- 如果 diff 内容是本 plan 关心的三条（`.claude/worktrees/` / `baseline-runs.txt` / `*.log`）—— 视为前置准备，可纳入 Task 0 commit
- 如果 diff 内容是**别的事**（与 Plan 4 无关的遗留修改）—— **不要**纳入 Task 0 commit。两种合理处置：
  - 先 stash（`git stash push -m "non-plan-4 gitignore changes"`）→ 跑完 Task 0 → 再 stash pop 在主仓 master 单独处理
  - 或在 master 单独 commit 这些遗留改动后再进 worktree
- 任何情况下，`git commit` 都用 `git add .gitignore` 精确加文件、不用 `git add -A`，避免把无关 dirty 文件卷进 Task 0

- [ ] **步骤 0.1：检查 `.gitignore` 是否含本 plan 需要的三条**

```powershell
Select-String -Path .gitignore -Pattern "claude/worktrees|baseline-runs|\.log$"
```

期望三条都能命中。如有缺，用 Edit 工具**只追加缺的那一条**到 `.gitignore` 末尾，不动其它行。

- [ ] **步骤 0.2：清残留 worktree**

```powershell
git worktree list
```

若有 `.claude/worktrees/plan-3-credit-wechatpay` 等已 merge 完的残留：

```powershell
git worktree remove .claude/worktrees/plan-3-credit-wechatpay
git worktree prune
```

如果 git 已不认它但目录还在：

```powershell
Remove-Item -Recurse -Force -LiteralPath .claude/worktrees/plan-3-credit-wechatpay
```

- [ ] **步骤 0.3：commit（如有改动）**

```powershell
git status --short
# 如果 .gitignore 改了：
git add .gitignore
git commit -m "chore(plan-4): Task 0 — gitignore hygiene"
```

如无改动 skip commit（本 task 可空）。

---

## Task 1：Prisma migration（3 表 + 3 enum + partial unique index + User 关联）

> **为什么先做**：error / variant 路由的所有 Prisma 查询都依赖这些表。Schema 一落地，后续 task 都能写代码。partial unique index 用 raw SQL 在 migration 末尾追加（Prisma 5 schema 不直接支持）。

**Files：**
- Modify: `packages/db/prisma/schema.prisma`（追加 3 enum + 3 model + User.errorBookEntries 关联）
- Create: `packages/db/prisma/migrations/<timestamp>_plan4_error_book/migration.sql`（prisma migrate dev 生成，末尾手动追加 partial unique index）

- [ ] **步骤 1.1：追加 3 enum 到 `schema.prisma` 末尾**

```prisma
enum ErrorRootCause {
  CONCEPT_CONFUSION     // 概念混淆
  READING_ERROR         // 读题失误
  FORMULA_MISUSE        // 公式误用
  CALCULATION_SLIP      // 计算疏漏
  TRANSFER_GAP          // 迁移不足
  OTHER                 // 兜底；AI 无法分类时
}

enum ErrorBookStatus {
  ACTIVE     // 默认错题本视图；进复习队列；error.list 默认只返此态
  ARCHIVED   // 用户主动归档：从默认错题本"移走"；仅归档页（status="ARCHIVED"）可见
  DELETED    // 终态；所有 student-facing 入口视为不存在；DB 行保留作审计
}

enum VariantLevel {
  L1   // 同结构同知识点；改数字 / 改具体值
  L2   // 改条件 / 改题型表象但同知识点
  L3   // 跨题型与现实情境融合；要求知识点迁移
}
```

- [ ] **步骤 1.2：追加 `ErrorBookEntry` model**

```prisma
model ErrorBookEntry {
  id                  String           @id @default(cuid())
  userId              String           @map("user_id")
  questionId          String           @map("question_id")
  status              ErrorBookStatus  @default(ACTIVE)

  rootCause           ErrorRootCause
  rootCauseReasoning  String           @db.Text @map("root_cause_reasoning")
  actualAnswerMd      String?          @db.Text @map("actual_answer_md")

  reviewCount         Int              @default(0) @map("review_count")
  nextReviewAt        DateTime?        @map("next_review_at")
  lastReviewedAt      DateTime?        @map("last_reviewed_at")

  diagnoseLedgerId    String?          @map("diagnose_ledger_id")
  lastDiagnoseCallId  String?          @map("last_diagnose_call_id")

  createdAt           DateTime         @default(now()) @map("created_at")
  updatedAt           DateTime         @updatedAt      @map("updated_at")

  user                User             @relation(fields: [userId], references: [id], onDelete: Restrict)
  question            Question         @relation(fields: [questionId], references: [id], onDelete: Restrict)
  variantGroups       VariantGroup[]

  // ❌ 故意不加 @@unique([userId, questionId])
  //    DELETED entry 允许与新 ACTIVE entry 共存；partial unique index 在 migration 里加（步骤 1.7）
  @@index([userId, status, nextReviewAt])
  @@index([userId, status, createdAt(sort: Desc)])
  @@index([questionId])
  @@map("error_book_entries")
}
```

> `onDelete: Restrict`：删 User / Question 不级联删错题（与 Wallet / CreditLedger 同安全默认）。用户注销 / 题库下线由独立 plan 接管。

- [ ] **步骤 1.3：追加 `VariantGroup` model**

```prisma
model VariantGroup {
  id              String         @id @default(cuid())
  entryId         String         @map("entry_id")
  userId          String         @map("user_id")
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
```

- [ ] **步骤 1.4：追加 `VariantItem` model**

```prisma
model VariantItem {
  id                  String        @id @default(cuid())
  groupId             String        @map("group_id")
  level               VariantLevel
  position            Int
  stemMd              String        @db.Text @map("stem_md")
  solutionMd          String        @db.Text @map("solution_md")
  knowledgePointHints String[]      @default([]) @map("knowledge_point_hints")
  createdAt           DateTime      @default(now()) @map("created_at")

  group               VariantGroup  @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([groupId, level])
  @@index([groupId, position])
  @@map("variant_items")
}
```

> VariantItem 的 `onDelete: Cascade`：删 VariantGroup 时 item 也删（item 与 group 强耦合，没有独立生命周期）。

- [ ] **步骤 1.5：在 `User` model 加 errorBookEntries 关联**

打开 `packages/db/prisma/schema.prisma`，找 `model User { ... }`，在 `wallet` 关联之后加一行：

```prisma
model User {
  // ... 现有字段 ...
  roles       UserRole[]
  identities  AuthIdentity[]
  sessions    Session[]
  wallet      Wallet?
  errorBookEntries  ErrorBookEntry[]   // ← Plan 4 加

  @@map("users")
}
```

- [ ] **步骤 1.6：`prisma migrate dev --create-only` 生成迁移 SQL（**不**应用）**

> **硬性顺序约束**：本步必须用 `--create-only`，**不许**走 `prisma migrate dev`（无 `--create-only`）一把 apply。原因：Prisma 把 migration 应用到 DB 时会把当前 migration.sql 的 checksum 记到 `_prisma_migrations` 表；之后步骤 1.7 追加 partial unique index 的 raw SQL 会让磁盘上 migration.sql 的 checksum 与表里记的对不上 → 下次 `migrate dev / deploy` 报 `migration ... has been modified after being applied` → 必须 `migrate resolve` 重置 → 给后人埋雷。
>
> 正确顺序固定为：
>   1. **`migrate dev --create-only`** 生成 SQL（不 apply）
>   2. **追加 partial unique 的 raw SQL 到同一 migration.sql 末尾**
>   3. **`migrate dev`** 才执行 apply（一次性把含 partial index 的完整 SQL 落库 + 写 checksum）

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --create-only --name plan4_error_book
```

期望：`packages/db/prisma/migrations/<timestamp>_plan4_error_book/migration.sql` 文件**已生成但未 apply**；DB 里 `error_book_entries` 等表还**不存在**；`_prisma_migrations` 表里也**没有**本迁移的行。验证：

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\dt error_book_entries" 2>&1 | Select-String "Did not find"
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%plan4_error_book%';" 2>&1
```

两条都应该提示"不存在 / 0 行"。如果 `_prisma_migrations` 已经有这条记录 → 你跑成了 `migrate dev` 而非 `--create-only`，必须先回退（`prisma migrate resolve --rolled-back <migration_name>` + drop 已建表）再重来；checksum drift 在此处堵住。

文件内容应含 `CREATE TYPE "ErrorRootCause"` / `CREATE TYPE "ErrorBookStatus"` / `CREATE TYPE "VariantLevel"` / `CREATE TABLE "error_book_entries"` / `CREATE TABLE "variant_groups"` / `CREATE TABLE "variant_items"` + 上面声明的所有 `@@index`。

- [ ] **步骤 1.7：在同一 migration.sql 末尾追加 partial unique index 的 raw SQL**

打开 `packages/db/prisma/migrations/<timestamp>_plan4_error_book/migration.sql`，**末尾**追加（用 Edit / 文本编辑器手工加；不在外部加临时 SQL）：

```sql
-- Plan 4 spec §3.3: partial unique index allows DELETED entries to coexist with new ACTIVE/ARCHIVED entries.
-- Prisma 5 schema 不直接支持带 WHERE 的 partial unique，手动追加进 Prisma 迁移文件本身；
-- Prisma apply 时会把这一行也跑掉，checksum 与磁盘文件保持一致。
CREATE UNIQUE INDEX "error_book_entries_user_question_active_idx"
  ON "error_book_entries" ("user_id", "question_id")
  WHERE "status" IN ('ACTIVE', 'ARCHIVED');
```

> **Postgres 用双引号包 identifier，不用 MySQL 风格反引号**——反引号会让 Postgres 报语法错。

- [ ] **步骤 1.8：现在才 apply（`migrate dev` 把含 partial index 的完整 SQL 一次性落库 + 写 checksum）**

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev
```

（不带 `--name`，因为目录已存在；Prisma 会发现 `<timestamp>_plan4_error_book` 是 pending 状态，把 migration.sql 整文件 apply。）

期望输出含 `Applying migration \`<timestamp>_plan4_error_book\`` + `The following migration(s) have been applied`。`_prisma_migrations` 表里 checksum 是**含 partial index 的完整 SQL 的指纹**，磁盘上 migration.sql 与 checksum 一致，不存在 drift。

**如果**步骤 1.6 已经误跑了无 `--create-only` 的 `migrate dev` 把表建了 + checksum 写了：
- 不要尝试改 migration.sql 后跑 `migrate resolve --applied`——会留下"applied checksum 与磁盘不符"的脏状态
- 正确恢复：drop 已建的 3 张表 + 3 个 enum（PowerShell 下 docker exec psql 跑 DROP）→ `prisma migrate resolve --rolled-back <migration_name>` 把 `_prisma_migrations` 行也清掉 → 回步骤 1.6 重来

- [ ] **步骤 1.9：验证 partial unique index 已落主库 DB**

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d error_book_entries"
```

期望输出含一行类似 `"error_book_entries_user_question_active_idx" UNIQUE, btree (user_id, question_id) WHERE status = ANY (ARRAY['ACTIVE'::"ErrorBookStatus", 'ARCHIVED'::"ErrorBookStatus"])`，索引名 `error_book_entries_user_question_active_idx`。

并验证 checksum 与磁盘一致（无 drift）：

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate status
```

期望输出 `Database schema is up to date!`（无任何 "modified after being applied" 警告）。如有 drift 警告 → 回步骤 1.8 的恢复流程。

- [ ] **步骤 1.10：把 partial index 也复制到所有 per-pkg test DB 的迁移路径**

per-package test DB 的 migration 由 `packages/db/scripts/setup-test-dbs.ts` + `prisma migrate deploy` 触发。检查是否需要手动确认 partial index 也在 `zhijiao_test_db` / `zhijiao_test_web`：

```powershell
pnpm.cmd test:setup
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_db -c "\d error_book_entries" | Select-String "user_question_active"
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_web -c "\d error_book_entries" | Select-String "user_question_active"
```

期望两库都命中 `user_question_active` 索引。如未命中，回 setup-test-dbs.ts 看是否走 `migrate deploy`；走 deploy 即应该自动应用 migration.sql 里的 raw SQL。

- [ ] **步骤 1.11：generate prisma client + typecheck**

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck --force
```

期望全绿；如 `ErrorBookEntry` / `VariantGroup` / `VariantItem` 类型未生成，回去 verify schema 没拼写错。

- [ ] **步骤 1.12：commit**

```powershell
git add packages/db/
git commit -m "feat(db): Plan 4 Task 1 — ErrorBookEntry/VariantGroup/VariantItem + 3 enums + partial unique idx"
```

---

## Task 2：`packages/ai` 错因分析 + 变式生成（schemas + prompts + router 方法 + unit tests）

> **为什么先做**：error / variant 路由的 mutation body 直接调 `AiRouter.diagnoseError(...)` / `AiRouter.generateVariants(...)`。AI 包不先扩展，路由没法写。

**Files：**
- Modify: `packages/ai/src/tasks.ts`（TaskKind 加 `ERROR_ANALYSIS` + `VARIANT_GROUP_GEN`；删 `ERROR_DIAGNOSIS` / `VARIANT_L1_GEN` / `VARIANT_L2_GEN` / `VARIANT_L3_GEN` 留位）
- Modify: `packages/ai/src/schemas.ts`（加 4 个 zod schema）
- Modify: `packages/ai/src/router.ts`（加 2 个 method + 各自 ComplianceRejected 扫描 helper）
- Modify: `packages/ai/src/index.ts`（barrel 导出新 schema）
- Create: `packages/ai/src/prompts/error-analysis/v1.md`
- Create: `packages/ai/src/prompts/variant-generation/v1.md`
- Create: `packages/ai/tests/error-analysis.test.ts`
- Create: `packages/ai/tests/variant-generation.test.ts`

- [ ] **步骤 2.1：改 `tasks.ts`：TaskKind 调整**

```ts
export type TaskKind =
  | "TUTOR_TURN"
  | "ERROR_ANALYSIS"            // ← 新增（替换 ERROR_DIAGNOSIS）
  | "VARIANT_GROUP_GEN"         // ← 新增（替换 VARIANT_L1/L2/L3_GEN 三个留位）
  | "PAPER_GEN"
  | "FORECAST_PAPER_GEN"
  | "EMBEDDING";

export const TASK_MODEL_MAP: Record<TaskKind, string> = {
  TUTOR_TURN:          "qwen-plus",
  ERROR_ANALYSIS:      "qwen-plus",
  VARIANT_GROUP_GEN:   "qwen-plus",        // 一次生成 3 道，需要 plus 级
  PAPER_GEN:           "qwen-max",
  FORECAST_PAPER_GEN:  "qwen-max",
  EMBEDDING:           "text-embedding-v2",
};
```

> 删 `ERROR_DIAGNOSIS / VARIANT_L1_GEN / VARIANT_L2_GEN / VARIANT_L3_GEN` 是因为它们是 Plan 1 留位、本 plan 内没人用。若有任何代码 import 这几个名字，先 grep 确认 0 命中再删：

```powershell
Select-String -Path packages -Pattern "ERROR_DIAGNOSIS|VARIANT_L1_GEN|VARIANT_L2_GEN|VARIANT_L3_GEN" -SimpleMatch
```

期望 0 命中。如有则一并改名。

- [ ] **步骤 2.2：改 `schemas.ts`：加 4 个 schema**

在文件末尾追加：

```ts
// === ErrorAnalysis (error.diagnose) ===
export const ErrorRootCauseEnum = z.enum([
  "CONCEPT_CONFUSION",
  "READING_ERROR",
  "FORMULA_MISUSE",
  "CALCULATION_SLIP",
  "TRANSFER_GAP",
  "OTHER",
]);
export type ErrorRootCauseValue = z.infer<typeof ErrorRootCauseEnum>;

export const ErrorAnalysisInputSchema = z.object({
  stemMd: z.string().min(1).max(4000),
  correctAnswerMd: z.string().min(1).max(4000).nullable(),
  actualAnswerMd: z.string().min(1).max(4000).nullable(),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).nullable(),
});
export type ErrorAnalysisInput = z.infer<typeof ErrorAnalysisInputSchema>;

export const ErrorAnalysisOutputSchema = z.object({
  rootCause: ErrorRootCauseEnum,
  reasoning: z.string().min(1).max(2000),
  suggestedKnowledgePoints: z.array(z.string().min(1).max(200)).max(10).default([]),
});
export type ErrorAnalysisOutput = z.infer<typeof ErrorAnalysisOutputSchema>;

// === VariantGeneration (variant.generateForEntry) ===
export const VariantLevelEnum = z.enum(["L1", "L2", "L3"]);
export type VariantLevelValue = z.infer<typeof VariantLevelEnum>;

export const VariantAnchorKpSchema = z.object({
  id: z.string(),
  name: z.string(),
  difficulty: z.number().int().min(1).max(5),
});

export const VariantGenerationInputSchema = z.object({
  anchorStemMd: z.string().min(1).max(4000),
  anchorRootCause: ErrorRootCauseEnum,
  anchorKps: z.array(VariantAnchorKpSchema).min(1),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).nullable(),
});
export type VariantGenerationInput = z.infer<typeof VariantGenerationInputSchema>;

export const VariantItemSchema = z.object({
  level: VariantLevelEnum,
  stemMd: z.string().min(1).max(4000),
  solutionMd: z.string().min(1).max(4000),
  knowledgePointHints: z.array(z.string().min(1).max(200)).max(10).default([]),
});

export const VariantGenerationOutputSchema = z.object({
  // 必须恰好 3 道，分别 L1 / L2 / L3 各一道
  items: z.array(VariantItemSchema)
    .length(3, "必须生成 3 道变式（L1/L2/L3 各一）")
    .refine(
      arr => arr.map(it => it.level).sort().join(",") === "L1,L2,L3",
      "items 的 level 必须为 {L1, L2, L3} 各一",
    ),
});
export type VariantGenerationOutput = z.infer<typeof VariantGenerationOutputSchema>;
```

- [ ] **步骤 2.3：建 `prompts/error-analysis/v1.md`**

```markdown
你是面向中国 K12 数学的错因分析助手。你的任务是判断学生这道题为什么会错，给出**简洁但精准**的错因解读。

# 输入

- 题目原文（Markdown）：
{{stemMd}}

- 正确答案（如有）：
{{correctAnswerMd}}

- 学生实际作答（如有）：
{{actualAnswerMd}}

- 学生年级：{{studentGrade}}

# 输出要求

只输出 JSON，**不要**任何额外文字、Markdown 包裹、解释。schema：

```json
{
  "rootCause": "CONCEPT_CONFUSION" | "READING_ERROR" | "FORMULA_MISUSE" | "CALCULATION_SLIP" | "TRANSFER_GAP" | "OTHER",
  "reasoning": "为什么错的解释，1-3 句话，不要给完整解答，聚焦'错在哪'",
  "suggestedKnowledgePoints": ["知识点名 1", "知识点名 2"]
}
```

# 分类口径

- `CONCEPT_CONFUSION`：对定义 / 性质 / 概念本身的理解错（如把"质数"和"奇数"混淆）
- `READING_ERROR`：题目条件 / 问题问的什么读偏了 / 漏了
- `FORMULA_MISUSE`：套错公式 / 用错适用域（如把二次公式用在一次方程）
- `CALCULATION_SLIP`：纯算术 / 符号 / 移项错；概念和方法都对
- `TRANSFER_GAP`：知识点会但情境变了用不出来（如知识点在课本里会、放到应用题里不会）
- `OTHER`：以上都不准确（应用上看这类要进人工 reclassify 队列）

# 措辞红线（合规）

- **不许**给"包过 / 必考 / 押中"等暗示
- **不许**给完整解答 / 求解步骤（聚焦"为什么错"，不是"怎么解"）
- **不许**恐吓 / 制造焦虑措辞
- 仅输出 JSON，无其它任何文字
```

- [ ] **步骤 2.4：建 `prompts/variant-generation/v1.md`**

```markdown
你是面向中国 K12 数学的"举一反三"变式生成助手。你的任务是基于学生做错的一道题（锚题），生成**恰好 3 道**变式：L1 / L2 / L3 各一道。

# 输入

- 锚题（学生做错的题）：
{{anchorStemMd}}

- 错因分类：{{anchorRootCause}}

- 锚题关键知识点：
{{anchorKps}}

- 学生年级：{{studentGrade}}

# Level 定义（务必严格遵守）

- **L1（同结构同知识点）**：换数字 / 换具体值，结构和题型完全保持。学生若已掌握应能直接做对。
- **L2（变条件 / 变题型表象）**：改条件 / 题型从选择→填空 / 填空→解答 / 调换已知与未知；但**仍考同一知识点**。学生需要做出小幅迁移。
- **L3（跨题型 + 现实情境）**：把同一知识点嵌入一个**现实情境**中（如购物 / 行程 / 几何应用）；题面可以加情境包装，但**核心知识点不变**。

# 输出要求

只输出 JSON，**不要**任何额外文字、Markdown 包裹、解释。schema：

```json
{
  "items": [
    {
      "level": "L1",
      "stemMd": "L1 变式题面",
      "solutionMd": "L1 解答（含必要步骤；不要先于学生尝试就把答案塞最前）",
      "knowledgePointHints": ["相关知识点 1"]
    },
    { "level": "L2", "stemMd": "...", "solutionMd": "...", "knowledgePointHints": [...] },
    { "level": "L3", "stemMd": "...", "solutionMd": "...", "knowledgePointHints": [...] }
  ]
}
```

# 合规 / 措辞红线

- **不许**任何"押中 / 包过 / 命中原题"等措辞
- **不许**恐吓 / 制造焦虑
- 题面不得包含与未成年人不宜的话题（暴力 / 成人 / 政治）
- 仅输出 JSON
```

- [ ] **步骤 2.5：改 `router.ts`：加 `diagnoseError(...)` 方法**

在 `AiRouter` class 内加（紧跟 `tutor` 方法之后）：

```ts
async diagnoseError(input: unknown): Promise<ErrorAnalysisOutput & { modelCallId: string }> {
  const parsed = ErrorAnalysisInputSchema.parse(input);
  const taskKind: TaskKind = "ERROR_ANALYSIS";
  const prompt = await loadPrompt("error-analysis", this.opts.promptVersion ?? "v1");
  const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

  const userContent = prompt.interpolate({
    stemMd: parsed.stemMd,
    correctAnswerMd: parsed.correctAnswerMd ?? "（未提供）",
    actualAnswerMd: parsed.actualAnswerMd ?? "（未提供）",
    studentGrade: parsed.studentGrade ?? "G8",
  });

  const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
  const request = {
    model,
    messages: [
      { role: "system" as const, content: "你是严谨、面向中国 K12 的错因分析助手。" },
      { role: "user" as const, content: userContent },
    ],
    responseFormat: "json_object" as const,
    temperature: 0.2,
  };

  const start = Date.now();
  let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
  let parseAttempts = 0;
  let lastError: unknown = null;

  while (parseAttempts < 3) {
    try {
      response = await this.opts.adapter.call(request);
      const json = JSON.parse(response.content);
      const validated = ErrorAnalysisOutputSchema.parse(json);

      // 合规扫描
      const corpus = [validated.reasoning, ...validated.suggestedKnowledgePoints].join("\n");
      const hits = findForbidden(corpus);
      if (hits.length > 0) {
        await writeAudit(this.opts.prisma, {
          taskKind, promptTemplateId, request, response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.COMPLIANCE_REJECTED,
          errorMessage: `forbidden phrases: ${hits.join(", ")}`,
          userId: this.opts.userId ?? null,
        });
        throw new ComplianceRejectedError(hits);
      }

      const modelCallId = await writeAudit(this.opts.prisma, {
        taskKind, promptTemplateId, request, response,
        latencyMs: Date.now() - start,
        status: ModelCallStatus.SUCCESS,
        errorMessage: null,
        userId: this.opts.userId ?? null,
      });

      return { ...validated, modelCallId };
    } catch (e) {
      if (e instanceof ComplianceRejectedError) throw e;
      lastError = e;
      parseAttempts++;
      if (e instanceof z.ZodError || e instanceof SyntaxError) {
        request.messages.push({
          role: "user",
          content: "上次输出不是符合 schema 的 JSON，请重新只输出 JSON。",
        });
        continue;
      }
      await writeAudit(this.opts.prisma, {
        taskKind, promptTemplateId, request, response,
        latencyMs: Date.now() - start,
        status: ModelCallStatus.ADAPTER_ERROR,
        errorMessage: e instanceof Error ? e.message : String(e),
        userId: this.opts.userId ?? null,
      });
      throw e;
    }
  }

  await writeAudit(this.opts.prisma, {
    taskKind, promptTemplateId, request, response,
    latencyMs: Date.now() - start,
    status: ModelCallStatus.PARSE_FAILED,
    errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
    userId: this.opts.userId ?? null,
  });
  throw new Error(`ERROR_ANALYSIS failed after ${parseAttempts} attempts`);
}
```

需要的 import 加到 `router.ts` 顶部：

```ts
import {
  TutoringInputSchema, TutoringOutputSchema, type TutoringOutput,
  ErrorAnalysisInputSchema, ErrorAnalysisOutputSchema, type ErrorAnalysisOutput,
  VariantGenerationInputSchema, VariantGenerationOutputSchema, type VariantGenerationOutput,
} from "./schemas.js";
```

- [ ] **步骤 2.6：改 `router.ts`：加 `generateVariants(...)` 方法**

紧跟 `diagnoseError` 之后：

```ts
async generateVariants(input: unknown): Promise<VariantGenerationOutput & { modelCallId: string }> {
  const parsed = VariantGenerationInputSchema.parse(input);
  const taskKind: TaskKind = "VARIANT_GROUP_GEN";
  const prompt = await loadPrompt("variant-generation", this.opts.promptVersion ?? "v1");
  const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

  // anchorKps 序列化为可注入 prompt 的 Markdown 列表
  const anchorKpsRendered = parsed.anchorKps
    .map(k => `- ${k.name}（difficulty=${k.difficulty}）`)
    .join("\n");

  const userContent = prompt.interpolate({
    anchorStemMd: parsed.anchorStemMd,
    anchorRootCause: parsed.anchorRootCause,
    anchorKps: anchorKpsRendered,
    studentGrade: parsed.studentGrade ?? "G8",
  });

  const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
  const request = {
    model,
    messages: [
      { role: "system" as const, content: "你是严谨、面向中国 K12 的举一反三变式生成助手。" },
      { role: "user" as const, content: userContent },
    ],
    responseFormat: "json_object" as const,
    temperature: 0.5,  // 变式需要一定多样性
  };

  const start = Date.now();
  let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
  let parseAttempts = 0;
  let lastError: unknown = null;

  while (parseAttempts < 3) {
    try {
      response = await this.opts.adapter.call(request);
      const json = JSON.parse(response.content);
      const validated = VariantGenerationOutputSchema.parse(json);

      // 合规扫描整组 stem + solution
      const corpus = validated.items
        .flatMap(it => [it.stemMd, it.solutionMd, ...it.knowledgePointHints])
        .join("\n");
      const hits = findForbidden(corpus);
      if (hits.length > 0) {
        await writeAudit(this.opts.prisma, {
          taskKind, promptTemplateId, request, response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.COMPLIANCE_REJECTED,
          errorMessage: `forbidden phrases: ${hits.join(", ")}`,
          userId: this.opts.userId ?? null,
        });
        throw new ComplianceRejectedError(hits);
      }

      const modelCallId = await writeAudit(this.opts.prisma, {
        taskKind, promptTemplateId, request, response,
        latencyMs: Date.now() - start,
        status: ModelCallStatus.SUCCESS,
        errorMessage: null,
        userId: this.opts.userId ?? null,
      });

      return { ...validated, modelCallId };
    } catch (e) {
      if (e instanceof ComplianceRejectedError) throw e;
      lastError = e;
      parseAttempts++;
      if (e instanceof z.ZodError || e instanceof SyntaxError) {
        request.messages.push({
          role: "user",
          content: "上次输出不是符合 schema 的 JSON（必须 3 道，level L1/L2/L3 各一），请重新只输出 JSON。",
        });
        continue;
      }
      await writeAudit(this.opts.prisma, {
        taskKind, promptTemplateId, request, response,
        latencyMs: Date.now() - start,
        status: ModelCallStatus.ADAPTER_ERROR,
        errorMessage: e instanceof Error ? e.message : String(e),
        userId: this.opts.userId ?? null,
      });
      throw e;
    }
  }

  await writeAudit(this.opts.prisma, {
    taskKind, promptTemplateId, request, response,
    latencyMs: Date.now() - start,
    status: ModelCallStatus.PARSE_FAILED,
    errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
    userId: this.opts.userId ?? null,
  });
  throw new Error(`VARIANT_GROUP_GEN failed after ${parseAttempts} attempts`);
}
```

> **注意 audit.ts 返回值**：当前 `writeAudit` 返回 `Promise<string>`（row.id）。这里依赖此返回值作为 `modelCallId`。复查 `packages/ai/src/audit.ts`，确认 `return row.id;` 仍在；若没则一并补。

- [ ] **步骤 2.7：改 `index.ts` barrel 导出新 schema**

```ts
export { AiRouter, ComplianceRejectedError, type RouterOptions } from "./router.js";
export { PromptVersionConflictError } from "./registry.js";
export { DashScopeAdapter } from "./adapters/dashscope.js";
export { MockAdapter } from "./adapters/mock.js";
export type { ModelAdapter, AdapterRequest, AdapterResponse } from "./adapters/types.js";
export { TASK_MODEL_MAP, type TaskKind } from "./tasks.js";
export {
  TutoringInputSchema, TutoringOutputSchema,
  type TutoringInput, type TutoringOutput,
  ErrorRootCauseEnum, ErrorAnalysisInputSchema, ErrorAnalysisOutputSchema,
  type ErrorRootCauseValue, type ErrorAnalysisInput, type ErrorAnalysisOutput,
  VariantLevelEnum, VariantGenerationInputSchema, VariantGenerationOutputSchema,
  type VariantLevelValue, type VariantGenerationInput, type VariantGenerationOutput,
} from "./schemas.js";
```

- [ ] **步骤 2.8：扩 MockAdapter 支持 ERROR_ANALYSIS / VARIANT_GROUP_GEN**

打开 `packages/ai/src/adapters/mock.ts`，看现有 `MockAdapter` 是否按 taskKind 切默认响应。若按 request.messages 内容启发式判断，需要加分支：

- 如果 messages 包含 "错因分析助手" / "ERROR_ANALYSIS" → 返一个有效的 `ErrorAnalysisOutput` JSON（rootCause: "CONCEPT_CONFUSION"，reasoning: "Mock 分析", suggestedKnowledgePoints: ["mock-kp"]）
- 如果 messages 包含 "举一反三变式生成助手" / "VARIANT_GROUP_GEN" → 返一个 3 道 L1/L2/L3 的 mock VariantGenerationOutput

具体实现根据 mock.ts 现有结构决定。**最小改动**：在 `MockAdapter.call()` 顶部根据 system message 关键词分发。

- [ ] **步骤 2.9：建 `packages/ai/tests/error-analysis.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, ComplianceRejectedError, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) throw new Error("DATABASE_URL must come from vitest.config.ts");

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "model_calls" RESTART IDENTITY CASCADE;`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "prompt_templates" RESTART IDENTITY CASCADE;`);
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("AiRouter.diagnoseError", () => {
  it("happy path: returns parsed ErrorAnalysisOutput + writes SUCCESS ModelCall + returns modelCallId", async () => {
    const router = new AiRouter({ prisma, adapter: new MockAdapter() });
    const out = await router.diagnoseError({
      stemMd: "解 2x+5=13",
      correctAnswerMd: "x=4",
      actualAnswerMd: "x=9（学生把 -5 写成 +5）",
      studentGrade: "G7",
    });
    expect(out.rootCause).toMatch(/^(CONCEPT_CONFUSION|READING_ERROR|FORMULA_MISUSE|CALCULATION_SLIP|TRANSFER_GAP|OTHER)$/);
    expect(out.reasoning.length).toBeGreaterThan(0);
    expect(out.modelCallId).toBeTruthy();
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
    expect(calls[0]!.taskKind).toBe("ERROR_ANALYSIS");
  });

  it("rejects rootCause outside enum (zod parse)", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({ rootCause: "NOT_A_VALID_CAUSE", reasoning: "x", suggestedKnowledgePoints: [] }),
        model: "mock", tokensIn: 1, tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.diagnoseError({
      stemMd: "x", correctAnswerMd: null, actualAnswerMd: null, studentGrade: null,
    })).rejects.toThrow(/ERROR_ANALYSIS failed/);
    const calls = await prisma.modelCall.findMany();
    expect(calls.at(-1)!.status).toBe(ModelCallStatus.PARSE_FAILED);
  });

  it("ComplianceRejectedError on forbidden phrase in reasoning", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          rootCause: "CONCEPT_CONFUSION",
          reasoning: "包过 必考",  // 含违禁词
          suggestedKnowledgePoints: [],
        }),
        model: "mock", tokensIn: 1, tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.diagnoseError({
      stemMd: "x", correctAnswerMd: null, actualAnswerMd: null, studentGrade: null,
    })).rejects.toBeInstanceOf(ComplianceRejectedError);
    const calls = await prisma.modelCall.findMany();
    expect(calls.at(-1)!.status).toBe(ModelCallStatus.COMPLIANCE_REJECTED);
  });

  it("retries on invalid JSON and recovers if 2nd attempt is valid", async () => {
    let call = 0;
    const adapter = new MockAdapter({
      respondWith: async () => {
        call++;
        if (call === 1) return { content: "not json", model: "mock", tokensIn: 1, tokensOut: 1 };
        return {
          content: JSON.stringify({ rootCause: "OTHER", reasoning: "valid", suggestedKnowledgePoints: [] }),
          model: "mock", tokensIn: 1, tokensOut: 1,
        };
      },
    });
    const router = new AiRouter({ prisma, adapter });
    const out = await router.diagnoseError({
      stemMd: "x", correctAnswerMd: null, actualAnswerMd: null, studentGrade: null,
    });
    expect(out.rootCause).toBe("OTHER");
    expect(call).toBe(2);
  });
});
```

- [ ] **步骤 2.10：建 `packages/ai/tests/variant-generation.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, ComplianceRejectedError, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) throw new Error("DATABASE_URL must come from vitest.config.ts");

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "model_calls" RESTART IDENTITY CASCADE;`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "prompt_templates" RESTART IDENTITY CASCADE;`);
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

const SAMPLE_INPUT = {
  anchorStemMd: "解 2x+5=13",
  anchorRootCause: "CALCULATION_SLIP" as const,
  anchorKps: [{ id: "kp-1", name: "一元一次方程", difficulty: 2 }],
  studentGrade: "G7" as const,
};

describe("AiRouter.generateVariants", () => {
  it("happy path: returns 3 items L1/L2/L3 + modelCallId + SUCCESS audit", async () => {
    const router = new AiRouter({ prisma, adapter: new MockAdapter() });
    const out = await router.generateVariants(SAMPLE_INPUT);
    expect(out.items).toHaveLength(3);
    expect(out.items.map(i => i.level).sort()).toEqual(["L1", "L2", "L3"]);
    expect(out.modelCallId).toBeTruthy();
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.taskKind).toBe("VARIANT_GROUP_GEN");
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
  });

  it("rejects when level not {L1, L2, L3} (zod refine)", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          items: [
            { level: "L1", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
            { level: "L1", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },  // 重复 L1
            { level: "L3", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
          ],
        }),
        model: "mock", tokensIn: 1, tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.generateVariants(SAMPLE_INPUT)).rejects.toThrow(/VARIANT_GROUP_GEN failed/);
  });

  it("rejects when length !== 3", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          items: [
            { level: "L1", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
            { level: "L2", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
          ],  // 只 2 道
        }),
        model: "mock", tokensIn: 1, tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.generateVariants(SAMPLE_INPUT)).rejects.toThrow(/VARIANT_GROUP_GEN failed/);
  });

  it("ComplianceRejectedError on forbidden phrase in stemMd", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          items: ["L1", "L2", "L3"].map(level => ({
            level, stemMd: "押中原题", solutionMd: "y", knowledgePointHints: [],
          })),
        }),
        model: "mock", tokensIn: 1, tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.generateVariants(SAMPLE_INPUT)).rejects.toBeInstanceOf(ComplianceRejectedError);
    const calls = await prisma.modelCall.findMany();
    expect(calls.at(-1)!.status).toBe(ModelCallStatus.COMPLIANCE_REJECTED);
  });
});
```

- [ ] **步骤 2.11：跑 packages/ai 测试**

```powershell
pnpm.cmd --filter @zhijiao/ai test
```

期望：`error-analysis.test.ts` + `variant-generation.test.ts` 全绿；既有 `router.test.ts` / `registry.test.ts` 也全绿（不可能因 schema 改动破坏）。

- [ ] **步骤 2.12：typecheck 全仓**

```powershell
pnpm.cmd exec turbo typecheck --force
```

期望全绿。如有 `ERROR_DIAGNOSIS` / `VARIANT_L1_GEN` 等被删的 TaskKind 在他处引用，会在此处暴露 —— 一并清。

- [ ] **步骤 2.13：commit**

```powershell
git add packages/ai/
git commit -m "feat(ai): Plan 4 Task 2 — error-analysis + variant-generation tasks + schemas + prompts"
```

---

## Task 3：`apps/web/server/trpc.ts` refactor — 抽 `chargeMiddleware` + 加 `validateEntryOwnership` + **零回归证明**

> **为什么先做**：error / variant 路由都依赖这两个 middleware。Refactor 必须保证 Plan 3 既有调用点（`tutor.ask`）行为零变化 —— 本 task 末尾必须显式跑既有 tutor 测试 + 计费 race 测试证明零回归，再 commit。

**Files：**
- Modify: `apps/web/server/trpc.ts`（抽 `chargeMiddleware(kind)` + 加 `validateEntryOwnership` + `chargedProcedure(kind)` 改糖语法）

- [ ] **步骤 3.1：在 trpc.ts 顶部 import 增量**

```ts
import type { ErrorBookEntry, Question, QuestionAnswer, QuestionKPLink, KnowledgePoint } from "@prisma/client";
```

（如果 trpc.ts 之前没 import Prisma 类型，加上；后面 `validateEntryOwnership` 注入 ctx 类型推断需要。）

- [ ] **步骤 3.2：在 `chargedProcedure` 之前抽出独立的 `chargeMiddleware`**

把当前 `apps/web/server/trpc.ts` L83-203 的 `chargedProcedure = (kind: ActionKind) => authedProcedure.use(async ({...}) => { ... })` 重构为：

```ts
// Plan 3 → Plan 4: chargeMiddleware 抽出为独立 factory，可与其它中间件组合。
// chargedProcedure(kind) 保留为糖语法（Plan 3 调用点零 diff）。
//
// 设计要点（spec §5.3）：
// - 必须在 authedProcedure 之后链用（依赖 ctx.auth）
// - input 强制含 clientRequestId: z.string().uuid()（idemKey 防重）
// - 扣费成功后通过 next({ ctx: { ...ctx, debit: { ledgerId } } }) 注入 ctx.debit
// - next() 返 MiddlewareResult（tRPC v11）；result.ok=false 不会 throw，必须显式分支
// - 默认补偿 + ComplianceRejectedError 白名单不补偿（沿用 Plan 3 shouldCompensate）
export const chargeMiddleware = (kind: ActionKind) =>
  t.middleware(async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      // 防御性：理论上 authedProcedure 已挡；若调用方漏链则尽早抛
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "请先登录",
        cause: { reason: "NO_SESSION" },
      });
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

    // Plan 4 新增：注入 ctx.debit 供 mutation body 访问 ledger id（用于 VariantGroup.debitLedgerId）
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
      // 现 Plan 3 不补偿分支逻辑原样保留（L150-200 抄过来）：
      const causeObj = (e as { cause?: unknown } | null)?.cause;
      const originalFromCauseObj =
        causeObj && typeof causeObj === "object" && "original" in causeObj
          ? (causeObj as { original?: unknown }).original
          : undefined;
      const originalClass =
        originalFromCauseObj instanceof Error
          ? originalFromCauseObj.constructor.name
          : causeObj instanceof Error
            ? causeObj.constructor.name
            : (e as { constructor?: { name?: string } } | null)?.constructor
                ?.name ?? "Unknown";
      const existing = await ctx.db.creditLedger.findUnique({
        where: { id: debit.ledgerId },
        select: { metadata: true },
      });
      const prior =
        (existing?.metadata as Record<string, unknown> | null) ?? {};
      await ctx.db.creditLedger.update({
        where: { id: debit.ledgerId },
        data: {
          metadata: {
            ...prior,
            compensationStatus: "not_compensated_whitelisted",
            errorClass: originalClass,
          },
        },
      });
      logger.warn(
        {
          event: "charged_action_not_compensated",
          ledgerId: debit.ledgerId,
          walletId: wallet.id,
          userId: ctx.auth.userId,
          actionKind: kind,
          cost,
          errorClass: originalClass,
          requestId: ctx.requestId,
        },
        "Action failed but whitelisted as non-compensable",
      );
    }
    return result;
  });

// chargedProcedure(kind) 改为糖语法。Plan 3 既有调用点（tutor.ask）零行 diff。
export const chargedProcedure = (kind: ActionKind) =>
  authedProcedure.use(chargeMiddleware(kind));
```

- [ ] **步骤 3.3：在 `chargedProcedure` 之后加 `validateEntryOwnership`**

```ts
// Plan 4 新增 —— 校验 entry 归属并注入 ctx.entry。必须在 chargeMiddleware **之前** 链用：
//   authedProcedure.use(validateEntryOwnership).use(chargeMiddleware("VARIANT_GROUP_GEN"))
// 三种失败合并为 NOT_FOUND（spec §5.3）：
//   a) entry 不存在
//   b) entry.userId !== ctx.auth.userId（跨用户 —— 不返 FORBIDDEN，避免存在性泄露）
//   c) entry.status === "DELETED"（终态对学生不可见）
export const validateEntryOwnership = t.middleware(
  async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "请先登录",
        cause: { reason: "NO_SESSION" },
      });
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

- [ ] **步骤 3.4：typecheck 验证 ctx 类型推断成立**

```powershell
pnpm.cmd --filter @zhijiao/web typecheck
```

期望全绿。如 `validateEntryOwnership` 注入 ctx.entry 后类型推断在 procedure body 里取不到 `ctx.entry.question.knowledgePoints` 等深层属性，可能需要在 `apps/web/server/context.ts` 的 `Ctx` 类型上加 `entry?: ErrorBookEntryWithRelations` 字段，或者依赖 tRPC v11 的 `next({ ctx: ... })` 推断（首选）。

- [ ] **步骤 3.5：零回归证明 —— 跑既有 tutor / billing 测试**

> 关键 step：本 refactor 不许破坏 Plan 3 任何行为。下列命令一组跑下来必须全绿，缺一不可。

```powershell
# 1. AI router 既有测试（tutor.ask 链路依赖）
pnpm.cmd --filter @zhijiao/ai test

# 2. billing 包全套（chargeForAction / compensate / wechat-notify / monthly-limit）
pnpm.cmd --filter @zhijiao/billing test

# 3. web 包既有 tutor / wallet / chargedProcedure integration 测试
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-tutor.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-idempotency.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-compensation.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/wallet-topup-create.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/wechat-pay-notify-happy.test.ts

# 4. E2E tutor-with-credit（端到端确认扣费 + 补偿在浏览器路径上仍正确）
pnpm.cmd --filter @zhijiao/web test:e2e -- tutor-with-credit
```

期望：**全部绿**。如有任一失败，是 refactor 破坏了 Plan 3 行为，**回退本 task 改动**重新审视抽取逻辑。常见错点：
- `next()` 之前丢了 `ctx` 注入（导致 mutation body 拿不到 ctx.debit / ctx.auth）
- 把 `await next()` 改成 `await next({...})` 时丢了 `ctx` spread → `ctx.auth` 在 procedure body 是 undefined
- 不补偿分支的 `originalClass` 启发式逻辑漏抄

- [ ] **步骤 3.6：commit**

> **不**新建占位测试文件。本 task 的零回归证明依据是步骤 3.5 跑的既有 Plan 3 测试套件（AI router / billing / charged-procedure-tutor / charged-procedure-idempotency / charged-procedure-compensation / wallet-topup-create / wechat-pay-notify-happy / E2E tutor-with-credit）—— 这些测试本身就足以覆盖"chargeMiddleware 抽取不破坏 Plan 3 计费契约"。**避免**提交 `it.todo` 文件：Vitest 把 todo 当作未实现但不失败，会在"证明零回归"的名义下提交空断言。

实现者如需为 chargeMiddleware 单独写直测（脱离 tutor 业务），可在 Task 5 拿到 variant 路由（authedProcedure.use(chargeMiddleware)）这第二种链法之后**再写真实测试**，作为 Task 5 的一部分提交；不提前在 Task 3 留 todo 占位。

```powershell
git add apps/web/server/trpc.ts
git commit -m "refactor(web): Plan 4 Task 3 — chargeMiddleware extract + validateEntryOwnership (zero regression vs Plan 3)"
```

---

## Task 4：`error` router + 7 个 procedure + 各自 integration 测试

> **为什么先做**：variant.generateForEntry 在 Task 5，但它依赖 error 路由能创建/查到 ErrorBookEntry。先把 error 全套写完跑通，Task 5 才有 entry 可生成变式。

**Files：**
- Create: `apps/web/server/lib/error-book.ts`（helpers：`upsertEntryOnDiagnose` / `nextReviewAtAfter` / `isErrorBookPartialUniqueP2002` / `toEntryView` / `toVariantGroupView` / 常量 DAY_MS, REVIEW_INTERVALS_MS）
- Create: `apps/web/server/routers/error.ts`（7 procedure）
- Modify: `apps/web/server/routers/_root.ts`（挂 error 路由）
- Create: 7 个 integration test 文件（步骤 4.3-4.9 每个 procedure 一个）

- [ ] **步骤 4.1：建 `apps/web/server/lib/error-book.ts`**

```ts
import "server-only";
import { Prisma, type PrismaClient, type ErrorBookEntry, type ErrorBookStatus, type ErrorRootCause, type Question, type QuestionAnswer, type QuestionKPLink, type KnowledgePoint } from "@prisma/client";
import type { ErrorAnalysisOutput } from "@zhijiao/ai";

export const DAY_MS = 24 * 60 * 60 * 1000;

// spec §6.3 间隔复习算法
// reviewCountAfter=1 → +1d; 2 → +3d; 3 → +7d; 4 → +14d; >=5 → +30d cap
export const REVIEW_INTERVALS_MS: readonly number[] = [
  1 * DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS,
];

export function nextReviewAtAfter(reviewCountAfter: number, now: Date): Date {
  const safeIdx = Math.min(Math.max(reviewCountAfter - 1, 0), REVIEW_INTERVALS_MS.length - 1);
  return new Date(now.getTime() + REVIEW_INTERVALS_MS[safeIdx]!);
}

// spec §4.1 修订：抽 helper 防止 `&& ... || ...` 运算符优先级踩坑。
// 单一返回，先 instanceof + code 早返；再 includes("user_question_active")。
export function isErrorBookPartialUniqueP2002(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code !== "P2002") return false;
  const meta = e.meta as { target?: string | string[] } | undefined;
  const target = meta?.target;
  const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
  return targetStr.includes("user_question_active");
}

export interface UpsertEntryOnDiagnoseArgs {
  userId: string;
  questionId: string;
  ai: ErrorAnalysisOutput;
  debitLedgerId: string;
  modelCallId: string;
  actualAnswerMd: string | null;
}

// spec §4.1 step 5 + §3.3
// 复用语义：
//   - 已有 ACTIVE entry → update（rootCause / reasoning / debit / model call）
//   - 已有 ARCHIVED entry → update + status="ACTIVE"（用户主动重学）；nextReviewAt 若为 null 设回 now+1d
//   - 已有 DELETED entry → findFirst 看不到（status filter 排除）→ 走 create path → 新 entry
//   - 都无 → create
// 并发 race：partial unique idx → P2002 → re-read 走 update path
export async function upsertEntryOnDiagnose(
  tx: Prisma.TransactionClient,
  args: UpsertEntryOnDiagnoseArgs,
): Promise<ErrorBookEntry> {
  const { userId, questionId, ai, debitLedgerId, modelCallId, actualAnswerMd } = args;
  const existing = await tx.errorBookEntry.findFirst({
    where: { userId, questionId, status: { in: ["ACTIVE", "ARCHIVED"] } },
  });
  if (existing) {
    return tx.errorBookEntry.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        rootCause: ai.rootCause,
        rootCauseReasoning: ai.reasoning,
        actualAnswerMd: actualAnswerMd ?? existing.actualAnswerMd,
        diagnoseLedgerId: debitLedgerId,
        lastDiagnoseCallId: modelCallId,
        nextReviewAt: existing.nextReviewAt ?? new Date(Date.now() + DAY_MS),
      },
    });
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
      return tx.errorBookEntry.update({
        where: { id: winner.id },
        data: {
          status: "ACTIVE",
          rootCause: ai.rootCause,
          rootCauseReasoning: ai.reasoning,
          diagnoseLedgerId: debitLedgerId,
          lastDiagnoseCallId: modelCallId,
          nextReviewAt: winner.nextReviewAt ?? new Date(Date.now() + DAY_MS),
        },
      });
    }
    throw e;
  }
}

// === View serializers ===

type EntryWithQuestion = ErrorBookEntry & {
  question?: Question & { answer?: QuestionAnswer | null } | null;
};

export function toEntryView(entry: EntryWithQuestion) {
  return {
    id: entry.id,
    userId: entry.userId,
    questionId: entry.questionId,
    status: entry.status,
    rootCause: entry.rootCause,
    rootCauseReasoning: entry.rootCauseReasoning,
    actualAnswerMd: entry.actualAnswerMd,
    reviewCount: entry.reviewCount,
    nextReviewAt: entry.nextReviewAt,
    lastReviewedAt: entry.lastReviewedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    question: entry.question
      ? {
          id: entry.question.id,
          stemMd: entry.question.stemMd,
          type: entry.question.type,
        }
      : null,
  };
}

export function toQuestionView(
  q: Question & {
    answer?: QuestionAnswer | null;
    knowledgePoints?: (QuestionKPLink & { kp: KnowledgePoint })[];
  },
) {
  return {
    id: q.id,
    stemMd: q.stemMd,
    type: q.type,
    difficulty: q.difficulty,
    answer: q.answer ? { contentMd: q.answer.contentMd, solutionMd: q.answer.solutionMd } : null,
    knowledgePoints:
      q.knowledgePoints?.map(l => ({
        id: l.kp.id, name: l.kp.name, difficulty: l.kp.difficulty, weight: l.weight,
      })) ?? [],
  };
}

// (toVariantGroupView 等 Task 5 再加；此 step 不需要)
```

- [ ] **步骤 4.2：建 `apps/web/server/routers/error.ts` 骨架（7 procedure 全声明 + 实现 5 个简单的）**

```ts
import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  authedProcedure,
  chargedProcedure,
  validateEntryOwnership,
  router,
} from "../trpc.js";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { getAiRouter } from "@/lib/ai-client";
import {
  upsertEntryOnDiagnose,
  nextReviewAtAfter,
  toEntryView,
  toQuestionView,
  DAY_MS,
} from "../lib/error-book.js";

const ErrorRootCauseClient = z.enum([
  "CONCEPT_CONFUSION", "READING_ERROR", "FORMULA_MISUSE",
  "CALCULATION_SLIP", "TRANSFER_GAP", "OTHER",
]);

export const errorRouter = router({
  // === diagnose（步骤 4.10）===
  diagnose: chargedProcedure("ERROR_ANALYSIS")
    .input(z.object({
      questionId: z.string().cuid(),
      actualAnswerMd: z.string().max(5000).optional(),
      clientRequestId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
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
        actualAnswerMd: input.actualAnswerMd ?? null,
      }));

      return {
        entryId: entry.id,
        rootCause: entry.rootCause,
        rootCauseReasoning: entry.rootCauseReasoning,
        suggestedKnowledgePoints: ai.suggestedKnowledgePoints,
        nextActions: ["GENERATE_VARIANTS", "REVIEW_LATER", "ASK_TUTOR"] as const,
      };
    }),

  // === list ===
  list: authedProcedure
    .input(z.object({
      status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),  // ❌ 不允许 DELETED
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // spec §3.1 + §5.1.2：默认错题本 = 仅 ACTIVE
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

  // === getById ===
  getById: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid() }))
    .query(async ({ ctx }) => {
      const variantGroups = await ctx.db.variantGroup.findMany({
        where: { entryId: ctx.entry.id },
        orderBy: { createdAt: "desc" },
        include: { items: { orderBy: { position: "asc" } } },
      });
      return {
        entry: toEntryView(ctx.entry),
        question: toQuestionView(ctx.entry.question),
        variantGroups,  // Task 5 引入 toVariantGroupView 后改
      };
    }),

  // === dueForReview ===
  dueForReview: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const userId = ctx.auth.userId;
      const dueToday = await ctx.db.errorBookEntry.findMany({
        where: { userId, status: "ACTIVE", nextReviewAt: { lte: now } },
        orderBy: { nextReviewAt: "asc" },
        take: input.limit,
        include: { question: { select: { id: true, stemMd: true, type: true } } },
      });
      let nextReviewAt: Date | null = null;
      if (dueToday.length === 0) {
        const future = await ctx.db.errorBookEntry.findFirst({
          where: { userId, status: "ACTIVE", nextReviewAt: { gt: now } },
          orderBy: { nextReviewAt: "asc" },
          select: { nextReviewAt: true },
        });
        nextReviewAt = future?.nextReviewAt ?? null;
      }
      return { dueToday: dueToday.map(toEntryView), nextReviewAt };
    }),

  // === markReviewed ===
  markReviewed: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
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

  // === archive ===
  archive: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const target = input.archived ? "ARCHIVED" : "ACTIVE";
      if (ctx.entry.status === target) {
        return { entry: toEntryView(ctx.entry) };  // idempotent
      }
      const updated = await ctx.db.errorBookEntry.update({
        where: { id: ctx.entry.id },
        data: {
          status: target,
          nextReviewAt: target === "ARCHIVED" ? null : new Date(Date.now() + DAY_MS),
        },
      });
      return { entry: toEntryView(updated) };
    }),

  // === delete ===
  delete: authedProcedure
    .use(validateEntryOwnership)
    .input(z.object({ entryId: z.string().cuid() }))
    .mutation(async ({ ctx }) => {
      await ctx.db.errorBookEntry.update({
        where: { id: ctx.entry.id },
        data: { status: "DELETED", nextReviewAt: null },
      });
      return { ok: true };
    }),
});
```

- [ ] **步骤 4.3：挂载到 `_root.ts`**

打开 `apps/web/server/routers/_root.ts`，import errorRouter 并加到 appRouter：

```ts
import { errorRouter } from "./error.js";
// ...
export const appRouter = router({
  // ... 既有路由 ...
  error: errorRouter,
});
```

跑 typecheck：

```powershell
pnpm.cmd --filter @zhijiao/web typecheck
```

期望全绿。

- [ ] **步骤 4.4：建 `tests/integration/error-diagnose.test.ts`**

测试覆盖（spec §7.2 ErrorAnalysis 相关）：
1. **happy path**：扣 1 credit + 创建 ACTIVE entry + 返 `entryId`（UI 反馈 A）+ ledger 写 DEBIT + ModelCall SUCCESS
2. **已有 ACTIVE entry 重新 diagnose**：复用 entry（不新建行）+ 扣 1 credit + rootCause 更新
3. **已有 ARCHIVED entry 重新 diagnose**：拉回 ACTIVE + nextReviewAt 重设 now+1d
4. **已有 DELETED entry 再 diagnose 同题**：创建新 entry（与 DELETED 行共存；partial unique 不阻止）
5. **并发 race**：两个 `Promise.all` 调 diagnose 同 (user, question) → 一条 P2002 → 走 update path；最终 entry 只 1 条 ACTIVE，扣 2 credits（两次 AI 服务都已交付）
6. **`ComplianceRejectedError` 不补偿**：ledger 留 DEBIT + metadata.compensationStatus="not_compensated_whitelisted"
7. **AI 内部错（非合规）默认补偿**：ledger 增一条 COMPENSATION (+1)；balance 回到 baseline
8. **缺 `clientRequestId`**：BAD_REQUEST / CLIENT_REQUEST_ID_REQUIRED；不扣费

**实现要求（硬性）**：上面 8 条覆盖项每条必须落成一个完整 `it("...", async () => { ... })` 块，含 arrange / act / assert 全部代码。**禁止** `it.todo(...)` 占位、**禁止**空 body、**禁止**只写注释的"伪 assert"。fixture / prisma / appRouter caller 沿用既有 `charged-procedure-tutor.test.ts` / `wallet-topup-create.test.ts` 工艺。Vitest 把 `it.todo` 当作 todo 不失败 → 这会让步骤 4.11 假绿，与本 plan Task 3 的零回归证明定义冲突。

`happy path` 用例的 assert 至少要含：返 `{ entryId, rootCause, rootCauseReasoning, suggestedKnowledgePoints, nextActions }` 的形状 / `entryId is truthy` / `prisma.errorBookEntry.findUnique(entryId).status === "ACTIVE"` / `wallet.balance === 99` / `creditLedger` 有一行 DEBIT 且 `idemKey === "debit:error_analysis:<userId>:<cri>"` / `modelCall` 有一行 ERROR_ANALYSIS SUCCESS。其它 7 条覆盖项类似展开（具体形状参考"测试覆盖"清单）。

跑：

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/error-diagnose.test.ts
```

期望全绿，且 `Tests` 行**不**含 `todo` 计数（应为 `passed`，无 `(N todo)`）。

- [ ] **步骤 4.5：建 `tests/integration/error-list.test.ts`（含 ARCHIVED 默认不可见）**

测试覆盖：
1. **默认 list（不传 status）**：只返 ACTIVE entry；ARCHIVED 不出现；DELETED 不出现
2. **status="ARCHIVED"**：只返 ARCHIVED entry；ACTIVE 不出现
3. **status="ACTIVE"**：等同默认
4. **status="DELETED"** zod parse 失败 → BAD_REQUEST
5. **cursor pagination**：limit=2 + 3 个 entry → 第一页返 2 + nextCursor；第二页返 1 + nextCursor=null
6. **跨用户隔离**：A 的 entry 不进 B 的 list

**实现要求**：上面 6 条覆盖项每条写完整 `it()`，不留 `it.todo`。`describe("error.list", ...)` 内只允许有真实带 assert 的测试用例。

跑：

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/error-list.test.ts
```

- [ ] **步骤 4.6：建 `tests/integration/error-get-by-id.test.ts`（含 DELETED NOT_FOUND）**

测试覆盖：
1. **happy path**：返 entry + question + variantGroups（如有）
2. **不存在 entryId（合法 cuid 但库无此行）**：NOT_FOUND / ENTRY_NOT_FOUND；不返 entry shape
3. **跨用户 entry**：NOT_FOUND / ENTRY_NOT_FOUND（**不**返 FORBIDDEN）
4. **DELETED entry**：NOT_FOUND / ENTRY_NOT_FOUND
5. **malformed entryId**：BAD_REQUEST / ENTRY_ID_REQUIRED（zod cuid 校验）

**实现要求**：上面 5 条覆盖项每条写完整 `it()`，不留 `it.todo`。注意：跨用户与 DELETED 都断言返 `NOT_FOUND` + `cause.reason === "ENTRY_NOT_FOUND"`（**不是** FORBIDDEN —— 这是防存在性泄露的核心断言，必须真实执行）。

- [ ] **步骤 4.7：建 `tests/integration/error-due-for-review.test.ts`（含 nextReviewAt 三形态）**

测试覆盖（spec §5.1.4 + UI 反馈 B）：
1. **dueToday 非空**：返 `dueToday.length > 0`；`nextReviewAt === null`
2. **dueToday 空 + 有 future ACTIVE**：返 `dueToday=[]`；`nextReviewAt === <future entry's nextReviewAt>`
3. **dueToday 空 + 无 future**：返 `dueToday=[]`；`nextReviewAt === null`
4. **ARCHIVED entry 不进队列**：纵使 nextReviewAt <= now，也不返
5. **DELETED entry 不进队列**

**实现要求**：上面 5 条覆盖项每条写完整 `it()`，不留 `it.todo`。前 3 条覆盖 `nextReviewAt` 的三种形态（UI 反馈 B 落地点）—— 前端依赖此返回值的精确语义，每条都必须真实断言而非占位。

- [ ] **步骤 4.8：建 `tests/integration/error-mark-reviewed.test.ts`（间隔算法 5 段 + cap）**

测试覆盖（spec §6.3）：
1. **首次 markReviewed**：reviewCount 0→1；nextReviewAt = now + 1d
2. **第 2 次**：reviewCount 1→2；nextReviewAt = now + 3d
3. **第 3 次**：→ +7d
4. **第 4 次**：→ +14d
5. **第 5 次**：→ +30d
6. **第 10 次（已超 cap）**：→ +30d
7. **ARCHIVED entry**：PRECONDITION_FAILED / ENTRY_NOT_ACTIVE；不更新
8. **DELETED entry**：NOT_FOUND / ENTRY_NOT_FOUND（validateEntryOwnership 挡）
9. **跨用户 entry**：NOT_FOUND / ENTRY_NOT_FOUND

**实现要求**：上面 9 条覆盖项每条写完整 `it()`，不留 `it.todo`。间隔算法 5 段 + cap 是产品契约，每段（1d / 3d / 7d / 14d / 30d）都要有独立 assert。可用 vitest 的 `vi.useFakeTimers()` 精确控制 now，避免因 `Date.now()` 漂移产生 flake。

- [ ] **步骤 4.9：建 `tests/integration/error-archive.test.ts`**

测试覆盖：
1. **ACTIVE → ARCHIVED**：status 变 ARCHIVED；nextReviewAt 变 null
2. **ARCHIVED → ACTIVE（archived: false）**：status 变 ACTIVE；nextReviewAt 重设 now+1d
3. **idempotent**：连续两次 archive(true) 不改 updatedAt（用 short-circuit on same status）
4. **DELETED entry**：NOT_FOUND（validateEntryOwnership 挡）

**实现要求**：上面 4 条覆盖项每条写完整 `it()`，不留 `it.todo`。idempotent 断言要真验证 `updatedAt` 不变（不只是 status 不变）。

- [ ] **步骤 4.10：建 `tests/integration/error-delete.test.ts`（DELETED 终态全套）**

测试覆盖（**Blocker 2 核心**）：
1. **delete ACTIVE entry**：status 变 DELETED；nextReviewAt null；返 `{ ok: true }`
2. **删后再 list（默认）**：列表不含此 entry
3. **删后再 list({ status: "ACTIVE" })**：不含
4. **删后再 list({ status: "ARCHIVED" })**：不含
5. **删后再 list({ status: "DELETED" })**：zod 拒绝 → BAD_REQUEST
6. **删后再 getById**：NOT_FOUND / ENTRY_NOT_FOUND
7. **删后再 dueForReview**：不在 dueToday；不在 nextReviewAt 指向的 future entry
8. **删后再 markReviewed**：NOT_FOUND
9. **删后再 archive**：NOT_FOUND
10. **删后再 delete**：NOT_FOUND（validateEntryOwnership 已挡，到不了 update 逻辑）
11. **删后再 diagnose 同题**：创建新 ACTIVE entry；与 DELETED 共存；返新 entryId（**不**复活）

**实现要求（Blocker 2 核心 —— 硬卡点）**：上面 11 条覆盖项每条写完整 `it()`，**绝不**留 `it.todo`。这一组测例承担了"DELETED 终态对所有 student-facing 入口不可见"的全部断言；任何一条 todo 化都会让 Blocker 2 的回归网形同虚设。`describe("error.delete ...", ...)` 块跑完后 `Tests` 行必须是 `11 passed`（**无** todo 计数）。

- [ ] **步骤 4.11：跑全部 error 测试**

显式列出 7 个文件跑，避免 vitest CLI 把 `tests/integration/error-` 当作不完整路径报错，也避免 PowerShell 通配符展开行为差异：

```powershell
pnpm.cmd --filter @zhijiao/web test -- `
  tests/integration/error-diagnose.test.ts `
  tests/integration/error-list.test.ts `
  tests/integration/error-get-by-id.test.ts `
  tests/integration/error-due-for-review.test.ts `
  tests/integration/error-mark-reviewed.test.ts `
  tests/integration/error-archive.test.ts `
  tests/integration/error-delete.test.ts
```

> 如果想用 vitest 自身的 glob 支持（不依赖 shell 通配），可改为：
> ```powershell
> pnpm.cmd --filter @zhijiao/web test -- --dir tests/integration --testNamePattern "error\\."
> ```
> 或单独 `pnpm.cmd --filter @zhijiao/web exec vitest run "tests/integration/error-*.test.ts"`（vitest 自己解析 glob，不让 shell 展开）。

期望全部 7 个文件绿。

- [ ] **步骤 4.12：commit 前 guardrail —— `it.todo` 必须 0 命中**

```powershell
Select-String -Path apps/web/tests/integration -Pattern "it\.todo" -Recurse
```

**期望：完全无输出（0 命中）**。如果有任何命中 → 回去把那些 `it.todo(...)` 改成真实带 arrange/act/assert 的 `it(...)`。不许在 Task 4 commit 含 `it.todo` 的测试文件 —— Vitest 把 todo 当成 "todo 不失败"，会让步骤 4.11 的"全绿"变成假绿，等同于把 Task 4 的所有覆盖项跳过。

如果新加的测试文件不在 `apps/web/tests/integration` 而在其它子目录，把 grep 路径调到对应位置。

跑一次最终 vitest 验证 `passed` / `todo` 数（额外保险）：

```powershell
pnpm.cmd --filter @zhijiao/web test -- `
  tests/integration/error-diagnose.test.ts `
  tests/integration/error-list.test.ts `
  tests/integration/error-get-by-id.test.ts `
  tests/integration/error-due-for-review.test.ts `
  tests/integration/error-mark-reviewed.test.ts `
  tests/integration/error-archive.test.ts `
  tests/integration/error-delete.test.ts 2>&1 | Select-String "Tests"
```

输出行必须形如 `Tests  N passed (N)`，**不**含 `(M todo)` 段。

- [ ] **步骤 4.13：commit**

```powershell
git add apps/web/server/lib/error-book.ts apps/web/server/routers/error.ts apps/web/server/routers/_root.ts apps/web/tests/integration/error-*.test.ts
git commit -m "feat(web): Plan 4 Task 4 — error router 7 procedures + DELETED/ARCHIVED/nextReviewAt tests"
```

---

## Task 5：`variant` router + `generateForEntry` + **Blocker 1 显式验收测例**

> **为什么先做（在 Task 4 之后）**：variant.generateForEntry 依赖 ErrorBookEntry 存在；Task 4 完成后才能写 fixture。本 task 把 **Blocker 1 的三个验收测例（spec §7.2）做成明确测试步骤**，是本 plan 的硬卡点 —— 不通过不许 commit。

**Files：**
- Modify: `apps/web/server/lib/error-book.ts`（加 `toVariantGroupView` helper）
- Modify: `apps/web/server/routers/error.ts`（`getById` 用上 `toVariantGroupView`）
- Create: `apps/web/server/routers/variant.ts`
- Modify: `apps/web/server/routers/_root.ts`（挂 variant 路由）
- Create: `apps/web/tests/integration/variant-generate-for-entry.test.ts`
- Optional: `apps/web/tests/integration/charge-middleware-direct.test.ts`（步骤 5.7 决定是否建；只写真实断言，不留 todo）

- [ ] **步骤 5.1：加 `toVariantGroupView` 到 `error-book.ts`**

```ts
import type { VariantGroup, VariantItem } from "@prisma/client";

export function toVariantGroupView(g: VariantGroup & { items: VariantItem[] }) {
  return {
    id: g.id,
    entryId: g.entryId,
    creditsCost: g.creditsCost,
    createdAt: g.createdAt,
    items: g.items.map(it => ({
      id: it.id,
      level: it.level,
      position: it.position,
      stemMd: it.stemMd,
      solutionMd: it.solutionMd,
      knowledgePointHints: it.knowledgePointHints,
    })),
  };
}
```

回 `error.ts` 的 `getById`，把 `variantGroups,` 改成 `variantGroups: variantGroups.map(toVariantGroupView),`。

- [ ] **步骤 5.2：建 `apps/web/server/routers/variant.ts`**

```ts
import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  authedProcedure,
  chargeMiddleware,
  validateEntryOwnership,
  router,
} from "../trpc.js";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { getAiRouter } from "@/lib/ai-client";
import { toVariantGroupView } from "../lib/error-book.js";

export const variantRouter = router({
  // spec §4.2 / §5.2
  // Middleware 链顺序硬性约束（Blocker 1）：
  //   authedProcedure (auth) → validateEntryOwnership (entry 校验) → chargeMiddleware (扣 3 credits)
  // entry 不存在 / 跨用户 / 已删 → 抛 NOT_FOUND，**不进 chargeMiddleware**，DEBIT 不写。
  generateForEntry: authedProcedure
    .use(validateEntryOwnership)
    .use(chargeMiddleware("VARIANT_GROUP_GEN"))
    .input(z.object({
      entryId: z.string().cuid(),
      clientRequestId: z.string().uuid(),
    }))
    .mutation(async ({ ctx }) => {
      // ctx.entry 由 validateEntryOwnership 注入；ctx.debit 由 chargeMiddleware 注入
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

- [ ] **步骤 5.3：挂载到 `_root.ts`**

```ts
import { variantRouter } from "./variant.js";

export const appRouter = router({
  // ...
  error: errorRouter,
  variant: variantRouter,
});
```

跑 typecheck：

```powershell
pnpm.cmd --filter @zhijiao/web typecheck
```

- [ ] **步骤 5.4：建 `tests/integration/variant-generate-for-entry.test.ts`** —— **Blocker 1 验收测例为命名测试**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
// fixture 沿用 既有 integration test 工艺

describe("variant.generateForEntry", () => {
  describe("Blocker 1: entry 校验必须在扣费之前", () => {
    // 这两条测例是 spec §7.2 Blocker 1 的"硬性验收测例"。
    // 不通过 = entry 校验顺序错（chargeMiddleware 在 validateEntryOwnership 之前）= 不许 commit。

    it("ghost entryId (valid cuid, not in DB): NOT_FOUND + no DEBIT ledger row + balance unchanged", async () => {
      // arrange:
      //   const user = await fixtures.userWithBalance(100);
      //   const ghostEntryId = "clghost000000000000000000";  // 25 chars; passes z.string().cuid(); not in DB
      //   const entryCheck = await prisma.errorBookEntry.findUnique({ where: { id: ghostEntryId } });
      //   expect(entryCheck).toBeNull();
      //
      // act:
      //   const err = await caller(user).variant.generateForEntry({
      //     entryId: ghostEntryId, clientRequestId: crypto.randomUUID(),
      //   }).catch(e => e);
      //
      // assert (Blocker 1 核心断言):
      //   expect(err).toBeInstanceOf(TRPCError);
      //   expect(err.code).toBe("NOT_FOUND");
      //   expect(err.cause?.reason).toBe("ENTRY_NOT_FOUND");
      //
      //   const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      //   expect(wallet.balance).toBe(100);   // 未扣
      //
      //   const debitRows = await prisma.creditLedger.findMany({
      //     where: { walletId: wallet.id, kind: "DEBIT" },
      //   });
      //   expect(debitRows).toHaveLength(0);  // 关键：DEBIT ledger 不写
    });

    it("cross-user entryId: NOT_FOUND (not FORBIDDEN) + no DEBIT ledger row + balance unchanged", async () => {
      // arrange:
      //   const userA = await fixtures.userWithBalance(100);
      //   const userB = await fixtures.userWithBalance(0);
      //   const entryOfB = await fixtures.errorBookEntry({ userId: userB.id });
      //
      // act:
      //   const err = await caller(userA).variant.generateForEntry({
      //     entryId: entryOfB.id, clientRequestId: crypto.randomUUID(),
      //   }).catch(e => e);
      //
      // assert:
      //   expect(err.code).toBe("NOT_FOUND");         // 不是 "FORBIDDEN"
      //   expect(err.cause?.reason).toBe("ENTRY_NOT_FOUND");
      //
      //   const walletA = await prisma.wallet.findUnique({ where: { userId: userA.id } });
      //   expect(walletA.balance).toBe(100);
      //
      //   const debitRows = await prisma.creditLedger.findMany({
      //     where: { walletId: walletA.id, kind: "DEBIT" },
      //   });
      //   expect(debitRows).toHaveLength(0);
    });

    it("malformed entryId: BAD_REQUEST + no DEBIT ledger row + balance unchanged", async () => {
      // 双闸的第 2 闸（zod 闸）：
      // arrange:
      //   const user = await fixtures.userWithBalance(100);
      // act:
      //   const err = await caller(user).variant.generateForEntry({
      //     entryId: "not-a-cuid", clientRequestId: crypto.randomUUID(),
      //   }).catch(e => e);
      // assert:
      //   expect(err.code).toBe("BAD_REQUEST");
      //   expect(err.cause?.reason).toBe("ENTRY_ID_REQUIRED");
      //
      //   const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      //   expect(wallet.balance).toBe(100);
      //
      //   const debitRows = await prisma.creditLedger.findMany({
      //     where: { walletId: wallet.id, kind: "DEBIT" },
      //   });
      //   expect(debitRows).toHaveLength(0);
    });

    it("DELETED entryId: NOT_FOUND + no DEBIT ledger row + balance unchanged", async () => {
      // arrange:
      //   const user = await fixtures.userWithBalance(100);
      //   const entry = await fixtures.errorBookEntry({ userId: user.id, status: "DELETED" });
      // act:
      //   const err = await caller(user).variant.generateForEntry({
      //     entryId: entry.id, clientRequestId: crypto.randomUUID(),
      //   }).catch(e => e);
      // assert:
      //   expect(err.code).toBe("NOT_FOUND");
      //   expect(err.cause?.reason).toBe("ENTRY_NOT_FOUND");
      //   // ledger / balance 断言同上
    });
  });

  // 以下 4 个 describe 块的覆盖项**全部**要写成完整 it() 块（含 arrange/act/assert），
  // **不**用 it.todo。具体覆盖项见下面"必须实现的测试清单"。
});
```

**必须实现的测试清单（步骤 5.4 内 4 个 describe 块的全部 `it()` 用例 —— 实现者写完整代码，不留 todo）**：

`describe("happy path & business", ...)`:
1. ACTIVE entry + 100 credits: 扣 3 → 余额 97；建 VariantGroup（creditsCost=3）+ 3 VariantItem（level 各为 L1/L2/L3）
2. ARCHIVED entry 也允许：扣 3 + 生成成功；entry.status 保持 ARCHIVED（不被 variant 生成动作改回 ACTIVE）
3. 返 `{ group: { id, items: [L1, L2, L3] } }` 且 items 按 `position` 升序（1, 2, 3）
4. `VariantGroup.debitLedgerId === <DEBIT ledger row id>`（断言 ctx.debit 注入到了 mutation body）
5. `prisma.modelCall` 新增一行 `taskKind="VARIANT_GROUP_GEN"` + `status="SUCCESS"`

`describe("compensation", ...)`:
6. AI 内部错（非合规，如 adapter throw）：ledger 新增一条 COMPENSATION (+3)；最终 wallet.balance === 100（回到 baseline）；**不**写 VariantGroup
7. `ComplianceRejectedError`：ledger 留 DEBIT；metadata.compensationStatus = "not_compensated_whitelisted"；errorClass = "ComplianceRejectedError"；**不**写 VariantGroup；balance === 97（扣点保留）

`describe("idempotency", ...)`:
8. 同 `clientRequestId` 第二次 mutate：返 CONFLICT / ACTION_IDEMPOTENCY_HIT；**不**新增 VariantGroup；**不**二次扣费（balance 仍为第一次后的值）
9. 缺 `clientRequestId`：BAD_REQUEST / CLIENT_REQUEST_ID_REQUIRED；**不**扣费

`describe("middleware chain order assertion", ...)`:
10. 同时缺 `entryId` AND `clientRequestId`：抛 `ENTRY_ID_REQUIRED`（**不是** `CLIENT_REQUEST_ID_REQUIRED`）。这一条是 middleware 链顺序的直接证据（`validateEntryOwnership` 在 `chargeMiddleware` 之前 → entryId 错先抛）。

`describe("Blocker 1: entry 校验必须在扣费之前", ...)` 的 4 条已在步骤 5.4 中以"arrange/act/assert 注释"形式列出 —— 实现者把那些注释**替换成真实代码**，不留注释占位（注释占位的 `it()` 不会 fail，但等同于空 body 假绿，与 it.todo 同款风险）。

- [ ] **步骤 5.5：跑 Blocker 1 测试组**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-generate-for-entry.test.ts -t "Blocker 1"
```

期望：四个测试全绿（ghost / cross-user / malformed / DELETED）。

> **硬卡点**：这一组测试任何一个失败 = entry 校验顺序错 = 不许进步骤 5.6。回 trpc.ts 检查 middleware 链顺序、回 validateEntryOwnership 实现检查三种失败分支。

- [ ] **步骤 5.6：跑全部 variant 测试**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-generate-for-entry.test.ts
```

期望全绿。

- [ ] **步骤 5.7：（可选）为 chargeMiddleware 单独写直测**

现在有了第二种链法（`authedProcedure.use(validateEntryOwnership).use(chargeMiddleware("VARIANT_GROUP_GEN"))`，与 Plan 3 的 `chargedProcedure("TUTOR_ASK")` 糖语法形成对比），如果实现者认为有必要给 chargeMiddleware 单独写直测（脱离 tutor / variant 业务）作回归网，可在本 step 建 `apps/web/tests/integration/charge-middleware-direct.test.ts`，覆盖：

- chargedProcedure(kind) 与 authedProcedure.use(chargeMiddleware(kind)) 行为一致（同样的 idemKey / 扣费量 / debit row metadata）
- chargeMiddleware 注入的 `ctx.debit.ledgerId` 在 mutation body 可见（variant.generateForEntry 成功后 `VariantGroup.debitLedgerId === DEBIT ledger row id` 已经是直接证据，可在此引用）
- ComplianceRejectedError 不补偿 + metadata.compensationStatus / 其它错默认补偿（这两点已被 Task 4 步骤 4.4 `error-diagnose.test.ts` 与 既有 `charged-procedure-compensation.test.ts` 覆盖；如不冗余即可跳过）

**只写真实有断言的测试，不留 `it.todo` 占位**。如全都已被上游测试覆盖，本 step 跳过、不建文件。

跑（如建了）：

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charge-middleware-direct.test.ts
```

- [ ] **步骤 5.8：commit 前 guardrail —— `it.todo` 必须 0 命中 + 步骤 5.4 注释占位也必须 0**

```powershell
Select-String -Path apps/web/tests/integration -Pattern "it\.todo" -Recurse
```

**期望：0 命中**。如有命中 → 把它改成真实 `it()` 后再 commit。

另外针对步骤 5.4 中 "Blocker 1" 4 条用例（在文档里以 `// arrange:` / `// act:` / `// assert:` 注释形式列出），手工再检查一次：

```powershell
Select-String -Path apps/web/tests/integration/variant-generate-for-entry.test.ts -Pattern "^\s*//\s*(arrange|act|assert):" -Context 0,0
```

每条注释行的下文必须有真实代码（不是空白 + `});`），否则 `it()` body 为空 → vitest 视为 passed → 假绿。最稳的判断标准是看最终 vitest 输出的 `Tests` 行：

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/variant-generate-for-entry.test.ts 2>&1 | Select-String "Tests"
```

输出 `Tests  14 passed (14)` （或与"必须实现的测试清单"匹配的 `it()` 总数；4 条 Blocker 1 + 5 happy/business + 2 compensation + 2 idempotency + 1 chain-order = 14）。**不**含 `(N todo)`、**不**含 `skipped`。

- [ ] **步骤 5.9：commit**

```powershell
# 注：charge-middleware-direct.test.ts 是步骤 5.7 可选产物；如未建则 git add 时省略
git add apps/web/server/lib/error-book.ts apps/web/server/routers/variant.ts apps/web/server/routers/error.ts apps/web/server/routers/_root.ts apps/web/tests/integration/variant-generate-for-entry.test.ts
git commit -m "feat(web): Plan 4 Task 5 — variant.generateForEntry + Blocker 1 acceptance tests (ghost/cross-user/malformed/DELETED → no DEBIT)"
```

---

## Task 6：UI（最小化）—— 错题本列表 / 详情 / 复习 / ErrorAnalysisCard 改造

> **为什么先做**：API 全绿后做 UI，避免反复改 schema 时 UI 同步改造的开销。最小可用 surface 4 个页面 + 1 个组件改造。

**Files：**
- Create: `apps/web/app/(student)/error-book/page.tsx`（列表页：ACTIVE / ARCHIVED tab）
- Create: `apps/web/app/(student)/error-book/[entryId]/page.tsx`（详情页：题目 + 错因 + 变式 + 操作）
- Create: `apps/web/app/(student)/error-book/review/page.tsx`（复习页：dueToday + 空状态 +Xd）
- Create: `apps/web/app/(student)/error-book/entry-actions.tsx`（client component：markReviewed / archive / delete / 生成变式 按钮）
- Modify: `apps/web/app/(student)/tutor/error-analysis-card.tsx`（或新建）：调 diagnose 后渲染 entryId 链接

- [ ] **步骤 6.1：建 `error-book/page.tsx`（列表页 + ACTIVE/ARCHIVED tab）**

server component；用 `serverApi` / `trpcServer`（看现有 app 工艺）：

```tsx
import { trpcServer } from "@/lib/trpc-server";
import Link from "next/link";

export default async function ErrorBookPage({
  searchParams,
}: {
  searchParams: { tab?: "active" | "archived" };
}) {
  const status = searchParams.tab === "archived" ? "ARCHIVED" : "ACTIVE";
  const { entries } = await trpcServer.error.list.query({ status, limit: 50 });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">错题本</h1>
      <div className="flex gap-4 mt-4 border-b">
        <Link
          href="/error-book?tab=active"
          className={status === "ACTIVE" ? "border-b-2 border-black pb-2" : "pb-2 text-gray-500"}
        >
          错题
        </Link>
        <Link
          href="/error-book?tab=archived"
          className={status === "ARCHIVED" ? "border-b-2 border-black pb-2" : "pb-2 text-gray-500"}
        >
          归档
        </Link>
        <Link href="/error-book/review" className="ml-auto text-blue-600 underline">
          去复习
        </Link>
      </div>
      <ul className="mt-4 space-y-2">
        {entries.length === 0 && (
          <li className="text-gray-500">
            {status === "ACTIVE"
              ? "还没有错题。下次答题答错后可以从答疑卡片加入错题本。"
              : "归档区是空的。"}
          </li>
        )}
        {entries.map(e => (
          <li key={e.id} className="border rounded p-3 hover:bg-gray-50">
            <Link href={`/error-book/${e.id}`} className="block">
              <div className="font-medium">{truncate(e.question?.stemMd ?? "", 80)}</div>
              <div className="text-xs text-gray-500 mt-1">
                错因：{rootCauseLabel(e.rootCause)} · 已复习 {e.reviewCount} 次
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function rootCauseLabel(c: string): string {
  return ({
    CONCEPT_CONFUSION: "概念混淆",
    READING_ERROR: "读题失误",
    FORMULA_MISUSE: "公式误用",
    CALCULATION_SLIP: "计算疏漏",
    TRANSFER_GAP: "迁移不足",
    OTHER: "其它",
  } as const)[c] ?? c;
}
```

- [ ] **步骤 6.2：建 `error-book/[entryId]/page.tsx`（详情页）**

```tsx
import { trpcServer } from "@/lib/trpc-server";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { EntryActions } from "../entry-actions";

export default async function EntryDetailPage({ params }: { params: { entryId: string } }) {
  let data;
  try {
    data = await trpcServer.error.getById.query({ entryId: params.entryId });
  } catch (e) {
    // NOT_FOUND → 404 页（DELETED entry 也走这里，因 validateEntryOwnership 已挡）
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { entry, question, variantGroups } = data;

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold">错题详情</h1>
      <section className="mt-4 border rounded p-4">
        <h2 className="font-semibold">题目</h2>
        <div className="mt-2 whitespace-pre-wrap">{question.stemMd}</div>
      </section>
      <section className="mt-4 border rounded p-4 bg-amber-50">
        <h2 className="font-semibold">错因分析</h2>
        <div className="mt-2">
          <span className="font-medium">分类：</span>
          {rootCauseLabel(entry.rootCause)}
        </div>
        <div className="mt-2 whitespace-pre-wrap text-sm">{entry.rootCauseReasoning}</div>
      </section>
      <section className="mt-4">
        <EntryActions entryId={entry.id} status={entry.status} />
      </section>
      <section className="mt-4">
        <h2 className="font-semibold">举一反三（{variantGroups.length} 组）</h2>
        {variantGroups.length === 0 && (
          <div className="text-sm text-gray-500 mt-2">
            还没生成过变式。点上方"生成变式"按钮试试（消耗 3 credits）。
          </div>
        )}
        {variantGroups.map(g => (
          <div key={g.id} className="mt-3 border rounded p-3">
            <div className="text-xs text-gray-500">
              生成于 {new Date(g.createdAt).toLocaleString()} · 消耗 {g.creditsCost} credits
            </div>
            {g.items.map(it => (
              <details key={it.id} className="mt-2">
                <summary className="cursor-pointer font-medium">
                  {it.level} · {truncate(it.stemMd, 60)}
                </summary>
                <div className="mt-2 ml-4 text-sm whitespace-pre-wrap">{it.stemMd}</div>
                <details className="mt-2 ml-4">
                  <summary className="cursor-pointer text-sm text-blue-600">查看解析</summary>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{it.solutionMd}</div>
                </details>
              </details>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **步骤 6.3：建 `error-book/entry-actions.tsx`（client component：操作按钮）**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

export function EntryActions({ entryId, status }: { entryId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const variantMutation = trpc.variant.generateForEntry.useMutation();
  const markMutation = trpc.error.markReviewed.useMutation();
  const archiveMutation = trpc.error.archive.useMutation();
  const deleteMutation = trpc.error.delete.useMutation();

  const onGenerateVariant = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await variantMutation.mutateAsync({
        entryId,
        clientRequestId: crypto.randomUUID(),
      });
      router.refresh();
    } catch (e: any) {
      alert(e.message ?? "生成失败");
    } finally {
      setBusy(false);
    }
  };

  const onMarkReviewed = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markMutation.mutateAsync({ entryId });
      router.refresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onArchive = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await archiveMutation.mutateAsync({ entryId, archived: status === "ACTIVE" });
      router.refresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (busy) return;
    if (!confirm("从错题本移除这道题？")) return;  // 文案"移除"不"删除"
    setBusy(true);
    try {
      await deleteMutation.mutateAsync({ entryId });
      router.push("/error-book");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2">
      <button onClick={onGenerateVariant} disabled={busy} className="px-3 py-2 bg-blue-600 text-white rounded">
        生成变式（举一反三）
      </button>
      {status === "ACTIVE" && (
        <button onClick={onMarkReviewed} disabled={busy} className="px-3 py-2 border rounded">
          标记已复习
        </button>
      )}
      <button onClick={onArchive} disabled={busy} className="px-3 py-2 border rounded">
        {status === "ACTIVE" ? "归档" : "取消归档"}
      </button>
      <button onClick={onDelete} disabled={busy} className="px-3 py-2 border rounded text-red-600">
        从错题本移除
      </button>
    </div>
  );
}
```

> **文案规范**（spec §6.4）：删除按钮文案"从错题本移除"不"删除"；不出现"回收站"。

- [ ] **步骤 6.4：建 `error-book/review/page.tsx`（复习页 + nextReviewAt 空状态）**

```tsx
import { trpcServer } from "@/lib/trpc-server";
import Link from "next/link";

export default async function ReviewPage() {
  const { dueToday, nextReviewAt } = await trpcServer.error.dueForReview.query({ limit: 50 });

  if (dueToday.length === 0) {
    if (nextReviewAt !== null) {
      const daysToNext = Math.ceil(
        (new Date(nextReviewAt).getTime() - Date.now()) / 86_400_000,
      );
      return (
        <div className="p-6">
          <h1 className="text-2xl font-bold">复习</h1>
          <div className="mt-6 text-center text-gray-600">
            今天没有需要复习的错题。下次复习 +{daysToNext} 天后。
          </div>
          <div className="mt-4 text-center">
            <Link href="/error-book" className="text-blue-600 underline">
              回错题本
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">复习</h1>
        <div className="mt-6 text-center text-gray-600">
          错题本里还没有需要复习的题。
        </div>
        <div className="mt-4 text-center">
          <Link href="/error-book" className="text-blue-600 underline">
            回错题本
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">复习（{dueToday.length} 题待复习）</h1>
      <ul className="mt-4 space-y-2">
        {dueToday.map(e => (
          <li key={e.id} className="border rounded p-3 hover:bg-gray-50">
            <Link href={`/error-book/${e.id}`}>
              <div className="font-medium">{truncate(e.question?.stemMd ?? "", 80)}</div>
              <div className="text-xs text-gray-500 mt-1">
                已复习 {e.reviewCount} 次
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

> 关键约定（spec §5.1.4）：`dueToday.length > 0` → 渲染列表；空 + nextReviewAt ≠ null → "下次 +Xd"；空 + null → "还没有需要复习的题"。

- [ ] **步骤 6.5：改 `tutor/error-analysis-card.tsx`：接 entryId 链接**

找现有 ErrorAnalysisCard（或新建）。关键改动：

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function ErrorAnalysisCard({ questionId, actualAnswer }: { questionId: string; actualAnswer?: string }) {
  const [diagnosed, setDiagnosed] = useState<null | {
    entryId: string;          // ← UI 反馈 A：必返字段
    rootCause: string;
    rootCauseReasoning: string;
    suggestedKnowledgePoints: string[];
  }>(null);
  const diagnose = trpc.error.diagnose.useMutation();

  const onDiagnose = async () => {
    const r = await diagnose.mutateAsync({
      questionId,
      actualAnswerMd: actualAnswer,
      clientRequestId: crypto.randomUUID(),
    });
    setDiagnosed(r);
  };

  if (!diagnosed) {
    return (
      <button onClick={onDiagnose} disabled={diagnose.isPending} className="px-3 py-2 bg-amber-500 text-white rounded">
        {diagnose.isPending ? "分析中…" : "加入错题本并分析错因（1 credit）"}
      </button>
    );
  }

  return (
    <div className="border rounded p-4 bg-amber-50">
      <h3 className="font-semibold">错因分析</h3>
      <div className="mt-2 text-sm">
        <span className="font-medium">分类：</span>
        {rootCauseLabel(diagnosed.rootCause)}
      </div>
      <div className="mt-2 text-sm whitespace-pre-wrap">{diagnosed.rootCauseReasoning}</div>
      {/* UI 反馈 A 落地：entryId 链接 */}
      <Link href={`/error-book/${diagnosed.entryId}`} className="mt-3 inline-block text-blue-600 underline">
        查看错题详情 →
      </Link>
    </div>
  );
}
```

- [ ] **步骤 6.6：手测**

```powershell
pnpm.cmd --filter @zhijiao/web dev
```

浏览器打开 `http://localhost:3000`，登录测试用户（fixture 起始 100 credits），手测：

1. 走一遍 tutor 流程，做错一题 → ErrorAnalysisCard 出现 → 点"加入错题本并分析错因" → 期望出现"查看错题详情"链接（带 entryId）
2. 点链接 → `/error-book/<entryId>` 详情页 → 看到题面 + 错因 + 操作按钮
3. 点"生成变式" → 期望扣 3 credits → 详情页刷新出现 1 组 3 道变式（L1/L2/L3）
4. 点"标记已复习" → 期望 reviewCount +1
5. 点"归档" → 期望详情页按钮变"取消归档"；回 `/error-book`（默认 ACTIVE tab）不见此条；切到"归档"tab 见此条
6. 点"取消归档" → 回 ACTIVE
7. 点"从错题本移除" → 期望跳回 `/error-book`，列表不含；浏览 `/error-book/<entryId>` 直接 404
8. 走 `/error-book/review`：
   - 错题刚加入时 nextReviewAt = now+1d → dueToday 应该是空 + 显示"下次复习 +1 天后"
   - 手 SQL 把 nextReviewAt 改成过去时间 → 刷新页面应见此题
9. **专门验证 UI 反馈 B**：在 review 页空状态下分别构造三种 nextReviewAt 形态，肉眼确认文案分别是"下次复习 +Xd 后" / "错题本里还没有需要复习的题" / 正常列表

记录手测结果到 PR description 或 commit message。

- [ ] **步骤 6.7：commit**

```powershell
git add apps/web/app/
git commit -m "feat(web): Plan 4 Task 6 — error-book UI (list/detail/review) + ErrorAnalysisCard entryId link"
```

---

## Task 7：E2E

> **为什么先做**：API + UI 都通了，端到端验证整个产品闭环。

**Files：**
- Create: `apps/web/e2e/error-book-end-to-end.spec.ts`

- [ ] **步骤 7.1：建 `error-book-end-to-end.spec.ts`**

覆盖闭环：登录 → tutor.ask 答错 → diagnose（错因分析卡片，扣 1 credit）→ 跳详情 → generateVariants（扣 3 credits）→ 看 3 道变式 → markReviewed → 归档 → 取消归档 → 删除 → 列表与详情都看不到

```ts
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";

test("error book end-to-end happy path", async ({ page }) => {
  await loginAs(page, "student-with-100-credits");

  // 1. 走 tutor 流程，answer wrong
  await page.goto("/tutor");
  // ... fill in a math question + a wrong answer ...
  await page.click('button:has-text("提交")');

  // 2. ErrorAnalysisCard 出现 → 点 diagnose
  await page.click('button:has-text("加入错题本并分析错因")');
  await expect(page.locator('a:has-text("查看错题详情")')).toBeVisible({ timeout: 30_000 });

  // 3. 跳详情页
  await page.click('a:has-text("查看错题详情")');
  await expect(page).toHaveURL(/\/error-book\/[a-z0-9]+/);

  // 4. 生成变式（扣 3 credits）
  await page.click('button:has-text("生成变式")');
  await expect(page.locator('text=/L1/')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('text=/L2/')).toBeVisible();
  await expect(page.locator('text=/L3/')).toBeVisible();

  // 5. 标记已复习
  await page.click('button:has-text("标记已复习")');
  await expect(page.locator('text=/已复习 1 次/')).toBeVisible();

  // 6. 归档
  await page.click('button:has-text("归档")');
  await expect(page.locator('button:has-text("取消归档")')).toBeVisible();

  // 7. 回列表（默认 ACTIVE）看不到
  await page.goto("/error-book");
  // (assert list doesn't include this entry's stem)

  // 8. 切归档 tab 能看到
  await page.click('a:has-text("归档")');
  // (assert list includes this entry)

  // 9. 点进去 + 取消归档 + 删除
  // ...
  await page.click('button:has-text("从错题本移除")');
  await page.click('button:has-text("确定")');  // confirm dialog
  await expect(page).toHaveURL(/\/error-book$/);

  // 10. 详情页 404
  // (navigate directly to /error-book/<entryId>, expect 404)
});

test("review page empty state shows next review countdown", async ({ page }) => {
  // 构造一个 fixture：1 个 ACTIVE entry，nextReviewAt = now + 5d
  // 访问 /error-book/review → 期望见 "下次复习 +5 天后"
});

test("review page fully-empty state", async ({ page }) => {
  // 构造一个 fixture：0 ACTIVE entries
  // 访问 /error-book/review → 期望见 "错题本里还没有需要复习的题"
});
```

- [ ] **步骤 7.2：跑 E2E**

```powershell
pnpm.cmd --filter @zhijiao/web test:e2e -- error-book-end-to-end
```

期望全绿。**注意**：E2E **不要**与 typecheck / test 并发（会写 `.next` 冲突）。

- [ ] **步骤 7.3：commit**

```powershell
git add apps/web/e2e/error-book-end-to-end.spec.ts
git commit -m "test(web): Plan 4 Task 7 — E2E error book end-to-end + review page empty states"
```

---

## Task 8：全量回归 + CLAUDE.md 更新 + Merge 验收清单

> **为什么先做**：Task 0-7 都过了，最后一步是全量回归 + 文档更新。

**Files：**
- Modify: `CLAUDE.md`（开始实现时段落 / Merge 后必跑 / 下一步候选 Plan）

- [ ] **步骤 8.1：全量典型回归**

```powershell
# typecheck
pnpm.cmd exec turbo typecheck --force

# unit + integration（全包）
pnpm.cmd exec turbo test --force

# E2E（单独跑，不与上面并发）
pnpm.cmd --filter @zhijiao/web test:e2e
```

期望：全绿。

- [ ] **步骤 8.2：spec § 附录 C "Merge 后必跑" 6 条新增探针 13-18**

把 spec 附录 C 的 6 条探针（每条在 spec 都有命令）落到 CLAUDE.md 末尾 "Merge 后必跑" 章节：

```markdown
13. **chargeMiddleware 抽取后 tutor.ask 零行为变化**：
    `pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-tutor.test.ts`
    应全绿，证明 Plan 3 既有计费行为未被 refactor 破坏。

14. **DELETED entry 不可见**：手动 `error.delete` 后调 `error.list / getById / dueForReview / markReviewed / archive`：全部应返 NOT_FOUND 或不含此条。grep:
    `Select-String -Path apps/web/server/routers/error.ts -Pattern "status.*DELETED"`
    应只在 update set 处出现，不在 findMany/findUnique where 处出现。

15. **entry 校验在扣费前**：
    `Select-String -Path apps/web/server/routers/variant.ts -Pattern "chargeMiddleware.*VARIANT_GROUP_GEN" -Context 2,5`
    应在 `validateEntryOwnership` **之后**。

16. **partial unique index 已落 DB**：
    `docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d error_book_entries"`
    应见 `user_question_active_idx` partial unique index。

17. **error.diagnose 返回 entryId**：
    `Select-String -Path apps/web/server/routers/error.ts -Pattern "entryId:"`
    应在 diagnose 返回类型出现；UI ErrorAnalysisCard 应有 `<Link href={"/error-book/" + entryId}>`。

18. **error.dueForReview 在空状态返 nextReviewAt**：
    `pnpm.cmd --filter @zhijiao/web test -- tests/integration/error-due-for-review.test.ts`
    覆盖三种 nextReviewAt 形态（空 ACTIVE / 有 future / dueToday 非空）。
```

- [ ] **步骤 8.3：CLAUDE.md "## 开始实现时（已落地）" 段加 Plan 4 条目**

参照 Plan 3 在 CLAUDE.md 的写法，在 Plan 3 后追加：

```markdown
- **Plan 4**（举一反三 + 错因分析：ErrorBookEntry + VariantGroup + 三阶变式 + chargeMiddleware 抽取）—— 见 `docs/superpowers/plans/2026-05-23-variant-and-error-analysis.md`，spec 在 `docs/superpowers/specs/2026-05-23-variant-and-error-analysis-design.md`
```

`**鉴权现状**` 之后加 `**错题本/变式现状**`：

```markdown
**错题本/变式现状**：
- `ErrorBookEntry` 三态：ACTIVE / ARCHIVED / DELETED；DELETED 终态，不复活；UI 不暴露回收站；partial unique idx `(user_id, question_id) WHERE status IN ('ACTIVE', 'ARCHIVED')` 允许 DELETED 与新 ACTIVE 共存
- `error.list` 默认仅 ACTIVE；归档页传 `status: "ARCHIVED"`；zod 不接受 "DELETED"
- `chargeMiddleware(kind)` 抽出独立 factory；`chargedProcedure(kind) = authedProcedure.use(chargeMiddleware(kind))` 糖语法；Plan 3 调用点零 diff
- `validateEntryOwnership` 中间件：entry 不存在 / 跨用户 / 已删 → 合并 NOT_FOUND，避免存在性泄露；注入 `ctx.entry`（含 question + answer + KP）
- `variant.generateForEntry` middleware 链：`authedProcedure → validateEntryOwnership → chargeMiddleware("VARIANT_GROUP_GEN")` —— entry 校验在扣费前，失败不写 DEBIT ledger
- 间隔复习：5 段固定（1d/3d/7d/14d/30d cap）；markReviewed 推进；archive 退出复习队列；MVP 不上 SM-2
- AI: `ERROR_ANALYSIS`（1 credit）+ `VARIANT_GROUP_GEN`（3 credits，一次出 L1/L2/L3 三道）；JSON schema 强约束 rootCause / level；合规 ComplianceRejected 走白名单不补偿
```

- [ ] **步骤 8.4：CLAUDE.md "下一步候选 Plan" 移除 Plan 4 + 加 Plan 4 衍生候选**

```markdown
**下一步候选 Plan**（Plan 4 已落地）：
- Plan 5: 真接阿里云 SMS + 微信公众号（ICP 备案通过后；**且 Plan 2 Hardening 必须先 ship**；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
- Plan 6: PII 治理（用户注销 / 去标识化 / `WechatPayEvent.rawBody` 保留期 / `TopupOrder` 孤儿订单清理 / `ErrorBookEntry` 用户注销时去标识化）—— **Plan 3 prod ship prereq**
- Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 商户证书）—— **Plan 3 prod ship prereq**
- Plan 8: 知识点 reconciler（把 AI 输出的 KP hint 字符串映射到 `KnowledgePoint` id；Plan 4 输出的 `knowledgePointHints` 用 NLP 接 KP 树）
- Plan 9: 教师端"分层作业"基于错题本 entry 扩展（教师可查看班级聚合错题热度图、按错因分类布置分层作业）
- Plan 10: 学情画像 / 趋势报告（学生掌握度 + 薄弱点 + 趋势画像；家长简版报告）
```

- [ ] **步骤 8.5：最后一次全量回归（CLAUDE.md 改完不影响代码，但确认 markdown 没语法错）**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web test:e2e
```

- [ ] **步骤 8.6：commit + (用户 review 后) merge**

```powershell
git add CLAUDE.md
git commit -m "docs(claude): Plan 4 landed + Merge probes 13-18 + candidates updated"
```

回主仓 master 等待用户 review，然后按 [[zhijiao-merge-workflow]] 工艺 merge：

```powershell
# 主仓 master 上
git switch master
git merge --no-ff plan-4-variant-and-error -m "Merge plan-4-variant-and-error: Variant + Error Analysis (Plan 4)"
git worktree remove .claude/worktrees/plan-4-variant-and-error
git worktree prune
```

Merge 后跑 CLAUDE.md "Merge 后必跑" 12 + 6 条 = 18 条探针。

---

## 完成条件

- [ ] 所有 Task 0-8 步骤勾完
- [ ] `pnpm.cmd exec turbo typecheck --force` 全绿
- [ ] `pnpm.cmd exec turbo test --force` 全绿（每个 per-pkg test DB 隔离 OK）
- [ ] `pnpm.cmd --filter @zhijiao/web test:e2e` 全绿
- [ ] CLAUDE.md "## 开始实现时（已落地）" 加 Plan 4 条目 + "Merge 后必跑" 加 6 条新探针
- [ ] **Blocker 1 四测例全绿**（ghost / cross-user / malformed / DELETED → no DEBIT）
- [ ] **Task 3 零回归证明**（charged-procedure-tutor / charged-procedure-idempotency / charged-procedure-compensation / wallet-topup-create / wechat-pay-notify-happy / E2E tutor-with-credit 全绿）
- [ ] **`Select-String apps/web/tests/integration -Pattern "it\.todo" -Recurse` 0 命中**（步骤 4.12 / 5.8 guardrail；Vitest todo 假绿防御）
- [ ] **Prisma migration checksum 一致**：`prisma migrate status` 输出 `Database schema is up to date!`，无 "modified after being applied" 警告（步骤 1.9）
- [ ] 手测 6.6 步骤的 9 个 UI flow 全部肉眼通过
- [ ] PR / Merge commit message 引用 spec 路径

---

## 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| Task 3 refactor 破坏 Plan 3 行为 | 步骤 3.5 任一测试失败 | 立即停；**先**跑 `git status --short` 确认工作区干净 + `git log --oneline -1` 确认 HEAD 是本 task 提交且只含 trpc.ts 改动；之后由人工决定回退方式（首选 `git revert --no-edit HEAD` 留可追溯记录；只在确认 HEAD 仅含本 task 改动、worktree 没有同时存在的其它未提交工作时才考虑 `git reset --hard HEAD~1`）。**不许**作为自动指令直接 `reset --hard`，会丢同 worktree 里其它未提交改动。回去检查 `chargeMiddleware` 抽取的 ctx spread / next 注入 / 不补偿分支逻辑 |
| Blocker 1 四测例任一失败 | 步骤 5.5 红 | 立即停；不许进步骤 5.6；回去检查 middleware 链顺序（`authedProcedure.use(validateEntryOwnership).use(chargeMiddleware(...))` 顺序）+ validateEntryOwnership 三种失败分支 |
| partial unique index 未落 test DB | 步骤 1.10 grep 未命中 | 手动在 test DB 跑 `CREATE UNIQUE INDEX ... WHERE status IN (...)`；同时回 `setup-test-dbs.ts` 看 migrate deploy 是否完整 |
| 步骤 1.6 误跑成无 `--create-only` 的 `migrate dev` | `_prisma_migrations` 表里出现本迁移行 / 表已建 | 走步骤 1.8 末尾的恢复流程：drop 三表 + 三 enum → `migrate resolve --rolled-back` → 回 1.6 重来。**不要**先改 migration.sql 再 `migrate resolve --applied`，会留 drift |
| AI mock 不返合规 JSON | 步骤 2.11 多个测试红 | 改 `packages/ai/src/adapters/mock.ts` 按 taskKind 切默认响应 |
| 间隔复习算法实现错 cap | 步骤 4.8 第 6/7 个测例失败 | 检查 `nextReviewAtAfter` 的 `safeIdx` 计算：`Math.min(Math.max(reviewCountAfter - 1, 0), 4)` |
| ARCHIVED 进了默认 list 视图 | 步骤 4.5 测例 1 失败 | 检查 `error.ts` 的 `list.where.status`：必须是 `input.status ?? "ACTIVE"`，不是 `?? { in: ["ACTIVE", "ARCHIVED"] }` |
| DELETED 在某入口出现 | 步骤 4.10 任一测例红 | 检查 zod `status` 枚举 + Prisma WHERE 默认；DELETED 永远不应在正向 filter 出现 |

---

## 附录 A：与 Plan 3 plan 工艺一致性

| 工艺 | Plan 3 plan 来源 | Plan 4 沿用 |
|---|---|---|
| Task 0 仓库卫生 | Plan 3 Task 0 | 一致；清残留 worktree + .gitignore 检查 |
| 每个 task 一个 commit + 引用 task 编号 | Plan 3 红线 #13 | 一致 |
| `pnpm.cmd`（PowerShell execution policy 拦 `.ps1`）| Plan 3 红线 #14 | 一致 |
| `prisma migrate dev --create-only` 绕 Docker 权限 | Plan 3 Task 2 | 一致 |
| 测试 spec §x.y 引用 | Plan 3 各 task 大量引用 | 一致 |
| Refactor 必须先证明零回归再 commit | Plan 3 Task 9 加 chargedProcedure 时未明确加；本 plan 在 Task 3 加硬要求 | **加强**（Task 3 步骤 3.5 必跑既有套件）|
| Blocker 测例为命名测试步骤 | Plan 3 §4.1 测试矩阵未做 | **加强**（Task 5 步骤 5.5 是硬卡点）|
| DELETED / ARCHIVED / nextReviewAt / entryId 测试分散到对应 procedure task | 用户审稿时指出 | **本 plan 新约定**（Task 4 步骤 4.4-4.10 每个 procedure 配套 integration test） |
| Merge 验收清单 prereq 区分 | Plan 3 Task 15 | 一致（步骤 8.2 加 6 条 13-18 探针） |
