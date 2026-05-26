# 智教 · Plan 12 VariantItem 升格成独立 Question Design

> Spec 是 Plan 12 的真理来源；实现 plan 引用本 spec 章节号。

## §1 目标 + 范围 + 显式 punt

**目标：** 把 `VariantItem` 升格成挂在 `Question` 上的独立行，让 Plan 9 reconciler 的 `sourceRefType=VARIANT_ITEM` 命中 EXACT/ALIAS 时能直接 `LINKED` 到 variant 自己的 `QuestionKPLink`（不再 `PENDING_REVIEW`），为 Plan 10/11（学情画像 / 教师分层作业）的 KP 命中数据基础铺路。Plan 9 §10.3 punt（"VariantItem 升格成独立 Question → 独立 plan / Plan 12"）在此收口。

**核心架构 4 条：**

1. **`VariantItem.questionId` 1:1 link 到 Question + 同事务双写** —— `variant.generateForEntry` 创建 VariantItem 同事务建 Question(source="VARIANT_GENERATED")，stemMd 在 Question 与 VariantItem 双写；variant write-once 语义保证 drift≈0；`VariantItem.solutionMd` 仍留作变式自有展示数据（不建 QuestionAnswer）。
2. **`VariantItem.questionId` Plan 12 阶段保持 nullable + 必跑 backfill 到 0 残留** —— schema 不引入 NOT NULL 约束（避免 two-phase migration 复杂度）；CLI `variant:backfill-questions` 幂等扫历史行；后续独立 cleanup plan 加 NOT NULL + 下线 nullable 分支。
3. **Plan 9 reconciler 两阶段切换** —— `questionId != null` → EXACT/ALIAS 命中直接 `LINKED` 到 variant Question 的 `QuestionKPLink`（`KpReconcileMatch.questionId` 与 `QuestionKPLink.questionId` 同步指向 variant.questionId）；`questionId == null` → 保留旧 `PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)` 路径作 migration safety branch。
4. **VARIANT_GENERATED Question 走 owner-only 访问守门** —— `validateQuestionAccess` 加分支：`source==="VARIANT_GENERATED" && createdByUserId !== userId` 合并 `NOT_FOUND`（存在性侧信道隐藏），与 USER_ADHOC 同手艺；PUBLISHED / null / "自有" 仍公开。

**范围（本 plan 做）：**

- `packages/db/prisma/schema.prisma`：`VariantItem` +`questionId String? @unique` + Question 反向 `variantItem VariantItem?`（1:1，VariantItem 是 owner 侧）
- 1 migration（加列 + unique idx + FK；无 raw SQL append）
- `apps/web/server/lib/question.ts`：新 helper `createVariantQuestion(tx, { stemMd, userId, subjectId })`
- `apps/web/server/routers/variant.ts`：`generateForEntry` body 改造 —— 同事务串行建 3 对 Question + VariantItem
- `apps/web/server/lib/kp-reconcile.ts`：`sourceRefType=VARIANT_ITEM` 分支两阶段分流（spec §5）
- `apps/web/server/trpc.ts`：`validateQuestionAccess` 加 VARIANT_GENERATED 分支 + 抽 `OWNER_ONLY_SOURCES` set
- `apps/web/server/lib/pii-governance.ts`：Plan 6 `deactivateUser` 补丁 —— scrub VARIANT_GENERATED.createdByUserId（spec §9）
- `apps/web/scripts/variant-backfill-questions.ts`：幂等 backfill CLI（含 `loadCliEnv()` + 显式 `parseLimit()`）
- `apps/web/package.json`：加 `variant:backfill-questions` script
- 7 个测试文件（integration only；无 UI 改动故不加 E2E）
- CLAUDE.md：Plan 12 状态条目 + Merge 探针 42-46 + 候选 Plan 重排

**显式 punt（写进本 spec + plan "不做" 清单）：**

- USER_ADHOC × PUBLISHED canonical dedup → Plan 15+（独立后续；本 plan 不动 `upsertUserAdhocQuestion` 行为）
- `VariantItem.questionId` NOT NULL 约束 + 下线 nullable 分支 + 删 `VARIANT_TO_PARENT_NEEDS_REVIEW` reviewReason → 独立 cleanup plan（观察期后）
- VariantItem.stemMd / solutionMd 列删除（destructive migration）→ 不做；保留作冗余字段，view layer 0 改动
- 建 QuestionAnswer for variant question → 不做；solutionMd 仍从 VariantItem 读
- ErrorBookEntry.questionId 改指向 variant question → 不动（仍指向 parent question）
- 历史 KpReconcileMatch `PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)` 行的 cleanup → 留给后续 cleanup plan 一起处理
- `kp:reconcile-pending` CLI 改造 → 不动；其处理逻辑等 backfill + cleanup plan 同步迁移
- VariantItem 间 dedup（同 user 多次生成相同 stem 的 variant）→ 不做；spec §8 风险表说明设计代价

---

## §2 Schema 变更

