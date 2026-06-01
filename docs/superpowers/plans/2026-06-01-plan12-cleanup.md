# Plan 12 cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `VariantItem.questionId` 升为 NOT NULL，退役 `isVariantPendingLegacy` 分支与 `VARIANT_TO_PARENT_NEEDS_REVIEW` 旧概念，使变式题 KP hints 在同步+异步 reconcile 两路径都 link 到变式题自己的 Question。

**Architecture:** 先做 test-prep（把现有测试从「fake VariantItem id → PENDING_REVIEW」旧工艺解耦，保持现码下全绿），再翻 schema NOT NULL，最后改两条 reconcile 代码路径并以 TDD 锁住两处真实行为变化（同步 UNMATCHED 存变式题 id 的 linchpin；异步变式高置信自动 LINK）。每个 task 结束时仓库全绿。

**Tech Stack:** TypeScript / Prisma 5 + Postgres / tRPC / Vitest / pnpm（PowerShell 下用 `pnpm.cmd`）。

**设计真源：** `docs/superpowers/specs/2026-06-01-plan12-cleanup-design.md`（先读）。

---

## 前置

- 分支已建：`plan-12-cleanup`（spec 已 commit 在此分支）。确认在该分支上：`git branch --show-current` → `plan-12-cleanup`。
- 命令约定：PowerShell + `pnpm.cmd`。单测：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/<file>`。全量：`pnpm.cmd test`。类型：`pnpm.cmd typecheck`。
- 假绿守门（每个改测试的 task 收尾跑）：`Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse` 期望 0 命中；Vitest 末行须 `N passed (N)`，不含 `todo`。

---

## 文件结构（本 plan 触碰清单）

```
packages/db/
  prisma/schema.prisma                              # 改：VariantItem.questionId NOT NULL + 枚举 tombstone 注释
  prisma/migrations/<ts>_plan12_variant_question_not_null/migration.sql  # 新

apps/web/
  package.json                                      # 改：删 "variant:backfill-questions" script
  scripts/
    variant-backfill-questions.ts                   # 删（退役）
    kp-backfill-variant-items.ts                     # 不动（仍有效）
    kp-review.ts                                     # 改：line 55 "Parent question" 标签
  server/lib/
    kp-reconcile.ts                                  # 改：findUniqueOrThrow + 删 legacy 分支 + UNMATCHED 存变式题 id + 收窄 reviewReason 联合类型
    kp-reconcile-pending.ts                          # 改：删 isVariant 特例，变式高置信自动 LINK
  server/routers/
    variant.ts                                       # 改：line 123-124 陈旧注释
  tests/integration/
    variant-backfill-questions.test.ts               # 删
    variant-backfill-race.test.ts                    # 删
    kp-reconcile-sync-variant-legacy.test.ts         # 删
    kp-reconcile-state-machine.test.ts               # 改：3 个 fake-id 例 → 直接插 PENDING_REVIEW
    kp-reconcile-alias-conflict.test.ts              # 改：fixture reviewReason → LLM_CONFIDENCE_BAND
    kp-reconcile-sync-variant.test.ts                # 改：promoted variant；+ linchpin UNMATCHED 例（Task 5）
    kp-reconcile-backfill.test.ts                    # 改：promoted variant + LINKED
    kp-reconcile-pending-script.test.ts              # 改：变式高置信 → LINKED（Task 6）
    kp-reconcile-sync-variant-promoted.test.ts       # 不动（canonical 守门）

docs/claude/implementation-state.md                  # 改：Plan 12 现状段
docs/claude/merge-verification.md                    # 改：探针 42/43 reword，删 46，32/34 reword
CLAUDE.md                                            # 改：Plan 12 cleanup 移入已落地
```

---

## Task 1: 退役 backfill 机器（script + package.json + 2 测试）

**Files:**
- Delete: `apps/web/scripts/variant-backfill-questions.ts`
- Delete: `apps/web/tests/integration/variant-backfill-questions.test.ts`
- Delete: `apps/web/tests/integration/variant-backfill-race.test.ts`
- Modify: `apps/web/package.json`（删 `"variant:backfill-questions"` 行）

NOT NULL 后该脚本只能返 0 行（`where: { questionId: null }`），是死代码；其 2 个测试 import 该脚本并断言 `questionId: null` 计数，schema 改后无法编译。先退役、保持独立可回滚。

- [ ] **Step 1: 确认无其它引用**

Run:
```powershell
Select-String -Path apps/web -Pattern "variant-backfill-questions|backfillVariantQuestions" -Recurse | Select-Object Filename,LineNumber,Line
```
Expected: 命中仅在 `scripts/variant-backfill-questions.ts`、上述 2 测试文件、`package.json:17`。若命中其它源文件 → 停下，引用未预期。

- [ ] **Step 2: 删除三文件**

Run:
```powershell
Remove-Item apps/web/scripts/variant-backfill-questions.ts
Remove-Item apps/web/tests/integration/variant-backfill-questions.test.ts
Remove-Item apps/web/tests/integration/variant-backfill-race.test.ts
```

- [ ] **Step 3: 删 package.json script 行**

在 `apps/web/package.json` 的 `"scripts"` 块删除这一行（约 line 17）：
```json
    "variant:backfill-questions": "tsx scripts/variant-backfill-questions.ts",
