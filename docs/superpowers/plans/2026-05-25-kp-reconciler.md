# 智教 · Plan 9 知识点 Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 4 `error.diagnose` 与 `variant.generateForEntry`、Plan 8 `tutor.ask` 三处 AI 产出的 `knowledgePointHints` 字符串落到 `QuestionKPLink` 结构化映射上，为后续 Plan 10/11 提供学情画像与教师分层作业的数据基础。

**Architecture:** 2 张新表（`KpAlias` + `KpReconcileMatch`）+ 1 个服务层（`apps/web/server/lib/kp-reconcile.ts`）+ 3 个 router body 接入 + 2 个 CLI 脚本（reconcile-pending / review）+ 1 个 backfill 脚本。同步路径只跑免费 EXACT / ALIAS 规则；未命中入 UNMATCHED 队列等手动 `kp:reconcile-pending` 跑 LLM 批处理；LLM 结果按 0.85 / 0.6 三档分流；OPS 在 `kp:review` 单键 a/r/m/alias 处理 PENDING_REVIEW。VARIANT_ITEM hints 永远不自动写 parent QuestionKPLink。

**Tech Stack:**（不变）pnpm 9 / Turborepo / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 / Redis 7 / @trpc/server@11 / superjson / Vitest 1 / Testcontainers 10 / pino 8

**Spec:** `docs/superpowers/specs/2026-05-25-kp-reconciler-design.md`（本 plan 的真理来源；遇到模糊回查 spec）

**Source Audit:** 2026-05-25 spec 三轮 review（ModelCall 字段对齐 + Prisma 反向 relation 补齐 + §4.1 stale 字段名修正）已收口

---

## ⚠️ 关键实现红线

1. **`reconcileHintsSync` 在 3 处 router body 调用必须 `await + try/catch + logger.warn` 兜底**（spec §3.4.2 / 探针 31）：reconcile 失败不能让 tutor.ask / error.diagnose / variant.generateForEntry 失败，用户已经付费拿到讲解或错因，KP reconcile 是后台增强。Task 7 commit 前 grep 验序。

2. **VARIANT_ITEM 永不自动写 parent QuestionKPLink**（spec §3.3 / 探针 32）：判分流条件是 `sourceRefType === "VARIANT_ITEM"`（不是 `source`，因为 BACKFILL source + sourceRefType=VARIANT_ITEM 也走 VARIANT 路径）。Task 5 service 层 + Task 9 backfill 同款。

3. **`KpAlias @@unique([subjectId, normalizedAlias])` 不能全局**（spec §2.1）：函数在不同学科语义不同；不能 `@@unique([normalizedAlias])`。Task 1 schema + Task 2 seed + Task 6 `learnAliasAndLink` 冲突检测都按 subject 隔离。

4. **`KpReconcileMatch.kpId` 三态语义不要乱**（spec §5.1 + §3.3 表）：UNMATCHED → null；LINKED / PENDING_REVIEW → 推荐/采纳的 kpId；REJECTED → 被拒的推荐（保留 audit）；DROPPED → null。CLI 直接读 row.kpId 显示 Suggested。

5. **LLM batch 输出按 matchId 对齐，不靠 rawHint**（spec §4.2）：LLM 可能改写文本或重复 hint，写回必须用 matchId。漏返 / 重复 → retry 2 次再 PARSE_FAILED。LLM 多返不在本批的 matchId → 静默忽略，不算异常（spec §4.2 末段）。

6. **ModelCall 写 `taskKind="KP_RECONCILE"` 字面值，不改 enum**（spec §2.4）：`ModelCall.taskKind` 现是 String。Plan 9 加字面值即可，不要把它升 enum，避免牵动历史所有 task。

7. **ModelCall 字段用现有 schema：`model / requestJson / responseJson / status / errorMessage / latencyMs / tokensIn / tokensOut`**（spec §4.4 / Source Audit P1 修正）。**不要**用 `inputDigest / inputJson / outputJson / modelVersion`（这些是 spec 早期错的字段名）。`inputDigest` 放进 `requestJson` payload 内。

8. **Prisma 反向 relation 必须补齐**（spec §2.3 / Source Audit P2）：现有 `Subject / KnowledgePoint / Question / User / ModelCall` 必须各自加新表的反向字段，否则 `prisma migrate dev --create-only` 直接报缺 opposite relation。Task 1 schema 改的时候同步落。

9. **LLM 不计 Credit**（spec §4.4 / §1）：`kpReconcile` 走 `aiRouter.kpReconcile()` 直接调，不接 `chargedProcedure` / `CreditLedger`。系统维护成本由 ModelCall 的 tokensIn/Out 事后核算。Task 8 commit 前 grep 验。

10. **CLI 不暴露 LINKED → REJECTED 反悔入口**（spec §5.5 / 探针 33）：只 export `unlinkIfOrphan` helper 给 unit test，router/scripts 不调用。Task 9 commit 前 grep 验。

11. **alias 冲突防御走异常，不静默覆盖**（spec §5.4）：`learnAliasAndLink` 检测 `(subjectId, normalizedAlias)` 已映射到其它 kpId → 抛 `KpAliasConflictError`。Task 6 测例守门。

12. **`migrate dev --create-only` → `migrate dev` 工艺**（spec §2.5 / 沿用 Plan 4/8）：本 plan 无 raw SQL partial idx（`KpAlias @@unique([subjectId, normalizedAlias])` 和 `KpReconcileMatch @@unique([sourceRefType, sourceRefId, normalizedHint])` 都是 Prisma 5 schema 直接支持的全集 unique），所以 `--create-only` 之后**不需要**手动追加 raw SQL，直接 apply 即可。但仍按 `--create-only` 工艺走，便于事后检查 migration.sql 内容。

13. **Vitest `it.todo` / 空 body 测试是假绿防御**（沿用 Plan 4 红线 #16）：Vitest 把 `it.todo` 当 todo 不失败、`it("name", async () => {})` 空 body 也直接 passed。Task 3/5/6/7/8/10 每次 commit 前必跑：
    ```powershell
    Select-String -Path apps/web/tests,packages/ai/tests -Pattern "it\.todo" -Recurse
    ```
    期望 0 命中。Vitest `Tests` 行也要确认是 `N passed (N)`、不含 `(M todo)` 计数。

14. **每个 task 一个 commit**，commit message 引用 task 编号。

15. **PowerShell 调 pnpm 必须用 `pnpm.cmd`**（execution policy 拦 `.ps1`）。

---

## 范围

**本 plan 做**（对应 spec §1 / §2-§10 全部）：

- `packages/db/prisma/schema.prisma`：2 新 model（`KpAlias` + `KpReconcileMatch`）+ 7 新 enum + 5 处现有 model 反向 relation 补齐
- 1 个 migration（`migrate dev --create-only` → `migrate dev`；无 raw SQL）
- `packages/db/prisma/seed/2_kp_aliases.ts`：8-12 条手工策展 math alias
- `packages/ai`：`kpReconcile()` router 方法 + `KpReconciliationInput/OutputSchema` zod + `prompts/kp-reconciliation/v1.md` prompt 模板 + `MockAdapter` 加 `kp-reconciliation` 默认响应 + `tasks.ts` 加 `KP_RECONCILE` TaskKind + 1 个 unit test (`kp-reconciliation.test.ts`)
- `apps/web/server/env.ts`：2 个新 env (`KP_RECONCILE_AUTO_LINK_THRESHOLD` / `KP_RECONCILE_REVIEW_THRESHOLD`) + zod refine 校验 + 默认值
- `apps/web/server/lib/kp-reconcile.ts`：`normalizeKpHint` + KP/alias map 构造 + `reconcileHintsSync` + 5 个 CLI 行为函数（`approveMatch / rejectMatch / remapMatch / learnAliasAndLink / unlinkIfOrphan`）+ `KpAliasConflictError` 异常类
- `apps/web/tests/unit/kp-reconcile-lib.test.ts`：normalize / map / unlinkIfOrphan unit
- 7 个 integration test 文件（sync / state machine / alias-conflict / subject-isolation / backfill / pending-script）
- `apps/web/server/routers/tutor.ts / error.ts / variant.ts`：每处加 reconcile 调用 + try/catch
- `apps/web/scripts/kp-reconcile-pending.ts`：异步 LLM 批处理 CLI（支持 `--limit N`）
- `apps/web/scripts/kp-review.ts`：交互式 review CLI
- `apps/web/scripts/kp-backfill-variant-items.ts`：一次性 backfill 脚本
- `apps/web/package.json`：加 `kp:review` / `kp:reconcile-pending` 两个 script
- CLAUDE.md：Plan 9 状态条目 + "答疑知识点结构化现状" 段 + Merge 探针 30-34 + 候选 Plan 重排

**本 plan 不做**（spec §1 显式 punt）：

- Web `/ops/kp-reconcile` 页面 → 等真有 OPS / 教师角色再做（memory: [[zhijiao-single-dev-no-ops-ui]]）
- CLI 暴露 LINKED→REJECTED 反悔入口 → 只 export helper、文档化清理 SQL，后续真有批量修错再开 ad-hoc 脚本
- cron 自动跑 `kp:reconcile-pending` → 成本不可见、prompt 初期需观察
- KP 树扩充 / 引入更多学科 KP / grade level 关联 → 独立 plan
- VariantItem 升格成独立 `Question` → 独立 plan（Plan 12 题库去重时考虑）
- 学情画像 / 教师分层作业（消费端）→ Plan 10 / Plan 11

---

## 文件结构（新建 / 修改清单）

```
CLAUDE.md                                                            # 改：Task 11

# === packages/db ===
packages/db/
  prisma/schema.prisma                                               # 改：2 新 model + 7 新 enum + 5 反向 relation
  prisma/migrations/<ts>_plan9_kp_reconciler/                        # 新（migrate dev --create-only 生成）
    migration.sql                                                    # 应是纯 ADD TABLE / ADD COLUMN，无 raw SQL append
  prisma/seed/2_kp_aliases.ts                                        # 新：8-12 条 math alias
  prisma/seed/index.ts                                               # 改：import + run 2_kp_aliases

# === packages/ai ===
packages/ai/
  src/tasks.ts                                                       # 改：TaskKind 加 KP_RECONCILE + TASK_MODEL_MAP
  src/schemas.ts                                                     # 改：加 KpReconciliationInput/OutputSchema
  src/prompts/kp-reconciliation/v1.md                                # 新：LLM prompt 模板
  src/router.ts                                                      # 改：加 AiRouter.kpReconcile() 方法
  src/adapters/mock.ts                                               # 改：加 kp-reconciliation 默认响应分支
  tests/kp-reconciliation.test.ts                                    # 新

# === apps/web ===
apps/web/
  server/env.ts                                                      # 改：加 2 env + refine
  server/lib/kp-reconcile.ts                                         # 新：核心 service
  server/routers/tutor.ts                                            # 改：mutation body 加 reconcile
  server/routers/error.ts                                            # 改：同上
  server/routers/variant.ts                                          # 改：同上（loop over items）
  scripts/kp-reconcile-pending.ts                                    # 新：异步 LLM CLI
  scripts/kp-review.ts                                               # 新：交互 review CLI
  scripts/kp-backfill-variant-items.ts                               # 新：一次性 backfill
  package.json                                                       # 改：加 kp:review / kp:reconcile-pending scripts
  tests/server/env.test.ts                                           # 改：加 2 个新 env 测例
  tests/unit/kp-reconcile-lib.test.ts                                # 新
  tests/integration/kp-reconcile-sync-tutor-ask.test.ts              # 新
  tests/integration/kp-reconcile-sync-error-diagnose.test.ts         # 新
  tests/integration/kp-reconcile-sync-variant.test.ts                # 新
  tests/integration/kp-reconcile-state-machine.test.ts               # 新
  tests/integration/kp-reconcile-alias-conflict.test.ts              # 新
  tests/integration/kp-reconcile-backfill.test.ts                    # 新
  tests/integration/kp-reconcile-subject-isolation.test.ts           # 新
  tests/integration/kp-reconcile-pending-script.test.ts              # 新
```

---

## 前置：环境检查 + 分支

> **Shell 约定**：本 plan 所有命令默认 **PowerShell**。`pnpm` 解析到 `pnpm.ps1` 被 execution policy 拦，**全文一律用 `pnpm.cmd`**。

```powershell
node --version       # >= 20
pnpm.cmd --version   # >= 9
docker --version     # Docker Desktop 在运行
```

- [ ] **步骤 P.1：从 master 起 worktree**

```powershell
git fetch origin                              # 注：本仓库无 remote，此步报错可跳过
git switch master
git pull --ff-only                            # 同上
git worktree add .claude/worktrees/plan-9-kp-reconciler -b plan-9-kp-reconciler master
```

新窗口 `Set-Location .claude/worktrees/plan-9-kp-reconciler`，后续命令都在 worktree 里跑。

- [ ] **步骤 P.2：起 docker、装依赖、迁主库**

```powershell
docker compose up -d
pnpm.cmd install
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd --filter @zhijiao/db db:migrate:deploy
pnpm.cmd db:seed
```

- [ ] **步骤 P.3：baseline 跑 1 次（确认 master 无 regression）**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望：4 项全绿。若有失败先停，回 master 修，本 plan 暂缓。

---

## Task 1：Prisma schema 2 新表 + 7 新 enum + 5 反向 relation + migration

> **为什么先做：** 后续所有 task 都依赖新 schema。schema 一落地，service 层、AI 层、router、CLI 都能写。

**Files：**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_plan9_kp_reconciler/migration.sql`

- [ ] **步骤 1.1：改 `schema.prisma` 加 2 model + 7 enum**

在 `schema.prisma` 末尾（`@@map("variant_items")` 之后）追加：

```prisma
// === Plan 9: Knowledge Point Reconciler ===

enum KpAliasSource {
  SEED         // pnpm db:seed 灌入
  CLI_MANUAL   // kp:review 的 alias <kpCode> 学到
}

enum KpReconcileSource {
  ERROR_ANALYSIS  // error.diagnose body sync 调用
  VARIANT_ITEM    // variant.generateForEntry body sync 调用
  TUTOR_ADHOC     // tutor.ask body sync 调用
  BACKFILL        // 一次性 backfill 脚本扫历史 VariantItem
}

enum KpReconcileSourceRefType {
  ERROR_BOOK_ENTRY  // sourceRefId = ErrorBookEntry.id
  VARIANT_ITEM      // sourceRefId = VariantItem.id（实时或 backfill）
  QUESTION          // sourceRefId = Question.id（TUTOR_ADHOC 路径指向 USER_ADHOC 题本身）
}

enum KpReconcileMatchVia {
  EXACT    // KP.name / KP.code 直接命中
  ALIAS    // KpAlias 表命中
  LLM      // 异步 LLM 兑底
  MANUAL   // CLI 人工 approve/remap/alias
}

enum KpReconcileMatchStatus {
  UNMATCHED       // sync 未命中，等异步 LLM
  PENDING_REVIEW  // 等人工：LLM 中档置信 / VARIANT_ITEM 待写 parent
  LINKED          // 已写 QuestionKPLink
  REJECTED        // 人工拒绝
  DROPPED         // LLM 低置信 / NO_MATCH
}

enum KpReconcileReviewReason {
  LLM_CONFIDENCE_BAND
  VARIANT_TO_PARENT_NEEDS_REVIEW
}

