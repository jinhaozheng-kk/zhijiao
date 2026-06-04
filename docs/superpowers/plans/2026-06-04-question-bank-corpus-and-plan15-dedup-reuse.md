# 题库语料供给 + Plan 15 去重/复用 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 原创一批 PUBLISHED 初中数学题入库，并让 `tutor.ask` 命中 PUBLISHED 范题时复用缓存的 hint-first 讲解（命中零 AI、零扣费），错题/热度归并到 canonical 题。

**Architecture:** Schema 加 `Question.externalKey/reuseHitCount` + `QuestionExplanationCache` 表 + `GradeBand` 枚举。计费中间件抽出 `beginCharge`/`settleCharge` 纯函数，使 `tutor.ask` 能"缓存命中跳过扣费、未命中正常扣费"。`tutor.ask` 中间件链加 `requireGuardianConsent`（与扣费解耦）并用 `tutorReuseAndChargeMiddleware` 替换裸 `chargeMiddleware`；resolver 三分支（命中缓存 / 命中范题缓存 miss / 无范题回原 USER_ADHOC 路径）。

**Tech Stack:** TypeScript、Prisma 5、tRPC v11、Vitest、Next.js（apps/web）。

参考 spec：`docs/superpowers/specs/2026-06-04-question-bank-corpus-and-plan15-dedup-reuse-design.md`

---

## 关键既有事实（实现前必读）

- `apps/web/server/lib/question-shared.ts`：`normalizeStem(trim+折叠空白)`、`stemHashHex(stem)→sha256 前32位`。**复用，不要重写。**
- `apps/web/server/lib/question.ts`：`upsertUserAdhocQuestion(prisma, {userId, stemMd, stemImageKeys?})`。无范题分支沿用它。
- `apps/web/server/trpc.ts`：`chargeMiddleware(kind)`（计费+补偿，承重）、`chargedProcedure=auth+requireGuardianConsent+charge`、`requireGuardianConsent`、`validateTutorInputCompliance`、`shouldCompensate/compensate/errorReason/ensureWallet/priceOf/chargeForAction/ActionAlreadyChargedError`。
- `apps/web/server/routers/tutor.ts`：`ask` 当前链 = `authedProcedure.use(validateTutorInputCompliance).use(chargeMiddleware("TUTOR_ASK"))`，**无 requireGuardianConsent**。
- 现有 PUBLISHED 题 `source` 不一致（`2_questions.ts`="自有"，旧测试=null）。匹配 canonical 用 `status="PUBLISHED" AND normalizedStemHash=hash`，**不依赖 source**。
- 测试 harness：`apps/web/tests/integration/_helpers/error-book-fixtures` 导出 `makeCtx(userId)`、`seedUserWithBalance(balance)`；`@zhijiao/db/test-utils` 导出 `prisma`、`resetDb`。`vi.mock("@/lib/ai-client", ...)` mock `getAiRouter().tutor()`。
- Windows migrate：若 `pnpm db:migrate` 卡壳走 README 的 docker-exec 绕过。

---

## Task 1: Schema —— externalKey / reuseHitCount / GradeBand / QuestionExplanationCache

**Files:**
- Modify: `packages/db/prisma/schema.prisma`（`Question` model、新增 enum + model）
- Migration: 新建（`pnpm db:migrate` 生成）

- [ ] **Step 1: 改 schema.prisma `Question` model**，在字段区加两列、relation 区加一行、末尾加索引：

```prisma
model Question {
  // ... 现有字段不动 ...
  externalKey         String?          @unique @map("external_key")   // seed/导入幂等键；USER_ADHOC/VARIANT 为 null
  reuseHitCount       Int              @default(0) @map("reuse_hit_count") // Plan 15 复用/命中热度
  // ... 现有 relations 不动 ...
  explanationCaches   QuestionExplanationCache[]   // Plan 15

  @@index([status, normalizedStemHash])   // Plan 15 canonical 查找
  @@map("questions")
}
```

- [ ] **Step 2: 新增 enum + model**（放在 `Question` 相关区域之后）：

```prisma
enum GradeBand {
  PRIMARY
  JUNIOR
  SENIOR
  NEUTRAL
}

model QuestionExplanationCache {
  id           String    @id @default(cuid())
  questionId   String    @map("question_id")
  gradeBand    GradeBand @map("grade_band")
  tutoringJson Json      @map("tutoring_json")
  modelCallId  String?   @map("model_call_id")
  createdAt    DateTime  @default(now()) @map("created_at")

  question     Question  @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@unique([questionId, gradeBand])
  @@map("question_explanation_caches")
}
```

- [ ] **Step 3: 生成 migration + client**

Run: `pnpm db:migrate`（迁移名 `plan15_question_reuse`）；若 Windows 卡住走 docker-exec 绕过，然后 `pnpm --filter @zhijiao/db prisma generate`
Expected: 迁移成功，`@prisma/client` 含 `GradeBand`、`QuestionExplanationCache`、`Question.externalKey/reuseHitCount`

- [ ] **Step 4: 同步 test DB schema**