```
保留前后行的逗号合法性（删的是中间行，前一行 `kp:reconcile-pending` 仍以逗号结尾，合法）。

- [ ] **Step 4: typecheck + 全量测试**

Run:
```powershell
pnpm.cmd typecheck
pnpm.cmd --filter @zhijiao/web test
```
Expected: typecheck 0 error；测试全绿（少了 2 个文件，无新失败）。

- [ ] **Step 5: Commit**

```powershell
git add apps/web/scripts/variant-backfill-questions.ts apps/web/tests/integration/variant-backfill-questions.test.ts apps/web/tests/integration/variant-backfill-race.test.ts apps/web/package.json
git commit -m "chore(web): Task 1 — retire variant-backfill-questions script + tests (Plan 12 cleanup)"
```

---

## Task 2: 解耦 review-flow 测试（state-machine + alias-conflict），删 legacy 测试

**Files:**
- Delete: `apps/web/tests/integration/kp-reconcile-sync-variant-legacy.test.ts`
- Modify: `apps/web/tests/integration/kp-reconcile-state-machine.test.ts`
- Modify: `apps/web/tests/integration/kp-reconcile-alias-conflict.test.ts`

这些测试用「fake VariantItem id 经 `reconcileHintsSync` 造 PENDING_REVIEW」的旧工艺。Task 5 改 `findUniqueOrThrow` 后 fake id 会抛错。本 task 把它们换成「直接 `prisma.kpReconcileMatch.create` 插 PENDING_REVIEW 行」（state-machine 的 learnAliasAndLink 例 L108-118 已是此工艺，照抄）。**现码下仍全绿**，与 schema/code 改动解耦。

- [ ] **Step 1: 删 legacy 测试**

Run:
```powershell
Remove-Item apps/web/tests/integration/kp-reconcile-sync-variant-legacy.test.ts
```
（整文件测 null-`questionId` → PENDING_REVIEW，该路径将删除。）

- [ ] **Step 2: 改写 state-machine 的 approve 例（L32-55）**

把 `kp-reconcile-state-machine.test.ts` 第一个 `it("approve: ...")` 里「kpAlias.create + reconcileHintsSync(fake id) + findFirstOrThrow」三步，替换为直接插一行 PENDING_REVIEW。新 body：

```typescript
  it("approve: PENDING_REVIEW → LINKED + 写 QuestionKPLink(weight=row.confidence)", async () => {
    const { kpAId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "一元一次方程", normalizedHint: "一元一次方程",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000001",
        matchVia: "EXACT", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });
    expect(m.status).toBe("PENDING_REVIEW");

    const updated = await approveMatch(prisma, { matchId: m.id, reviewedByUserId: userId });
    expect(updated.status).toBe("LINKED");
    expect(updated.reviewReason).toBeNull();
    expect(updated.reviewedByUserId).toBe(userId);
    expect(updated.reviewedAt).not.toBeNull();
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpAId } },
    });
    expect(link.weight).toBe(1.0);
  });
```

- [ ] **Step 3: 改写 state-machine 的 reject 例（L57-73）**

替换 reconcileHintsSync(fake id) 造 PENDING_REVIEW 为直接插行：

```typescript
  it("reject: PENDING_REVIEW → REJECTED + 不写 QuestionKPLink", async () => {
    const { kpAId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "一元一次方程", normalizedHint: "一元一次方程",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000002",
        matchVia: "EXACT", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });

    const updated = await rejectMatch(prisma, { matchId: m.id, reviewedByUserId: userId });
    expect(updated.status).toBe("REJECTED");
    expect(updated.kpId).toBe(kpAId);
    expect(await prisma.questionKPLink.count({ where: { questionId } })).toBe(0);
  });
```

- [ ] **Step 4: 改写 state-machine 的 remap 例（L75-106）**

替换造 PENDING_REVIEW 那段为直接插行（保留后半 remap 断言不变）：

```typescript
  it("remap: PENDING_REVIEW → LINKED with 新 kpId (matchVia=MANUAL, confidence=1.0)", async () => {
    const { kpAId, kpBId, questionId, userId } = await seedFixtures();
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId, kpId: kpAId, rawHint: "一元一次方程", normalizedHint: "一元一次方程",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000003",
        matchVia: "EXACT", confidence: 1.0,
        status: "PENDING_REVIEW", reviewReason: "LLM_CONFIDENCE_BAND",
      },
    });
    expect(m.kpId).toBe(kpAId);

    const updated = await remapMatch(prisma, {
      matchId: m.id,
      newKpCode: "math-g7-substitution",
      reviewedByUserId: userId,
    });
    expect(updated.status).toBe("LINKED");
    expect(updated.kpId).toBe(kpBId);
    expect(updated.matchVia).toBe("MANUAL");
    expect(updated.confidence).toBe(1.0);
    const link = await prisma.questionKPLink.findUniqueOrThrow({
      where: { questionId_kpId: { questionId, kpId: kpBId } },
    });
    expect(link.weight).toBe(1.0);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId: kpAId } })).toBe(0);
  });