model KpAlias {
  id               String        @id @default(cuid())
  subjectId        String        @map("subject_id")
  kpId             String        @map("kp_id")
  normalizedAlias  String        @map("normalized_alias")
  source           KpAliasSource
  createdAt        DateTime      @default(now()) @map("created_at")
  createdByUserId  String?       @map("created_by_user_id")

  subject          Subject        @relation(fields: [subjectId], references: [id])
  kp               KnowledgePoint @relation(fields: [kpId], references: [id])
  createdBy        User?          @relation("KpAliasCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@unique([subjectId, normalizedAlias])
  @@index([kpId])
  @@map("kp_aliases")
}

model KpReconcileMatch {
  id              String                      @id @default(cuid())
  questionId      String                      @map("question_id")
  kpId            String?                     @map("kp_id")
  rawHint         String                      @db.Text @map("raw_hint")
  normalizedHint  String                      @map("normalized_hint")
  source          KpReconcileSource
  sourceRefType   KpReconcileSourceRefType    @map("source_ref_type")
  sourceRefId     String                      @map("source_ref_id")
  matchVia        KpReconcileMatchVia?        @map("match_via")
  confidence      Float?
  status          KpReconcileMatchStatus      @default(UNMATCHED)
  reviewReason    KpReconcileReviewReason?    @map("review_reason")
  modelCallId     String?                     @map("model_call_id")
  reviewedAt      DateTime?                   @map("reviewed_at")
  reviewedByUserId String?                    @map("reviewed_by_user_id")
  createdAt       DateTime                    @default(now()) @map("created_at")
  updatedAt       DateTime                    @updatedAt @map("updated_at")

  question        Question                    @relation(fields: [questionId], references: [id], onDelete: Cascade)
  kp              KnowledgePoint?             @relation(fields: [kpId], references: [id], onDelete: SetNull)
  reviewedBy      User?                       @relation("KpReconcileReviewer", fields: [reviewedByUserId], references: [id], onDelete: SetNull)
  modelCall       ModelCall?                  @relation(fields: [modelCallId], references: [id], onDelete: SetNull)

  @@unique([sourceRefType, sourceRefId, normalizedHint])
  @@index([status, createdAt])
  @@index([questionId])
  @@map("kp_reconcile_matches")
}
```

- [ ] **步骤 1.2：补 5 处现有 model 反向 relation**

打开同文件，找到现有 model 一一加：

`model Subject { ... }` 内加：
```prisma
  kpAliases       KpAlias[]
```

`model KnowledgePoint { ... }` 内加：
```prisma
  aliases             KpAlias[]
  reconcileMatches    KpReconcileMatch[]
```

`model Question { ... }` 内加（注意 Plan 8 已有的 `createdQuestions / errorBookEntries` 等保持不变）：
```prisma
  kpReconcileMatches  KpReconcileMatch[]
```

`model User { ... }` 内加：
```prisma
  createdKpAliases     KpAlias[]           @relation("KpAliasCreator")
  reviewedKpMatches    KpReconcileMatch[]  @relation("KpReconcileReviewer")
```

`model ModelCall { ... }` 内加：
```prisma
  kpReconcileMatches  KpReconcileMatch[]
```

- [ ] **步骤 1.3：`prisma migrate dev --create-only` 生成迁移**

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --create-only --name plan9_kp_reconciler
```

期望：`packages/db/prisma/migrations/<ts>_plan9_kp_reconciler/migration.sql` 生成但**未** apply。验证：

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\dt kp_*"
```

应**未命中**（表未建）。如已建 → 你跑成了 `migrate dev`（没 --create-only），回 Plan 4 Task 1 步骤 1.10 末尾的恢复流程。

打开生成的 `migration.sql` 浏览：应见 `CREATE TABLE "kp_aliases"` / `CREATE TABLE "kp_reconcile_matches"` / `CREATE INDEX "kp_aliases_subject_id_normalized_alias_key"` / `CREATE INDEX "kp_reconcile_matches_source_ref_type_source_ref_id_normalized_hint_key"` 等，**无**需要手动追加的 raw SQL。

- [ ] **步骤 1.4：apply migration**

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev
```

期望输出含 `Applying migration \`<ts>_plan9_kp_reconciler\``。

- [ ] **步骤 1.5：验 2 表 + unique idx 已落主库**

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d kp_aliases"
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d kp_reconcile_matches"
```

期望见两表完整字段 + unique idx 定义带 `(subject_id, normalized_alias)` 与 `(source_ref_type, source_ref_id, normalized_hint)`。

并验 checksum：
```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate status
```

期望 `Database schema is up to date!`，无 "modified after being applied" 警告。

- [ ] **步骤 1.6：把新表复制到 per-pkg test DB**

```powershell
pnpm.cmd test:setup
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_db -c "\dt kp_*"
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_web -c "\dt kp_*"
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_ai -c "\dt kp_*"
```

每库都应见 `kp_aliases` + `kp_reconcile_matches`。如未命中 → 看 `packages/db/scripts/setup-test-dbs.ts` 是否走 `migrate deploy`。

- [ ] **步骤 1.7：generate client + typecheck**

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck --force
```

期望全绿。

- [ ] **步骤 1.8：commit**

```powershell
git add packages/db/
git commit -m "feat(db): Plan 9 Task 1 — KpAlias + KpReconcileMatch + 7 enum + reverse relations + migration"
```

---

## Task 2：KpAlias 初始 seed

> **为什么先做：** Task 5 写 sync 路径的 integration test 需要 alias 表里至少有几条记录验证 ALIAS 命中分支。

**Files：**
- Create: `packages/db/prisma/seed/2_kp_aliases.ts`
- Modify: `packages/db/prisma/seed/index.ts`

- [ ] **步骤 2.1：新建 `seed/2_kp_aliases.ts`**

```ts
import type { PrismaClient } from "@prisma/client";

// Plan 9 spec §7.1: 仅覆盖当前 seed 的 4 个 math KP，每个 2-3 条高确定别名。
// 不扩到 50-100 条 —— alias 质量比数量重要，乱塞同义词会误自动匹配。
// 后续靠 CLI kp:review 的 alias <kpCode> 慢慢沉淀。

function normalizeKpHint(s: string): string {
  // Mirror apps/web/server/lib/kp-reconcile.ts → normalizeKpHint。
  // 不复用 import 是因为 seed 在 packages/db 跑、不依赖 apps/web。
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

const ALIASES: Array<{
  subjectCode: string;
  kpCode: string;
  aliases: string[];
}> = [
  {
    subjectCode: "math",
    kpCode: "math-g7-linear-eq",
    aliases: ["一元一次方程", "linear equation", "一元一次"],
  },
  {
    subjectCode: "math",
    kpCode: "math-g7-substitution",
    aliases: ["代入消元", "代入法"],
  },
  {
    subjectCode: "math",
    kpCode: "math-g8-system-eq",
    aliases: ["二元一次方程组", "system of equations", "方程组"],
  },
  {
    subjectCode: "math",
    kpCode: "math-g7-fraction-eq",
    aliases: ["分式方程", "fractional equation"],
  },
];

export async function seedKpAliases(prisma: PrismaClient): Promise<void> {
  for (const item of ALIASES) {
    const subject = await prisma.subject.findUnique({
      where: { code: item.subjectCode },
    });
    if (!subject) {
      console.warn(`  ⚠️ subject ${item.subjectCode} not found, skipping aliases`);
      continue;
    }
    const kp = await prisma.knowledgePoint.findUnique({
      where: { subjectId_code: { subjectId: subject.id, code: item.kpCode } },
    });
    if (!kp) {
      console.warn(`  ⚠️ kp ${item.kpCode} not found in subject ${item.subjectCode}, skipping`);
      continue;
    }
    for (const raw of item.aliases) {
      const normalized = normalizeKpHint(raw);
      await prisma.kpAlias.upsert({
        where: {
          subjectId_normalizedAlias: {
            subjectId: subject.id,
            normalizedAlias: normalized,
          },
        },
        create: {
          subjectId: subject.id,
          kpId: kp.id,
          normalizedAlias: normalized,
          source: "SEED",
        },
        update: {},
      });
    }
    console.log(`  ✓ Seeded ${item.aliases.length} aliases for ${item.kpCode}`);
  }
}
```

> 注：实际 KP code 名称（`math-g7-linear-eq` 等）来自 `seed/0_curriculum.ts`。如名字对不上，先 `grep -n "kpCode\|code:" packages/db/prisma/seed/0_curriculum.ts` 校准。

- [ ] **步骤 2.2：在 `seed/index.ts` 末尾接入**

`packages/db/prisma/seed/index.ts` 当前应该已经有 `seedCurriculum` / `seedTestUsers` / `seedSampleQuestions` 等。在所有现有 seed 之后加：

```ts
// （文件顶部 imports）
import { seedKpAliases } from "./2_kp_aliases.js";

// （main function 内部，所有现有 seed 之后）
await seedKpAliases(prisma);
```

- [ ] **步骤 2.3：重 seed 主库 + 验**

```powershell
pnpm.cmd db:seed
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT COUNT(*) FROM kp_aliases;"
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT s.code, k.code AS kp_code, a.normalized_alias, a.source FROM kp_aliases a JOIN subjects s ON s.id=a.subject_id JOIN knowledge_points k ON k.id=a.kp_id ORDER BY s.code, k.code;"
```

期望见 10 条（4 个 KP × 2-3 条），全部 `source=SEED`。

- [ ] **步骤 2.4：commit**

```powershell
git add packages/db/prisma/seed/
git commit -m "feat(db): Plan 9 Task 2 — KpAlias seed (10 math aliases, curated)"
```

---

## Task 3：AI 层 `kpReconcile()` + prompt 模板 + mock + 单元测试

> **为什么这时做：** Task 8 (CLI `kp-reconcile-pending`) 需要这个；Task 5 sync 路径不需要 LLM，但 schema 类型先就绪不会冲突。

**Files：**
- Modify: `packages/ai/src/tasks.ts`
- Modify: `packages/ai/src/schemas.ts`
- Create: `packages/ai/src/prompts/kp-reconciliation/v1.md`
- Modify: `packages/ai/src/router.ts`
- Modify: `packages/ai/src/adapters/mock.ts`
- Create: `packages/ai/tests/kp-reconciliation.test.ts`

- [ ] **步骤 3.1：`tasks.ts` 加 TaskKind + 映射**

```ts
export type TaskKind =
  | "TUTOR_TURN"
  | "ERROR_ANALYSIS"
  | "VARIANT_GROUP_GEN"
  | "PAPER_GEN"
  | "FORECAST_PAPER_GEN"
  | "EMBEDDING"
  | "KP_RECONCILE";        // Plan 9

export const TASK_MODEL_MAP: Record<TaskKind, string> = {
  TUTOR_TURN:          "qwen-plus",
  ERROR_ANALYSIS:      "qwen-plus",
  VARIANT_GROUP_GEN:   "qwen-plus",
  PAPER_GEN:           "qwen-max",
  FORECAST_PAPER_GEN:  "qwen-max",
  EMBEDDING:           "text-embedding-v2",
  KP_RECONCILE:        "qwen-plus",   // 候选集小、JSON 输出，plus 足够
};
```

- [ ] **步骤 3.2：`schemas.ts` 加 KP reconciliation 契约**

文件末尾追加：

```ts
// === KpReconciliation (Plan 9) ===

export const KpReconciliationCandidateSchema = z.object({
  id: z.string().cuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  parentPath: z.string(),
});
export type KpReconciliationCandidate = z.infer<typeof KpReconciliationCandidateSchema>;

export const KpReconciliationHintSchema = z.object({
  matchId: z.string().cuid(),
  rawHint: z.string().min(1).max(2000),
  normalizedHint: z.string().min(1).max(2000),
});
export type KpReconciliationHint = z.infer<typeof KpReconciliationHintSchema>;

export const KpReconciliationInputSchema = z.object({
  subjectId: z.string().cuid(),
  candidates: z.array(KpReconciliationCandidateSchema).min(1),
  hints: z.array(KpReconciliationHintSchema).min(1).max(50),
});
export type KpReconciliationInput = z.infer<typeof KpReconciliationInputSchema>;

// LLM output: 一项对一条 hint（按 matchId 对齐，多/漏在 router 层 retry）
export const KpReconciliationItemSchema = z.object({
  matchId: z.string().cuid(),
  kpId: z.string().cuid().nullable(),          // null = NO_MATCH
  confidence: z.number().min(0).max(1),         // NO_MATCH 时也要给 0
});
export type KpReconciliationItem = z.infer<typeof KpReconciliationItemSchema>;

export const KpReconciliationOutputSchema = z.array(KpReconciliationItemSchema);
export type KpReconciliationOutput = z.infer<typeof KpReconciliationOutputSchema>;
```

- [ ] **步骤 3.3：新建 prompt 模板**

```powershell
New-Item -ItemType Directory -Force packages/ai/src/prompts/kp-reconciliation
```

创建 `packages/ai/src/prompts/kp-reconciliation/v1.md`：

```markdown
你是一个知识点匹配助手。给定一批知识点候选（候选集已经按学科收敛），以及一批待匹配的 hint 字符串（可能是 AI 之前给出的自由文本），你需要为每条 hint 输出最匹配的知识点 ID 或 null。

## 候选知识点

{{candidates}}

## 待匹配 hints

{{hints}}

## 输出要求

输出 JSON 数组，每条 hint 对应一项：

```json
[
  { "matchId": "<原 matchId>", "kpId": "<选中的候选 id 或 null>", "confidence": <0..1 浮点数> }
]
```

规则：
- `matchId` 必须与输入一一对应，**不要漏返、不要重复、不要改写**
- `kpId` 必须是候选集里出现过的 id；若 hint 与所有候选都不匹配（含 hint 太宽泛、跨学科、模糊），返回 `null`
- `confidence` 永远填，范围 0..1。`kpId=null` 时也填 0。0.85 以上 = 几乎确定，0.6-0.85 = 有信心但不绝对，<0.6 = 牵强
- **宁缺勿滥**：不确定就 `null` + 低 confidence。错误的高 confidence 比 NO_MATCH 危害大
- 只输出 JSON 数组，不要任何解释文字或 Markdown 包裹
```

- [ ] **步骤 3.4：`router.ts` 加 `kpReconcile()` 方法 + 输出对齐逻辑**

文件顶部 imports 加：

```ts
import {
  KpReconciliationInputSchema,
  KpReconciliationOutputSchema,
  type KpReconciliationInput,
  type KpReconciliationOutput,
} from "./schemas.js";
```

在 `AiRouter` class 内末尾（`generateVariants` 之后）加：

```ts
  // Plan 9: kp:reconcile-pending CLI 调这个；不计 Credit。
  // 输出按 matchId 对齐写回：LLM 漏返/重复 → retry 2 次再 PARSE_FAILED；
  // 多返不在本批 matchId → 静默忽略（不算异常，spec §4.2）。
  async kpReconcile(
    input: unknown,
  ): Promise<{
    items: KpReconciliationOutput;
    modelCallId: string;
  }> {
    const parsed = KpReconciliationInputSchema.parse(input);
    const taskKind: TaskKind = "KP_RECONCILE";
    const prompt = await loadPrompt(
      "kp-reconciliation",
      this.opts.promptVersion ?? "v1",
    );
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const candidatesRendered = parsed.candidates
      .map(
        (c) =>
          `- id=${c.id}, code=${c.code}, name=${c.name}, path=${c.parentPath}` +
          (c.description ? `, desc=${c.description}` : ""),
      )
      .join("\n");
    const hintsRendered = parsed.hints
      .map((h) => `- matchId=${h.matchId}, hint=${JSON.stringify(h.normalizedHint)}`)
      .join("\n");

    const userContent = prompt.interpolate({
      candidates: candidatesRendered,
      hints: hintsRendered,
    });

    const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
    const request = {
      model,
      messages: [
        {
          role: "system" as const,
          content: "你是严谨、面向中国 K12 知识点结构化的匹配助手。",
        },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.0,         // 匹配任务要确定性
    };

    const start = Date.now();
    let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
    let parseAttempts = 0;
    let lastError: unknown = null;
    const inputMatchIds = new Set(parsed.hints.map((h) => h.matchId));

    while (parseAttempts < 3) {
      try {
        response = await this.opts.adapter.call(request);
        const json = JSON.parse(response.content);
        const validated = KpReconciliationOutputSchema.parse(json);

        // 多返不属于本批 matchId → 静默忽略
        const filtered = validated.filter((it) => inputMatchIds.has(it.matchId));

        // 漏返 / 重复 → 视为本次输出无效，触发 retry
        const returnedIds = new Set(filtered.map((it) => it.matchId));
        const hasAllMatchIds = parsed.hints.every((h) => returnedIds.has(h.matchId));
        const hasNoDuplicates = filtered.length === returnedIds.size;
        if (!hasAllMatchIds || !hasNoDuplicates) {
          lastError = new Error(
            `LLM output matchId alignment failed (returned=${filtered.length}, expected=${parsed.hints.length})`,
          );
          parseAttempts++;
          request.messages.push({
            role: "user",
            content:
              "上次输出 matchId 未与输入一一对应。请严格输出与输入 hints 数量相同的项，每个 matchId 出现且仅出现一次。",
          });
          continue;
        }

        const modelCallId = await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.SUCCESS,
          errorMessage: null,
          userId: this.opts.userId ?? null,
        });
        return { items: filtered, modelCallId };
      } catch (e) {
        lastError = e;
        parseAttempts++;
        if (e instanceof z.ZodError || e instanceof SyntaxError) {
          request.messages.push({
            role: "user",
            content: "上次输出不是符合 schema 的 JSON 数组，请重新只输出 JSON。",
          });
          continue;
        }
        await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.ADAPTER_ERROR,
          errorMessage: e instanceof Error ? e.message : String(e),
          userId: this.opts.userId ?? null,
        });
        throw e;
      }
    }

    await writeAudit(this.opts.prisma, {
      taskKind,
      promptTemplateId,
      request,
      response,
      latencyMs: Date.now() - start,
      status: ModelCallStatus.PARSE_FAILED,
      errorMessage:
        lastError instanceof Error ? lastError.message : String(lastError),
      userId: this.opts.userId ?? null,
    });
    throw new Error(
      `KP_RECONCILE failed after ${parseAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
```

- [ ] **步骤 3.5：`MockAdapter` 加 kp-reconciliation 默认分支**

打开 `packages/ai/src/adapters/mock.ts`，在 `DEFAULT_VARIANT_GENERATION` 之后加：

```ts
// Plan 9: kpReconcile 默认 mock —— 返回 matchId 全部映射成 null 的最弱响应。
// 实际测试场景通过 `respondWith` 注入具体返值。
const DEFAULT_KP_RECONCILIATION: unknown = [];
```

修改 `pickDefault`：

```ts
function pickDefault(req: AdapterRequest): unknown {
  const sys = req.messages.find((m) => m.role === "system")?.content ?? "";
  if (sys.includes("错因分析助手")) return DEFAULT_ERROR_ANALYSIS;
  if (sys.includes("举一反三变式生成助手")) return DEFAULT_VARIANT_GENERATION;
  if (sys.includes("知识点结构化的匹配助手")) return DEFAULT_KP_RECONCILIATION;
  return DEFAULT_TUTORING;
}
```

> 注：默认空数组会被 router 当成 "漏返" → retry 3 次 → PARSE_FAILED。测试场景必须用 `respondWith` 注入具体返值。

- [ ] **步骤 3.6：写 `packages/ai/tests/kp-reconciliation.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AiRouter } from "../src/router.js";
import { MockAdapter } from "../src/adapters/mock.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) throw new Error("DATABASE_URL must come from vitest.config.ts");

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "model_calls","prompt_templates","kp_reconcile_matches","kp_aliases","question_kp_links","knowledge_points","subjects" RESTART IDENTITY CASCADE;`);
}

async function seedSubjectAndKps() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp1 = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  const kp2 = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-substitution", name: "代入消元", difficulty: 2 },
  });
  return { subjectId: subject.id, kp1Id: kp1.id, kp2Id: kp2.id };
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("AiRouter.kpReconcile", () => {
  it("happy path: returns aligned items + writes ModelCall(SUCCESS)", async () => {
    const { subjectId, kp1Id, kp2Id } = await seedSubjectAndKps();
    const hint1 = "clrelid000000000000000001"; // 26-char cuid-shape
    const hint2 = "clrelid000000000000000002";
    const adapter = new MockAdapter({
      respondWith: () =>
        Promise.resolve({
          content: JSON.stringify([
            { matchId: hint1, kpId: kp1Id, confidence: 0.92 },
            { matchId: hint2, kpId: null, confidence: 0 },
          ]),
        }),
    });
    const router = new AiRouter({ prisma, adapter });

    const r = await router.kpReconcile({
      subjectId,
      candidates: [
        { id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" },
        { id: kp2Id, code: "math-g7-substitution", name: "代入消元", description: null, parentPath: "数学" },
      ],
      hints: [
        { matchId: hint1, rawHint: "linear equation", normalizedHint: "linear equation" },
        { matchId: hint2, rawHint: "未知概念", normalizedHint: "未知概念" },
      ],
    });

    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ matchId: hint1, kpId: kp1Id, confidence: 0.92 });
    expect(r.items[1]).toEqual({ matchId: hint2, kpId: null, confidence: 0 });
    expect(r.modelCallId).toBeTruthy();

    const mc = await prisma.modelCall.findUniqueOrThrow({ where: { id: r.modelCallId } });
    expect(mc.taskKind).toBe("KP_RECONCILE");
    expect(mc.status).toBe("SUCCESS");
  });

  it("LLM 多返不属于本批 matchId 的项 → 静默忽略，不算异常", async () => {
    const { subjectId, kp1Id } = await seedSubjectAndKps();
    const hint1 = "clrelid000000000000000001";
    const adapter = new MockAdapter({
      respondWith: () =>
        Promise.resolve({
          content: JSON.stringify([
            { matchId: hint1, kpId: kp1Id, confidence: 0.9 },
            { matchId: "clrelid000000000000000099", kpId: kp1Id, confidence: 0.5 }, // 不在本批
          ]),
        }),
    });
    const router = new AiRouter({ prisma, adapter });

    const r = await router.kpReconcile({
      subjectId,
      candidates: [
        { id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" },
      ],
      hints: [{ matchId: hint1, rawHint: "linear", normalizedHint: "linear" }],
    });

    expect(r.items).toHaveLength(1);
    expect(r.items[0].matchId).toBe(hint1);
  });

  it("LLM 漏返一个 matchId → retry → 最终 PARSE_FAILED", async () => {
    const { subjectId, kp1Id, kp2Id } = await seedSubjectAndKps();
    const hint1 = "clrelid000000000000000001";
    const hint2 = "clrelid000000000000000002";
    let calls = 0;
    const adapter = new MockAdapter({
      respondWith: () => {
        calls++;
        return Promise.resolve({
          content: JSON.stringify([
            { matchId: hint1, kpId: kp1Id, confidence: 0.9 },
            // 永远漏 hint2
          ]),
        });
      },
    });
    const router = new AiRouter({ prisma, adapter });

    await expect(
      router.kpReconcile({
        subjectId,
        candidates: [
          { id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" },
          { id: kp2Id, code: "math-g7-substitution", name: "代入消元", description: null, parentPath: "数学" },
        ],
        hints: [
          { matchId: hint1, rawHint: "a", normalizedHint: "a" },
          { matchId: hint2, rawHint: "b", normalizedHint: "b" },
        ],
      }),
    ).rejects.toThrow(/KP_RECONCILE failed/);

    expect(calls).toBe(3); // 初次 + 2 retry
    const mc = await prisma.modelCall.findFirst({ where: { taskKind: "KP_RECONCILE" }, orderBy: { createdAt: "desc" } });
    expect(mc?.status).toBe("PARSE_FAILED");
  });

  it("LLM 返非 JSON → retry → 最终 PARSE_FAILED", async () => {
    const { subjectId, kp1Id } = await seedSubjectAndKps();
    const adapter = new MockAdapter({
      respondWith: () => Promise.resolve({ content: "不是 JSON 啊" }),
    });
    const router = new AiRouter({ prisma, adapter });

    await expect(
      router.kpReconcile({
        subjectId,
        candidates: [{ id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" }],
        hints: [{ matchId: "clrelid000000000000000001", rawHint: "x", normalizedHint: "x" }],
      }),
    ).rejects.toThrow();

    const mc = await prisma.modelCall.findFirst({ where: { taskKind: "KP_RECONCILE" }, orderBy: { createdAt: "desc" } });
    expect(mc?.status).toBe("PARSE_FAILED");
  });
});
```

- [ ] **步骤 3.7：跑 AI test + typecheck**

```powershell
pnpm.cmd --filter @zhijiao/ai test -- tests/kp-reconciliation.test.ts
pnpm.cmd exec turbo typecheck --force
```

期望：4 tests passed + typecheck 全绿。

- [ ] **步骤 3.8：guardrail — 0 个 it.todo**

```powershell
Select-String -Path packages/ai/tests -Pattern "it\.todo" -Recurse
```

期望 0 命中。

- [ ] **步骤 3.9：commit**

```powershell
git add packages/ai/
git commit -m "feat(ai): Plan 9 Task 3 — kpReconcile() router method + prompt + mock + 4 unit tests"
```

---

## Task 4：env 变量 + zod refine

> **为什么单独 task：** 两个阈值要在 Task 5 service 层和 Task 8 CLI 都用，env 先落不会重复改。

**Files：**
- Modify: `apps/web/server/env.ts`
- Modify: `apps/web/tests/server/env.test.ts`

- [ ] **步骤 4.1：`env.ts` 加 2 个新字段**

找现有 `EnvSchema = z.object({ ... })`，在末尾（其它字段之后）加：

```ts
  // Plan 9 KP reconciler thresholds
  KP_RECONCILE_AUTO_LINK_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  KP_RECONCILE_REVIEW_THRESHOLD:    z.coerce.number().min(0).max(1).default(0.6),
```

在 `.superRefine((env, ctx) => { ... })` 末尾加：

```ts
  if (env.KP_RECONCILE_REVIEW_THRESHOLD >= env.KP_RECONCILE_AUTO_LINK_THRESHOLD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["KP_RECONCILE_REVIEW_THRESHOLD"],
      message: "KP_RECONCILE_REVIEW_THRESHOLD must be strictly less than KP_RECONCILE_AUTO_LINK_THRESHOLD",
    });
  }
```

- [ ] **步骤 4.2：`env.test.ts` 加 2 个新测例**

打开 `apps/web/tests/server/env.test.ts`，在末尾 `describe` 里加：

```ts
  it("KP_RECONCILE_REVIEW_THRESHOLD >= AUTO_LINK throws", async () => {
    process.env.KP_RECONCILE_AUTO_LINK_THRESHOLD = "0.7";
    process.env.KP_RECONCILE_REVIEW_THRESHOLD = "0.8";
    await expect(loadEnv()).rejects.toThrow(/REVIEW_THRESHOLD must be strictly less/);
  });

  it("KP_RECONCILE thresholds 默认 0.85 / 0.6", async () => {
    delete process.env.KP_RECONCILE_AUTO_LINK_THRESHOLD;
    delete process.env.KP_RECONCILE_REVIEW_THRESHOLD;
    const env = await loadEnv();
    expect(env.KP_RECONCILE_AUTO_LINK_THRESHOLD).toBe(0.85);
    expect(env.KP_RECONCILE_REVIEW_THRESHOLD).toBe(0.6);
  });
```

> 注：`loadEnv` 实现细节看现有测例；如签名是 `() => env` 同步函数，把 `await expect(...).rejects` 改成 `expect(() => loadEnv()).toThrow`。

- [ ] **步骤 4.3：跑 env test**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/server/env.test.ts
```

期望全部 env 测例通过（原有 + 新加 2 个）。

- [ ] **步骤 4.4：commit**

```powershell
git add apps/web/server/env.ts apps/web/tests/server/env.test.ts
git commit -m "feat(web): Plan 9 Task 4 — env KP_RECONCILE_{AUTO_LINK,REVIEW}_THRESHOLD + refine"
```

---

## Task 5：service 核心 `reconcileHintsSync` + unit + 3 sync integration

> **为什么这个 task 大：** 核心 helper + 3 个 router 都依赖它的语义；测例覆盖按 sourceRefType 分流的两条路径（写 vs 不写 parent QuestionKPLink）。

**Files：**
- Create: `apps/web/server/lib/kp-reconcile.ts`（部分；CLI actions 留 Task 6）
- Create: `apps/web/tests/unit/kp-reconcile-lib.test.ts`
- Create: `apps/web/tests/integration/kp-reconcile-sync-tutor-ask.test.ts`（占位，Task 7 接 router 后补 router 调用断言）
- Create: `apps/web/tests/integration/kp-reconcile-sync-error-diagnose.test.ts`（同上）
- Create: `apps/web/tests/integration/kp-reconcile-sync-variant.test.ts`（同上）
- Create: `apps/web/tests/integration/kp-reconcile-subject-isolation.test.ts`

> 注：本 task 先把 sync integration 测例 stub 出来（用 `reconcileHintsSync` 直接调，不经过 router），Task 7 router 接入后再加 "router 调用经路径" 断言。这样 sync 路径行为已被守门，Task 7 只是验证 router 真的调到了。

- [ ] **步骤 5.1：新建 `apps/web/server/lib/kp-reconcile.ts`（核心部分）**

```ts
import "server-only";
import { Prisma, type PrismaClient, type KnowledgePoint } from "@prisma/client";
import { logger } from "../logger.js";

// ============ 类型与常量 ============

export type KpReconcileSourceLiteral =
  | "ERROR_ANALYSIS"
  | "VARIANT_ITEM"
  | "TUTOR_ADHOC"
  | "BACKFILL";

export type KpReconcileSourceRefTypeLiteral =
  | "ERROR_BOOK_ENTRY"
  | "VARIANT_ITEM"
  | "QUESTION";

export interface ReconcileHintsSyncArgs {
  questionId: string;
  hints: string[];
  source: KpReconcileSourceLiteral;
  sourceRefType: KpReconcileSourceRefTypeLiteral;
  sourceRefId: string;
}

export interface ReconcileHintsSyncResult {
  linked: number;
  queued: number;
  alreadySeen: number;
}

// ============ normalize ============

// Plan 9 spec §3.2.1: KP 名称域大小写不带语义（"一元一次方程"/"Linear Equation"/"移项"），
// 跟 Plan 8 normalizeStem 拒绝 lowercase 的数学题面不同，本函数可以 lowercase。
export function normalizeKpHint(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// ============ KP / Alias map 构造 ============

interface SubjectCandidates {
  kpById: Map<string, KnowledgePoint>;
  kpByNormalized: Map<string, string>;   // normalized key → kpId
  aliasByNormalized: Map<string, string>; // normalized key → kpId
}

async function loadSubjectCandidates(
  prisma: PrismaClient,
  subjectId: string,
): Promise<SubjectCandidates> {
  const [kps, aliases] = await Promise.all([
    prisma.knowledgePoint.findMany({ where: { subjectId } }),
    prisma.kpAlias.findMany({ where: { subjectId } }),
  ]);

  const kpById = new Map<string, KnowledgePoint>();
  const kpByNormalized = new Map<string, string>();
  for (const kp of kps) {
    kpById.set(kp.id, kp);
    kpByNormalized.set(normalizeKpHint(kp.name), kp.id);
    kpByNormalized.set(normalizeKpHint(kp.code), kp.id);
  }
  const aliasByNormalized = new Map<string, string>();
  for (const a of aliases) {
    aliasByNormalized.set(a.normalizedAlias, a.kpId);
  }
  return { kpById, kpByNormalized, aliasByNormalized };
}

// ============ reconcileHintsSync ============

// Plan 9 spec §3.1 + §3.3:
// - 三个 router body 调用：tutor.ask / error.diagnose / variant.generateForEntry
// - 决定写不写 parent QuestionKPLink 的条件是 sourceRefType=VARIANT_ITEM（不是 source，
//   因为 BACKFILL source + sourceRefType=VARIANT_ITEM 也走 VARIANT 路径）
// - VARIANT_ITEM EXACT/ALIAS 命中 → PENDING_REVIEW + reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW
// - 其它 sourceRefType EXACT/ALIAS 命中 → LINKED + upsert QuestionKPLink
// - 未命中 → UNMATCHED
//
// 错误处理：单条 hint 失败不影响同批其它；调用方必须 try/catch 包住（reconcile 失败
// 不能破坏主流程）。
export async function reconcileHintsSync(
  prisma: PrismaClient,
  args: ReconcileHintsSyncArgs,
): Promise<ReconcileHintsSyncResult> {
  const result: ReconcileHintsSyncResult = { linked: 0, queued: 0, alreadySeen: 0 };
  if (args.hints.length === 0) return result;

  const question = await prisma.question.findUniqueOrThrow({
    where: { id: args.questionId },
    select: { subjectId: true },
  });
  const candidates = await loadSubjectCandidates(prisma, question.subjectId);
  const writesToParent = args.sourceRefType !== "VARIANT_ITEM";

  // 去重：同一批内重复 hint 不重复处理
  const seen = new Set<string>();

  for (const rawHint of args.hints) {
    const normalized = normalizeKpHint(rawHint);
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // EXACT
    let matchVia: "EXACT" | "ALIAS" | null = null;
    let matchedKpId = candidates.kpByNormalized.get(normalized) ?? null;
    if (matchedKpId) matchVia = "EXACT";

    // ALIAS（EXACT miss 才查；并守 cross-subject 防御）
    if (!matchedKpId) {
      const aliasKpId = candidates.aliasByNormalized.get(normalized) ?? null;
      if (aliasKpId) {
        const kp = candidates.kpById.get(aliasKpId);
        if (kp && kp.subjectId === question.subjectId) {
          matchedKpId = aliasKpId;
          matchVia = "ALIAS";
        } else {
          // 防御：alias 表里有跨 subject 行（理论上 @@unique 挡住）
          logger.warn({
            event: "kp_reconcile_alias_cross_subject",
            questionId: args.questionId,
            aliasKpId,
            questionSubjectId: question.subjectId,
          });
        }
      }
    }

    try {
      if (matchedKpId && matchVia) {
        if (writesToParent) {
          // LINKED + upsert QuestionKPLink
          await prisma.$transaction(async (tx) => {
            await upsertReconcileMatch(tx, {
              ...args,
              normalizedHint: normalized,
              rawHint,
              kpId: matchedKpId,
              matchVia,
              confidence: 1.0,
              status: "LINKED",
              reviewReason: null,
            });
            await upsertQuestionKpLink(tx, args.questionId, matchedKpId, 1.0);
          });
          result.linked++;
        } else {
          // VARIANT_ITEM → PENDING_REVIEW + 不写 QuestionKPLink
          await upsertReconcileMatch(prisma, {
            ...args,
            normalizedHint: normalized,
            rawHint,
            kpId: matchedKpId,
            matchVia,
            confidence: 1.0,
            status: "PENDING_REVIEW",
            reviewReason: "VARIANT_TO_PARENT_NEEDS_REVIEW",
          });
          result.queued++;
        }
      } else {
        // UNMATCHED
        await upsertReconcileMatch(prisma, {
          ...args,
          normalizedHint: normalized,
          rawHint,
          kpId: null,
          matchVia: null,
          confidence: null,
          status: "UNMATCHED",
          reviewReason: null,
        });
        result.queued++;
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // 同 (sourceRefType, sourceRefId, normalizedHint) 已存在 → no-op
        result.alreadySeen++;
        continue;
      }
      // 单条 hint 失败不抛 —— 不影响同批其它
      logger.warn({
        event: "kp_reconcile_sync_hint_failed",
        questionId: args.questionId,
        hint: normalized,
        error: String(e),
      });
    }
  }

  return result;
}

interface ReconcileMatchUpsertArgs extends ReconcileHintsSyncArgs {
  normalizedHint: string;
  rawHint: string;
  kpId: string | null;
  matchVia: "EXACT" | "ALIAS" | "LLM" | "MANUAL" | null;
  confidence: number | null;
  status: "UNMATCHED" | "PENDING_REVIEW" | "LINKED" | "REJECTED" | "DROPPED";
  reviewReason: "LLM_CONFIDENCE_BAND" | "VARIANT_TO_PARENT_NEEDS_REVIEW" | null;
}

async function upsertReconcileMatch(
  tx: PrismaClient | Prisma.TransactionClient,
  args: ReconcileMatchUpsertArgs,
): Promise<void> {
  // Plan 8 工艺：先尝试 create，捕 P2002 当 no-op（上面调用方在 catch 处理 alreadySeen 计数）。
  await tx.kpReconcileMatch.create({
    data: {
      questionId: args.questionId,
      kpId: args.kpId,
      rawHint: args.rawHint,
      normalizedHint: args.normalizedHint,
      source: args.source,
      sourceRefType: args.sourceRefType,
      sourceRefId: args.sourceRefId,
      matchVia: args.matchVia,
      confidence: args.confidence,
      status: args.status,
      reviewReason: args.reviewReason,
    },
  });
}

async function upsertQuestionKpLink(
  tx: PrismaClient | Prisma.TransactionClient,
  questionId: string,
  kpId: string,
  newWeight: number,
): Promise<void> {
  // weight = max(existing, newWeight) — spec §3.3
  const existing = await tx.questionKPLink.findUnique({
    where: { questionId_kpId: { questionId, kpId } },
  });
  if (existing) {
    if (existing.weight < newWeight) {
      await tx.questionKPLink.update({
        where: { questionId_kpId: { questionId, kpId } },
        data: { weight: newWeight },
      });
    }
  } else {
    await tx.questionKPLink.create({
      data: { questionId, kpId, weight: newWeight },
    });
  }
}
```

- [ ] **步骤 5.2：写 unit tests `apps/web/tests/unit/kp-reconcile-lib.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { normalizeKpHint } from "@/server/lib/kp-reconcile";

describe("normalizeKpHint", () => {
  it("trim + collapse whitespace + lowercase", () => {
    expect(normalizeKpHint("  Linear Equation  ")).toBe("linear equation");
    expect(normalizeKpHint("一元\n一次\t方程")).toBe("一元 一次 方程");
    expect(normalizeKpHint("SIN x")).toBe("sin x");
  });

  it("preserves emoji and full-width chars", () => {
    expect(normalizeKpHint("题目：一元一次方程 🧮")).toBe("题目：一元一次方程 🧮");
  });

  it("empty / whitespace-only → empty string", () => {
    expect(normalizeKpHint("")).toBe("");
    expect(normalizeKpHint("   ")).toBe("");
  });
});

// 注：reconcileHintsSync 的覆盖在 integration 测例（kp-reconcile-sync-*.test.ts）
// 因为需要真 DB。本文件只覆盖纯函数。
```

- [ ] **步骤 5.3：写 sync integration `kp-reconcile-sync-tutor-ask.test.ts`（不依赖 router，直接调 reconcileHintsSync 验 sync 行为）**

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedSubjectKpsAndAlias() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
  });
  return { subjectId: subject.id, kpId: kp.id };
}

async function seedQuestion(subjectId: string, source = "USER_ADHOC" as const): Promise<string> {
  const q = await prisma.question.create({
    data: {
      subjectId,
      stemMd: "x + 1 = 2",
      type: "ESSAY",
      status: "DRAFT",
      source,
    },
  });
  return q.id;
}

beforeAll(async () => { /* per-pkg DB ready */ });
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("reconcileHintsSync — source=TUTOR_ADHOC / sourceRefType=QUESTION", () => {
  it("EXACT 命中 → LINKED + 写 QuestionKPLink(weight=1.0)", async () => {
    const { subjectId, kpId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["一元一次方程"],
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: qid,
    });

    expect(r.linked).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: qid } });
    expect(match.status).toBe("LINKED");
    expect(match.matchVia).toBe("EXACT");
    expect(match.kpId).toBe(kpId);
    expect(match.confidence).toBe(1.0);
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId: qid, kpId } },
    });
    expect(link.weight).toBe(1.0);
  });

  it("ALIAS 命中 → LINKED + 写 QuestionKPLink", async () => {
    const { subjectId, kpId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["Linear Eq"],  // 大小写不同，normalize 后命中 alias "linear eq"
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: qid,
    });

    expect(r.linked).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: qid } });
    expect(match.matchVia).toBe("ALIAS");
    expect(match.kpId).toBe(kpId);
  });

  it("未命中 → UNMATCHED + 不写 QuestionKPLink", async () => {
    const { subjectId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["未知概念"],
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: qid,
    });

    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: qid } });
    expect(match.status).toBe("UNMATCHED");
    expect(match.kpId).toBeNull();
    const linkCount = await prisma.questionKPLink.count({ where: { questionId: qid } });
    expect(linkCount).toBe(0);
  });

  it("重复同 hint → alreadySeen 计数，DB 行数不变", async () => {
    const { subjectId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    await reconcileHintsSync(prisma, {
      questionId: qid, hints: ["一元一次方程"], source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: qid,
    });
    const r2 = await reconcileHintsSync(prisma, {
      questionId: qid, hints: ["一元一次方程"], source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: qid,
    });

    expect(r2.alreadySeen).toBe(1);
    const count = await prisma.kpReconcileMatch.count({ where: { questionId: qid } });
    expect(count).toBe(1);
  });

  it("一批内同一 normalize hint 只处理一次", async () => {
    const { subjectId } = await seedSubjectKpsAndAlias();
    const qid = await seedQuestion(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId: qid,
      hints: ["一元一次方程", "  一元一次方程  ", "一元一次方程"],
      source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: qid,
    });

    expect(r.linked).toBe(1);
    expect(r.alreadySeen).toBe(0); // 同批内 dedup，不算 alreadySeen
    const count = await prisma.kpReconcileMatch.count({ where: { questionId: qid } });
    expect(count).toBe(1);
  });
});
```

- [ ] **步骤 5.4：写 `kp-reconcile-sync-error-diagnose.test.ts`**

文件结构与上面类似，但用 `source=ERROR_ANALYSIS, sourceRefType=ERROR_BOOK_ENTRY, sourceRefId=<entry.id>`：

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedSubjectKpAlias() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
  });
  return { subjectId: subject.id, kpId: kp.id };
}

