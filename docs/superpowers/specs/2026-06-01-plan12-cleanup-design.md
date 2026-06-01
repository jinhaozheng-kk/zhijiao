# Plan 12 cleanup 设计 — VariantItem.questionId NOT NULL + 退役 legacy reconcile 分支

> 状态：设计已评审（3 subagent 评审融入）。落地见 `docs/superpowers/plans/2026-06-01-plan12-cleanup.md`（待 writing-plans 生成）。
> 关联：Plan 12（`docs/superpowers/specs/2026-05-27-variant-question-promotion-design.md`）的收尾；Plan 9 KP reconciler（`2026-05-25-kp-reconciler-design.md`）。

## §0 一句话目标

完成 Plan 12「VariantItem 升格成独立 Question」的收尾：把 `VariantItem.questionId` 从 nullable 过渡字段升为 **NOT NULL**，**退役** `isVariantPendingLegacy` 分支与 `VARIANT_TO_PARENT_NEEDS_REVIEW` 旧概念，使变式题的 KP hints 在 **同步 + 异步** reconcile 两条路径都 link 到 **变式题自己的 Question**（而非 parent），并保持红线 #2（service 层永不自动写 **parent** QuestionKPLink）不变。

## §1 数据现状（grounding）

2026-06-01 实测主 dev DB（DB 在跑）：

| 计数 | 值 |
|---|---|
| `variant_items` 总行 | 0 |
| `variant_items WHERE question_id IS NULL` | 0 |
| `kp_reconcile_matches WHERE review_reason='VARIANT_TO_PARENT_NEEDS_REVIEW'` | 0 |
| 其中 `status='PENDING_REVIEW'` | 0 |

单人本地、无 GitHub remote、无其它环境（memory `zhijiao-merge-workflow`）。**结论**：NOT NULL migration 立即安全（0 null），「迁移历史 legacy 行」无真实数据可迁——纯防御代码，按 YAGNI **不做** 一次性 legacy-upgrade 脚本；改用 schema 自守卫（`SET NOT NULL` 全表校验，遇 null 即 abort）。

## §2 问题诊断（为什么 legacy 概念两处都活着）

`VARIANT_TO_PARENT_NEEDS_REVIEW` 在 **两处** 被写，不是单一 dead branch：

1. **同步路径** `kp-reconcile.ts::reconcileHintsSync`：`VariantItem` 缺失或 `questionId==null` → `isVariantPendingLegacy=true` → `PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)`（`kp-reconcile.ts:226-239`）。NOT NULL 后此分支对「存在的 variant item」永不可达。
2. **异步 LLM 路径** `kp-reconcile-pending.ts::applyLlmResult`：高置信（≥autoLink）的 VARIANT_ITEM 命中 **不** 自动 link，而是 `PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)`（`:196-199`）。

第 2 处之所以存在，是因为同步 **UNMATCHED** 分支（`kp-reconcile.ts:240-251`）写 match 行时用 `...args` → `questionId = args.questionId = ctx.entry.questionId`（**parent**，见 `variant.ts:132`）。于是异步 LLM 若对这些行自动 link，`upsertQuestionKpLink(match.questionId, …)` 会写到 **parent**，违反红线 #2。当前的「VARIANT→PENDING_REVIEW」就是防 parent 污染的闸门。

**根因**：同步 LINKED 分支用变式题 id（`linkedQuestionId`，`:194-209`），但 UNMATCHED 分支用 parent id。id 不一致是 Plan 12 过渡期的产物。

`variant.ts:123-124` 的注释「命中 EXACT/ALIAS 也只到 PENDING_REVIEW」是 **Plan 12 前的陈旧注释**，与现码（变式 EXACT/ALIAS 已 LINKED 到变式题）矛盾，一并修。

## §3 设计

### §3.1 Schema（`packages/db/prisma/schema.prisma`）

- `VariantItem.questionId String? @unique` → `String @unique`；relation `question Question? @relation(... onDelete: Restrict)` → `question Question @relation(... onDelete: Restrict)`（`Restrict` 不变）。
- `KpReconcileReviewReason` 枚举：`VARIANT_TO_PARENT_NEEDS_REVIEW` **保留为惰性 tombstone**，加 `// @deprecated Plan 12 cleanup：不再被任何代码读写；Postgres 无 DROP VALUE，保留为历史 tombstone` 注释。**不做** enum-recreation migration。

### §3.2 Migration