```

注：`reconcileHintsSync` 现已不在本文件被用；若 import 行 `kp-reconcile-state-machine.test.ts:4` 的 `reconcileHintsSync` 变 unused，删之（保留 `approveMatch, rejectMatch, remapMatch, learnAliasAndLink, unlinkIfOrphan`）。

- [ ] **Step 5: 改 alias-conflict fixture（L36, L83）**

`kp-reconcile-alias-conflict.test.ts` 中两处手建 PENDING_REVIEW fixture 的 `reviewReason: "VARIANT_TO_PARENT_NEEDS_REVIEW"` 改为 `reviewReason: "LLM_CONFIDENCE_BAND"`（语义等价的「待人工」标签，不再引 tombstone）。

Run:
```powershell
Select-String -Path apps/web/tests/integration/kp-reconcile-alias-conflict.test.ts -Pattern "VARIANT_TO_PARENT_NEEDS_REVIEW"
```
Expected: 改完后 0 命中。

- [ ] **Step 6: 跑这两个测试 + 假绿守门**

Run:
```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-state-machine.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-alias-conflict.test.ts
Select-String -Path apps/web/tests/integration/kp-reconcile-state-machine.test.ts,apps/web/tests/integration/kp-reconcile-alias-conflict.test.ts -Pattern "it\.todo"
```
Expected: 两文件全绿（`N passed (N)`）；假绿守门 0 命中。

- [ ] **Step 7: Commit**

```powershell
git add apps/web/tests/integration/kp-reconcile-state-machine.test.ts apps/web/tests/integration/kp-reconcile-alias-conflict.test.ts
git rm apps/web/tests/integration/kp-reconcile-sync-variant-legacy.test.ts
git commit -m "test(web): Task 2 — decouple review-flow tests from fake-id pattern, drop legacy variant test (Plan 12 cleanup)"
```

---

## Task 3: 迁移 sync-variant + backfill 测试到 promoted variant（现码下全绿）

**Files:**
- Modify: `apps/web/tests/integration/kp-reconcile-sync-variant.test.ts`
- Modify: `apps/web/tests/integration/kp-reconcile-backfill.test.ts`

这两文件现在用 fake id / 无 questionId 的 VariantItem（走 legacy → PENDING_REVIEW）。改为 seed **真 promoted variant**（含 `Question(source=VARIANT_GENERATED)` + `variantItem.questionId`）。现码下 promoted variant EXACT/ALIAS 已 LINKED 到变式题（见 `kp-reconcile-sync-variant-promoted.test.ts`），故**现码下即绿**；schema 改后仍绿。同时让无 questionId 的 seed 改成有 questionId，避免 Task 4 schema 改后编译失败。

- [ ] **Step 1: 整体重写 `kp-reconcile-sync-variant.test.ts`**

用真 promoted variant 重写全文（EXACT/ALIAS → LINKED 到变式题；保留 BACKFILL vs sourceRefType 判别例，现 LINK 到变式题）。新全文：

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { normalizeKpHint, reconcileHintsSync } from "@/server/lib/kp-reconcile";

// seed 一个 promoted variant：parent question + KP(+alias) + variantQuestion(source=VARIANT_GENERATED) + variantItem.questionId
async function seedPromotedVariant() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  await prisma.kpAlias.create({
    data: { subjectId: subject.id, kpId: kp.id, normalizedAlias: "linear eq", source: "SEED" },
  });
  const parentQuestion = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "parent", type: "ESSAY", status: "PUBLISHED" },
  });
  const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
  const entry = await prisma.errorBookEntry.create({
    data: { userId: user.id, questionId: parentQuestion.id, status: "ACTIVE", rootCause: "OTHER", rootCauseReasoning: "seed" },
  });
  const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
  const ledger = await prisma.creditLedger.create({
    data: { walletId: wallet.id, kind: "DEBIT", delta: -3, balanceAfter: 0, actionKind: "VARIANT_GROUP_GEN", idemKey: `debit:variant_group_gen:${user.id}:sync-variant` },
  });
  const group = await prisma.variantGroup.create({
    data: { entryId: entry.id, userId: user.id, creditsCost: 3, debitLedgerId: ledger.id },
  });
  const variantQuestion = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "variant", type: "ESSAY", status: "DRAFT", source: "VARIANT_GENERATED", createdByUserId: user.id },
  });
  const variantItem = await prisma.variantItem.create({
    data: { groupId: group.id, questionId: variantQuestion.id, level: "L1", position: 0, stemMd: "variant", solutionMd: "sol", knowledgePointHints: [kp.name] },
  });
  return { subjectId: subject.id, kpId: kp.id, parentQuestion, variantQuestion, variantItem };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// 红线 #2: VARIANT_ITEM 路径永不写 PARENT QuestionKPLink；只写变式题自己的 link。
describe("reconcileHintsSync — sourceRefType=VARIANT_ITEM 链到变式题，不污染 parent（红线 #2）", () => {
  it("EXACT 命中 → LINKED 到变式题 + 变式题 QuestionKPLink，parent 无 link", async () => {
    const { kpId, parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    const r = await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: ["一元一次方程"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    expect(r.linked).toBe(1);
    expect(r.queued).toBe(0);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
    });
    expect(match.status).toBe("LINKED");
    expect(match.matchVia).toBe("EXACT");
    expect(match.kpId).toBe(kpId);
    expect(match.questionId).toBe(variantQuestion.id);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } })).toBe(0);
  });

  it("ALIAS 命中 → 同样 LINKED 到变式题，parent 无 link", async () => {
    const { kpId, parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: ["Linear Eq"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
    });
    expect(match.status).toBe("LINKED");
    expect(match.matchVia).toBe("ALIAS");
    expect(match.questionId).toBe(variantQuestion.id);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } })).toBe(0);
  });

  it("source=BACKFILL + sourceRefType=VARIANT_ITEM → 仍按 VARIANT_ITEM 解析（分流看 sourceRefType 不看 source）", async () => {
    const { kpId, parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: ["一元一次方程"],
      source: "BACKFILL",          // 不同 source
      sourceRefType: "VARIANT_ITEM", // 但 sourceRefType 决定路径
      sourceRefId: variantItem.id,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
    });
    expect(match.status).toBe("LINKED");
    expect(match.source).toBe("BACKFILL");
    expect(match.questionId).toBe(variantQuestion.id);         // 关键：链到变式题，不是 parent
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId: parentQuestion.id } })).toBe(0);
  });
});
```