async function seedQuestionAndEntry(subjectId: string) {
  const q = await prisma.question.create({
    data: { subjectId, stemMd: "stem", type: "ESSAY", status: "PUBLISHED" },
  });
  const u = await prisma.user.create({ data: { persona: "STUDENT" } });
  const entry = await prisma.errorBookEntry.create({
    data: {
      userId: u.id,
      questionId: q.id,
      status: "ACTIVE",
      rootCause: "CONCEPT_CONFUSION",
      rootCauseReasoning: "test",
    },
  });
  return { questionId: q.id, entryId: entry.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("reconcileHintsSync — source=ERROR_ANALYSIS / sourceRefType=ERROR_BOOK_ENTRY", () => {
  it("EXACT 命中 → LINKED + 写 QuestionKPLink；sourceRefId 是 entryId 非 ledgerId", async () => {
    const { subjectId, kpId } = await seedSubjectKpAlias();
    const { questionId, entryId } = await seedQuestionAndEntry(subjectId);

    const r = await reconcileHintsSync(prisma, {
      questionId,
      hints: ["一元一次方程"],
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: entryId,
    });

    expect(r.linked).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId } });
    expect(match.sourceRefType).toBe("ERROR_BOOK_ENTRY");
    expect(match.sourceRefId).toBe(entryId);   // 关键：不是 diagnoseLedgerId
    expect(match.status).toBe("LINKED");
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId } },
    });
    expect(link.weight).toBe(1.0);
  });
});
```

- [ ] **步骤 5.5：写 `kp-reconcile-sync-variant.test.ts`（红线 #2 关键守门）**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

async function seedSubjectKpAlias() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
  });
  return { subjectId: subject.id, kpId: kp.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("reconcileHintsSync — sourceRefType=VARIANT_ITEM 永不自动写 QuestionKPLink（红线 #2）", () => {
  it("EXACT 命中 → PENDING_REVIEW + 不写 QuestionKPLink", async () => {
    const { subjectId, kpId } = await seedSubjectKpAlias();
    const q = await prisma.question.create({
      data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    // 模拟 VariantItem.id（实际 task 7 接 router 时用真 VariantItem.id）
    const fakeVariantItemId = "clrelid000000000000000123";

    const r = await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["一元一次方程"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: fakeVariantItemId,
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("PENDING_REVIEW");
    expect(match.matchVia).toBe("EXACT");
    expect(match.kpId).toBe(kpId);
    expect(match.confidence).toBe(1.0);
    expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");

    // 关键：QuestionKPLink 没有被写
    const linkCount = await prisma.questionKPLink.count({ where: { questionId: q.id } });
    expect(linkCount).toBe(0);
  });

  it("ALIAS 命中 → 同样 PENDING_REVIEW 不写 QuestionKPLink", async () => {
    const { subjectId, kpId } = await seedSubjectKpAlias();
    const q = await prisma.question.create({
      data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const fakeVariantItemId = "clrelid000000000000000124";

    await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["Linear Eq"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: fakeVariantItemId,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("PENDING_REVIEW");
    expect(match.matchVia).toBe("ALIAS");
    expect(match.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(await prisma.questionKPLink.count({ where: { questionId: q.id } })).toBe(0);
  });

  it("source=BACKFILL + sourceRefType=VARIANT_ITEM → 仍走 VARIANT 路径，不写 QuestionKPLink", async () => {
    const { subjectId } = await seedSubjectKpAlias();
    const q = await prisma.question.create({
      data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const fakeVariantItemId = "clrelid000000000000000125";

    await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["一元一次方程"],
      source: "BACKFILL",       // 不同的 source
      sourceRefType: "VARIANT_ITEM",  // 但 sourceRefType 是 VARIANT_ITEM
      sourceRefId: fakeVariantItemId,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("PENDING_REVIEW");  // 关键：不是 LINKED
    expect(match.source).toBe("BACKFILL");
    expect(await prisma.questionKPLink.count({ where: { questionId: q.id } })).toBe(0);
  });
});
```