Run: `pnpm test:setup`
Expected: 6 个 test DB 迁移到最新

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @zhijiao/db typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): add Question.externalKey/reuseHitCount + QuestionExplanationCache (Plan 15)"
```

---

## Task 2: 原创 PUBLISHED 语料数据文件 + 校验

先用 WebSearch 检索初中数学（一次函数/方程/不等式及邻近主题）真题，**仅作考点/题型/难度参考**；本任务落库的题目全部**原创等价**，不逐字照搬。

**Files:**
- Create: `packages/db/prisma/seed/question-bank/junior-math.ts`
- Create: `packages/db/prisma/seed/question-bank/types.ts`
- Test: `packages/db/prisma/seed/question-bank/types.test.ts`（vitest，跑在 db 包）

- [ ] **Step 1: 写校验失败测试** `types.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateSeedQuestions, type SeedQuestion } from "./types.js";

const ok: SeedQuestion = {
  externalKey: "qb-x-001", stemMd: "解方程 x+1=2", type: "CALCULATION",
  difficulty: 1, answerMd: "x=1", solutionMd: "移项得 x=1", kpCodes: ["math-g8-linear-eq-solve"],
};

describe("validateSeedQuestions", () => {
  it("接受合法题集", () => {
    expect(() => validateSeedQuestions([ok], new Set(["math-g8-linear-eq-solve"]))).not.toThrow();
  });
  it("重复 externalKey 抛错", () => {
    expect(() => validateSeedQuestions([ok, ok], new Set(["math-g8-linear-eq-solve"]))).toThrow(/externalKey/);
  });
  it("kpCode 不在叶子集合抛错", () => {
    expect(() => validateSeedQuestions([{ ...ok, kpCodes: ["nope"] }], new Set(["math-g8-linear-eq-solve"]))).toThrow(/kpCode/);
  });
  it("空 kpCodes 抛错", () => {
    expect(() => validateSeedQuestions([{ ...ok, kpCodes: [] }], new Set(["math-g8-linear-eq-solve"]))).toThrow(/kpCodes/);
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `pnpm --filter @zhijiao/db test -- seed/question-bank/types.test.ts`
Expected: FAIL（`validateSeedQuestions` 未定义）

- [ ] **Step 3: 写 `types.ts`**

```ts
import type { QuestionType } from "@prisma/client";

export interface SeedQuestion {
  externalKey: string;
  stemMd: string;
  type: QuestionType;
  optionsJson?: unknown;
  difficulty: number;
  answerMd: string;
  solutionMd: string;
  kpCodes: string[];
}

export function validateSeedQuestions(qs: SeedQuestion[], leafCodes: Set<string>): void {
  const seen = new Set<string>();
  for (const q of qs) {
    if (seen.has(q.externalKey)) throw new Error(`duplicate externalKey: ${q.externalKey}`);
    seen.add(q.externalKey);
    if (q.kpCodes.length === 0) throw new Error(`empty kpCodes: ${q.externalKey}`);
    for (const code of q.kpCodes) {
      if (!leafCodes.has(code)) throw new Error(`unknown kpCode "${code}" in ${q.externalKey}`);
    }
  }
}
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `pnpm --filter @zhijiao/db test -- seed/question-bank/types.test.ts`
Expected: PASS

- [ ] **Step 5: 写 `junior-math.ts`**（≥30 道原创题；下为格式样例，实现时补满，KP code 须存在于 `kp-data` 叶子，如 `math-g8-linear-eq-solve` / `math-g8-linear-eq-apply` 等）

```ts
import type { SeedQuestion } from "./types.js";

export const juniorMathQuestions: SeedQuestion[] = [
  {
    externalKey: "qb-junior-linear-eq-001",
    stemMd: "解方程：5x - 7 = 2x + 8",
    type: "CALCULATION",
    difficulty: 2,
    answerMd: "x = 5",
    solutionMd: "移项：5x - 2x = 8 + 7，即 3x = 15，两边除以 3 得 x = 5。",
    kpCodes: ["math-g8-linear-eq-solve"],
  },
  // ... 实现时补满至 ≥30 道，覆盖：一元一次方程求解/应用、二元一次方程组、
  //     一次函数图象与性质、一元一次不等式（组）等已存在的 KP 叶子 ...
];
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/seed/question-bank
git commit -m "feat(db): original junior-math PUBLISHED corpus + seed validation (Plan 15)"
```

---

## Task 3: 语料 loader + 补 hash + verify 脚本

**Files:**
- Create: `packages/db/prisma/seed/5_question_bank.ts`
- Modify: `packages/db/prisma/seed/index.ts`（加 step）
- Modify: `packages/db/prisma/seed/2_questions.ts`（补 normalizedStemHash）
- Create: `packages/db/prisma/scripts/verify-question-bank.ts`
- Modify: `packages/db/package.json`（加 `verify:question-bank` script）

- [ ] **Step 1: 写 loader `5_question_bank.ts`**

```ts
import { PrismaClient } from "@prisma/client";
import { stemHashHex } from "./kp-data/../../../../../apps/web/server/lib/question-shared.js";
import { juniorMathQuestions } from "./question-bank/junior-math.js";
import { validateSeedQuestions } from "./question-bank/types.js";
import { mathKpRoots } from "./kp-data/index.js";

// 收集 KP 叶子 code（容器有子节点，叶子无）
function collectLeafCodes(): Set<string> {
  const out = new Set<string>();
  const walk = (n: { code: string; children?: unknown[] }) => {
    const kids = (n as { children?: { code: string }[] }).children;
    if (!kids || kids.length === 0) out.add(n.code);
    else kids.forEach((k) => walk(k as never));
  };
  (mathKpRoots as { code: string; children?: unknown[] }[]).forEach(walk);
  return out;
}

export async function seedQuestionBank(prisma: PrismaClient) {
  validateSeedQuestions(juniorMathQuestions, collectLeafCodes());
  const math = await prisma.subject.findUniqueOrThrow({ where: { code: "math" } });

  for (const q of juniorMathQuestions) {
    const kps = await prisma.knowledgePoint.findMany({
      where: { subjectId: math.id, code: { in: q.kpCodes } },
      select: { id: true },
    });
    await prisma.question.upsert({
      where: { externalKey: q.externalKey },
      create: {
        externalKey: q.externalKey,
        subjectId: math.id,
        stemMd: q.stemMd,
        type: q.type,
        difficulty: q.difficulty,
        status: "PUBLISHED",
        source: "PUBLISHED",
        normalizedStemHash: stemHashHex(q.stemMd),
        answer: { create: { contentMd: q.answerMd, solutionMd: q.solutionMd } },
        knowledgePoints: { create: kps.map((k) => ({ kpId: k.id, weight: 1.0 })) },
      },
      update: {
        stemMd: q.stemMd,
        difficulty: q.difficulty,
        normalizedStemHash: stemHashHex(q.stemMd),
      },
    });
  }
  console.log(`✓ ${juniorMathQuestions.length} question-bank questions seeded`);
}
```

> 注：`stemHashHex` 的 import 路径若跨包不便，可在 `packages/db` 内复制同一 4 行实现（`sha256(normalizeStem).slice(0,32)`），保持与 `question-shared.ts` 行为**逐字一致**（trim+折叠空白、不 lowercase、前 32 位）。实现时二选一并在 PR 描述注明。

- [ ] **Step 2: wire 进 `index.ts`**

```ts
import { seedQuestionBank } from "./5_question_bank.js";
// main() 内，seedKpAliases 之后、seedClassroom 之前：
await seedQuestionBank(prisma);
```

- [ ] **Step 3: 给 `2_questions.ts` 现有 PUBLISHED 题补 hash**

在 `prisma.question.create` 的 data 里加（import `stemHashHex` 同 Step 1 处理）：

```ts
normalizedStemHash: stemHashHex(s.stem),
```

- [ ] **Step 4: 写 verify 脚本 `scripts/verify-question-bank.ts`**

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const qs = await prisma.question.findMany({
    where: { status: "PUBLISHED" },
    include: { answer: true, knowledgePoints: true },
  });
  const errors: string[] = [];
  if (qs.length < 30) errors.push(`PUBLISHED 题数 ${qs.length} < 30`);
  for (const q of qs) {
    if (!q.answer) errors.push(`无 answer: ${q.id}`);
    if (q.knowledgePoints.length === 0) errors.push(`无 KP link: ${q.id}`);
    if (!q.normalizedStemHash) errors.push(`无 normalizedStemHash: ${q.id}`);
  }
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log(`✓ question-bank OK: ${qs.length} PUBLISHED questions`);
}
main().finally(() => prisma.$disconnect());
```

- [ ] **Step 5: 加 package.json script**

`packages/db/package.json` 的 `"scripts"`：

```json
"verify:question-bank": "tsx prisma/scripts/verify-question-bank.ts"
```

- [ ] **Step 6: 重新 seed + verify**

Run: `pnpm db:seed && pnpm --filter @zhijiao/db verify:question-bank`
Expected: seed 打印 `✓ N question-bank questions seeded`，verify 打印 `✓ question-bank OK`

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): question-bank seed loader + hash backfill + verify script (Plan 15)"
```

---

## Task 4: `bandOf` 学段→band 纯函数

**Files:**
- Create: `apps/web/server/lib/grade-band.ts`
- Test: `apps/web/tests/unit/grade-band.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { bandOf } from "@/server/lib/grade-band";

describe("bandOf", () => {
  it("小学", () => { expect(bandOf("G5")).toBe("PRIMARY"); expect(bandOf("G6")).toBe("PRIMARY"); });
  it("初中", () => { expect(bandOf("G7")).toBe("JUNIOR"); expect(bandOf("G9")).toBe("JUNIOR"); });
  it("高中", () => { expect(bandOf("G10")).toBe("SENIOR"); expect(bandOf("G12")).toBe("SENIOR"); });
  it("缺失→NEUTRAL", () => { expect(bandOf(undefined)).toBe("NEUTRAL"); });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/grade-band.test.ts`
Expected: FAIL

- [ ] **Step 3: 写实现 `grade-band.ts`**

```ts
import type { GradeBand } from "@prisma/client";

export type GradeInput = "G5" | "G6" | "G7" | "G8" | "G9" | "G10" | "G11" | "G12";

export function bandOf(grade: GradeInput | undefined | null): GradeBand {
  switch (grade) {
    case "G5": case "G6": return "PRIMARY";
    case "G7": case "G8": case "G9": return "JUNIOR";
    case "G10": case "G11": case "G12": return "SENIOR";
    default: return "NEUTRAL";
  }
}
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `pnpm --filter @zhijiao/web test -- tests/unit/grade-band.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/grade-band.ts apps/web/tests/unit/grade-band.test.ts
git commit -m "feat(web): bandOf grade-to-band helper (Plan 15)"
```

---

## Task 5: 抽 `beginCharge`/`settleCharge`（计费中间件无行为重构）

把 `chargeMiddleware` 的计费+补偿逻辑抽成两个 module-level 函数，供 `tutor.ask` 条件复用。**行为零变**，由既有 billing 测试守门。

**Files:**
- Modify: `apps/web/server/trpc.ts`

- [ ] **Step 1: 在 `chargeMiddleware` 定义之上加 `beginCharge`/`settleCharge`**

```ts
// Plan 15: 从 chargeMiddleware 抽出，供条件计费复用（缓存命中跳过 charge）。行为与原内联逻辑逐字一致。
export interface ChargeHandle { ledgerId: string; walletId: string; cost: number; }

export async function beginCharge(
  ctx: { db: PrismaClient; auth: { userId: string } },
  kind: ActionKind,
  clientRequestId: string,
): Promise<ChargeHandle> {
  const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
  const cost = priceOf(kind);
  const idemKey = `debit:${kind.toLowerCase()}:${ctx.auth.userId}:${clientRequestId}`;
  let debit: Awaited<ReturnType<typeof chargeForAction>>;
  try {
    debit = await chargeForAction(ctx.db, {
      walletId: wallet.id, kind, cost, idemKey, createdByUserId: ctx.auth.userId,
    });
  } catch (e) {
    if (e instanceof ActionAlreadyChargedError) {
      throw new TRPCError({ code: "CONFLICT", message: "该请求已处理，请勿重复提交", cause: { reason: "ACTION_IDEMPOTENCY_HIT" } });
    }
    throw e;
  }
  if (debit.kind === "INSUFFICIENT_BALANCE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "余额不足", cause: { reason: "INSUFFICIENT_BALANCE", required: cost, balance: debit.balance } });
  }
  return { ledgerId: debit.ledgerId, walletId: wallet.id, cost };
}

export async function settleCharge(
  ctx: { db: PrismaClient; auth: { userId: string }; requestId?: string },
  handle: ChargeHandle & { kind: ActionKind },
  // tRPC MiddlewareResult: { ok: boolean; error?: unknown }
  result: { ok: boolean; error?: unknown },
): Promise<void> {
  if (result.ok) return;
  const e = result.error;
  if (shouldCompensate(e)) {
    await compensate(ctx.db, { originalLedgerId: handle.ledgerId, walletId: handle.walletId, cost: handle.cost, kind: handle.kind, reason: errorReason(e) });
    return;
  }
  // 非补偿白名单：注解 metadata + warn（原逻辑逐字搬运）
  const causeObj = (e as { cause?: unknown } | null)?.cause;
  const originalFromCauseObj = causeObj && typeof causeObj === "object" && "original" in causeObj ? (causeObj as { original?: unknown }).original : undefined;
  const originalClass = originalFromCauseObj instanceof Error ? originalFromCauseObj.constructor.name : causeObj instanceof Error ? causeObj.constructor.name : (e as { constructor?: { name?: string } } | null)?.constructor?.name ?? "Unknown";
  const existing = await ctx.db.creditLedger.findUnique({ where: { id: handle.ledgerId }, select: { metadata: true } });
  const prior = (existing?.metadata as Record<string, unknown> | null) ?? {};
  await ctx.db.creditLedger.update({ where: { id: handle.ledgerId }, data: { metadata: { ...prior, compensationStatus: "not_compensated_whitelisted", errorClass: originalClass } } });
  logger.warn({ event: "charged_action_not_compensated", ledgerId: handle.ledgerId, walletId: handle.walletId, userId: ctx.auth.userId, actionKind: handle.kind, cost: handle.cost, errorClass: originalClass, requestId: ctx.requestId }, "Action failed but whitelisted as non-compensable");
}
```

> `PrismaClient` 已在 trpc.ts import；若未 import `type { PrismaClient } from "@prisma/client"` 则补上。

- [ ] **Step 2: 用 `beginCharge`/`settleCharge` 改写 `chargeMiddleware` 主体**（parse clientRequestId 后）：

```ts
export const chargeMiddleware = (kind: ActionKind) =>
  t.middleware(async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录", cause: { reason: ctx.authError ?? "NO_SESSION" } });
    }
    const raw = await getRawInput();
    const parsed = z.object({ clientRequestId: z.string().uuid() }).safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "请求缺少 clientRequestId（UUID）", cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" } });
    }
    const handle = await beginCharge(ctx, kind, parsed.data.clientRequestId);
    const result = await next({ ctx: { ...ctx, auth: ctx.auth, debit: { ledgerId: handle.ledgerId } } });
    await settleCharge(ctx, { ...handle, kind }, result);
    return result;
  });
```

- [ ] **Step 3: typecheck + 跑全部 billing 回归**

Run: `pnpm --filter @zhijiao/web typecheck && pnpm --filter @zhijiao/web test -- tests/integration/charged-procedure-compensation.test.ts tests/integration/charged-procedure-idempotency.test.ts tests/integration/charged-procedure-tutor.test.ts tests/integration/wallet-balance.test.ts`
Expected: 全 PASS（行为零变）

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/trpc.ts
git commit -m "refactor(web): extract beginCharge/settleCharge from chargeMiddleware (Plan 15 prep)"
```

---

## Task 6: canonical 查找 + 缓存 + 热度 service

**Files:**
- Create: `apps/web/server/lib/question-reuse.ts`
- Test: `apps/web/tests/integration/question-reuse-lib.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { findPublishedCanonical, getCachedExplanation, putCachedExplanation, incrementReuseHit } from "@/server/lib/question-reuse";
import { stemHashHex } from "@/server/lib/question-shared";

async function mathId() {
  const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  return s.id;
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("question-reuse lib", () => {
  it("findPublishedCanonical 按 status+hash 命中、忽略 DRAFT", async () => {
    const subjectId = await mathId();
    const hash = stemHashHex("解方程 2x=4");
    const pub = await prisma.question.create({ data: { subjectId, stemMd: "解方程 2x=4", type: "CALCULATION", status: "PUBLISHED", normalizedStemHash: hash } });
    await prisma.question.create({ data: { subjectId, stemMd: "解方程 2x=4", type: "ESSAY", status: "DRAFT", source: "USER_ADHOC", normalizedStemHash: hash } });
    const found = await findPublishedCanonical(prisma, hash);
    expect(found?.id).toBe(pub.id);
  });

  it("put/get 缓存按 band 隔离", async () => {
    const subjectId = await mathId();
    const q = await prisma.question.create({ data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED", normalizedStemHash: "h" } });
    await putCachedExplanation(prisma, { questionId: q.id, gradeBand: "JUNIOR", tutoringJson: { restatement: "r" }, modelCallId: null });
    expect(await getCachedExplanation(prisma, q.id, "JUNIOR")).toMatchObject({ restatement: "r" });
    expect(await getCachedExplanation(prisma, q.id, "SENIOR")).toBeNull();
  });

  it("put 同 (q,band) 幂等（upsert 不抛）", async () => {
    const subjectId = await mathId();
    const q = await prisma.question.create({ data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED", normalizedStemHash: "h" } });
    await putCachedExplanation(prisma, { questionId: q.id, gradeBand: "JUNIOR", tutoringJson: { a: 1 }, modelCallId: null });
    await putCachedExplanation(prisma, { questionId: q.id, gradeBand: "JUNIOR", tutoringJson: { a: 2 }, modelCallId: null });
    const rows = await prisma.questionExplanationCache.count({ where: { questionId: q.id, gradeBand: "JUNIOR" } });
    expect(rows).toBe(1);
  });

  it("incrementReuseHit 原子 +1", async () => {
    const subjectId = await mathId();
    const q = await prisma.question.create({ data: { subjectId, stemMd: "x", type: "ESSAY", status: "PUBLISHED", normalizedStemHash: "h" } });
    await incrementReuseHit(prisma, q.id);
    await incrementReuseHit(prisma, q.id);
    const r = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(r.reuseHitCount).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/question-reuse-lib.test.ts`
Expected: FAIL（模块未定义）

- [ ] **Step 3: 写 `question-reuse.ts`**

```ts
import "server-only";
import type { PrismaClient, GradeBand, Prisma } from "@prisma/client";

export async function findPublishedCanonical(db: PrismaClient, normalizedStemHash: string) {
  return db.question.findFirst({
    where: { status: "PUBLISHED", normalizedStemHash },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

export async function getCachedExplanation(db: PrismaClient, questionId: string, gradeBand: GradeBand): Promise<Record<string, unknown> | null> {
  const row = await db.questionExplanationCache.findUnique({
    where: { questionId_gradeBand: { questionId, gradeBand } },
    select: { tutoringJson: true },
  });
  return (row?.tutoringJson as Record<string, unknown> | undefined) ?? null;
}

export async function putCachedExplanation(db: PrismaClient, args: { questionId: string; gradeBand: GradeBand; tutoringJson: Prisma.InputJsonValue; modelCallId: string | null }): Promise<void> {
  await db.questionExplanationCache.upsert({
    where: { questionId_gradeBand: { questionId: args.questionId, gradeBand: args.gradeBand } },
    create: { questionId: args.questionId, gradeBand: args.gradeBand, tutoringJson: args.tutoringJson, modelCallId: args.modelCallId },
    update: {}, // 已存在即保留首版（v1）
  });
}

export async function incrementReuseHit(db: PrismaClient, questionId: string): Promise<void> {
  await db.question.update({ where: { id: questionId }, data: { reuseHitCount: { increment: 1 } } });
}
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/question-reuse-lib.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/question-reuse.ts apps/web/tests/integration/question-reuse-lib.test.ts
git commit -m "feat(web): question-reuse lib (canonical lookup + explanation cache + hit count)"
```

---

## Task 7: `tutorReuseAndChargeMiddleware` + 链重构

**Files:**
- Modify: `apps/web/server/trpc.ts`（加中间件，含 ctx 类型扩展）

- [ ] **Step 1: 在 trpc.ts 加 `tutorReuseAndChargeMiddleware`**（放在 validateTutorInputCompliance 附近）

```ts
import { redactPii } from "@zhijiao/domain";
import { stemHashHex } from "./lib/question-shared.js";
import { bandOf, type GradeInput } from "./lib/grade-band.js";
import { findPublishedCanonical, getCachedExplanation } from "./lib/question-reuse.js";

// Plan 15: tutor.ask 专用——先按 status+hash 查 canonical + 缓存；命中则免费放行（不扣费），
// 未命中走标准 TUTOR_ASK 计费。consent 由链上 requireGuardianConsent 独立保证（不依赖扣费）。
const TutorReuseRawSchema = z.object({
  questionStem: z.string(),
  studentGrade: z.enum(["G5","G6","G7","G8","G9","G10","G11","G12"]).optional(),
  clientRequestId: z.string().uuid(),
});

export const tutorReuseAndChargeMiddleware = t.middleware(async ({ ctx, next, getRawInput }) => {
  if (!ctx.auth) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录", cause: { reason: ctx.authError ?? "NO_SESSION" } });
  }
  const parsed = TutorReuseRawSchema.safeParse(await getRawInput());
  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请求缺少 clientRequestId（UUID）", cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" } });
  }
  const { questionStem, studentGrade, clientRequestId } = parsed.data;
  const { redacted: redactedStem, hits } = redactPii(questionStem);
  if (hits.phone > 0 || hits.idCard > 0) {
    logger.info({ event: "pii_redacted_input", source: "TUTOR_ASK", hits });
  }
  const hash = stemHashHex(redactedStem);
  const gradeBand = bandOf(studentGrade as GradeInput | undefined);

  let canonicalId: string | null = null;
  let cached: Record<string, unknown> | null = null;
  try {
    const canonical = await findPublishedCanonical(ctx.db, hash);
    if (canonical) {
      canonicalId = canonical.id;
      cached = await getCachedExplanation(ctx.db, canonical.id, gradeBand);
    }
  } catch (e) {
    // fail-open：优化失败绝不阻断学生，按无范题走
    logger.warn({ event: "tutor_reuse_lookup_failed", err: String(e) });
    canonicalId = null;
    cached = null;
  }

  const reuseBase = { redactedStem, gradeBand, canonicalId };

  if (cached) {
    // 缓存命中：免费路径，不扣费
    return next({ ctx: { ...ctx, auth: ctx.auth, debit: { ledgerId: null as string | null }, tutorReuse: { ...reuseBase, hit: true as const, cached } } });
  }
  // 未命中：标准计费
  const handle = await beginCharge(ctx, "TUTOR_ASK", clientRequestId);
  const result = await next({ ctx: { ...ctx, auth: ctx.auth, debit: { ledgerId: handle.ledgerId as string | null }, tutorReuse: { ...reuseBase, hit: false as const, cached: null } } });
  await settleCharge(ctx, { ...handle, kind: "TUTOR_ASK" }, result);
  return result;
});
```

> ctx 扩展：`next({ ctx: { ...ctx, tutorReuse } })` 会让 tRPC 推断出 resolver ctx 含 `tutorReuse`。`debit.ledgerId` 在命中路径为 `null`——把它声明为 `string | null` 不破坏既有读 `ctx.debit.ledgerId` 的 Plan 4 路由（它们走 chargeMiddleware，仍是 string）。如类型冲突，给 tutor 链单独的 ctx 分支即可（resolver 只在 tutor.ask 读 tutorReuse）。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @zhijiao/web typecheck`
Expected: PASS（仅新增导出，未接线，应通过）

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/trpc.ts
git commit -m "feat(web): tutorReuseAndChargeMiddleware (Plan 15)"
```

---

## Task 8: `tutor.ask` 接线（链重构 + resolver 三分支）

**Files:**
- Modify: `apps/web/server/routers/tutor.ts`

- [ ] **Step 1: 改 import + 链**

```ts
import {
  authedProcedure,
  requireGuardianConsent,
  validateTutorInputCompliance,
  tutorReuseAndChargeMiddleware,
  router,
} from "../trpc.js";
import { putCachedExplanation, incrementReuseHit } from "../lib/question-reuse.js";
// （删掉 chargeMiddleware import 若 ask 不再用；askImage 仍用 chargeMiddleware，保留）
```

链：

```ts
  ask: authedProcedure
    .use(requireGuardianConsent)            // Plan 15: consent 独立于扣费（缓存命中的免费路径也门禁）
    .use(validateTutorInputCompliance)      // 扣费前扫违禁词
    .use(tutorReuseAndChargeMiddleware)     // Plan 15: 命中缓存免费、未命中标准计费
    .input(TutorAskInputSchema)
    .mutation(async ({ ctx, input }) => { /* Step 2 */ }),
```

- [ ] **Step 2: 重写 resolver body 为三分支**

```ts
    .mutation(async ({ ctx, input }) => {
      const reuse = ctx.tutorReuse;
      const { clientRequestId: _c, ...aiInput } = input;

      // 分支 1：缓存命中 —— 复用，不调 AI、不扣费、不建题
      if (reuse.hit && reuse.cached && reuse.canonicalId) {
        await incrementReuseHit(ctx.db, reuse.canonicalId);
        return { ...reuse.cached, questionId: reuse.canonicalId } as typeof reuse.cached & { questionId: string };
      }

      // 中间件已脱敏题面（reuse.redactedStem），直接喂 AI
      aiInput.questionStem = reuse.redactedStem;
      let ai;
      try {
        ai = await getAiRouter(ctx.auth.userId).tutor(aiInput);
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "讲解内容未通过合规检查，请换一道题或稍后再试。", cause: { reason: "COMPLIANCE_REJECTED", original: e } });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "讲解失败，请稍后再试。", cause: { reason: "TUTOR_INTERNAL" } });
      }

      // 分支 2：命中范题但缓存 miss —— 生成后缓存到 canonical，不建 USER_ADHOC
      if (reuse.canonicalId) {
        await putCachedExplanation(ctx.db, {
          questionId: reuse.canonicalId,
          gradeBand: reuse.gradeBand,
          tutoringJson: ai as unknown as Prisma.InputJsonValue,
          modelCallId: (ai as { modelCallId?: string }).modelCallId ?? null,
        });
        await incrementReuseHit(ctx.db, reuse.canonicalId);
        return { ...ai, questionId: reuse.canonicalId };
      }

      // 分支 3：无范题 —— 原 USER_ADHOC 路径（不变）
      const question = await upsertUserAdhocQuestion(ctx.db, {
        userId: ctx.auth.userId,
        stemMd: reuse.redactedStem,
      });
      try {
        await reconcileHintsSync(ctx.db, { questionId: question.id, hints: ai.knowledgePoints, source: "TUTOR_ADHOC", sourceRefType: "QUESTION", sourceRefId: question.id });
      } catch (e) {
        logger.warn({ event: "kp_reconcile_sync_failed", source: "TUTOR_ADHOC", questionId: question.id, err: String(e) });
      }
      return { ...ai, questionId: question.id };
    }),
```

> 加 `import { Prisma } from "@prisma/client";`。注：分支 2 不跑 `reconcileHintsSync`（canonical 是已有 PUBLISHED 题，KP link 在 seed 时已建；ad-hoc reconcile 仅用于 USER_ADHOC）。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @zhijiao/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/routers/tutor.ts
git commit -m "feat(web): wire Plan 15 reuse into tutor.ask (three-branch resolver)"
```

---

## Task 9: 集成测试 + 反转旧回归

**Files:**
- Rewrite: `apps/web/tests/integration/tutor-ask-published-untouched.test.ts` → 改名/改内容为 `tutor-ask-published-reuse.test.ts`
- Create: `apps/web/tests/integration/tutor-ask-reuse-cache.test.ts`

- [ ] **Step 1: 删旧反转测试，建 `tutor-ask-published-reuse.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";
import { stemHashHex } from "@/server/lib/question-shared";

const tutorSpy = vi.fn(async () => ({ restatement: "r", knowledgePoints: [], steps: ["s"], pitfalls: [], finalAnswer: "a" }));
vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({ tutor: tutorSpy }) }));
const { appRouter } = await import("@/server/routers/_root");

async function seedPublished(stem: string) {
  const subject = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  return prisma.question.create({ data: { subjectId: subject.id, stemMd: stem, type: "CALCULATION", status: "PUBLISHED", source: "PUBLISHED", normalizedStemHash: stemHashHex(stem) } });
}

beforeEach(async () => { await resetDb(); tutorSpy.mockClear(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask reuses PUBLISHED canonical (Plan 15)", () => {
  it("命中范题、缓存 miss：扣费、写缓存、返 canonical id、不建 USER_ADHOC", async () => {
    const stem = "解方程 2x + 5 = 13";
    const pub = await seedPublished(stem);
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));

    const r = await caller.tutor.ask({ questionStem: stem, studentGrade: "G8", clientRequestId: crypto.randomUUID() });

    expect(r.questionId).toBe(pub.id);                         // 复用 canonical
    expect(tutorSpy).toHaveBeenCalledTimes(1);                  // miss → 调 AI
    const adhoc = await prisma.question.count({ where: { source: "USER_ADHOC" } });
    expect(adhoc).toBe(0);                                      // 不建 USER_ADHOC
    const cache = await prisma.questionExplanationCache.count({ where: { questionId: pub.id, gradeBand: "JUNIOR" } });
    expect(cache).toBe(1);                                      // 写缓存
    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: u.id } });
    expect(wallet.balance).toBe(99);                            // 扣 1
  });
});
```

- [ ] **Step 2: 建 `tutor-ask-reuse-cache.test.ts`**（命中复用 / 跨 band / 无范题回归 / consent / fail-open）

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";
import { stemHashHex } from "@/server/lib/question-shared";

const tutorSpy = vi.fn(async () => ({ restatement: "r", knowledgePoints: [], steps: ["s"], pitfalls: [], finalAnswer: "a" }));
vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({ tutor: tutorSpy }) }));
const { appRouter } = await import("@/server/routers/_root");

async function seedPublished(stem: string) {
  const subject = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  return prisma.question.create({ data: { subjectId: subject.id, stemMd: stem, type: "CALCULATION", status: "PUBLISHED", source: "PUBLISHED", normalizedStemHash: stemHashHex(stem) } });
}

beforeEach(async () => { await resetDb(); tutorSpy.mockClear(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("Plan 15 reuse cache", () => {
  it("二次同 stem 同 band：缓存命中、零扣费、AI 未再调", async () => {
    const stem = "解不等式 2x - 1 > 3";
    const pub = await seedPublished(stem);
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));

    await caller.tutor.ask({ questionStem: stem, studentGrade: "G8", clientRequestId: crypto.randomUUID() }); // miss
    tutorSpy.mockClear();
    const r2 = await caller.tutor.ask({ questionStem: stem, studentGrade: "G8", clientRequestId: crypto.randomUUID() }); // hit

    expect(r2.questionId).toBe(pub.id);
    expect(tutorSpy).not.toHaveBeenCalled();                    // 零 AI
    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: u.id } });
    expect(wallet.balance).toBe(99);                            // 仅首次扣 1
    const pubReread = await prisma.question.findUniqueOrThrow({ where: { id: pub.id } });
    expect(pubReread.reuseHitCount).toBe(2);                    // 命中两次
  });

  it("不同 band 各自 miss：两行缓存", async () => {
    const stem = "解不等式 3x < 9";
    const pub = await seedPublished(stem);
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));
    await caller.tutor.ask({ questionStem: stem, studentGrade: "G8", clientRequestId: crypto.randomUUID() });  // JUNIOR
    await caller.tutor.ask({ questionStem: stem, studentGrade: "G11", clientRequestId: crypto.randomUUID() }); // SENIOR
    const n = await prisma.questionExplanationCache.count({ where: { questionId: pub.id } });
    expect(n).toBe(2);
  });

  it("无范题：USER_ADHOC 路径回归", async () => {
    const u = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.tutor.ask({ questionStem: "一道库里没有的题 zzz", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    const q = await prisma.question.findUniqueOrThrow({ where: { id: r.questionId } });
    expect(q.source).toBe("USER_ADHOC");
    expect(q.createdByUserId).toBe(u.id);
  });
});
```

> consent 门禁验证：若已有 `<14` PENDING 用户 fixture（参考 `wallet-topup-create-minor.test.ts` 建 minor 的方式），加一例：minor 无 consent 调 `tutor.ask` 命中范题仍抛 `GUARDIAN_CONSENT_REQUIRED`、且 `tutorSpy` 未调用、无 DEBIT。实现时若 fixture 复用成本高，至少补一条断言 `requireGuardianConsent` 在链上（minor PENDING → FORBIDDEN）。

- [ ] **Step 3: 跑新测试 + 全 tutor 回归**

Run: `pnpm --filter @zhijiao/web test -- tests/integration/tutor-ask-published-reuse.test.ts tests/integration/tutor-ask-reuse-cache.test.ts tests/integration/tutor-ask-questionid.test.ts tests/integration/tutor-ask-dedup.test.ts tests/integration/kp-reconcile-sync-tutor-ask.test.ts`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/integration
git rm apps/web/tests/integration/tutor-ask-published-untouched.test.ts 2>/dev/null || true
git commit -m "test(web): Plan 15 reuse integration + invert published-untouched regression"
```

---

## Task 10: 全量回归 + 文档

**Files:**
- Modify: `docs/claude/implementation-state.md`
- Modify: `docs/claude/merge-verification.md`
- Modify: `CLAUDE.md`（已落地汇总加 Plan 15）

- [ ] **Step 1: 全量 typecheck + test**

Run: `pnpm typecheck && pnpm test`
Expected: 全 PASS

- [ ] **Step 2: E2E（确认未破答疑闭环）**

Run: `pnpm --filter @zhijiao/web test:e2e`
Expected: 全绿（数目不变）

- [ ] **Step 3: 更新 `implementation-state.md`**：加「Plan 15 现状」段——canonical 匹配 `status+hash`（非 source）、缓存按 `questionId×gradeBand`、命中免费/未命中计费、consent 解耦补挂、热度 `reuseHitCount` + 错题归并到 canonical、`tutor-ask-published-untouched` 已反转为 `-reuse`。

- [ ] **Step 4: 更新 `merge-verification.md`**：反转旧探针（published-untouched → published-reuse）+ 新增缓存命中零扣费零 AI 探针。

- [ ] **Step 5: 更新 `CLAUDE.md`**「已落地汇总」加 Plan 15；「上线后候选 Plan」移除 Plan 15。

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: record Plan 15 dedup/reuse landed"
```

---

## Self-Review 覆盖核对

- spec §2（语料）→ Task 2/3；§3.1 匹配（status+hash）→ Task 6 `findPublishedCanonical` + Task 7；§3.2 缓存按 band → Task 1 schema + Task 6；§3.3 链重构/consent 解耦 → Task 5/7/8；§3.4 三分支 → Task 8；§3.5 计费 → Task 7（命中跳过/未命中 beginCharge）；§4 统计（reuseHitCount + 错题归并）→ Task 1/6/8；§5 错误处理（fail-open/幂等）→ Task 6/7 测试；§6 schema → Task 1；§7 测试 + 反转 → Task 9；§8 合规 → 语料原创(Task2)+hint-first 复用(Task8)。
- 类型一致：`bandOf`/`GradeBand`/`findPublishedCanonical`/`getCachedExplanation`/`putCachedExplanation`/`incrementReuseHit`/`beginCharge`/`settleCharge`/`ChargeHandle` 跨 Task 命名一致。
- 无占位：每步含可跑命令与完整代码（语料题目正文实现时补满，已注明 ≥30 道与 KP code 约束）。