注：`normalizeKpHint` import 保留（若未用则删；本文件未用到 → 删该 import，仅留 `reconcileHintsSync`）。

- [ ] **Step 2: 改 `kp-reconcile-backfill.test.ts` 的 seed 加 promoted variant**

把 `seedVariantItem` 改成创建 `variantQuestion` 并给 `variantItem.questionId` 赋值，返回 `variantQuestionId`。替换 L9-74 的 helper：

```typescript
async function seedVariantItem(opts: { knowledgePointHints: string[] }) {
  const subject = await prisma.subject.create({ data: { code: "math", name: "Mathematics" } });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "linear equation", difficulty: 2 },
  });
  const question = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "Solve x + 1 = 2", type: "ESSAY", status: "PUBLISHED" },
  });
  const user = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
  const entry = await prisma.errorBookEntry.create({
    data: { userId: user.id, questionId: question.id, status: "ACTIVE", rootCause: "OTHER", rootCauseReasoning: "seed" },
  });
  const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
  const ledger = await prisma.creditLedger.create({
    data: { walletId: wallet.id, kind: "DEBIT", delta: -3, balanceAfter: 0, actionKind: "VARIANT_GROUP_GEN", idemKey: `debit:variant_group_gen:${user.id}:backfill-test` },
  });
  const group = await prisma.variantGroup.create({
    data: { entryId: entry.id, userId: user.id, creditsCost: 3, debitLedgerId: ledger.id },
  });
  const variantQuestion = await prisma.question.create({
    data: { subjectId: subject.id, stemMd: "Variant stem", type: "ESSAY", status: "DRAFT", source: "VARIANT_GENERATED", createdByUserId: user.id },
  });
  const variantItem = await prisma.variantItem.create({
    data: { groupId: group.id, questionId: variantQuestion.id, level: "L1", position: 0, stemMd: "Variant stem", solutionMd: "Variant solution", knowledgePointHints: opts.knowledgePointHints },
  });
  return { questionId: question.id, variantQuestionId: variantQuestion.id, variantItemId: variantItem.id, kpId: kp.id };
}
```

- [ ] **Step 3: 改 backfill 的 idempotency 例（保持断言，sourceRefId 不变）**

第一个 `it("running the same backfill input twice ...")` 的断言 `kpReconcileMatch.count({ where: { sourceRefId: variantItemId } })` 不变（仍 1 行）。无需改 body（`variantItemId` 仍来自解构）。确认解构行含 `variantItemId`。

- [ ] **Step 4: 改 backfill 的「exact hit」例 → LINKED 到变式题**

替换第二个 `it(...)`（L106-126）为：

```typescript
  it("BACKFILL exact hit links to the promoted variant question, not the parent", async () => {
    const { questionId, variantQuestionId, variantItemId, kpId } = await seedVariantItem({
      knowledgePointHints: ["linear equation"],
    });

    await reconcileHintsSync(prisma, {
      questionId,
      hints: ["linear equation"],
      source: "BACKFILL",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItemId,
    });

    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { sourceRefId: variantItemId } });
    expect(match.status).toBe("LINKED");
    expect(match.kpId).toBe(kpId);
    expect(match.questionId).toBe(variantQuestionId);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestionId, kpId } })).toBe(1);
    expect(await prisma.questionKPLink.count({ where: { questionId, kpId } })).toBe(0); // parent 无 link
  });
```

- [ ] **Step 5: 跑两文件 + 假绿守门**

Run:
```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-backfill.test.ts
Select-String -Path apps/web/tests/integration/kp-reconcile-sync-variant.test.ts,apps/web/tests/integration/kp-reconcile-backfill.test.ts -Pattern "it\.todo|VARIANT_TO_PARENT_NEEDS_REVIEW"
```
Expected: 两文件全绿（现码下 promoted variant 即 LINKED）；守门 0 命中。

- [ ] **Step 6: Commit**

```powershell
git add apps/web/tests/integration/kp-reconcile-sync-variant.test.ts apps/web/tests/integration/kp-reconcile-backfill.test.ts
git commit -m "test(web): Task 3 — migrate variant reconcile tests to promoted-variant seeds (Plan 12 cleanup)"
```