```prisma
model VariantItem {
  // ... 既有字段保持不变（id / groupId / level / position / stemMd / solutionMd / knowledgePointHints[] / createdAt）
  questionId          String?       @unique @map("question_id")    // Plan 12: nullable 过渡，cleanup plan 后加 NOT NULL

  // ... 既有 relations
  question            Question?     @relation(fields: [questionId], references: [id], onDelete: Restrict)
  // onDelete: Restrict（非 SetNull）：
  //   - Plan 12 cleanup plan 加 NOT NULL 时 Restrict 更接近未来目标语义；
  //   - 同时阻挡未来误 prisma.question.delete() 把 VARIANT_GENERATED 题删了导致 VariantItem 失主
  //   - Plan 6 deactivateUser scrub createdByUserId 不动 Question 行，所以 Restrict 不卡注销
}

model Question {
  // ... 既有字段保持不变（含 Plan 8 createdByUserId / normalizedStemHash）
  // ... 既有 relations 保持不变
  variantItem         VariantItem?  // Plan 12 反向 1:0..1；便于未来 Plan 10/11 从 Question -> KP link -> stats 反查 variant 上下文
}
```

**`Question.source` 取值约定**（schema 仍是 String 不变 enum；spec 仅约定字面值）：

| 字面值 | 来源 | 访问控制 | 备注 |
|---|---|---|---|
| `"USER_ADHOC"` | Plan 8 user-typed stem | owner-only | Plan 8 hotfix P1 已实施 |
| `"VARIANT_GENERATED"` | Plan 12 AI 生成变式 | owner-only | 本 plan 新加 |
| `"自有"` | seed PUBLISHED 题 | 公开 | Plan 1 既有 |
| `null` | 历史无 source 题 | 公开 | 容错分支 |

**没有新加 unique idx**：本 plan 仅 `VariantItem.questionId @unique`，不加额外约束。`Question.source="VARIANT_GENERATED"` 行不被 Plan 8 partial unique idx `questions_user_adhoc_dedup_idx`（WHERE source='USER_ADHOC'）约束。

**Migration SQL 预期**（沿用 Plan 4/8/9 `--create-only` 工艺）：

```sql
ALTER TABLE variant_items ADD COLUMN question_id text;
CREATE UNIQUE INDEX variant_items_question_id_key ON variant_items (question_id);
ALTER TABLE variant_items ADD CONSTRAINT variant_items_question_id_fkey
  FOREIGN KEY (question_id) REFERENCES questions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
```

3 条 DDL，无 raw SQL append。Postgres unique idx 允许多个 NULL，nullable 过渡期无碰撞。

---

## §3 `variant.generateForEntry` 改造

### §3.1 新 helper `createVariantQuestion`

文件 `apps/web/server/lib/question.ts` 追加：

```ts
export interface CreateVariantQuestionArgs {
  stemMd: string;
  userId: string;
  subjectId: string;
}

// Plan 12 §3：升格出来的变式 Question。
// 与 USER_ADHOC 不同点：
//   - source = "VARIANT_GENERATED"（新字面值；validateQuestionAccess 走 owner-only）
//   - 不查 partial unique idx（USER_ADHOC dedup 不约束此 source）
//   - 不带 P2002 重读（变式 stem 由 AI 生成；同 user 同 stem 重复几乎不存在）
// 与 USER_ADHOC 同点：
//   - normalizedStemHash 仍写（为未来 Plan 15+ canonical dedup 铺路；无即时用途）
//   - subjectId 取自 parent entry.question.subjectId
//   - createdByUserId 取自 VariantGroup.userId（== ctx.auth.userId）
export async function createVariantQuestion(
  tx: Prisma.TransactionClient,
  args: CreateVariantQuestionArgs,
): Promise<Question> {
  return tx.question.create({
    data: {
      subjectId: args.subjectId,
      stemMd: args.stemMd,
      type: "ESSAY",
      status: "DRAFT",
      source: "VARIANT_GENERATED",
      createdByUserId: args.userId,
      normalizedStemHash: stemHashHex(args.stemMd),
    },
  });
}
```

### §3.2 新 tx body（替换 `variant.ts:87-111`）