- 单条：`ALTER TABLE "variant_items" ALTER COLUMN "question_id" SET NOT NULL;`
- 仅翻转列 nullability；既有 `variant_items_question_id_key` unique 索引与 FK **不** 重建；`Restrict` 与 NOT NULL 正交，无交互。
- **自守卫**：`SET NOT NULL` 触发全表校验，遇任何 null 即 abort（`column "question_id" contains null values`）。0 行即时通过。**无需** 前置 backfill。
- 授权方式沿用仓库惯例：`schema.prisma` 改 → `prisma migrate diff --create-only`（或手写 `migration.sql`）→ `pnpm db:migrate`；Windows AV 拦 P1000 时走 `docker exec … psql` 应用（`README.md:76`）。

### §3.3 同步 reconcile（`kp-reconcile.ts::reconcileHintsSync`）

- VARIANT_ITEM 解析：`findUnique` + `isVariantPendingLegacy` → **`findUniqueOrThrow`**（`questionId` 现恒非空；item 缺失=数据损坏 → throw，由调用方 try/catch 兜底）。删除 `isVariantPendingLegacy` 变量与整条 legacy 分支。
- **🔑 Linchpin**：VARIANT_ITEM 路径的 match 行 `questionId` 在 **所有分支**（LINKED **和 UNMATCHED**）一律存 `linkedQuestionId`（= 变式题 id）。即 UNMATCHED 分支不再 `...args`（parent），改写 `questionId: linkedQuestionId`。这是异步自动 link 落在变式题、不污染 parent 的前提。
- 候选加载 **维持用 parent**（`args.questionId`）：变式题与 parent 同 `subjectId`（`createVariantQuestion` ← `ctx.entry.question.subjectId`，恒等），切到变式题为无差别 churn，不改。
- 变式 EXACT/ALIAS → LINKED + 变式题 QuestionKPLink（行为不变）；变式 UNMATCHED → match 行记在变式题（id 修正）。
- 红线 #2 不变：永不写 **parent** QuestionKPLink。修 `variant.ts:123-124` 陈旧注释。

### §3.4 异步 LLM reconcile（`kp-reconcile-pending.ts::applyLlmResult`）

- 删 `isVariant` 特例：高置信（≥autoLink）VARIANT_ITEM 命中与其它 source 一致 **自动 LINKED** 到 `match.questionId`（§3.3 后即变式题）+ 写其 QuestionKPLink。band 区间 reviewReason 恒 `LLM_CONFIDENCE_BAND`。
- `isVariant` / `match.sourceRefType` 若因此变 unused 一并清。
- **行为变化（显式）**：变式题 LLM 高置信命中不再排人工 review，直接 link。与同步 EXACT/ALIAS 对称。

### §3.5 不变式（invariant）

- 红线 #2 收窄为精确表述：**永不写 parent 的 QuestionKPLink**；写 **变式题自己** 的 QuestionKPLink 是 Plan 12 的正确目标。
- match 唯一键 `@@unique([sourceRefType, sourceRefId, normalizedHint])` 不含 questionId → 改存 id 不影响幂等/upsert。
- review CLI service 层（`approveMatch`/`remapMatch`/`learnAliasAndLink`）写 `upsertQuestionKpLink(tx, match.questionId, …)`；变式行的 `match.questionId` 现为变式题 → 正确。

## §4 脚本与配置

- 退役 `apps/web/scripts/variant-backfill-questions.ts`（null→Question backfill；NOT NULL 后只能返 0 行）。
- 删 `apps/web/package.json:17` `"variant:backfill-questions"` script。
- 保留 `apps/web/scripts/kp-backfill-variant-items.ts`（KP-hint backfill；经更新后的同步路径产出变式题 link）。其循环无 per-item try/catch；`findUniqueOrThrow` 下若 item 中途被删会 abort 整批——概率极低（迭代真实行），**本 plan 不加**（记此取舍，未来如需可补）。
- 修 `apps/web/scripts/kp-review.ts:55` "Parent question" 标签——对变式行已不准（现显示变式题）。改中性措辞（如 "question"）。

## §5 测试矩阵（churn 清单）

> 标准规则：禁 `it.todo` / 空 body 假绿；删除即删（功能退役，promotion 由 NOT NULL schema 强制，无覆盖洞）；rewrite 必须真断言。