---

## Task 4: Schema `VariantItem.questionId` NOT NULL + 枚举 tombstone 注释

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_plan12_variant_question_not_null/migration.sql`

此时所有 `questionId: null` seed 已删/改（Task 1-3），schema 改后编译/测试不破。

- [ ] **Step 1: 改 schema**

在 `packages/db/prisma/schema.prisma` 的 `model VariantItem`：
- `questionId String? @unique @map("question_id")` → `questionId String @unique @map("question_id")`
- relation `question Question? @relation(fields: [questionId], references: [id], onDelete: Restrict)` → `question Question @relation(fields: [questionId], references: [id], onDelete: Restrict)`

在 `enum KpReconcileReviewReason` 给 tombstone 值加注释：
```prisma
enum KpReconcileReviewReason {
  LLM_CONFIDENCE_BAND
  // @deprecated Plan 12 cleanup：不再被任何代码读写；Postgres 无 ALTER TYPE DROP VALUE，保留为历史 tombstone。
  VARIANT_TO_PARENT_NEEDS_REVIEW
}
```

- [ ] **Step 2: 生成 migration SQL（--create-only）**

Run:
```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --name plan12_variant_question_not_null --create-only
```
检查生成的 `migration.sql` 应仅含：
```sql
-- AlterTable
ALTER TABLE "variant_items" ALTER COLUMN "question_id" SET NOT NULL;
```
若 Prisma 额外生成 enum/index DDL（不应有），删掉非 `SET NOT NULL` 的行，只保留这一句。

- [ ] **Step 3: 应用 migration**

Run（Windows AV 拦 P1000 时走 docker-exec，见 README §migration）：
```powershell
pnpm.cmd db:migrate
```
若 P1000：
```powershell
docker exec -i zhijiao-postgres psql -U postgres -d zhijiao -c 'ALTER TABLE "variant_items" ALTER COLUMN "question_id" SET NOT NULL;'
```
（并确保 `_prisma_migrations` 记录该 migration —— 优先用 `pnpm.cmd db:migrate`，docker-exec 仅作 AV 兜底。）

- [ ] **Step 4: 重生成 client + typecheck**

Run:
```powershell
pnpm.cmd --filter @zhijiao/db exec prisma generate
pnpm.cmd typecheck
```
Expected: `VariantItem.questionId` 类型变 `string`；typecheck 0 error（Task 1-3 已清掉所有 `questionId: null` seed）。

- [ ] **Step 5: 验证列已 NOT NULL + 全量测试**

Run:
```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d variant_items"
pnpm.cmd --filter @zhijiao/web test
```
Expected: `question_id | text | not null`；测试全绿。

- [ ] **Step 6: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): Task 4 — VariantItem.questionId NOT NULL + enum tombstone comment (Plan 12 cleanup)"
```

---

## Task 5: 同步 reconcile 代码 —— findUniqueOrThrow + 删 legacy 分支 + UNMATCHED 存变式题 id（linchpin）

**Files:**
- Modify: `apps/web/server/lib/kp-reconcile.ts`
- Modify: `apps/web/server/routers/variant.ts:122-128`（陈旧注释）
- Test: `apps/web/tests/integration/kp-reconcile-sync-variant.test.ts`（加 linchpin UNMATCHED 例）

🔑 **Linchpin**：同步 UNMATCHED 分支当前对变式行存 **parent** id（`...args`）。改成存 **变式题** id，使 Task 6 异步自动 link 落变式题、不污染 parent。先写会失败的 TDD 断言，再改代码。

- [ ] **Step 1: 写失败测试（UNMATCHED 变式行存变式题 id）**

在 `kp-reconcile-sync-variant.test.ts` 的 describe 内追加一例（hint 不命中任何 KP → UNMATCHED）：

```typescript
  it("UNMATCHED 变式 hint → match 行记在变式题（不是 parent）—— linchpin", async () => {
    const { parentQuestion, variantQuestion, variantItem } = await seedPromotedVariant();

    const r = await reconcileHintsSync(prisma, {
      questionId: parentQuestion.id,
      hints: ["完全没有对应知识点的提示词"],
      source: "VARIANT_ITEM",
      sourceRefType: "VARIANT_ITEM",
      sourceRefId: variantItem.id,
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({
      where: { sourceRefType: "VARIANT_ITEM", sourceRefId: variantItem.id },
    });
    expect(match.status).toBe("UNMATCHED");
    expect(match.questionId).toBe(variantQuestion.id); // 关键：变式题 id，非 parent
  });
```

- [ ] **Step 2: 跑测试看它失败**

Run:
```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant.test.ts -t "linchpin"
```
Expected: FAIL —— `match.questionId` 现为 parentQuestion.id（旧码 UNMATCHED 存 `...args`）。

- [ ] **Step 3: 改 `kp-reconcile.ts` VARIANT_ITEM 解析块（约 L129-147）**

替换为（删 `isVariantPath` / `isVariantPendingLegacy`，用 findUniqueOrThrow）：