```ts
const result = await ctx.db.$transaction(async (tx) => {
  const group = await tx.variantGroup.create({
    data: {
      entryId: ctx.entry.id,
      userId: ctx.auth.userId,
      creditsCost: 3,
      debitLedgerId: ctx.debit.ledgerId,
      modelCallId: ai.modelCallId,
    },
  });

  // Plan 12 §3：每个 VariantItem 同事务建对应 Question(source="VARIANT_GENERATED")。
  //   stemMd 在 Question 与 VariantItem 双写（VariantItem.stemMd 保留作冗余字段，
  //   variant write-once → drift 风险≈0；红线 R1 / drift guard test 守门）。
  //
  // 为什么顺序 create 不用 createMany：Prisma createMany 返 count 不返行，而
  // VariantItem.questionId 必须先有 Question 才能写。3 items × 2 SQL = 6 round trip，
  // 对生成路径（AI 调用 1-3s）忽略不计。
  for (let idx = 0; idx < ai.items.length; idx++) {
    const it = ai.items[idx]!;
    const question = await createVariantQuestion(tx, {
      stemMd: it.stemMd,
      userId: ctx.auth.userId,
      subjectId: ctx.entry.question.subjectId,
    });
    await tx.variantItem.create({
      data: {
        groupId: group.id,
        level: it.level,
        position: idx + 1,
        stemMd: it.stemMd,
        solutionMd: it.solutionMd,
        knowledgePointHints: it.knowledgePointHints ?? [],
        questionId: question.id,
      },
    });
  }

  return tx.variantGroup.findUniqueOrThrow({
    where: { id: group.id },
    include: { items: { orderBy: { position: "asc" } } },
  });
});

// Plan 9 reconcile 调用**不变**（仍 sourceRefType=VARIANT_ITEM + sourceRefId=item.id）。
// reconciler 内部读 VariantItem.questionId 决定写哪个 Question 的 KP link（详 §5）。
// $transaction 之外保持现状。
for (const item of result.items) {
  try {
    await reconcileHintsSync(ctx.db, {
      questionId: ctx.entry.questionId,    // 仍传 parent；reconciler 内部 variant linked path 自行覆盖
      hints: item.knowledgePointHints,
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: item.id,
    });
  } catch (e) {
    logger.warn({ event: "kp_reconcile_sync_failed", source: "VARIANT_ITEM", variantItemId: item.id, err: String(e) });
  }
}

return { group: toVariantGroupView(result) };
```

### §3.3 事务原子性

Question / VariantGroup / VariantItem 三类行同事务；任一抛错（含真实 DB 约束失败如 `VariantItem @@unique([groupId, level])` 撞车、FK 不存在等）全 rollback；Plan 3 既有 charge fail-open 补偿不破坏（事务回滚不抹掉外层 debit ledger 的状态机）。

`toVariantGroupView` 不动（view layer 仍直接读 `VariantItem.stemMd / solutionMd`；冗余字段策略详 §1）。

---

## §4 `variant:backfill-questions` CLI

### §4.1 目标 + 幂等性

扫所有 `VariantItem.questionId IS NULL` 历史行，为每条同事务建对应 Question + 填回 questionId。幂等可重跑：

- 已 backfill 行 (`questionId != null`) 在 `where: { questionId: null }` 直接被过滤
- `updateMany where: { id, questionId: null }` 二次守门 → 多实例并发也 race-safe
- race 输方在 tx 内删自己刚建的 orphan Question

### §4.2 CLI 签名

```bash
pnpm.cmd --filter @zhijiao/web variant:backfill-questions [--limit N] [--dry-run]
```

- `--limit N`：默认 1000；上限防失控（典型场景 dev DB 几十行；prod 上量后单批跑完）
- `--dry-run`：仅 count + log，不写

### §4.3 实现模板

文件 `apps/web/scripts/variant-backfill-questions.ts`：