- [ ] **步骤 5.6：写 `kp-reconcile-subject-isolation.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("subject isolation: math hint 不匹 english KP", () => {
  it("跨 subject hint 走 UNMATCHED，不写 QuestionKPLink", async () => {
    // math subject + KP
    const math = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const englishKp = await prisma.knowledgePoint.create({
      data: {
        subjectId: math.id,   // 假装这是 english KP 的同名 hint —— 严格意义上这是 math kp
        code: "math-g7-linear-eq",
        name: "function",
        difficulty: 2,
      },
    });
    // english subject + KP（不同名）
    const english = await prisma.subject.create({ data: { code: "english", name: "英语" } });
    const engKp = await prisma.knowledgePoint.create({
      data: { subjectId: english.id, code: "eng-g7-pronouns", name: "Pronouns", difficulty: 2 },
    });
    // english 题
    const engQ = await prisma.question.create({
      data: { subjectId: english.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });

    // 用 english 题，提交 "function" hint —— 应不命中 math KP (function)
    const r = await reconcileHintsSync(prisma, {
      questionId: engQ.id,
      hints: ["function"],
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: "clrelid000000000000000001",
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: engQ.id } });
    expect(match.status).toBe("UNMATCHED");
    expect(match.kpId).toBeNull();
  });
});
```