```typescript
  let effectiveQuestionId: string | null = null;

  if (args.sourceRefType === "VARIANT_ITEM") {
    // Plan 12 cleanup: questionId 现恒非空；item 缺失=数据损坏 → throw，由调用方 try/catch 兜底。
    const variantItem = await prisma.variantItem.findUniqueOrThrow({
      where: { id: args.sourceRefId },
      select: { questionId: true },
    });
    effectiveQuestionId = variantItem.questionId;
  }

  const subjectQuestionId = args.questionId;
  const linkedQuestionId = effectiveQuestionId ?? args.questionId;
```

- [ ] **Step 4: 改 matched / UNMATCHED 分支（约 L192-253）**

把整个 `try { if (matchedKpId && matchVia) { ...三分支... } else { UNMATCHED } }` 替换为统一用 `linkedQuestionId`：

```typescript
    try {
      if (matchedKpId && matchVia) {
        // LINKED + 写 QuestionKPLink（变式路径写变式题；非变式 linkedQuestionId === args.questionId）
        await prisma.$transaction(async (tx) => {
          await upsertReconcileMatch(tx, {
            ...args,
            questionId: linkedQuestionId,
            normalizedHint: normalized,
            rawHint,
            kpId: matchedKpId,
            matchVia,
            confidence: 1.0,
            status: "LINKED",
            reviewReason: null,
          });
          await upsertQuestionKpLink(tx, linkedQuestionId, matchedKpId, 1.0);
        });
        result.linked++;
      } else {
        // UNMATCHED —— 同样记在 linkedQuestionId（变式路径=变式题；linchpin）
        await upsertReconcileMatch(prisma, {
          ...args,
          questionId: linkedQuestionId,
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
```
（catch 块及之后 L254-287 不变。注意 `upsertQuestionKpLink(tx, linkedQuestionId, matchedKpId, 1.0)` 删掉旧的 `matchedKpId!` 非空断言——TS 在 `if (matchedKpId && matchVia)` 内已收窄为非空。）

- [ ] **Step 5: 收窄 reviewReason 联合类型（L296）**

`ReconcileMatchUpsertArgs.reviewReason` 从
`reviewReason: "LLM_CONFIDENCE_BAND" | "VARIANT_TO_PARENT_NEEDS_REVIEW" | null;`
改为
`reviewReason: "LLM_CONFIDENCE_BAND" | null;`
（不再写该 tombstone 值；Prisma 枚举仍保留该值。）

- [ ] **Step 6: 修 `variant.ts:122-128` 陈旧注释**

把「sourceRefType=VARIANT_ITEM 在 service 层永不自动写 parent QuestionKPLink（红线 #2）—— 命中 EXACT/ALIAS 也只到 PENDING_REVIEW」更新为：

```typescript
      // Plan 9 + Plan 12: 每个 VariantItem 的 knowledgePointHints 过 reconcile。
      // sourceRefType=VARIANT_ITEM 永不写 PARENT QuestionKPLink（红线 #2）——
      // 命中 EXACT/ALIAS 直接 LINK 到变式题自己的 Question。
      // 在 $transaction 之外做，避免 reconcile 失败 rollback 已写好的 VariantGroup/Items。
      // await + try/catch + logger.warn 兜底（红线 #1）。caller 传 parent question 作 subject 上下文；
      // reconcileHintsSync 内部解析 VariantItem.questionId 作 link 目标。
```

- [ ] **Step 7: 跑 linchpin + 同步变式 + promoted + 全量**

Run:
```powershell
pnpm.cmd typecheck
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant.test.ts
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-sync-variant-promoted.test.ts
pnpm.cmd --filter @zhijiao/web test
```
Expected: typecheck 0；linchpin 例 PASS；promoted 守门 PASS；全量绿。

- [ ] **Step 8: Commit**

```powershell
git add apps/web/server/lib/kp-reconcile.ts apps/web/server/routers/variant.ts apps/web/tests/integration/kp-reconcile-sync-variant.test.ts
git commit -m "refactor(web): Task 5 — sync reconcile links variants to their own question, drop legacy branch (Plan 12 cleanup)"
```

---

## Task 6: 异步 LLM reconcile —— 变式高置信自动 LINK

**Files:**
- Modify: `apps/web/server/lib/kp-reconcile-pending.ts:146-212`
- Test: `apps/web/tests/integration/kp-reconcile-pending-script.test.ts`（变式例 → LINKED）

异步 `applyLlmResult` 当前对 VARIANT_ITEM 高置信走 PENDING_REVIEW（防 parent 污染）。Task 5 后变式 UNMATCHED 行已记变式题 id，故可与其它 source 一致自动 LINK。TDD：先改测试断言（red），再改代码（green）。

- [ ] **Step 1: 改 pending-script 变式例 → LINKED（写失败断言）**

替换 `kp-reconcile-pending-script.test.ts` 第二个 `it(...)`（L93-116）为「seed 变式题 + UNMATCHED 行 questionId=变式题 → 高置信 LINK 到变式题」：