```ts
#!/usr/bin/env tsx
// Plan 12 §4: VariantItem.questionId backfill。
//   pnpm.cmd --filter @zhijiao/web variant:backfill-questions [--limit N] [--dry-run]
//
// 幂等：where questionId=null 过滤已 backfill 行；updateMany 二次守门防 race；
// race 输方删 orphan Question。详 spec §4.1。
//
// loadCliEnv() 沿用 Plan 6 hotfix 工艺（apps/web/scripts/load-cli-env.ts）。

import { loadCliEnv } from "./load-cli-env.js";
loadCliEnv();

import { PrismaClient } from "@prisma/client";
import { createVariantQuestion } from "../server/lib/question.js";

const BATCH = 200;

function parseLimit(args: string[]): number {
  const flagIdx = args.indexOf("--limit");
  if (flagIdx < 0) return 1000;
  const raw = args[flagIdx + 1];
  if (!raw || raw.startsWith("--")) throw new Error("--limit requires a positive integer value");
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid --limit: ${raw}`);
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseLimit(args);
  const dryRun = args.includes("--dry-run");

  const prisma = new PrismaClient();
  let cursor: string | undefined;
  let processed = 0;
  let created = 0;
  let alreadySeen = 0;

  try {
    while (processed < limit) {
      const items = await prisma.variantItem.findMany({
        where: { questionId: null },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: Math.min(BATCH, limit - processed),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          group: { include: { entry: { include: { question: { select: { subjectId: true } } } } } },
        },
      });
      if (items.length === 0) break;

      for (const item of items) {
        processed++;
        // 防御性：理论上 where 已过滤
        if (item.questionId != null) { alreadySeen++; continue; }
        if (dryRun) { created++; continue; }

        // 单 tx 内：建 Question + 用 questionId IS NULL 守门更新 VariantItem
        // race 输方（updated.count===0）必须删自己刚建的孤儿 Question
        await prisma.$transaction(async (tx) => {
          const q = await createVariantQuestion(tx, {
            stemMd: item.stemMd,
            userId: item.group.userId,
            subjectId: item.group.entry.question.subjectId,
          });
          const updated = await tx.variantItem.updateMany({
            where: { id: item.id, questionId: null },
            data: { questionId: q.id },
          });
          if (updated.count === 0) {
            // race：其它进程已写 questionId，本次建的 Question 无引用 → 安全 delete
            // （VariantItem.questionId Restrict 保护：只要无 VariantItem 引用此 Question，
            //  delete 不会被卡。delete 失败 → tx 抛错让 OPS 重跑）
            await tx.question.delete({ where: { id: q.id } });
          } else {
            created++;
          }
        });
      }

      cursor = items[items.length - 1]!.id;
      console.log(`Processed ${processed} (created ${created}, alreadySeen ${alreadySeen})`);
    }
    console.log(`Done. processed=${processed}, created=${created}, alreadySeen=${alreadySeen}, dryRun=${dryRun}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

### §4.4 Backfill 后验证（探针 43）

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items WHERE question_id IS NULL;"
# 期望: 0

docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM questions WHERE source = 'VARIANT_GENERATED' AND created_by_user_id IS NULL;"
# 期望: 0（每个 VARIANT_GENERATED Question 必有 owner —— 除非该 owner 已注销且 Plan 6 scrub 过；那时 createdByUserId 为 null 也合规）

docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT count(*) FROM variant_items vi JOIN questions q ON q.id = vi.question_id JOIN variant_groups vg ON vg.id = vi.group_id WHERE q.created_by_user_id IS NOT NULL AND q.created_by_user_id != vg.user_id;"
# 期望: 0（每个 backfilled Question 的 createdByUserId 等于其 VariantGroup.userId，除非已被 Plan 6 scrub 成 null）
```

---

## §5 Plan 9 reconciler 两阶段切换

### §5.1 核心改动

`reconcileHintsSync` 在 `sourceRefType === "VARIANT_ITEM"` 分支增加一次 `VariantItem.findUnique` 查 `questionId`：非空走新 LINKED 路径（写 variant Question 的 KPLink），空走旧 PENDING_REVIEW 路径作 migration safety branch。

### §5.2 关键不变量（红线 R5）

**变量分离**：

```ts
const subjectQuestionId = args.questionId;                // 取 subjectId 用
const linkedQuestionId = effectiveQuestionId ?? args.questionId;  // 真正写 KPLink 的目标
```

**variant linked path** —— 三处 id 严格相等（红线 R5）：

```
KpReconcileMatch.questionId === QuestionKPLink.questionId === VariantItem.questionId
```

审计行与 link 目标必须一致；否则后续统计 / 排查会混乱。

### §5.3 改造代码（替换 `kp-reconcile.ts:120` 起的 `writesToParent` 段）

```ts
// Plan 12 §5: VARIANT_ITEM 两阶段分流
//   questionId != null → LINKED to variant Question 的 KPLink（升格后行为）
//   questionId == null → PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)（migration safety）
//   后续 cleanup plan 加 NOT NULL 时下线 null 分支与该 reviewReason
let effectiveQuestionId: string | null = null;
let isVariantPath = false;
let isVariantPendingLegacy = false;

if (args.sourceRefType === "VARIANT_ITEM") {
  const variantItem = await prisma.variantItem.findUnique({
    where: { id: args.sourceRefId },
    select: { questionId: true },
  });
  if (!variantItem) {
    // 防御：sourceRefId 指向已删 VariantItem。走 legacy pending 保守处理便于 OPS review
    _logger.warn({ event: "kp_reconcile_variant_item_missing", sourceRefId: args.sourceRefId });
    isVariantPendingLegacy = true;
  } else if (variantItem.questionId != null) {
    isVariantPath = true;
    effectiveQuestionId = variantItem.questionId;
  } else {
    isVariantPendingLegacy = true;
  }
}

// 显式拆变量便于阅读 + 避免后续误用
const subjectQuestionId = args.questionId;
const linkedQuestionId = effectiveQuestionId ?? args.questionId;

const question = await prisma.question.findUniqueOrThrow({
  where: { id: subjectQuestionId },
  select: { subjectId: true },
});
const candidates = await loadSubjectCandidates(prisma, question.subjectId);
// 注：subjectId 等价不变 —— createVariantQuestion 写 parent.subjectId，所以 parent 与 variant Question 的 subjectId 相同
```

**LINKED / PENDING_REVIEW 写入分支**：

```ts
if (matchedKpId && matchVia) {
  if (isVariantPath) {
    // Plan 12: 升格变式题 → LINKED 到 variant Question 的 KPLink
    // 红线 R5: KpReconcileMatch.questionId === QuestionKPLink.questionId === linkedQuestionId
    await prisma.$transaction(async (tx) => {
      await upsertReconcileMatch(tx, {
        ...args,
        questionId: linkedQuestionId,   // 覆盖 parent.questionId → variant.questionId
        normalizedHint: normalized,
        rawHint,
        kpId: matchedKpId,
        matchVia,
        confidence: 1.0,
        status: "LINKED",
        reviewReason: null,
      });
      await upsertQuestionKpLink(tx, linkedQuestionId, matchedKpId!, 1.0);
    });
    result.linked++;
  } else if (isVariantPendingLegacy) {
    // Plan 9 旧路径 (migration safety): VariantItem.questionId 未 backfill 或 sourceRefId 失踪
    // KpReconcileMatch.questionId 保持 parent —— 该 row 的含义是"暂挂 parent context 待审"
    await upsertReconcileMatch(prisma, {
      ...args,
      // questionId 不覆盖；用默认 ...args.questionId（parent）
      normalizedHint: normalized,
      rawHint,
      kpId: matchedKpId,
      matchVia,
      confidence: 1.0,
      status: "PENDING_REVIEW",
      reviewReason: "VARIANT_TO_PARENT_NEEDS_REVIEW",
    });
    result.queued++;
  } else {
    // 其它 sourceRefType（ERROR_BOOK_ENTRY / QUESTION）→ LINKED + 写 parent KPLink
    await prisma.$transaction(async (tx) => {
      await upsertReconcileMatch(tx, { ...args, normalizedHint: normalized, rawHint, kpId: matchedKpId, matchVia, confidence: 1.0, status: "LINKED", reviewReason: null });
      await upsertQuestionKpLink(tx, args.questionId, matchedKpId!, 1.0);
    });
    result.linked++;
  }
} else {
  // UNMATCHED 路径不变（不写 KPLink，只写 KpReconcileMatch row）
  // ...
}
```

### §5.4 caller 接口契约

`reconcileHintsSync` 签名不变。`args.questionId` 语义变化（**spec 必须明写**）：

- **之前**：`args.questionId` 同时用作 (a) subject lookup 和 (b) KPLink 目标
- **现在**：`args.questionId` 仅用作 subject lookup；variant linked path 内部把 match/link 写入目标覆盖为 `VariantItem.questionId`

caller（`tutor.ts` / `error.ts` / `variant.ts`）不需要知道这层切换；继续传 parent / entry / question 的 id 即可。

### §5.5 `kp:reconcile-pending` CLI 不动

异步 LLM 路径 `processBatch` 保持现状。理由：

- `VARIANT_TO_PARENT_NEEDS_REVIEW` 行只在 `questionId==null` 时产生；Plan 12 backfill 跑完后这种 review 行不会再增加
- 旧残留行作为 cleanup plan 的输入保留，供未来人工 review 或批量处理
- 改造 `processBatch` 涉及对 batch 内行重新按 VariantItem.questionId 分流，复杂度高、收益低（量小、靠手动 review 即可）

---

## §6 `validateQuestionAccess` VARIANT_GENERATED owner-only

### §6.1 改动位置

`apps/web/server/trpc.ts:331` `validateQuestionAccess` middleware。

### §6.2 改造代码

**抽 `OWNER_ONLY_SOURCES` set**（middleware 模块级常量；**不 export**，避免为测试导出实现细节，访问行为由 integration test 覆盖）：

```ts
// Plan 12 §6: 抽 OWNER_ONLY_SOURCES set —— USER_ADHOC + VARIANT_GENERATED。
// 未来加新 owner-only source（如 USER_HIDDEN）一处加即可。
// 不 export —— 集合作为实现细节；行为正确性由 integration test 覆盖（见 §7）。
const OWNER_ONLY_SOURCES = new Set(["USER_ADHOC", "VARIANT_GENERATED"]);
```

**判断块替换**（line 358-369）：

```ts
if (
  !question ||
  (question.source != null &&
    OWNER_ONLY_SOURCES.has(question.source) &&
    question.createdByUserId !== ctx.auth.userId)
) {
  // 合并 missing + cross-user owner-only 为同一 NOT_FOUND/QUESTION_NOT_FOUND（存在性侧信道隐藏）
  // 注：createdByUserId == null 时（Plan 6 deactivateUser scrub 后）也走此路径
  //     —— null !== anyUserId 评估为 true，正确挡住已注销用户的 owner-only Question
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "题目不存在",
    cause: { reason: "QUESTION_NOT_FOUND" },
  });
}
```

### §6.3 注释更新（line 324-326）

```
访问规则：
  USER_ADHOC / VARIANT_GENERATED: createdByUserId === ctx.auth.userId → 允许；否则 NOT_FOUND
  其它 source（含 null / "自有" / PUBLISHED 等）：允许（题库公共题）
  missing questionId / 不存在的 id → BAD_REQUEST / NOT_FOUND
```

---

## §7 测试矩阵

| 测试 | 类型 | 覆盖 |
|---|---|---|
| `variant-generate-question-link.test.ts` | integration | `variant.generateForEntry` 跑完后 3 个 VariantItem 都有非空 `questionId`；3 个对应 Question 行 `source="VARIANT_GENERATED" / createdByUserId=ctx.auth.userId / subjectId=parent.subjectId / status=DRAFT / normalizedStemHash=stemHashHex(stemMd)`；rollback 测例：mock AI 返回两个同 `level` 触发 `VariantItem @@unique([groupId, level])` P2002 → 整个 tx 回滚，验 0 group / 0 question / 0 item 半成品 |
| `variant-stem-drift-guard.test.ts` | integration | 生成 3 个变式后断言 `VariantItem.stemMd === Question.stemMd` strict 相等（红线 R1）；`Question.normalizedStemHash === stemHashHex(VariantItem.stemMd)` |
| `variant-question-access-owner-only.test.ts` | integration | 4 形态：(a) owner 拿自己 VARIANT_GENERATED questionId 调 `error.diagnose` 通过 + DEBIT 写；(b) cross-user 拿别人 variant questionId → `NOT_FOUND / QUESTION_NOT_FOUND` + DEBIT 不写；(c) 不存在 questionId → 同 NOT_FOUND；(d) PUBLISHED questionId → 通过（不被误伤）|
| `kp-reconcile-sync-variant-promoted.test.ts` | integration | sourceRefType=VARIANT_ITEM + VariantItem.questionId 非空：EXACT/ALIAS 命中后 **三处 id 严格相等**（红线 R5）：`KpReconcileMatch.questionId === QuestionKPLink.questionId === VariantItem.questionId`；status=LINKED；**parent question 的 QuestionKPLink 不写**（红线 R2：`prisma.questionKPLink.count({ where: { questionId: parent.id } }) === 0`）|
| `kp-reconcile-sync-variant-legacy.test.ts` | integration | sourceRefType=VARIANT_ITEM + VariantItem.questionId==null（migration safety path）：EXACT/ALIAS 命中 → 仍走 `PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)`；`KpReconcileMatch.questionId === parent.questionId`；不写 QuestionKPLink。**legacy 路径在 backfill 跑完后理论不再触发，本测例防回归** |
| `variant-backfill-questions.test.ts` | integration | 4 测例：(a) seed 5 行无 questionId VariantItem → backfill → 5 行有 questionId + 5 个 VARIANT_GENERATED Question + createdByUserId=group.userId / subjectId=parent.question.subjectId / status=DRAFT；(b) 二次跑 0 改动 + 0 新 Question（红线 R3 幂等）；(c) `--dry-run` 0 写但 count 准；(d) 部分已 backfill 部分未 backfill 混合 → 只动 null 行 |
| `variant-backfill-race.test.ts` | integration | 模拟 race：seed 1 行 → mock `createVariantQuestion` 之后、`updateMany` 之前手动 update questionId → backfill 检测 update.count=0 → 删自己刚建的 orphan Question（断言 `prisma.question.count({ where: { source: "VARIANT_GENERATED" } })` 不增）+ continue 不抛 |
| `pii-deactivate-variant-questions.test.ts` | integration | Plan 6 deactivateUser 补丁验证（spec §9）：seed VARIANT_GENERATED Question(createdByUserId=user) + VariantItem.questionId → deactivateUser → 验 Question 仍在 + createdByUserId === null + VariantItem 仍在 + questionId 不变 + `DeactivatePayload.scrubbed.variantGeneratedQuestions === 1` |

**8 个测试文件**（全 integration；无 UI / E2E 改动）。

### §7.1 反向守门红线

- **红线 R1**：`variant-stem-drift-guard.test.ts` `expect(VariantItem.stemMd).toBe(Question.stemMd)` strict 相等
- **红线 R2**：`kp-reconcile-sync-variant-promoted.test.ts` 升格后 `parent.question` 的 KPLink 不被变式题污染
- **红线 R3**：`variant-backfill-questions.test.ts` 二次跑 0 改动 + 0 新 Question 行
- **红线 R4**：`variant-generate-question-link.test.ts` 真实约束错触发的 rollback 测例（不 mock Prisma；用 `@@unique([groupId, level])` 撞车）
- **红线 R5**：`kp-reconcile-sync-variant-promoted.test.ts` 三处 id 严格相等 `KpReconcileMatch.questionId === QuestionKPLink.questionId === VariantItem.questionId`

---

## §8 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| `VariantItem.questionId` migration 加列后既有代码假定不存在该字段 → typecheck 报 | Task 1 步骤后 turbo typecheck red | `pnpm.cmd --filter @zhijiao/db db:generate` regenerate client（沿用 Plan 8/9 探针 29） |
| `variant.generateForEntry` 顺序 create 比 createMany 慢 | 生成路径多 ~6 SQL round trip | 实测每次 ~2ms × 6 = 12ms；AI 调用 1-3s 主导；忽略不计 |
| 同事务 3 个 Question + 3 个 VariantItem + 1 VariantGroup 拉长 tx 时间 | Postgres lock 竞争 | 单 tx 内仅插入 7 行；lock 量极小；prod 真出问题再拆 tx |
| Plan 9 reconciler 加 `VariantItem.findUnique` 多一次 SQL | tutor.ask / error.diagnose / variant.generateForEntry 三处 reconcile 都多一次 query | 仅 `sourceRefType=VARIANT_ITEM` 走这分支（其它 source 不动）；variant 路径每次 reconcile 已经 N×SQL，多 1 次可忽略 |
| backfill CLI race 输方 `tx.question.delete` 被 Restrict 卡住 | 同时有其它 VariantItem 引用了这个新 Question | 不可能：updateMany 输了说明 questionId 被其它进程占了别的 Question，本次 create 的 Question 没有任何 row 引用；若 delete 仍失败 → tx 抛错让 OPS 重跑（不留孤儿但要补救） |
| `OWNER_ONLY_SOURCES` set 漏加未来新 source | 后续引入新 owner-only source 时漏更新 | spec §6 注释明写；integration test `variant-question-access-owner-only.test.ts` 覆盖 4 形态；未来加 source 一处改一处测 |
| Plan 9 reconciler 的 `args.questionId` 语义变化引发后续 caller 误用 | 未来 caller 试图传 variant.questionId 作 args.questionId | spec §5.4 明写契约；reconciler 内部 subjectId 等价不变（parent 与 variant 同 subjectId）；不会因 caller 改传值而错 |
| 历史 KpReconcileMatch row（升格前 PENDING_REVIEW(VARIANT_TO_PARENT_NEEDS_REVIEW)）残留 | backfill 跑完后不自动 cleanup | 设计如此（cleanup plan 接力）；`kp:review` CLI 仍能看到这些行供人工处理 |
| `Question.normalizedStemHash` 写进 VARIANT_GENERATED 行但 partial unique idx 是 `WHERE source='USER_ADHOC'`，variant 不受 dedup 约束 | 同 user 多次生成 stem 完全相同的 VARIANT_GENERATED 行（unlikely 但可能） | 设计如此（VariantItem 间 dedup punt）；为未来 Plan 15+ canonical dedup 铺路；不踩任何既有约束 |
| Plan 6 deactivateUser 没扩 VARIANT_GENERATED → 注销用户的 variant Question 行保留指向 tombstone User | 用户注销后 cross-user 仍正确 NOT_FOUND（OWNER_ONLY 守门），但 createdByUserId 指向已 scrubbed User 行 | 本 plan §9 在 deactivateUser 内补 updateMany scrub VARIANT_GENERATED.createdByUserId → null；`pii-deactivate-variant-questions.test.ts` 守门 |
| backfill 跑慢锁表 | 历史 VariantItem 量大（prod 上量后） | `--limit N` + cursor 分批；MAX 跑足 N 行自动退出；OPS 多次跑直到 `count(questionId IS NULL) = 0`；当前 dev 0 行 |
| Restrict onDelete 阻挡未来误 prisma.question.delete() | 业务代码不应 hard-delete VARIANT_GENERATED Question | 设计如此（与 Plan 6 ErrorBookEntry.user Restrict 同手艺）；用户注销走 Plan 6 deactivateUser scrub 路径不删行；未来真要清理走独立 cleanup plan |

---

## §9 Plan 6 `deactivateUser` 补丁

### §9.1 背景

Plan 12 引入新 source `"VARIANT_GENERATED"`，写 `createdByUserId = ctx.auth.userId`。Plan 6 `deactivateUser` spec §3.3 当前 step 4 只删 USER_ADHOC：

```ts
tx.question.deleteMany({ where: { source: "USER_ADHOC", createdByUserId: userId } })
```

未触及 VARIANT_GENERATED。用户注销后，该用户的 variant Question 行会保留 `createdByUserId` 指向已 tombstone 的 User row——这是 Plan 12 引入的新边界 case。

### §9.2 处理策略

**方案 B：scrub `createdByUserId` 为 null，不删行。** 与 Plan 6 设计哲学一致（"PII 去标识化 + 统计数据保留"）；VARIANT_GENERATED 题面是用户提交内容的 AI 衍生，按 PII 原则应 scrub 归属字段，但 KP 命中数据有学情统计价值。

**为什么不删行**：`VariantItem.questionId` Restrict 卡删 Question；若级联删 VariantItem 与 Plan 12b "保留变式统计样本"目标冲突。

**为什么不留 tombstone FK**：去标识化不完整，与 Plan 6 方向不一致；Plan 6 对 `ModelCall.userId` 已采 scrub null 路径，VARIANT_GENERATED 同手艺。

### §9.3 deactivateUser step C 补丁

在 `apps/web/server/lib/pii-governance.ts` `deactivateUser` step 10（KpAlias/KpReconcileMatch SetNull）与 step 11（User update）之间插入：

```ts
// Plan 12 §9: VARIANT_GENERATED Question.createdByUserId scrub null
//   - Question 行保留作 KP 统计样本
//   - VariantItem.questionId Restrict 卡删行，所以 scrub 不动 row
//   - 与 USER_ADHOC 删除策略不同：USER_ADHOC stem 是用户原始输入，删；
//     VARIANT_GENERATED stem 是 AI 衍生，保留作统计资产
const variantQuestionScrub = await tx.question.updateMany({
  where: { source: "VARIANT_GENERATED", createdByUserId: userId },
  data: { createdByUserId: null },
});
```

### §9.4 `DeactivatePayload` 扩字段

`apps/web/server/lib/pii-governance.ts` 的 `DeactivatePayload.scrubbed` 加一项：

```ts
scrubbed: {
  // ... 既有字段
  variantGeneratedQuestions: number;
}
```

`payload.scrubbed.variantGeneratedQuestions = variantQuestionScrub.count` 在 step D 写 OpsActionLog 时填入。

### §9.5 `previewDeactivateUser` 同步

`previewDeactivateUser` 加对应 count（与 step C 11 同 where 条件）：

```ts
const variantQuestionsByUser = await prisma.question.count({
  where: { source: "VARIANT_GENERATED", createdByUserId: userId },
});
// ...
return {
  scrubbed: { /* ... 既有, */ variantGeneratedQuestions: variantQuestionsByUser },
  // ...
};
```

### §9.6 测试覆盖

新增 `apps/web/tests/integration/pii-deactivate-variant-questions.test.ts`（详 §7 测试矩阵）。**不重开 Plan 6**——补丁与测试都在 Plan 12 实施期内完成。

---

## §10 兼容性 + 与既有 Plan 工艺一致性

### §10.1 兼容性

- `tutor.ask` / `error.diagnose` 路由 0 行 diff（不走 variant linked path）
- `variant.generateForEntry` 输入/输出 schema 不变（仅 tx body 改造）
- `toVariantGroupView` 0 行 diff（view layer 仍直接读 `VariantItem.stemMd / solutionMd`）
- Plan 9 `reconcileHintsSync` 签名 0 行 diff（仅内部分流逻辑改）
- Plan 6 `deactivateUser` 接口 0 行 diff（仅 step C 内部 + payload 字段加）
- 既有 USER_ADHOC / PUBLISHED / null source Question 行不受任何影响
- 既有 Plan 9 `KpReconcileMatch` 行不动；新行按新逻辑写入

### §10.2 工艺一致性

| 工艺 | 来源 | Plan 12 沿用 |
|---|---|---|
| `migrate dev --create-only` → 浏览 SQL → `migrate dev` | Plan 4 / 8 / 9 Task 1 | 一致（§2） |
| 每个 task 一个 commit + 引用 task 编号 | Plan 4 / 6 / 9 红线 #14 | 一致 |
| `pnpm.cmd`（PowerShell execution policy）| Plan 4 / 6 / 9 红线 #15 | 一致 |
| Vitest `it.todo` / 空 body 防御 | Plan 4 / 6 / 8 / 9 | 一致（每 task commit 前 grep）|
| OPS 操作走 CLI 不走 Web | Plan 6 / 9 工艺 | 一致（`variant:backfill-questions`）|
| CLI 头部 `loadCliEnv()` | Plan 6 hotfix e564652 | 一致（§4.3）|
| CLI `parseLimit()` 显式参数校验 | Plan 9 `kp-reconcile-pending.ts` | 一致（§4.3）|
| 中文输出 | Plan 4 / 6 / 8 / 9 | 一致 [[zhijiao-chinese-default]] |
| Spec 是真理来源 + plan 引用章节号 | Plan 4 / 6 / 8 / 9 | 一致 |
| 服务层接口写成可被未来 Web 包形式 | Plan 9 §1 / [[zhijiao-single-dev-no-ops-ui]] | 一致 |
| Plan merge 后必跑 `db:generate` | Plan 8 merge 经验（探针 29）| 一致 |
| 探针 0-residual grep guard | Plan 6 Task 3 步骤 3.6 | §11 探针 43-46 沿用同手艺 |

---

## §11 完成条件

- 所有 Task 步骤勾完（实现 plan 分 task；spec 不规定 task 编号）
- `pnpm.cmd exec turbo typecheck --force` 全绿
- `pnpm.cmd exec turbo test --force` 全绿（含 Plan 12 新加 8 测试）
- `pnpm.cmd --filter @zhijiao/web exec next build` exit 0
- `pnpm.cmd --filter @zhijiao/web exec playwright test` 全绿（无 E2E 改动，零回归）
- CLAUDE.md 加 Plan 12 条目 + "VariantItem 升格现状" 段 + Merge 探针 42-46 + 候选 Plan 重排
- Backfill 跑完后 3 项 DB 探针（§4.4）全 0
- 红线 R1-R5 全部测试覆盖
- Plan 6 `deactivateUser` 补丁落地 + `pii-deactivate-variant-questions.test.ts` 绿
- `pnpm.cmd --filter @zhijiao/web variant:backfill-questions --dry-run` smoke exit 0
- Prisma migration checksum 一致：`prisma migrate status` 输出 `Database schema is up to date!`
- Merge commit message 引用 spec 路径