- [ ] **步骤 5.7：跑 5 个测试 + typecheck + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/unit/kp-reconcile-lib.test.ts tests/integration/kp-reconcile-sync-tutor-ask.test.ts tests/integration/kp-reconcile-sync-error-diagnose.test.ts tests/integration/kp-reconcile-sync-variant.test.ts tests/integration/kp-reconcile-subject-isolation.test.ts
pnpm.cmd exec turbo typecheck --force
Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse
```

期望：unit 3 + integration 5+1+1+3+1=11 全绿，typecheck 全绿，0 个 it.todo。

- [ ] **步骤 5.8：commit**

```powershell
git add apps/web/server/lib/kp-reconcile.ts apps/web/tests/unit/kp-reconcile-lib.test.ts apps/web/tests/integration/kp-reconcile-sync-tutor-ask.test.ts apps/web/tests/integration/kp-reconcile-sync-error-diagnose.test.ts apps/web/tests/integration/kp-reconcile-sync-variant.test.ts apps/web/tests/integration/kp-reconcile-subject-isolation.test.ts
git commit -m "feat(web): Plan 9 Task 5 — reconcileHintsSync + normalizeKpHint + sync integration tests"
```

---

## Task 6：service 层 CLI 行为函数 + 状态机 + alias 冲突测例

> **为什么这个 task 大：** 把 PENDING_REVIEW → LINKED/REJECTED/REMAP/ALIAS 4 条转移都覆盖；alias 冲突防御要测；unlinkIfOrphan helper 也在这里写。

**Files：**
- Modify: `apps/web/server/lib/kp-reconcile.ts`
- Create: `apps/web/tests/integration/kp-reconcile-state-machine.test.ts`
- Create: `apps/web/tests/integration/kp-reconcile-alias-conflict.test.ts`

- [ ] **步骤 6.1：在 `kp-reconcile.ts` 加 5 个 CLI 行为函数 + 异常类**

文件末尾追加：

```ts
// ============ CLI / service 层操作 ============

export class KpAliasConflictError extends Error {
  constructor(
    public existing: { id: string; kpId: string; source: string },
    public requested: { kpId: string; normalizedAlias: string },
  ) {
    super(
      `Alias "${requested.normalizedAlias}" already maps to kp ${existing.kpId} (source=${existing.source}); refused to override`,
    );
    this.name = "KpAliasConflictError";
  }
}

export interface ApproveMatchArgs {
  matchId: string;
  reviewedByUserId: string;
}

// PENDING_REVIEW → LINKED；采纳 row.kpId 写 QuestionKPLink
export async function approveMatch(
  prisma: PrismaClient,
  args: ApproveMatchArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: args.matchId } });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`approveMatch: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  if (!match.kpId) {
    throw new Error(`approveMatch: match ${args.matchId} has no kpId (cannot approve)`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.kpReconcileMatch.update({
      where: { id: args.matchId },
      data: {
        status: "LINKED",
        reviewReason: null,
        reviewedAt: new Date(),
        reviewedByUserId: args.reviewedByUserId,
      },
    });
    await upsertQuestionKpLink(tx, match.questionId, match.kpId!, match.confidence ?? 1.0);
    return updated;
  });
}

export interface RejectMatchArgs {
  matchId: string;
  reviewedByUserId: string;
}

export async function rejectMatch(
  prisma: PrismaClient,
  args: RejectMatchArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: args.matchId } });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`rejectMatch: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  return prisma.kpReconcileMatch.update({
    where: { id: args.matchId },
    data: {
      status: "REJECTED",
      reviewReason: null,
      reviewedAt: new Date(),
      reviewedByUserId: args.reviewedByUserId,
    },
  });
}

export interface RemapMatchArgs {
  matchId: string;
  newKpCode: string;
  reviewedByUserId: string;
}