```typescript
  it("confidence >= 0.85 + sourceRefType=VARIANT_ITEM → LINKED 到变式题（Plan 12 cleanup）", async () => {
    const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const kp = await prisma.knowledgePoint.create({
      data: { subjectId: subject.id, code: "kp-a", name: "KP-A", difficulty: 2 },
    });
    // 变式题（异步路径只用 match.questionId；此处直接 seed 变式 Question）
    const variantQuestion = await prisma.question.create({
      data: { subjectId: subject.id, stemMd: "variant", type: "ESSAY", status: "DRAFT", source: "VARIANT_GENERATED" },
    });
    const m = await prisma.kpReconcileMatch.create({
      data: {
        questionId: variantQuestion.id, // Task 5 后变式 UNMATCHED 行记变式题 id
        kpId: null, rawHint: "linear", normalizedHint: "linear",
        source: "VARIANT_ITEM", sourceRefType: "VARIANT_ITEM", sourceRefId: "clrelid000000000000000091",
        matchVia: null, confidence: null, status: "UNMATCHED",
      },
    });
    const adapter = makeAdapter(({ matchIds }) =>
      matchIds.map((matchId) => ({ matchId, kpId: kp.id, confidence: 0.95 })),
    );
    const router = new AiRouter({ prisma, adapter });

    const r = await processBatch(prisma, router, { limit: 50, thresholds: THRESHOLDS });
    expect(r.batches[0]!.linked).toBe(1);
    expect(r.batches[0]!.pendingReview).toBe(0);

    const reread = await prisma.kpReconcileMatch.findUniqueOrThrow({ where: { id: m.id } });
    expect(reread.status).toBe("LINKED");
    expect(reread.kpId).toBe(kp.id);
    expect(reread.confidence).toBe(0.95);
    expect(await prisma.questionKPLink.count({ where: { questionId: variantQuestion.id, kpId: kp.id } })).toBe(1);
  });
```

- [ ] **Step 2: 跑测试看失败**

Run:
```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-pending-script.test.ts -t "LINKED 到变式题"
```
Expected: FAIL —— 旧码走 isVariant → PENDING_REVIEW，断言 LINKED 失败。

- [ ] **Step 3: 改 `applyLlmResult`（删 isVariant 特例）**

`kp-reconcile-pending.ts::applyLlmResult`：
- 删 L153 `const isVariant = match.sourceRefType === "VARIANT_ITEM";`
- L171 `if (item.confidence >= thresholds.autoLink && !isVariant)` → `if (item.confidence >= thresholds.autoLink)`
- 删 L195-199 的 `const reviewReason = isVariant && ... ? "VARIANT_TO_PARENT_NEEDS_REVIEW" : "LLM_CONFIDENCE_BAND";`，PENDING_REVIEW 写死 `reviewReason: "LLM_CONFIDENCE_BAND"`：

```typescript
  // PENDING_REVIEW —— 仅 LLM 置信带 [review, autoLink)
  await prisma.kpReconcileMatch.update({
    where: { id: match.id },
    data: {
      kpId: item.kpId,
      matchVia: "LLM",
      confidence: item.confidence,
      status: "PENDING_REVIEW",
      reviewReason: "LLM_CONFIDENCE_BAND",
      modelCallId,
    },
  });
  return "PENDING_REVIEW";
```
- `match` 参数若 `sourceRefType` 字段变 unused，更新调用处的类型/解构（保留 `id`, `questionId`）。同步更新 L139-145 的注释（删 VARIANT_ITEM 特例描述）。

- [ ] **Step 4: 跑变式例 + 全 pending-script + typecheck**

Run:
```powershell
pnpm.cmd typecheck
pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-pending-script.test.ts
```
Expected: typecheck 0；6 例全绿（变式例现 LINKED；QUESTION 高置信、band、dropped、limit、parentPath 例不受影响）。

- [ ] **Step 5: 全量回归 + tombstone 0 写检查**

Run:
```powershell
pnpm.cmd --filter @zhijiao/web test
Select-String -Path apps/web/server -Pattern "VARIANT_TO_PARENT_NEEDS_REVIEW" -Recurse
```
Expected: 全量绿；server 源码 0 处再写/读 `VARIANT_TO_PARENT_NEEDS_REVIEW`（仅 schema enum tombstone 保留）。

- [ ] **Step 6: Commit**

```powershell
git add apps/web/server/lib/kp-reconcile-pending.ts apps/web/tests/integration/kp-reconcile-pending-script.test.ts
git commit -m "refactor(web): Task 6 — async LLM auto-links variant matches to their own question (Plan 12 cleanup)"
```

---

## Task 7: CLI 标签 + 文档/探针 + 全量回归 + CLAUDE.md