| 文件 | 动作 | 要点 |
|---|---|---|
| `kp-reconcile-sync-variant-legacy.test.ts` | **DELETE** | 整文件测 null-questionId→PENDING_REVIEW；seed `questionId:null` NOT NULL 后无法编译 |
| `kp-reconcile-sync-variant.test.ts` | **REWRITE** | 3 例用 fake id 走 missing→PENDING_REVIEW；改 seed **真 promoted VariantItem**（镜像 `-promoted` 的 `seedPromotedVariant`）；保留独有的 `source=BACKFILL + sourceRefType=VARIANT_ITEM` 判别例（现 LINK 到 **变式题**）；EXACT/ALIAS happy 已被 `-promoted` 覆盖，不重复。**保 probe 32 文件名** |
| `kp-reconcile-state-machine.test.ts` | **REWRITE** | L38/62/80/199 用 fake VARIANT_ITEM id 制造 PENDING_REVIEW；`findUniqueOrThrow` 下抛错，且 VARIANT_ITEM 不再产 PENDING_REVIEW。改用 **直接 insert PENDING_REVIEW 行** 或 LLM band 路径制造 review 态 fixture |
| `kp-reconcile-pending-script.test.ts` | **UPDATE** | "VARIANT_ITEM→PENDING_REVIEW" 例（`:93-116`）翻成 LINKED；seed 须为 **真 promoted variant** 使行 `questionId=变式题`，断言 link 落 **变式题**、parent count=0（否则锁死污染 bug） |
| `kp-reconcile-alias-conflict.test.ts` | **UPDATE** | `:36`/`:83` 手建 fixture 的 `reviewReason` → `LLM_CONFIDENCE_BAND`（不再引 tombstone）|
| `kp-reconcile-backfill.test.ts` | **UPDATE** | `:106-126` BACKFILL 例断言 PENDING_REVIEW+tombstone（`:122-123`）→ LINKED-to-变式题；两例 seed 均需补 `questionId`（NOT NULL）|
| `variant-backfill-questions.test.ts` | **DELETE** | import 退役脚本；断言 `questionId:null` 计数 |
| `variant-backfill-race.test.ts` | **DELETE** | 同上 |
| `kp-reconcile-sync-variant-promoted.test.ts` | **不动** | 已覆盖 LINKED-to-变式 + 红线 #2（parent=0），仍是 canonical 守门 |

## §6 文档与探针

- `docs/claude/implementation-state.md`：Plan 12 现状段（约 :80/:104/:106 两阶段 null/non-null 分流 + 「历史 VARIANT_TO_PARENT_NEEDS_REVIEW punt」）改写为「单路径：VARIANT_ITEM 恒 LINK 变式题；枚举值为 tombstone」。
- `docs/claude/merge-verification.md` 探针：
  - **32**（sync-variant 文件 + BACKFILL+VARIANT_ITEM 守门）→ 措辞改「LINKED-to-变式」
  - **34**（backfill 测试）→ 措辞改（PENDING_REVIEW→LINKED）
  - **42**（`\d variant_items` 见 question_id/unique/RESTRICT）→ 追加断言列为 `not null`
  - **43**（三条 count=0 子探针）→ 第 1 条 `question_id IS NULL` 改为 schema NOT-NULL 列检查（并入 probe 42）；第 2/3 条（`source=VARIANT_GENERATED`、`created_by` 完整性）仍是有效不变式，**保留**
  - **46**（`variant:backfill-questions --dry-run` smoke）→ **删除**（脚本退役），重编号
  - **44**（`-promoted` 测试，红线 #2 canonical 守门）→ **保留不变**
- `CLAUDE.md:134`「Plan 12 cleanup」候选项 → 标记已落地（移入「已落地」段，追加 Plan 12 cleanup 条目）。

## §7 验证

`pnpm db:migrate`（迁移应用）→ `pnpm typecheck` → 全量 `pnpm test`（unit+integration）→ E2E（变式流若触及；评审确认 `apps/web/e2e/` 无 variant-reconcile 断言，预期不受影响）。每 commit 前跑假绿探针：`Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse` 期望 0。

## §8 范围

**做**：§3 schema + 两路径 reconcile + §4 脚本/配置 + §5 测试 churn + §6 文档/探针。
**不做**（YAGNI / 0 数据）：一次性 legacy-row upgrade 脚本；enum-recreation 移除 tombstone 值；`kp-backfill-variant-items.ts` per-item try/catch 加固。

## §9 任务划分（给 writing-plans 参考）

建议 5 task，每 task 一 commit、message 引用 task 号：

- **Task 1**：Schema NOT NULL migration + 枚举 tombstone 注释（`prisma migrate diff --create-only` 生成 / 手写 `migration.sql`；Windows docker-exec 应用）。验：迁移应用、`\d variant_items` question_id NOT NULL。
- **Task 2**：`kp-reconcile.ts` 同步路径——`findUniqueOrThrow`、删 legacy 分支、UNMATCHED 存 `linkedQuestionId`（linchpin）、修 `variant.ts:123-124` 注释。
- **Task 3**：`kp-reconcile-pending.ts` 异步路径——删 `isVariant` 特例、变式高置信自动 LINK。
- **Task 4**：测试 churn（§5 全部 9 文件）+ `kp-review.ts:55` 标签。**先确认两路径改完再改测试**，逐文件跑。
- **Task 5**：退役 `variant-backfill-questions.ts` + `package.json:17` script + 其 2 测试；文档/探针（§6）；全量回归 + CLAUDE.md。