// PENDING_REVIEW → LINKED but with new kpId（用户挑了不同 KP）
export async function remapMatch(
  prisma: PrismaClient,
  args: RemapMatchArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({
    where: { id: args.matchId },
    include: { question: { select: { subjectId: true } } },
  });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`remapMatch: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  const targetKp = await prisma.knowledgePoint.findUnique({
    where: { subjectId_code: { subjectId: match.question.subjectId, code: args.newKpCode } },
  });
  if (!targetKp) {
    throw new Error(`remapMatch: KP code ${args.newKpCode} not found in subject ${match.question.subjectId}`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.kpReconcileMatch.update({
      where: { id: args.matchId },
      data: {
        kpId: targetKp.id,
        matchVia: "MANUAL",
        confidence: 1.0,
        status: "LINKED",
        reviewReason: null,
        reviewedAt: new Date(),
        reviewedByUserId: args.reviewedByUserId,
      },
    });
    await upsertQuestionKpLink(tx, match.questionId, targetKp.id, 1.0);
    return updated;
  });
}

export interface LearnAliasAndLinkArgs {
  matchId: string;
  targetKpCode: string;
  reviewedByUserId: string;
}

// PENDING_REVIEW → LINKED + 写 KpAlias（subject 内冲突防御）
export async function learnAliasAndLink(
  prisma: PrismaClient,
  args: LearnAliasAndLinkArgs,
) {
  const match = await prisma.kpReconcileMatch.findUniqueOrThrow({
    where: { id: args.matchId },
    include: { question: { select: { subjectId: true } } },
  });
  if (match.status !== "PENDING_REVIEW") {
    throw new Error(`learnAliasAndLink: match ${args.matchId} is ${match.status}, expected PENDING_REVIEW`);
  }
  const targetKp = await prisma.knowledgePoint.findUnique({
    where: { subjectId_code: { subjectId: match.question.subjectId, code: args.targetKpCode } },
  });
  if (!targetKp) {
    throw new Error(`learnAliasAndLink: KP code ${args.targetKpCode} not found in subject ${match.question.subjectId}`);
  }

  // 冲突检测（spec §5.4）
  const existingAlias = await prisma.kpAlias.findUnique({
    where: {
      subjectId_normalizedAlias: {
        subjectId: match.question.subjectId,
        normalizedAlias: match.normalizedHint,
      },
    },
  });
  if (existingAlias && existingAlias.kpId !== targetKp.id) {
    throw new KpAliasConflictError(
      { id: existingAlias.id, kpId: existingAlias.kpId, source: existingAlias.source },
      { kpId: targetKp.id, normalizedAlias: match.normalizedHint },
    );
  }

  return prisma.$transaction(async (tx) => {
    if (!existingAlias) {
      await tx.kpAlias.create({
        data: {
          subjectId: match.question.subjectId,
          kpId: targetKp.id,
          normalizedAlias: match.normalizedHint,
          source: "CLI_MANUAL",
          createdByUserId: args.reviewedByUserId,
        },
      });
    }
    const updated = await tx.kpReconcileMatch.update({
      where: { id: args.matchId },
      data: {
        kpId: targetKp.id,
        matchVia: "MANUAL",
        confidence: 1.0,
        status: "LINKED",
        reviewReason: null,
        reviewedAt: new Date(),
        reviewedByUserId: args.reviewedByUserId,
      },
    });
    await upsertQuestionKpLink(tx, match.questionId, targetKp.id, 1.0);
    return updated;
  });
}

// Plan 9 不暴露给 CLI / router；spec §5.5 说明清理规则。
// 仅 export 供 unit test 验证逻辑 + 未来开 ad-hoc 脚本用。
export async function unlinkIfOrphan(
  prisma: PrismaClient,
  args: { questionId: string; kpId: string },
): Promise<{ removed: boolean }> {
  const stillLinked = await prisma.kpReconcileMatch.count({
    where: { questionId: args.questionId, kpId: args.kpId, status: "LINKED" },
  });
  if (stillLinked === 0) {
    await prisma.questionKPLink.deleteMany({
      where: { questionId: args.questionId, kpId: args.kpId },
    });
    return { removed: true };
  }
  return { removed: false };
}
```

- [ ] **步骤 6.2：写 `kp-reconcile-state-machine.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  reconcileHintsSync,
  approveMatch,
  rejectMatch,
  remapMatch,
  learnAliasAndLink,
  unlinkIfOrphan,
} from "@/server/lib/kp-reconcile";

async function seedFixtures() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kpA = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  const kpB = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-substitution", name: "代入消元", difficulty: 2 },
  });
  const q = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
  });
  const u = await prisma.user.create({ data: { persona: "OPS" as never, isMinor: false } });
  return { subjectId: subject.id, kpAId: kpA.id, kpBId: kpB.id, questionId: q.id, userId: u.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("state machine: PENDING_REVIEW 4 个转移 + LINKED orphan 清理", () => {
  it("approve: PENDING_REVIEW → LINKED + 写 QuestionKPLink", async () => {
    const { subjectId, kpAId, questionId, userId } = await seedFixtures();
    // 先制造 PENDING_REVIEW：VARIANT_ITEM EXACT 命中
    await prisma.kpAlias.create({
      data: { subjectId, kpId: kpAId, normalizedAlias: "一元一次方程", source: "SEED" },
    });
    await reconcileHintsSync(prisma, {
      questionId, hints: ["一元一次方程"],
      source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM",
      sourceRefId: "clrelid000000000000000001",
    });
    const m = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId } });
    expect(m.status).toBe("PENDING_REVIEW");

    const updated = await approveMatch(prisma, { matchId: m.id, reviewedByUserId: userId });
    expect(updated.status).toBe("LINKED");
    expect(updated.reviewedByUserId).toBe(userId);
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpAId } },
    });
    expect(link.weight).toBe(1.0);
  });

  it("reject: PENDING_REVIEW → REJECTED + 不写 QuestionKPLink", async () => {
    const { subjectId, kpAId, questionId, userId } = await seedFixtures();
    await prisma.kpAlias.create({
      data: { subjectId, kpId: kpAId, normalizedAlias: "一元一次方程", source: "SEED" },
    });
    await reconcileHintsSync(prisma, {
      questionId, hints: ["一元一次方程"],
      source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM",
      sourceRefId: "clrelid000000000000000002",
    });
    const m = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId } });

    const updated = await rejectMatch(prisma, { matchId: m.id, reviewedByUserId: userId });
    expect(updated.status).toBe("REJECTED");
    expect(await prisma.questionKPLink.count({ where: { questionId } })).toBe(0);
  });

  it("remap: PENDING_REVIEW → LINKED with 新 kpId", async () => {
    const { subjectId, kpAId, kpBId, questionId, userId } = await seedFixtures();
    await prisma.kpAlias.create({
      data: { subjectId, kpId: kpAId, normalizedAlias: "一元一次方程", source: "SEED" },
    });
    await reconcileHintsSync(prisma, {
      questionId, hints: ["一元一次方程"],
      source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM",
      sourceRefId: "clrelid000000000000000003",
    });
    const m = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId } });
    expect(m.kpId).toBe(kpAId);

    const updated = await remapMatch(prisma, {
      matchId: m.id,
      newKpCode: "math-g7-substitution",
      reviewedByUserId: userId,
    });
    expect(updated.status).toBe("LINKED");
    expect(updated.kpId).toBe(kpBId);
    expect(updated.matchVia).toBe("MANUAL");
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpBId } },
    });
    expect(link.weight).toBe(1.0);
  });

  it("learnAliasAndLink: PENDING_REVIEW → LINKED + 写 KpAlias(source=CLI_MANUAL)", async () => {
    const { subjectId, kpAId, questionId, userId } = await seedFixtures();
    // 制造 LLM-band PENDING_REVIEW
    await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "解一元", normalizedHint: "解一元",
        source: "ERROR_ANALYSIS", sourceRefType: "ERROR_BOOK_ENTRY", sourceRefId: "clrelid000000000000000004",
        matchVia: "LLM", confidence: 0.72,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });
    const m = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId } });

    const updated = await learnAliasAndLink(prisma, {
      matchId: m.id,
      targetKpCode: "math-g7-linear-eq",
      reviewedByUserId: userId,
    });
    expect(updated.status).toBe("LINKED");
    expect(updated.matchVia).toBe("MANUAL");

    const alias = await prisma.kpAlias.findUniqueOrThrow({
      where: { subjectId_normalizedAlias: { subjectId, normalizedAlias: "解一元" } },
    });
    expect(alias.kpId).toBe(kpAId);
    expect(alias.source).toBe("CLI_MANUAL");
    expect(alias.createdByUserId).toBe(userId);

    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpAId } },
    });
    expect(link.weight).toBe(1.0);
  });

  it("unlinkIfOrphan: LINKED 的 match 还在 → 不删", async () => {
    const { kpAId, questionId } = await seedFixtures();
    await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "x", normalizedHint: "x",
        source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: questionId,
        matchVia: "EXACT", confidence: 1.0,
        status: "LINKED",
      },
    });
    await prisma.questionKPLink.create({ data: { questionId, kpId: kpAId, weight: 1.0 } });

    const r = await unlinkIfOrphan(prisma, { questionId, kpId: kpAId });
    expect(r.removed).toBe(false);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId: kpAId } })).toBe(1);
  });

  it("unlinkIfOrphan: 没有 LINKED match → 删 QuestionKPLink", async () => {
    const { kpAId, questionId } = await seedFixtures();
    await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "x", normalizedHint: "x",
        source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: questionId,
        matchVia: "EXACT", confidence: 1.0,
        status: "REJECTED",   // 不是 LINKED
      },
    });
    await prisma.questionKPLink.create({ data: { questionId, kpId: kpAId, weight: 1.0 } });

    const r = await unlinkIfOrphan(prisma, { questionId, kpId: kpAId });
    expect(r.removed).toBe(true);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId: kpAId } })).toBe(0);
  });
});
```

- [ ] **步骤 6.3：写 `kp-reconcile-alias-conflict.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { learnAliasAndLink, KpAliasConflictError } from "@/server/lib/kp-reconcile";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("alias 冲突防御（spec §5.4）", () => {
  it("已存在的 alias 指向不同 KP → 抛 KpAliasConflictError，不静默覆盖", async () => {
    const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const kpA = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
    });
    const kpB = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-b", name: "KP-B", difficulty: 2 },
    });
    const q = await prisma.question.create({
      data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const user = await prisma.user.create({ data: { persona: "OPS" as never, isMinor: false } });

    // 已存在 alias: "解题" → kpA
    await prisma.kpAlias.create({
      data: { subjectId: subject.id, kpId: kpA.id, normalizedAlias: "解题", source: "SEED" },
    });

    // PENDING_REVIEW 行 hint = "解题"
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId: q.id, kpId: kpA.id, rawHint: "解题", normalizedHint: "解题",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM",
        sourceRefId: "clrelid000000000000000099",
        matchVia: "ALIAS", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "VARIANT_TO_PARENT_NEEDS_REVIEW",
      },
    });

    // 尝试把 "解题" 学成 kpB → 应抛
    await expect(
      learnAliasAndLink(prisma, {
        matchId: m.id,
        targetKpCode: "kp-b",
        reviewedByUserId: user.id,
      }),
    ).rejects.toBeInstanceOf(KpAliasConflictError);

    // 原 alias 不变
    const alias = await prisma.kpAlias.findUniqueOrThrow({
      where: { subjectId_normalizedAlias: { subjectId: subject.id, normalizedAlias: "解题" } },
    });
    expect(alias.kpId).toBe(kpA.id);
    // match 不变
    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("PENDING_REVIEW");
  });

  it("已存在的 alias 指向相同 KP → 不抛，直接 LINKED（幂等）", async () => {
    const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const kp = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
    });
    const q = await prisma.question.create({
      data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });
    const user = await prisma.user.create({ data: { persona: "OPS" as never, isMinor: false } });

    await prisma.kpAlias.create({
      data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "解题", source: "SEED" },
    });

    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId: q.id, kpId: kp.id, rawHint: "解题", normalizedHint: "解题",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM",
        sourceRefId: "clrelid000000000000000098",
        matchVia: "ALIAS", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "VARIANT_TO_PARENT_NEEDS_REVIEW",
      },
    });

    const updated = await learnAliasAndLink(prisma, {
      matchId: m.id, targetKpCode: "kp-a", reviewedByUserId: user.id,
    });
    expect(updated.status).toBe("LINKED");
    // alias 没新建
    expect(await prisma.kpAlias.count({ where: { subjectId: subject.id } })).toBe(1);
  });
});
```

- [ ] **步骤 6.4：跑测试 + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-state-machine.test.ts tests/integration/kp-reconcile-alias-conflict.test.ts
pnpm.cmd exec turbo typecheck --force
Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse
```

期望：6 + 2 = 8 测例全绿，typecheck 全绿，0 个 it.todo。

- [ ] **步骤 6.5：commit**

```powershell
git add apps/web/server/lib/kp-reconcile.ts apps/web/tests/integration/kp-reconcile-state-machine.test.ts apps/web/tests/integration/kp-reconcile-alias-conflict.test.ts
git commit -m "feat(web): Plan 9 Task 6 — service CLI actions (approve/reject/remap/alias/unlinkIfOrphan) + state machine + alias conflict tests"
```

---

## Task 7：3 个 router body 接入 + 路径专测

> **为什么这时做：** Task 5/6 已经把 service 行为守住，Task 7 只是把 3 个 router body 真的调到。整体改动小。

**Files：**
- Modify: `apps/web/server/routers/tutor.ts`
- Modify: `apps/web/server/routers/error.ts`
- Modify: `apps/web/server/routers/variant.ts`

- [ ] **步骤 7.1：`tutor.ts` 加 reconcile 调用**

在 `apps/web/server/routers/tutor.ts` 顶部 imports 加：

```ts
import { reconcileHintsSync } from "../lib/kp-reconcile.js";
import { logger } from "../logger.js";
```

mutation body 在 `const question = await upsertUserAdhocQuestion(...)` 之后、`return { ...ai, questionId: question.id }` 之前加：

```ts
      // Plan 9: 把 AI 给的 knowledgePoints 字符串落到 QuestionKPLink。
      // try/catch 包住 —— reconcile 失败不能让 tutor.ask 失败（红线 #1）。
      try {
        await reconcileHintsSync(ctx.db, {
          questionId: question.id,
          hints: ai.knowledgePoints,
          source: "TUTOR_ADHOC",
          sourceRefType: "QUESTION",
          sourceRefId: question.id,
        });
      } catch (e) {
        logger.warn({
          event: "kp_reconcile_sync_failed",
          source: "TUTOR_ADHOC",
          questionId: question.id,
          err: String(e),
        });
      }
```

- [ ] **步骤 7.2：`error.ts` 加 reconcile 调用**

同款 import + mutation body：在 `const entry = await ctx.db.$transaction(...)` 之后、`return { entryId: entry.id, ... }` 之前加：

```ts
      try {
        await reconcileHintsSync(ctx.db, {
          questionId: input.questionId,
          hints: ai.suggestedKnowledgePoints,
          source: "ERROR_ANALYSIS",
          sourceRefType: "ERROR_BOOK_ENTRY",
          sourceRefId: entry.id,   // 关键：spec §6.2 — entry.id 不是 diagnoseLedgerId
        });
      } catch (e) {
        logger.warn({
          event: "kp_reconcile_sync_failed",
          source: "ERROR_ANALYSIS",
          entryId: entry.id,
          err: String(e),
        });
      }
```

- [ ] **步骤 7.3：`variant.ts` 加 reconcile 调用（每 item 一次）**

现有 router body 用 `tx.variantItem.createMany(...)` 批量插入，然后 `tx.variantGroup.findUniqueOrThrow({ include: { items } })` 取回，返回到 `result` 变量。`result.items` 是 `VariantItem[]`，每个带 `id` 和 `knowledgePointHints`。

在 `const result = await ctx.db.$transaction(...)` 之后、`return { group: toVariantGroupView(result) };` **之前**加：

```ts
      // Plan 9: 每个 VariantItem 的 knowledgePointHints 都过 reconcile。
      // VARIANT_ITEM 路径在 service 内部不会自动写 parent QuestionKPLink (红线 #2)。
      // 注意：在 $transaction 之外做，避免 reconcile 失败 rollback 已写好的 VariantGroup/Items。
      for (const item of result.items) {
        try {
          await reconcileHintsSync(ctx.db, {
            questionId: ctx.entry.questionId,
            hints: item.knowledgePointHints,
            source: "VARIANT_ITEM",
            sourceRefType: "VARIANT_ITEM",
            sourceRefId: item.id,
          });
        } catch (e) {
          logger.warn({
            event: "kp_reconcile_sync_failed",
            source: "VARIANT_ITEM",
            variantItemId: item.id,
            err: String(e),
          });
        }
      }
```

- [ ] **步骤 7.4：typecheck + 既有 router 套件不回归**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-tutor.test.ts tests/integration/error-diagnose.test.ts tests/integration/variant-generate-for-entry.test.ts
```

期望：typecheck 全绿，3 个既有套件 0 回归。

- [ ] **步骤 7.5：guardrail — 3 处 reconcile 调用都包 try/catch（红线 #1）**

```powershell
Select-String -Path apps/web/server/routers/tutor.ts,apps/web/server/routers/error.ts,apps/web/server/routers/variant.ts -Pattern "reconcileHintsSync" -Context 2,5
```

每处必须出现在 `try { ... } catch` 块内 + `logger.warn` 兜底。

- [ ] **步骤 7.6：commit**

```powershell
git add apps/web/server/routers/tutor.ts apps/web/server/routers/error.ts apps/web/server/routers/variant.ts
git commit -m "feat(web): Plan 9 Task 7 — wire reconcileHintsSync into tutor.ask / error.diagnose / variant.generateForEntry bodies (await + try/catch)"
```

---

## Task 8：CLI `kp:reconcile-pending` (async LLM batch)

> **为什么这时做：** 上游 service + AI 层都就绪；这一步把流水线接通。

**Files：**
- Create: `apps/web/scripts/kp-reconcile-pending.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/tests/integration/kp-reconcile-pending-script.test.ts`

- [ ] **步骤 8.1：新建脚本 `apps/web/scripts/kp-reconcile-pending.ts`**

```ts
#!/usr/bin/env tsx
// Plan 9 spec §4: 异步 LLM batch CLI。
//   pnpm.cmd --filter @zhijiao/web kp:reconcile-pending [-- --limit N]
//
// 取 UNMATCHED 行（按 createdAt asc, limit），按 subjectId 分桶，每个 subject 单独
// 跑 LLM，输出按 matchId 对齐写回。

import { PrismaClient } from "@prisma/client";
import { AiRouter } from "@zhijiao/ai";
import { getAdapter } from "@/lib/ai-client";   // 或现有的 adapter 工厂；按真实导出调整
import { processBatch } from "@/server/lib/kp-reconcile-pending";

async function main() {
  const args = process.argv.slice(2);
  const limitFlag = args.indexOf("--limit");
  const limit = limitFlag >= 0 ? parseInt(args[limitFlag + 1] ?? "50", 10) : 50;
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error(`Invalid --limit: ${args[limitFlag + 1]}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const adapter = getAdapter();    // 真实 / mock 由 env 决定
  const router = new AiRouter({ prisma, adapter });

  try {
    const result = await processBatch(prisma, router, { limit });
    console.log(
      `Done. Total UNMATCHED processed: ${result.totalProcessed}, ` +
        `Batches: ${result.batches.length}.`,
    );
    for (const [i, b] of result.batches.entries()) {
      console.log(
        `  Batch ${i + 1}/${result.batches.length} (subject=${b.subjectId}, hints=${b.hintsCount}): ` +
          `${b.linked} LINKED, ${b.pendingReview} PENDING_REVIEW, ${b.dropped} DROPPED, ${b.failed} FAILED`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **步骤 8.2：把核心逻辑写在 service 层 `apps/web/server/lib/kp-reconcile-pending.ts`**

```ts
import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AiRouter } from "@zhijiao/ai";
import { loadEnv } from "../env.js";

export interface BatchResult {
  subjectId: string;
  hintsCount: number;
  linked: number;
  pendingReview: number;
  dropped: number;
  failed: number;
}

export interface ProcessBatchResult {
  totalProcessed: number;
  batches: BatchResult[];
}

export async function processBatch(
  prisma: PrismaClient,
  router: AiRouter,
  opts: { limit: number },
): Promise<ProcessBatchResult> {
  const env = loadEnv();
  const autoLink = env.KP_RECONCILE_AUTO_LINK_THRESHOLD;
  const review = env.KP_RECONCILE_REVIEW_THRESHOLD;

  const matches = await prisma.kpReconcileMatch.findMany({
    where: { status: "UNMATCHED" },
    orderBy: { createdAt: "asc" },
    take: opts.limit,
    include: { question: { select: { subjectId: true } } },
  });
  if (matches.length === 0) return { totalProcessed: 0, batches: [] };

  // 按 subjectId 分组
  const bySubject = new Map<string, typeof matches>();
  for (const m of matches) {
    const sid = m.question.subjectId;
    if (!bySubject.has(sid)) bySubject.set(sid, []);
    bySubject.get(sid)!.push(m);
  }

  const batches: BatchResult[] = [];
  for (const [subjectId, batchMatches] of bySubject) {
    const candidates = await prisma.knowledgePoint.findMany({ where: { subjectId } });
    if (candidates.length === 0) {
      batches.push({ subjectId, hintsCount: batchMatches.length, linked: 0, pendingReview: 0, dropped: 0, failed: batchMatches.length });
      continue;
    }
    const hints = batchMatches.map((m) => ({
      matchId: m.id,
      rawHint: m.rawHint,
      normalizedHint: m.normalizedHint,
    }));

    const batchSummary: BatchResult = {
      subjectId, hintsCount: batchMatches.length,
      linked: 0, pendingReview: 0, dropped: 0, failed: 0,
    };
    try {
      const llmOut = await router.kpReconcile({
        subjectId,
        candidates: candidates.map((kp) => ({
          id: kp.id,
          code: kp.code,
          name: kp.name,
          description: kp.description,
          parentPath: "数学",   // MVP 简化；真实 parentPath 由独立 plan 完善
        })),
        hints,
      });

      const itemById = new Map(llmOut.items.map((it) => [it.matchId, it]));
      for (const m of batchMatches) {
        const item = itemById.get(m.id);
        if (!item) {
          batchSummary.failed++;
          continue;
        }
        await applyLlmResult(prisma, m, item, llmOut.modelCallId, { autoLink, review });
        if (m.sourceRefType !== "VARIANT_ITEM" && item.confidence >= autoLink && item.kpId) {
          batchSummary.linked++;
        } else if (item.kpId && item.confidence >= review) {
          batchSummary.pendingReview++;
        } else {
          batchSummary.dropped++;
        }
      }
    } catch (e) {
      // 本批整批 PARSE_FAILED / ADAPTER_ERROR / TIMEOUT —— router 已写 ModelCall(状态)
      batchSummary.failed = batchMatches.length;
    }
    batches.push(batchSummary);
  }

  return { totalProcessed: matches.length, batches };
}

async function applyLlmResult(
  prisma: PrismaClient,
  match: { id: string; questionId: string; sourceRefType: string },
  item: { matchId: string; kpId: string | null; confidence: number },
  modelCallId: string,
  thresholds: { autoLink: number; review: number },
) {
  // 状态机分流（spec §3.3 + §4.3）
  const isVariant = match.sourceRefType === "VARIANT_ITEM";

  if (!item.kpId || item.confidence < thresholds.review) {
    // DROPPED
    await prisma.kpReconcileMatch.update({
      where: { id: match.id },
      data: {
        kpId: null,
        matchVia: "LLM",
        confidence: item.confidence,
        status: "DROPPED",
        modelCallId,
      },
    });
    return;
  }

  // confidence >= review
  if (item.confidence >= thresholds.autoLink && !isVariant) {
    // LINKED + 写 QuestionKPLink
    await prisma.$transaction(async (tx) => {
      await tx.kpReconcileMatch.update({
        where: { id: match.id },
        data: {
          kpId: item.kpId,
          matchVia: "LLM",
          confidence: item.confidence,
          status: "LINKED",
          modelCallId,
        },
      });
      // weight=max(existing, confidence)
      const existing = await tx.questionKPLink.findUnique({
        where: { questionId_kpId: { questionId: match.questionId, kpId: item.kpId! } },
      });
      if (!existing) {
        await tx.questionKPLink.create({
          data: { questionId: match.questionId, kpId: item.kpId!, weight: item.confidence },
        });
      } else if (existing.weight < item.confidence) {
        await tx.questionKPLink.update({
          where: { questionId_kpId: { questionId: match.questionId, kpId: item.kpId! } },
          data: { weight: item.confidence },
        });
      }
    });
    return;
  }

  // PENDING_REVIEW
  const reviewReason = isVariant && item.confidence >= thresholds.autoLink
    ? "VARIANT_TO_PARENT_NEEDS_REVIEW"
    : "LLM_CONFIDENCE_BAND";
  await prisma.kpReconcileMatch.update({
    where: { id: match.id },
    data: {
      kpId: item.kpId,
      matchVia: "LLM",
      confidence: item.confidence,
      status: "PENDING_REVIEW",
      reviewReason,
      modelCallId,
    },
  });
}
```

- [ ] **步骤 8.3：`apps/web/package.json` 加 scripts**

```json
{
  "scripts": {
    ...,
    "kp:reconcile-pending": "tsx scripts/kp-reconcile-pending.ts",
    "kp:review": "tsx scripts/kp-review.ts"
  }
}
```

- [ ] **步骤 8.4：写 `kp-reconcile-pending-script.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { processBatch } from "@/server/lib/kp-reconcile-pending";
import { AiRouter } from "@zhijiao/ai";
import { MockAdapter } from "@zhijiao/ai/adapters/mock";

async function seedSubjectKpQuestion() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
  });
  const q = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
  });
  return { subjectId: subject.id, kpId: kp.id, questionId: q.id };
}

async function seedUnmatched(questionId: string, sourceRefType: "QUESTION" | "VARIANT_ITEM", rawHint: string) {
  return prisma.kpReconcileMatch.create({
    data: {
      questionId, kpId: null, rawHint, normalizedHint: rawHint.toLowerCase(),
      source: sourceRefType === "VARIANT_ITEM" ? "VARIANT_ITEM" : "TUTOR_ADHOC",
      sourceRefType, sourceRefId: questionId,
      matchVia: null, confidence: null, status: "UNMATCHED",
    },
  });
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("processBatch (kp-reconcile-pending core)", () => {
  it("confidence ≥ 0.85 + sourceRefType=QUESTION → LINKED + 写 QuestionKPLink", async () => {
    const { subjectId, kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(questionId, "QUESTION", "linear");
    const adapter = new MockAdapter({
      respondWith: () => Promise.resolve({
        content: JSON.stringify([{ matchId: m.id, kpId, confidence: 0.92 }]),
      }),
    });
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 50 });
    expect(r.totalProcessed).toBe(1);
    expect(r.batches[0].linked).toBe(1);

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("LINKED");
    expect(reread.confidence).toBe(0.92);
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId } },
    });
    expect(link.weight).toBe(0.92);
  });

  it("confidence ≥ 0.85 + sourceRefType=VARIANT_ITEM → PENDING_REVIEW + 不写 QuestionKPLink", async () => {
    const { subjectId, kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(questionId, "VARIANT_ITEM", "linear");
    const adapter = new MockAdapter({
      respondWith: () => Promise.resolve({
        content: JSON.stringify([{ matchId: m.id, kpId, confidence: 0.95 }]),
      }),
    });
    const router = new AiRouter({ prisma, adapter });

    await processBatch(prisma, router, { limit: 50 });

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("PENDING_REVIEW");
    expect(reread.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId } })).toBe(0);
  });

  it("confidence 0.6-0.85 → PENDING_REVIEW(LLM_CONFIDENCE_BAND)", async () => {
    const { subjectId, kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(questionId, "QUESTION", "hint-x");
    const adapter = new MockAdapter({
      respondWith: () => Promise.resolve({
        content: JSON.stringify([{ matchId: m.id, kpId, confidence: 0.72 }]),
      }),
    });
    const router = new AiRouter({ prisma, adapter });

    await processBatch(prisma, router, { limit: 50 });

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("PENDING_REVIEW");
    expect(reread.reviewReason).toBe("LLM_CONFIDENCE_BAND");
    expect(reread.confidence).toBe(0.72);
  });

  it("confidence < 0.6 → DROPPED", async () => {
    const { subjectId, kpId, questionId } = await seedSubjectKpQuestion();
    const m = await seedUnmatched(questionId, "QUESTION", "hint-y");
    const adapter = new MockAdapter({
      respondWith: () => Promise.resolve({
        content: JSON.stringify([{ matchId: m.id, kpId, confidence: 0.3 }]),
      }),
    });
    const router = new AiRouter({ prisma, adapter });

    await processBatch(prisma, router, { limit: 50 });

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("DROPPED");
    expect(reread.confidence).toBe(0.3);
  });

  it("--limit 限制取的 UNMATCHED 行数", async () => {
    const { kpId, questionId } = await seedSubjectKpQuestion();
    const ids = [] as string[];
    for (let i = 0; i < 5; i++) {
      const m = await seedUnmatched(questionId, "QUESTION", `hint-${i}`);
      ids.push(m.id);
    }
    const adapter = new MockAdapter({
      respondWith: (req) => {
        const sys = req.messages.find((m) => m.role === "system")?.content ?? "";
        const hintLines = (req.messages.find((m) => m.role === "user")?.content ?? "").match(/matchId=([a-z0-9]+)/g) ?? [];
        const items = hintLines.map((line) => {
          const matchId = line.replace("matchId=", "");
          return { matchId, kpId, confidence: 0.9 };
        });
        return Promise.resolve({ content: JSON.stringify(items) });
      },
    });
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 3 });
    expect(r.totalProcessed).toBe(3);
    // 验：只有 3 条被处理，剩 2 条仍是 UNMATCHED
    const still = await prisma.kpReconcileMatch.count({ where: { status: "UNMATCHED" } });
    expect(still).toBe(2);
  });
});
```

- [ ] **步骤 8.5：跑测试 + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-pending-script.test.ts
pnpm.cmd exec turbo typecheck --force
Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse
```

期望：5 测例全绿，typecheck 全绿，0 个 it.todo。

- [ ] **步骤 8.6：guardrail — LLM 不计 Credit（红线 #9）**

```powershell
Select-String -Path apps/web/scripts/kp-reconcile-pending.ts,apps/web/server/lib/kp-reconcile-pending.ts -Pattern "chargedProcedure|chargeForAction|CreditLedger|priceOf"
```

期望 0 命中。

- [ ] **步骤 8.7：commit**

```powershell
git add apps/web/scripts/kp-reconcile-pending.ts apps/web/server/lib/kp-reconcile-pending.ts apps/web/package.json apps/web/tests/integration/kp-reconcile-pending-script.test.ts
git commit -m "feat(web): Plan 9 Task 8 — kp:reconcile-pending CLI + processBatch service + 5 integration tests"
```

---

## Task 9：CLI `kp:review` 交互脚本

> **为什么这时做：** service 层 5 个行为函数 + state machine 测例都过，CLI 是 thin wrapper，主要是交互细节。

**Files：**
- Create: `apps/web/scripts/kp-review.ts`

- [ ] **步骤 9.1：新建脚本**

```ts
#!/usr/bin/env tsx
// Plan 9 spec §5.2: 交互式 PENDING_REVIEW review CLI。
//   pnpm.cmd --filter @zhijiao/web kp:review
//
// 单键操作：a / r / m <kpCode> / alias <kpCode> / s / q
// 服务层在 server/lib/kp-reconcile.ts 已实现 approve/reject/remap/learnAliasAndLink

import { PrismaClient } from "@prisma/client";
import readline from "node:readline";
import {
  approveMatch,
  rejectMatch,
  remapMatch,
  learnAliasAndLink,
  KpAliasConflictError,
} from "@/server/lib/kp-reconcile";

const REVIEWER_USER_ID = process.env.KP_REVIEW_USER_ID ?? "system-cli";

async function loadPending(prisma: PrismaClient) {
  return prisma.kpReconcileMatch.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    include: {
      kp: { select: { code: true, name: true } },
      question: { select: { id: true, stemMd: true, subjectId: true } },
    },
  });
}

function render(m: Awaited<ReturnType<typeof loadPending>>[number], idx: number, total: number) {
  const reasonStr = m.reviewReason ?? "—";
  const kpStr = m.kp ? `${m.kp.code} "${m.kp.name}"` : "(none)";
  const confStr = m.confidence?.toFixed(2) ?? "—";
  console.log(`\n[${idx + 1}/${total}]  reviewReason=${reasonStr}`);
  console.log(`  Hint:        "${m.rawHint}"`);
  console.log(`  Source:      ${m.source}  refId=${m.sourceRefId}`);
  console.log(`  Suggested:   ${kpStr}  via ${m.matchVia ?? "—"}  confidence=${confStr}`);
  console.log(`  Parent question: ${m.question.id} "${m.question.stemMd.slice(0, 80)}..."`);
}

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
  const prisma = new PrismaClient();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const pending = await loadPending(prisma);
    if (pending.length === 0) {
      console.log("No PENDING_REVIEW matches. ✓");
      return;
    }
    console.log(`Loading PENDING_REVIEW... ${pending.length} entries.`);

    let processed = 0;
    for (const [i, m] of pending.entries()) {
      render(m, i, pending.length);
      const action = (await prompt(rl, `\nAction [a/r/m <code>/alias <code>/s/q]> `)).trim();

      if (action === "q") break;
      if (action === "s" || action === "") continue;
      if (action === "a") {
        await approveMatch(prisma, { matchId: m.id, reviewedByUserId: REVIEWER_USER_ID });
        console.log(`✓ LINKED. Wrote QuestionKPLink(${m.questionId}, ${m.kpId}).`);
        processed++;
        continue;
      }
      if (action === "r") {
        await rejectMatch(prisma, { matchId: m.id, reviewedByUserId: REVIEWER_USER_ID });
        console.log(`✓ REJECTED.`);
        processed++;
        continue;
      }
      if (action.startsWith("m ")) {
        const kpCode = action.slice(2).trim();
        await remapMatch(prisma, { matchId: m.id, newKpCode: kpCode, reviewedByUserId: REVIEWER_USER_ID });
        console.log(`✓ REMAPPED to ${kpCode}.`);
        processed++;
        continue;
      }
      if (action.startsWith("alias ")) {
        const kpCode = action.slice(6).trim();
        try {
          await learnAliasAndLink(prisma, {
            matchId: m.id,
            targetKpCode: kpCode,
            reviewedByUserId: REVIEWER_USER_ID,
          });
          console.log(`✓ LINKED via MANUAL. Wrote KpAlias("${m.normalizedHint}" → ${kpCode}, source=CLI_MANUAL).`);
          processed++;
        } catch (e) {
          if (e instanceof KpAliasConflictError) {
            console.log(`✗ Alias conflict: "${m.normalizedHint}" already maps to kp ${e.existing.kpId} (source=${e.existing.source}).`);
            console.log(`  Plan 9 不提供 alias 覆盖入口；如需改：1) prisma studio 删旧行，2) ad-hoc 脚本。`);
            console.log(`  当前选项：r 拒绝 / m <code> remap 不学 alias / s 跳过。重新选：`);
            i--;   // 让下一轮循环重新处理本条
            continue;
          }
          throw e;
        }
        continue;
      }
      console.log(`Unknown action "${action}". Skipping.`);
    }

    console.log(`\nReviewed ${processed} / queued ${pending.length}. Run again to continue.`);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **步骤 9.2：手测 CLI（不上自动化）**

启动一个 PENDING_REVIEW 场景：

```powershell
# 准备一条 PENDING_REVIEW 数据
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "
  WITH sub AS (SELECT id FROM subjects WHERE code='math'),
       kp  AS (SELECT id FROM knowledge_points WHERE code='math-g7-linear-eq'),
       q   AS (SELECT id FROM questions LIMIT 1)
  INSERT INTO kp_reconcile_matches (id, question_id, kp_id, raw_hint, normalized_hint, source, source_ref_type, source_ref_id, match_via, confidence, status, review_reason, created_at, updated_at)
  SELECT 'clreviewtest000000000001', q.id, kp.id, '手测 hint', '手测 hint', 'TUTOR_ADHOC', 'QUESTION', q.id, 'LLM', 0.72, 'PENDING_REVIEW', 'LLM_CONFIDENCE_BAND', NOW(), NOW()
  FROM q, kp;
"

pnpm.cmd --filter @zhijiao/web kp:review
```

按 `a` 验通过，`s` 跳过，`q` 退出。手测正常即可。

- [ ] **步骤 9.3：guardrail — `unlinkIfOrphan` 未暴露给 router/scripts（红线 #10 / 探针 33）**

```powershell
Select-String -Path apps/web/server/routers,apps/web/scripts -Pattern "unlinkIfOrphan"
```

期望 0 命中。

- [ ] **步骤 9.4：commit**

```powershell
git add apps/web/scripts/kp-review.ts
git commit -m "feat(web): Plan 9 Task 9 — kp:review interactive CLI (a/r/m/alias/s/q)"
```

---

## Task 10：Backfill 脚本 `kp-backfill-variant-items.ts`

**Files：**
- Create: `apps/web/scripts/kp-backfill-variant-items.ts`
- Create: `apps/web/tests/integration/kp-reconcile-backfill.test.ts`

- [ ] **步骤 10.1：新建脚本**

```ts
#!/usr/bin/env tsx
// Plan 9 spec §7.2: 一次性 backfill 现有 VariantItem.knowledgePointHints。
//   pnpm.cmd --filter @zhijiao/web exec tsx scripts/kp-backfill-variant-items.ts
//
// 幂等：靠 KpReconcileMatch @@unique([sourceRefType, sourceRefId, normalizedHint])
// VARIANT_ITEM 路径走 service 内部，命中 exact/alias 也只到 PENDING_REVIEW，不写 parent

import { PrismaClient } from "@prisma/client";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

const BATCH_SIZE = 200;

async function main() {
  const prisma = new PrismaClient();
  let cursor: string | undefined = undefined;
  let totalProcessed = 0;
  let totalLinked = 0;
  let totalQueued = 0;
  let totalSeen = 0;

  try {
    while (true) {
      const items: Array<{
        id: string;
        knowledgePointHints: string[];
        group: { entry: { questionId: string } };
      }> = await prisma.variantItem.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: BATCH_SIZE,
        orderBy: { createdAt: "asc" },
        include: { group: { include: { entry: { select: { questionId: true } } } } },
      });
      if (items.length === 0) break;

      for (const item of items) {
        if (item.knowledgePointHints.length === 0) continue;
        const r = await reconcileHintsSync(prisma, {
          questionId: item.group.entry.questionId,
          hints: item.knowledgePointHints,
          source: "BACKFILL",
          sourceRefType: "VARIANT_ITEM",
          sourceRefId: item.id,
        });
        totalLinked += r.linked;
        totalQueued += r.queued;
        totalSeen += r.alreadySeen;
        totalProcessed++;
      }
      cursor = items[items.length - 1].id;
      console.log(`  Processed ${totalProcessed} items so far (cursor=${cursor})`);
    }
    console.log(
      `\nDone. Items=${totalProcessed}, ` +
        `New: linked=${totalLinked}, queued=${totalQueued}; alreadySeen=${totalSeen}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **步骤 10.2：写 idempotency integration test**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

// 用 reconcileHintsSync 直接模拟 backfill 行为（脚本本体是 thin wrapper）。
// 真正的脚本路径手测：tsx scripts/kp-backfill-variant-items.ts

async function seedVariantItem(opts: { knowledgePointHints: string[] }) {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  const q = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
  });
  const u = await prisma.user.create({ data: { persona: "STUDENT" } });
  const entry = await prisma.errorBookEntry.create({
    data: { userId: u.id, questionId: q.id, status: "ACTIVE", rootCause: "OTHER", rootCauseReasoning: "x" },
  });
  // VariantGroup + VariantItem
  const ledger = await prisma.creditLedger.create({
    data: { walletId: (await prisma.wallet.create({ data: { userId: u.id, balance: 0 } })).id, kind: "DEBIT", delta: -3, balanceAfter: 0, actionKind: "VARIANT_GROUP_GEN", idemKey: `debit:variant_group_gen:${u.id}:bf-test-1` },
  });
  const group = await prisma.variantGroup.create({
    data: { entryId: entry.id, userId: u.id, creditsCost: 3, debitLedgerId: ledger.id },
  });
  const variantItem = await prisma.variantItem.create({
    data: { groupId: group.id, level: "L1", position: 0, stemMd: "x", solutionMd: "y", knowledgePointHints: opts.knowledgePointHints },
  });
  return { questionId: q.id, variantItemId: variantItem.id, kpId: kp.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("kp-backfill-variant-items 幂等", () => {
  it("跑两次产生的 KpReconcileMatch 行数相同 (alreadySeen 计数累计)", async () => {
    const { questionId, variantItemId } = await seedVariantItem({
      knowledgePointHints: ["一元一次方程"],
    });

    // 第一次
    const r1 = await reconcileHintsSync(prisma, {
      questionId,
      hints: ["一元一次方程"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItemId,
    });
    expect(r1.alreadySeen).toBe(0);
    const count1 = await prisma.kpReconcileMatch.count({ where: { sourceRefId: variantItemId } });
    expect(count1).toBe(1);

    // 第二次（同输入）
    const r2 = await reconcileHintsSync(prisma, {
      questionId,
      hints: ["一元一次方程"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItemId,
    });
    expect(r2.alreadySeen).toBe(1);
    const count2 = await prisma.kpReconcileMatch.count({ where: { sourceRefId: variantItemId } });
    expect(count2).toBe(1);
  });

  it("backfill 命中 EXACT 仍走 VARIANT 路径 PENDING_REVIEW，不写 parent QuestionKPLink", async () => {
    const { questionId, variantItemId, kpId } = await seedVariantItem({
      knowledgePointHints: ["一元一次方程"],
    });

    await reconcileHintsSync(prisma, {
      questionId,
      hints: ["一元一次方程"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItemId,
    });

    const m = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { sourceRefId: variantItemId } });
    expect(m.status).toBe("PENDING_REVIEW");
    expect(m.reviewReason).toBe("VARIANT_TO_PARENT_NEEDS_REVIEW");
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId } })).toBe(0);
  });
});
```

- [ ] **步骤 10.3：跑测试 + guardrail**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-backfill.test.ts
Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse
```