**Files:**
- Modify: `apps/web/scripts/kp-review.ts:55`
- Modify: `docs/claude/implementation-state.md`
- Modify: `docs/claude/merge-verification.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 修 kp-review.ts 标签**

`apps/web/scripts/kp-review.ts:55` 把 `console.log(... "Parent question" ...)` 的措辞改中性（如 `question=${m.questionId}`），因变式行的 `questionId` 现是变式题、不再是 parent。最小改：把字面 "Parent question" 改 "question"。

- [ ] **Step 2: 更新 implementation-state.md Plan 12 现状段**

`docs/claude/implementation-state.md` 「VariantItem 升格现状（Plan 12）」段，把两阶段 null/non-null 分流 + 「历史 VARIANT_TO_PARENT_NEEDS_REVIEW punt」改写为单路径。替换该段 bullets 为：

```
**VariantItem 升格现状**（Plan 12 + 2026-06-01 cleanup）：
- `VariantItem.questionId` 现为 **NOT NULL**，恒指向 `Question(source="VARIANT_GENERATED")`；新生成变式同事务双写 Question + VariantItem。
- `reconcileHintsSync` 对 `sourceRefType=VARIANT_ITEM` 用 `findUniqueOrThrow` 解析 `VariantItem.questionId`，**所有分支**（LINKED + UNMATCHED）的 match 行均记**变式题 id**；EXACT/ALIAS 直接 LINK 到变式题 QuestionKPLink。红线 #2 = 永不写 **parent** QuestionKPLink（仍成立）。
- 异步 `applyLlmResult` 对变式高置信命中与其它 source 一致 **自动 LINK** 到变式题，不再进人工 review。
- `KpReconcileReviewReason.VARIANT_TO_PARENT_NEEDS_REVIEW` 为 **tombstone**：无代码读写，Postgres 无 DROP VALUE 故保留。`variant-backfill-questions` 脚本/测试已退役（NOT NULL 后无 null 可补）。`kp-backfill-variant-items` 仍有效。
- `VARIANT_GENERATED` 与 `USER_ADHOC` 同为 owner-only；注销 scrub `createdByUserId=null` 保留行作统计样本。
```

- [ ] **Step 3: 更新 merge-verification.md 探针**

`docs/claude/merge-verification.md`：
- 探针 **42**：在 `\d variant_items` 断言后补「且 `question_id` 为 `not null`」。
- 探针 **43**：第 1 条 `variant_items WHERE question_id IS NULL count=0` 改为「schema 已 NOT NULL（见探针 42）」；保留第 2/3 条（source=VARIANT_GENERATED、created_by 完整性）。
- 探针 **46**（`variant:backfill-questions --dry-run` smoke）：**删除**整条，后续探针顺延（或标注「46 退役」保号不重编，二选一，与文件现有惯例一致）。
- 探针 **32**：措辞「永不写 QuestionKPLink」改「LINK 到变式题、不写 parent link」；文件名 `kp-reconcile-sync-variant.test.ts` 仍在。
- 探针 **34**：措辞同步为 LINKED（backfill 例现 LINK 到变式题）。
- 探针 **44**（`-promoted` 测试）：不动。

- [ ] **Step 4: 更新 CLAUDE.md**

`CLAUDE.md`：
- 「## 开始实现时（已落地）」追加一条 Plan 12 cleanup 落地说明（引用本 plan 与 spec 路径）。
- 「下一步候选 Plan」删除 `Plan 12 cleanup: ...` 那一行。

- [ ] **Step 5: 全量回归（unit+integration）+ 假绿 + tombstone 守门**

Run:
```powershell
pnpm.cmd typecheck
pnpm.cmd test
Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse
Select-String -Path apps/web/server,apps/web/scripts -Pattern "VARIANT_TO_PARENT_NEEDS_REVIEW" -Recurse
```
Expected: typecheck 0；全量绿；假绿 0 命中；server/scripts 源码 0 处 tombstone 引用。

- [ ] **Step 6: E2E（变式流不受影响确认）**

Run:
```powershell
pnpm.cmd --filter @zhijiao/web test:e2e
```
Expected: 全绿（spec 评审确认无 variant-reconcile E2E 断言；若环境无法跑 E2E，记录跳过原因，不谎报）。

- [ ] **Step 7: Commit**

```powershell
git add apps/web/scripts/kp-review.ts docs/claude/implementation-state.md docs/claude/merge-verification.md CLAUDE.md
git commit -m "docs(web): Task 7 — kp-review label + docs/probes + CLAUDE.md (Plan 12 cleanup landed)"
```

---

## 完成后（执行者注意）

- 全部 7 task 绿后，本分支 `plan-12-cleanup` 经 `--no-ff` 合入 `master`（用户审计工作流，memory `zhijiao-merge-workflow`）。合并由用户/收尾步骤触发，不在本 plan 内自动 push。
- Merge 后逐条核对 `docs/claude/merge-verification.md`（含本 plan 改动的探针 32/34/42/43/44）。

## Self-Review 记录（写 plan 时自查）

- **Spec 覆盖**：§3.1 schema→Task4；§3.3 同步→Task5；§3.4 异步→Task6；§4 脚本/标签→Task1/Task7；§5 测试 churn 9 文件→Task1(2 删)/Task2(legacy 删+state-machine+alias)/Task3(sync-variant+backfill)/Task5(linchpin)/Task6(pending)；§6 文档/探针→Task7。`kp-reconcile-sync-variant-promoted.test.ts` 不动（spec §5 表）。全覆盖。
- **Placeholder 扫描**：无 TBD/TODO；每个 code step 给完整代码与命令。
- **类型一致**：`linkedQuestionId`/`effectiveQuestionId`（Task5）、`reviewReason: "LLM_CONFIDENCE_BAND" | null`（Task5 收窄）、`variantQuestionId`（Task3 seed 返回）跨 task 命名一致。
- **green-per-task**：Task1-3 在现码下绿（promoted variant 已 LINK）；Task4 schema 改时 null-seeder 已清；Task5/6 TDD red→green。