期望：2 测例全绿，0 个 it.todo。

- [ ] **步骤 10.4：commit**

```powershell
git add apps/web/scripts/kp-backfill-variant-items.ts apps/web/tests/integration/kp-reconcile-backfill.test.ts
git commit -m "feat(web): Plan 9 Task 10 — kp-backfill-variant-items.ts (idempotent, BACKFILL+VARIANT_ITEM path)"
```

---

## Task 11：全量回归 + CLAUDE.md 更新 + Merge 验收清单

**Files：**
- Modify: `CLAUDE.md`

- [ ] **步骤 11.1：全量回归**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望 4 项全绿。

- [ ] **步骤 11.2：CLAUDE.md "## 开始实现时（已落地）" 加 Plan 9 条目**

在 Plan 8 条目之后追加：

```markdown
- **Plan 9**（知识点 reconciler：hint→KP 结构化映射 + KpReconcileMatch 审计队列 + CLI 异步 LLM/review）—— 见 `docs/superpowers/plans/2026-05-25-kp-reconciler.md`，spec 在 `docs/superpowers/specs/2026-05-25-kp-reconciler-design.md`
```

- [ ] **步骤 11.3：在 "答疑题面持久化现状" 段之后加 "知识点结构化现状（Plan 9）"**

```markdown
**知识点结构化现状**（Plan 9）：
- `QuestionKPLink` 仍是唯一权威映射，新表 `KpAlias`（subject 内 normalizedAlias 唯一）+ `KpReconcileMatch`（hint→kp 审计队列）做支撑
- `reconcileHintsSync(prisma, { questionId, hints, source, sourceRefType, sourceRefId })` 在 `tutor.ask` / `error.diagnose` / `variant.generateForEntry` 三处 body 接入，**await + try/catch**，失败不破坏主流程
- 同步只跑 EXACT (KP.name/code) → ALIAS 表 → 命中即 LINKED + upsert QuestionKPLink（weight=max(existing, 1.0)）
- 关键：`sourceRefType=VARIANT_ITEM` 永不自动写 parent QuestionKPLink（变式题 hint 可能跨原题域），命中 EXACT/ALIAS 也只到 PENDING_REVIEW(reviewReason=VARIANT_TO_PARENT_NEEDS_REVIEW)；判分流条件是 sourceRefType 不是 source
- 异步 LLM 走 `pnpm.cmd --filter @zhijiao/web kp:reconcile-pending [-- --limit N]`，三档 (≥0.85 / ≥0.6 / <0.6) 分流 LINKED / PENDING_REVIEW(LLM_CONFIDENCE_BAND) / DROPPED；matchId 对齐写回（不靠 rawHint）；LLM 漏返/重复 retry 2 次再 PARSE_FAILED；多返不属于本批 matchId 静默忽略
- 人工 review 走 `pnpm.cmd --filter @zhijiao/web kp:review`，单键 a/r/m <code>/alias <code>/s/q；service 层 `apps/web/server/lib/kp-reconcile.ts` 的 `approveMatch / rejectMatch / remapMatch / learnAliasAndLink / unlinkIfOrphan` 5 个函数可被未来 `/ops/kp-reconcile` Web 页面复用
- alias 冲突防御：`learnAliasAndLink` 检测 `(subjectId, normalizedAlias)` 已映射到不同 KP → 抛 `KpAliasConflictError`，不静默覆盖
- LLM 不计 Credit（系统维护任务），只写 `ModelCall(taskKind="KP_RECONCILE")`；`taskKind` 字面值，不引入 enum
- KpAlias 初始 seed 10 条 math 别名 (`packages/db/prisma/seed/2_kp_aliases.ts`)；后续靠 CLI `alias <code>` 慢慢沉淀
- backfill: `pnpm.cmd --filter @zhijiao/web exec tsx scripts/kp-backfill-variant-items.ts` 一次性扫现有 VariantItem.knowledgePointHints，幂等

**Plan 9 未完成的事 —— 等后续 plan**：
- Web `/ops/kp-reconcile` 页面（等真有 OPS / 教师角色）
- CLI 暴露 LINKED→REJECTED 反悔入口（只 export `unlinkIfOrphan` helper，文档化清理 SQL）
- cron 自动跑 `kp:reconcile-pending`（成本不可见，暂手动）
- KP 树扩充（独立 plan）
- VariantItem 升格成独立 Question（独立 plan / Plan 12 题库去重时考虑）
```

- [ ] **步骤 11.4：CLAUDE.md "Merge 后必跑" 加 5 条新探针 30-34**

```markdown
30. **KpAlias subject 隔离 unique idx 落库**（Plan 9 §2.1）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d kp_aliases"` 应见 `UNIQUE (subject_id, normalized_alias)`。同 alias 跨 subject 允许，同 subject 内唯一
31. **三个 sync 调用点都包 try/catch**（Plan 9 §3.4.2 / 红线 #1）：`Select-String -Path apps/web/server/routers/tutor.ts,apps/web/server/routers/error.ts,apps/web/server/routers/variant.ts -Pattern "reconcileHintsSync" -Context 2,5` 每处必须出现在 `try { ... } catch` 块内 + `logger.warn` 兜底
32. **sourceRefType=VARIANT_ITEM 永不写 QuestionKPLink**（Plan 9 §3.3 / 红线 #2）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant.test.ts` 应全绿（含 BACKFILL+VARIANT_ITEM 测例守门 source vs sourceRefType 分流条件）
33. **LINKED→REJECTED 反悔入口未暴露**（Plan 9 §5.5 / 红线 #10）：`grep -rn "unlinkIfOrphan" apps/web/server/routers apps/web/scripts` 应 0 命中。Plan 9 只 export helper + 文档化清理 SQL；unit test import 它走 helper 不算"用户入口"
34. **backfill 脚本幂等**（Plan 9 §7.2）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-backfill.test.ts` 应全绿（覆盖第二次跑 alreadySeen 计数 + 行数不变）
```

- [ ] **步骤 11.5：CLAUDE.md "下一步候选 Plan" 移走 Plan 9 + Plan 10/11 更新依赖**

把现有 "下一步候选 Plan" 段改为：

```markdown
**下一步候选 Plan**（Plan 4 + Plan 8 + Plan 9 已落地）：
- Plan 5: 真接阿里云 SMS + 微信公众号（ICP 备案通过后；**且 Plan 2 Hardening 必须先 ship**；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
- Plan 6: PII 治理（用户注销 / 去标识化 / `WechatPayEvent.rawBody` 保留期 / `TopupOrder` 孤儿订单清理 / `ErrorBookEntry` 用户注销时去标识化 / `Question.USER_ADHOC` 孤儿清理 + 注销时去标识化 / `KpReconcileMatch.reviewedByUserId` 注销时 SetNull —— 已实现）—— **Plan 3 prod ship prereq**
- Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 商户证书；激活 `RealWechatPayAdapter.unifiedOrder` + `verifyNotify`）—— **Plan 3 prod ship prereq**
- Plan 10: 教师端"分层作业"基于错题本扩展（教师可看班级错题热度图，按错因 / KP 分类布置分层作业 —— **Plan 9 接通后**有 KP id 数据可用）
- Plan 11: 学情画像 / 趋势报告（学生掌握度 + 薄弱点 + 趋势画像；家长简版报告 —— **Plan 9 接通后**有 KP id 数据可用）
- Plan 12: 题库去重 / PUBLISHED 复用 / 统计归并 + VariantItem 升格为独立 Question（Plan 8 §6.2 + Plan 9 §10.3 punt）
- Plan 13: KP 树扩充（small / middle / high school math KP curation；当前 seed 仅 4 个 math KP，alias 表长得慢，Plan 9 上线一段时间后 UNMATCHED → DROPPED 比例高）
```

- [ ] **步骤 11.6：最后一次全量回归**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望全绿。

- [ ] **步骤 11.7：commit**

```powershell
git add CLAUDE.md
git commit -m "docs(claude): Plan 9 Task 11 — Plan 9 landed + Merge probes 30-34 + candidates updated"
```

回主仓 master 等待用户 review，按 `zhijiao-merge-workflow` memory 工艺 merge：

```powershell
# 主仓 master 上
git switch master
git merge --no-ff plan-9-kp-reconciler -m "Merge plan-9-kp-reconciler: 知识点 reconciler (Plan 9)"
git worktree remove .claude/worktrees/plan-9-kp-reconciler   # Windows path-too-long 可失败，留空壳
git worktree prune
git branch -d plan-9-kp-reconciler
```

Merge 后必跑 CLAUDE.md "Merge 后必跑" 全部探针（含新加 30-34）。

**注意（Plan 8 merge 经验，已固化为探针 29）：** Plan 9 加了新 Prisma 字段 + 新 model，主 worktree merge 后必须先：

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
```

再跑 typecheck，否则 stale Prisma Client 会在 typecheck 报找不到 `kpAlias / kpReconcileMatch`。

**收尾运行（spec §7.3）：** Plan 9 merge 后必跑一次（写进 plan 收尾 + CLAUDE.md "Merge 后必跑" 隐含）：

```powershell
pnpm.cmd --filter @zhijiao/web exec tsx scripts/kp-backfill-variant-items.ts
pnpm.cmd --filter @zhijiao/web kp:reconcile-pending
pnpm.cmd --filter @zhijiao/web kp:review
```

---

## 完成条件

- [ ] 所有 Task 1-11 步骤勾完
- [ ] `pnpm.cmd exec turbo typecheck --force` 全绿
- [ ] `pnpm.cmd exec turbo test --force` 全绿（含 Plan 9 新加 19 个测例：1 AI unit + 5 sync integration + 6 state machine + 2 alias conflict + 1 subject isolation + 2 backfill + 5 pending-script - 拆下来 = 22 ish；以实际跑出为准）
- [ ] `pnpm.cmd --filter @zhijiao/web exec next build` exit 0
- [ ] `pnpm.cmd --filter @zhijiao/web exec playwright test` 全绿（无 E2E 改动，零回归）
- [ ] CLAUDE.md 加 Plan 9 条目 + "知识点结构化现状" 段 + "Merge 后必跑" 加 5 条新探针 30-34 + 候选 Plan 重排（含 Plan 10/11/12/13）
- [ ] **Task 5 关键守门**：`kp-reconcile-sync-variant.test.ts` 3 测例全绿（含 BACKFILL+VARIANT_ITEM 守门 source vs sourceRefType 分流条件，红线 #2）
- [ ] **Task 6 alias 冲突守门**：`kp-reconcile-alias-conflict.test.ts` 2 测例全绿
- [ ] **Task 7 零回归证明**：`charged-procedure-tutor.test.ts` + `error-diagnose.test.ts` + `variant-generate-for-entry.test.ts` 全绿
- [ ] **`Select-String apps/web/tests,packages/ai/tests -Pattern "it\.todo" -Recurse` 0 命中**
- [ ] **Prisma migration checksum 一致**：`prisma migrate status` 输出 `Database schema is up to date!`
- [ ] **`unlinkIfOrphan` 未暴露**：`grep -rn "unlinkIfOrphan" apps/web/server/routers apps/web/scripts` 0 命中
- [ ] **LLM 不计 Credit**：`grep -rn "chargedProcedure\|chargeForAction\|CreditLedger\|priceOf" apps/web/scripts/kp-* apps/web/server/lib/kp-*` 0 命中
- [ ] Merge commit message 引用 spec 路径

---

## 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| Schema 改动 `prisma migrate dev --create-only` 报缺 opposite relation | Task 1 步骤 1.3 失败 | 红线 #8：检查 Subject / KnowledgePoint / Question / User / ModelCall 5 个 model 的反向字段，按 spec §2.3 补齐 |
| Sync reconcile 在 router 内部抛错破坏 tutor.ask / error.diagnose / variant.generateForEntry 主流程 | Task 7 之后跑 `charged-procedure-tutor.test.ts` 等既有套件红 | 红线 #1：检查 3 处 reconcile 调用是否都包 try/catch + logger.warn；Service 层内部任何抛错都不能逃出 |
| VARIANT_ITEM 命中 exact/alias 时写了 parent QuestionKPLink | Task 5 步骤 5.5 `kp-reconcile-sync-variant.test.ts` 红 | 红线 #2：service 层 `writesToParent = args.sourceRefType !== "VARIANT_ITEM"`，分支条件检查 |
| LLM 输出对齐异常（matchId 漏返/重复）导致写错 row | Task 3 步骤 3.6 `kp-reconciliation.test.ts` "漏返一个 matchId" 测例红 | router 内 `hasAllMatchIds && hasNoDuplicates` 校验，不通过走 retry；3 次仍异常走 PARSE_FAILED 不写回 |
| `alias <kpCode>` 命令静默覆盖了已有别名 | Task 6 步骤 6.3 `kp-reconcile-alias-conflict.test.ts` 红 | `learnAliasAndLink` 必须先 findUnique 检查 `(subjectId, normalizedAlias)`，已存在不同 kpId → 抛 `KpAliasConflictError` |
| KpAlias seed 名字对不上现有 KP code | Task 2 步骤 2.3 `console.warn` 大量出现 | grep `packages/db/prisma/seed/0_curriculum.ts` 的 kpCode 校准 `2_kp_aliases.ts` |
| `unlinkIfOrphan` 被误暴露到 router/CLI | Task 9 步骤 9.3 grep 命中 | 只 export 给 unit test 用，不在 CLI / router 调用；本 plan 无反悔功能 |
| Prisma client stale 导致 typecheck 报找不到 `kpAlias / kpReconcileMatch` | Merge 后跑 typecheck 红 | 沿用 Plan 8 merge 经验（探针 29）：先 `pnpm.cmd --filter @zhijiao/db db:generate` 再 typecheck |
| env validator: `KP_RECONCILE_REVIEW_THRESHOLD >= AUTO_LINK` | Task 4 步骤 4.3 env 测例红 | env.ts superRefine 顺序：把 review >= auto-link 的 issue.addIssue 在 schema parse 之后调用 |
| `kp:reconcile-pending` LLM 调用烧很多 token 但没结果 | 跑了几批 confidence 都低 / NO_MATCH | 这是 Plan 9 上线初期已知设计代价（spec §10.1）：KP 树稀疏 + alias 表小。先 `--limit 5` 小批跑校准 prompt 质量；不解就停 + alias 表手工补 |

---

## 附录：与 Plan 4 / Plan 8 工艺一致性

| 工艺 | Plan 4 / Plan 8 来源 | Plan 9 沿用 |
|---|---|---|
| middleware 显式 chain 顺序 | Plan 4 §4.2 / Plan 8 §3.1 | N/A（Plan 9 不引入新 middleware；reconcile 在 mutation body 内调用） |
| `chargeMiddleware(kind)` factory | Plan 4 Task 3 | N/A（Plan 9 不计费） |
| `migrate dev --create-only` → raw SQL → `migrate dev` | Plan 4 / Plan 8 Task 1 | 简化：本 plan 无需 raw SQL，直接 `migrate dev`（Task 1 步骤 1.3-1.4） |
| P2002 catch → no-op 幂等 | Plan 8 `upsertUserAdhocQuestion` | 一致（`reconcileHintsSync` 内 try/catch P2002 → `alreadySeen++`） |
| 每个 task 一个 commit + 引用 task 编号 | Plan 4 红线 #14 / Plan 8 红线 #14 | 一致 |
| `pnpm.cmd`（PowerShell execution policy）| Plan 4 红线 #15 | 一致 |
| Vitest `it.todo` / 空 body 防御 | Plan 4 红线 #16 / Plan 8 红线 #12 | 一致（每 task commit 前 grep） |
| `next build` 是 UI task 的 commit prereq | Plan 4 Task 6 followup / Plan 8 红线 #13 | N/A（Plan 9 无 UI 改动） |
| 收尾走 `zhijiao-merge-workflow`（无 GitHub remote）| Plan 4 / Plan 8 Task 8 | 一致（Task 11 步骤 11.7） |
| Spec 是真理来源 + plan 引用章节号 | Plan 4 / Plan 8 | 一致 |
| OPS 操作走 CLI 不走 Web | Plan 9 新工艺 | 本 plan 引入（memory [[zhijiao-single-dev-no-ops-ui]]） |
| 中文输出 | Plan 4 / Plan 8 | 一致（memory [[zhijiao-chinese-default]]） |
| Plan 9 后 merge 必跑 `db:generate` | Plan 8 merge 经验（探针 29）| 一致（Task 11 步骤 11.7 末段提醒） |
