# 智教 · Plan 8 答疑题面持久化 + ErrorAnalysisCard 接入答疑闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 4 留的 ErrorAnalysisCard 真正挂进 `/tutor` 流程：学生输入题面 → AI 讲解 → 一键"加入错题本并分析错因" → 跳 `/error-book/[entryId]`，闭合学生学习中心主链路。

**Architecture:** `tutor.ask` 中间件链插 `validateTutorInputCompliance`（扣费前扫违禁词），mutation body AI 成功后 `upsertUserAdhocQuestion` 落 USER_ADHOC `Question` 行（partial unique idx 按 (userId, stemHash) 去重）+ 返 `questionId`。`TutorForm` 加可选 "我的作答" 折叠 + 讲解后 mount 现有 `ErrorAnalysisCard`，传 questionId + actualAnswer 快照。

**Tech Stack:**（不变）pnpm 9 / Turborepo / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 / Redis 7 / jose 5 / @trpc/server@11 / superjson / ioredis 5 / Vitest 1 / Testcontainers 10 / Playwright 1 / pino 8

**Spec:** `docs/superpowers/specs/2026-05-25-tutor-question-bank-and-error-card-integration-design.md`（本 plan 的真理来源；遇到模糊回查 spec）

**Source Audit:** 2026-05-25 spec 三轮 review（findForbidden 路径修正 / 超长 stem 副作用写明 / Task 0 删除）已收口

---

## ⚠️ 关键实现红线

1. **中间件链顺序硬约束**（spec §3.1 / Blocker 类）：`tutor.ask = authedProcedure.use(validateTutorInputCompliance).use(chargeMiddleware("TUTOR_ASK")).input(...).mutation(...)`。compliance 必须在 charge **之前**；反了就回到"违禁词输入也扣费"的事故。Task 3 / 4 commit 前必跑 grep 验序。

2. **`chargedProcedure("TUTOR_ASK")` 糖语法保留不动**（spec §3.1）：error/variant 路由仍可能复用糖语法，本 plan 只 `tutor.ask` 改用 explicit chain。**绝不**删 `chargedProcedure` factory；Plan 3 / 4 调用点零行 diff。

3. **AI 成功才写 Question**（spec §3.3 / §3.4）：mutation body 顺序固定为 `AI 调用 → 成功 → upsertUserAdhocQuestion → return`。**绝不**先写 Question 再调 AI（AI 失败会沉淀大量孤儿题面）。

4. **upsert 不依赖 `meta.target` 字面**（spec §4.4 / 与 Plan 4 改进点）：`upsertUserAdhocQuestion` 的 P2002 catch 必须 "P2002 → 重读 → 命中返回 / 未命中原样抛"，**不**用 `targetStr.includes("user_adhoc_dedup")` 这类字面匹配。Prisma 在 raw SQL partial unique 上 `meta.target` 行为版本不稳。

5. **normalizeStem 不 lowercase**（spec §4.2）：仅 `trim() + replace(/\s+/g, " ")`。数学文本大小写可有义（点 A vs a / 变量 X vs x / 集合矩阵符号 / `sin x` vs `SIN x`）。本 plan 不做语义相似题合并。

6. **partial unique idx 用 raw SQL + IS NOT NULL 守门**（spec §2.4）：`WHERE source = 'USER_ADHOC' AND created_by_user_id IS NOT NULL AND normalized_stem_hash IS NOT NULL`。Prisma 5 schema 不支持，migration 末尾手动追加（沿用 Plan 4 Task 1 工艺）。

7. **Prisma migration 顺序硬约束**（spec §2.5 / 沿用 Plan 4）：`migrate dev --create-only` → 手动追加 raw SQL → `migrate dev` apply。禁止先 apply 再改 migration.sql（checksum drift）。

8. **超长 stem 副作用**（spec §3.2 / §7.2）：`if (stem.length === 0 || stem.length > 4000) return next()` 让 zod 兜底。但 chargeMiddleware 在 zod `.input()` 前跑 → 超长输入会产生 `DEBIT + COMPENSATION` 配对（净余额不变）。这与违禁词路径（不扣费 / 无 DEBIT）**不同**。Test 断言要分清两者。

9. **AI 成功 + Question upsert 失败 = chargeMiddleware fail-open 补偿**（spec §3.4）：mini-transaction 仅含 upsert；AI 已成功不可回退；chargeMiddleware 默认补偿，用户已扣费会被补回。

10. **PUBLISHED 不复用**（spec §6.2）：partial unique idx WHERE 子句 source='USER_ADHOC'，PUBLISHED 题不受约束。用户输入与 PUBLISHED 题完全相同的 stem → 仍建新 USER_ADHOC 副本。Task 4 integration `tutor-ask-published-untouched.test.ts` 守门此设计。

11. **找 math subject 不缓存**（spec §4.4）：每次 upsert 内 `tx.subject.findUniqueOrThrow({ where: { code: "math" } })`。测试 reset DB 会让模块级缓存拿到过期 id。

12. **`it.todo` / 空 body 测试是假绿防御**（沿用 Plan 4 红线 #16）：Vitest 把 `it.todo` 当 todo 不失败、`it("name", async () => {})` 空 body 也直接 passed。Task 2 / 4 / 6 每次 commit 前必跑：
    ```powershell
    Select-String -Path apps/web/tests,packages/db/tests,apps/web/e2e -Pattern "it\.todo" -Recurse
    ```
    期望 0 命中。Vitest `Tests` 行也要确认是 `N passed (N)`、不含 `(M todo)` 计数。

13. **`next build` 是 UI task 的 commit prereq**（沿用 Plan 4 Task 6 followup 经验）：`tsc --noEmit` 查不出 `<Suspense>` 漏包裹 / JSX `"` 未转义 / `useSearchParams()` missing-suspense。Task 5 commit 前必跑 `pnpm.cmd --filter @zhijiao/web exec next build`。

14. **每个 task 一个 commit**，commit message 引用 task 编号。

15. **PowerShell 调 pnpm 必须用 `pnpm.cmd`**（execution policy 拦 `.ps1`）。

---

## 范围

**本 plan 做**（对应 spec §1-§8 全部）：
- Prisma migration（Question 2 字段 + partial unique idx + User.createdQuestions + seed dev-student-02）
- `apps/web/server/lib/question.ts` 新建：常量 + normalize/hash + upsertUserAdhocQuestion + unit tests
- `apps/web/server/trpc.ts` 加 `validateTutorInputCompliance` middleware
- `apps/web/server/routers/tutor.ts` 改造：middleware 链 + body + 返 questionId + 6 个 integration test
- `apps/web/components/TutorForm.tsx` 改造：可选 "我的作答" + snapshot + ErrorAnalysisCard mount
- E2E `tutor-error-book-link.spec.ts`
- CLAUDE.md 更新 + Merge 验收清单 4 条新探针（21-24）

**本 plan 不做**（spec §1 / §6.2 显式 punt）：
- USER_ADHOC 题 GC / 注销时去标识化 → Plan 6 PII 治理
- PII 扫描（手机号 / 身份证 regex）→ Plan 6
- 图片题 / OCR / image upload → 独立 plan
- 教师 / 学生从题库选题流程 → 独立 plan
- 自动判对错（AI 比对学生作答正确性）→ 独立 plan
- knowledgePointHints → KP id 映射 → Plan 9 KP reconciler
- PUBLISHED 题复用 → 独立 plan（题库去重 / PUBLISHED 复用 / 统计归并）

---

## 文件结构（新建 / 修改清单）

```
CLAUDE.md                                                   # 改：Task 7

# === packages/db ===
packages/db/
  prisma/schema.prisma                                      # 改：Question 2 字段 + User.createdQuestions
  prisma/migrations/<ts>_plan8_user_adhoc_question/         # 新（migrate dev --create-only 生成）
    migration.sql                                           # 末尾手动追加 partial unique idx raw SQL
  prisma/seed/1_test_users.ts                               # 改：加 dev-student-02

# === apps/web ===
apps/web/
  server/lib/question.ts                                    # 新：QUESTION_SOURCE_USER_ADHOC + normalizeStem + stemHashHex + upsertUserAdhocQuestion
  server/trpc.ts                                            # 改：加 validateTutorInputCompliance middleware
  server/routers/tutor.ts                                   # 改：middleware 链 + body + 返 questionId
  components/TutorForm.tsx                                  # 改：可选作答 + snapshot + ErrorAnalysisCard mount
  tests/unit/question-lib.test.ts                           # 新：normalizeStem + stemHashHex + upsertUserAdhocQuestion unit
  tests/integration/tutor-ask-questionid.test.ts            # 新
  tests/integration/tutor-ask-dedup.test.ts                 # 新
  tests/integration/tutor-ask-input-compliance.test.ts      # 新
  tests/integration/tutor-ask-stem-too-long.test.ts         # 新
  tests/integration/tutor-ask-race.test.ts                  # 新
  tests/integration/tutor-ask-published-untouched.test.ts   # 新
  e2e/tutor-error-book-link.spec.ts                         # 新
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
git fetch origin
git switch master
git pull --ff-only   # 注：本仓库无 remote，此步报错可跳过
git worktree add .claude/worktrees/plan-8-tutor-question-bank -b plan-8-tutor-question-bank master
```

新窗口 `Set-Location .claude/worktrees/plan-8-tutor-question-bank`，后续命令都在 worktree 里跑。

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

## Task 1：Prisma migration（Question 2 字段 + partial unique idx + seed dev-student-02）

> **为什么先做**：所有后续 task 的代码都依赖新 schema 字段。schema 一落地，helper / middleware / router / UI 都能写。

**Files：**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_plan8_user_adhoc_question/migration.sql`
- Modify: `packages/db/prisma/seed/1_test_users.ts`

- [ ] **步骤 1.1：改 `schema.prisma` 给 `Question` 加 2 字段 + `createdBy` 关联**

打开 `packages/db/prisma/schema.prisma`，找 `model Question { ... }`，在 `source String?` 行之后加：

```prisma
  createdByUserId     String?  @map("created_by_user_id")
  normalizedStemHash  String?  @map("normalized_stem_hash")

  createdBy           User?    @relation("CreatedQuestions", fields: [createdByUserId], references: [id], onDelete: SetNull)
```

**注意**：`onDelete: SetNull` 不是 `Restrict` —— spec §2.3 解释了与 Plan 4 `ErrorBookEntry.questionId @Restrict` 业务含义不同。

- [ ] **步骤 1.2：在 `User` model 加 createdQuestions 关联**

找 `model User { ... }`，在 `errorBookEntries  ErrorBookEntry[]` 之后加：

```prisma
  createdQuestions  Question[]  @relation("CreatedQuestions")
```

- [ ] **步骤 1.3：`prisma migrate dev --create-only` 生成迁移 SQL（**不**应用）**

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --create-only --name plan8_user_adhoc_question
```

期望：`packages/db/prisma/migrations/<ts>_plan8_user_adhoc_question/migration.sql` 已生成但未 apply。验证：

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d questions" | Select-String "created_by_user_id"
```

应**未命中**（表未变）。如已变 → 你跑成了 `migrate dev` 而非 `--create-only`，回 Plan 4 Task 1 步骤 1.8 末尾的恢复流程。

文件内容应含 `ALTER TABLE "questions" ADD COLUMN "created_by_user_id"` + `ADD COLUMN "normalized_stem_hash"` + `ADD CONSTRAINT "questions_created_by_user_id_fkey" FOREIGN KEY ... ON DELETE SET NULL`。

- [ ] **步骤 1.4：手动追加 partial unique idx raw SQL 到 migration.sql 末尾**

打开 `packages/db/prisma/migrations/<ts>_plan8_user_adhoc_question/migration.sql`，末尾追加：

```sql
-- Plan 8 spec §2.4: partial unique idx for USER_ADHOC dedup.
-- WHERE 子句显式 IS NOT NULL 守门 —— 防脏数据 / 注销后行进入索引语义混乱。
-- Prisma 5 schema 不支持 partial unique，手动追加进 migration 本身；apply 一次性落库。
CREATE UNIQUE INDEX "questions_user_adhoc_dedup_idx"
  ON "questions" ("created_by_user_id", "normalized_stem_hash")
  WHERE "source" = 'USER_ADHOC'
    AND "created_by_user_id" IS NOT NULL
    AND "normalized_stem_hash" IS NOT NULL;
```

- [ ] **步骤 1.5：apply migration**

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate dev
```

期望输出含 `Applying migration \`<ts>_plan8_user_adhoc_question\``。`_prisma_migrations` 表里 checksum 是含 partial idx 的完整 SQL 指纹，无 drift。

- [ ] **步骤 1.6：验 partial idx 已落主库**

```powershell
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d questions"
```

期望见 `"questions_user_adhoc_dedup_idx" UNIQUE, btree (created_by_user_id, normalized_stem_hash) WHERE source::text = 'USER_ADHOC'::text AND created_by_user_id IS NOT NULL AND normalized_stem_hash IS NOT NULL`。

并验 checksum：

```powershell
pnpm.cmd --filter @zhijiao/db exec prisma migrate status
```

期望 `Database schema is up to date!`，无 "modified after being applied" 警告。

- [ ] **步骤 1.7：把 partial idx 复制到 per-pkg test DB**

```powershell
pnpm.cmd test:setup
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_db -c "\d questions" | Select-String "user_adhoc_dedup"
docker exec zhijiao-postgres psql -U postgres -d zhijiao_test_web -c "\d questions" | Select-String "user_adhoc_dedup"
```

期望两库都命中。如未命中 → 看 `packages/db/scripts/setup-test-dbs.ts` 是否走 `migrate deploy`。

- [ ] **步骤 1.8：改 `seed/1_test_users.ts` 加 dev-student-02**

打开 `packages/db/prisma/seed/1_test_users.ts`，在 users 数组末尾（`dev-admin-01` 之后）加：

```ts
    { id: "dev-student-02", phone: "13800000006", name: "测试学生 02", persona: Persona.STUDENT, gradeLevel: GradeLevel.G9, isMinor: false, roles: [] },
```

- [ ] **步骤 1.9：重 seed 主库 + 验 dev-student-02 落进 + 钱包初始 100 credits**

```powershell
pnpm.cmd db:seed
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "SELECT u.id, w.balance FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id='dev-student-02';"
```

期望见 `dev-student-02 | 100`。

- [ ] **步骤 1.10：generate client + typecheck**

```powershell
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck --force
```

期望全绿。

- [ ] **步骤 1.11：commit**

```powershell
git add packages/db/
git commit -m "feat(db): Plan 8 Task 1 — Question + createdByUserId/normalizedStemHash + partial unique idx + seed dev-student-02"
```

---

## Task 2：`apps/web/server/lib/question.ts` + unit tests

> **为什么先做**：`tutor.ask` 的 mutation body 调 `upsertUserAdhocQuestion`，helper 不先建好 router 没法改。

**Files：**
- Create: `apps/web/server/lib/question.ts`
- Create: `apps/web/tests/unit/question-lib.test.ts`

- [ ] **步骤 2.1：新建 `apps/web/server/lib/question.ts`**

```ts
import "server-only";
import crypto from "node:crypto";
import { Prisma, type Question } from "@prisma/client";

export const QUESTION_SOURCE_USER_ADHOC = "USER_ADHOC";

/**
 * spec §4.2: 不 lowercase。数学文本大小写可有义（点 A vs a / 变量 X vs x /
 * 集合矩阵符号 / sin x vs SIN x）。本 plan 仅"防膨胀"，不做语义相似题合并。
 */
export function normalizeStem(stem: string): string {
  return stem.trim().replace(/\s+/g, " ");
}

/**
 * 128-bit prefix is enough for dedup; keeps the indexed value compact.
 * This is not a privacy boundary.
 */
export function stemHashHex(stem: string): string {
  return crypto.createHash("sha256").update(normalizeStem(stem)).digest("hex").slice(0, 32);
}

/**
 * spec §4.4: upsert USER_ADHOC Question 行。
 *
 * 流程：
 *   1. normalize + hash
 *   2. findFirst by (createdByUserId, source=USER_ADHOC, normalizedStemHash)
 *      —— 命中即返（少一次写尝试 + 不污染 DB error log）
 *   3. 未命中 → tx.subject lookup math by code @unique（不缓存，test reset DB 会失效）
 *   4. tx.question.create
 *   5. P2002 catch → 重读 → 命中返回 / 未命中原样抛
 *      （不依赖 meta.target —— Prisma 在 raw SQL partial unique 上 meta.target 行为版本不稳，
 *      与 Plan 4 isErrorBookPartialUniqueP2002 不同手艺，是本 plan 主动改进）
 */
export async function upsertUserAdhocQuestion(
  tx: Prisma.TransactionClient,
  args: { userId: string; stemMd: string },
): Promise<Question> {
  const normalizedStemHash = stemHashHex(args.stemMd);

  const existing = await tx.question.findFirst({
    where: {
      createdByUserId: args.userId,
      source: QUESTION_SOURCE_USER_ADHOC,
      normalizedStemHash,
    },
  });
  if (existing) return existing;

  const math = await tx.subject.findUniqueOrThrow({
    where: { code: "math" },
    select: { id: true },
  });

  try {
    return await tx.question.create({
      data: {
        subjectId: math.id,
        stemMd: args.stemMd,
        type: "ESSAY",
        status: "DRAFT",
        source: QUESTION_SOURCE_USER_ADHOC,
        createdByUserId: args.userId,
        normalizedStemHash,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await tx.question.findFirst({
        where: {
          createdByUserId: args.userId,
          source: QUESTION_SOURCE_USER_ADHOC,
          normalizedStemHash,
        },
      });
      if (winner) return winner;
    }
    throw e;
  }
}
```

- [ ] **步骤 2.2：写 unit tests `apps/web/tests/unit/question-lib.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  QUESTION_SOURCE_USER_ADHOC,
  normalizeStem,
  stemHashHex,
  upsertUserAdhocQuestion,
} from "@/server/lib/question";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) throw new Error("DATABASE_URL must come from vitest.config.ts");

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "questions" RESTART IDENTITY CASCADE;`);
}

async function seedMathSubject() {
  await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });
}

async function seedUser(id: string) {
  await prisma.user.upsert({
    where: { id },
    create: { id, name: id, persona: "STUDENT" },
    update: {},
  });
}

beforeEach(async () => {
  await resetDb();
  await seedMathSubject();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("normalizeStem", () => {
  it("trims and collapses whitespace; does NOT lowercase", () => {
    expect(normalizeStem("  2x + 5 = 13  ")).toBe("2x + 5 = 13");
    expect(normalizeStem("2x\n+\t5  =  13")).toBe("2x + 5 = 13");
    expect(normalizeStem("sin X")).toBe("sin X");           // 大小写保留
    expect(normalizeStem("SIN x")).toBe("SIN x");           // 不归一到小写
  });

  it("preserves emoji and full-width chars", () => {
    expect(normalizeStem("题目：2x＋5＝13 🧮")).toBe("题目：2x＋5＝13 🧮");
  });
});

describe("stemHashHex", () => {
  it("returns 32 hex chars for any input", () => {
    expect(stemHashHex("x")).toHaveLength(32);
    expect(stemHashHex("a much longer stem here")).toHaveLength(32);
  });

  it("same normalized input produces same hash", () => {
    expect(stemHashHex("  2x + 5 = 13  ")).toBe(stemHashHex("2x + 5 = 13"));
    expect(stemHashHex("2x\n+\t5  =  13")).toBe(stemHashHex("2x + 5 = 13"));
  });

  it("differs by case (因为 normalizeStem 不 lowercase)", () => {
    expect(stemHashHex("sin x")).not.toBe(stemHashHex("SIN x"));
  });
});

describe("upsertUserAdhocQuestion", () => {
  it("creates a new USER_ADHOC Question row with expected fields", async () => {
    await seedUser("u1");
    const q = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "解方程 2x + 5 = 13" }),
    );
    expect(q.source).toBe(QUESTION_SOURCE_USER_ADHOC);
    expect(q.createdByUserId).toBe("u1");
    expect(q.status).toBe("DRAFT");
    expect(q.type).toBe("ESSAY");
    expect(q.normalizedStemHash).toBe(stemHashHex("解方程 2x + 5 = 13"));
  });

  it("same user + same stem returns same row (dedup via partial unique idx)", async () => {
    await seedUser("u1");
    const q1 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "解方程 2x + 5 = 13" }),
    );
    const q2 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "解方程 2x + 5 = 13" }),
    );
    expect(q2.id).toBe(q1.id);
    const count = await prisma.question.count({ where: { createdByUserId: "u1" } });
    expect(count).toBe(1);
  });

  it("different users with same stem each get their own row", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const q1 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "解方程 2x + 5 = 13" }),
    );
    const q2 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u2", stemMd: "解方程 2x + 5 = 13" }),
    );
    expect(q2.id).not.toBe(q1.id);
  });

  it("whitespace-only differences in stem still dedupe (normalize 生效)", async () => {
    await seedUser("u1");
    const q1 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "  2x + 5 = 13" }),
    );
    const q2 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "2x   +   5   =   13" }),
    );
    expect(q2.id).toBe(q1.id);
  });

  it("case differences in stem do NOT dedupe (normalize 不 lowercase)", async () => {
    await seedUser("u1");
    const q1 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "sin x" }),
    );
    const q2 = await prisma.$transaction(tx =>
      upsertUserAdhocQuestion(tx, { userId: "u1", stemMd: "SIN x" }),
    );
    expect(q2.id).not.toBe(q1.id);
  });
});
```

- [ ] **步骤 2.3：跑 unit test 验证全过**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/unit/question-lib.test.ts
```

期望：8 tests passed。

- [ ] **步骤 2.4：guardrail — 0 个 it.todo / 空 body**

```powershell
Select-String -Path apps/web/tests -Pattern "it\.todo" -Recurse
```

期望：0 命中。

- [ ] **步骤 2.5：commit**

```powershell
git add apps/web/server/lib/question.ts apps/web/tests/unit/question-lib.test.ts
git commit -m "feat(web): Plan 8 Task 2 — question.ts helper (normalize/hash/upsert) + unit tests"
```

---

## Task 3：`validateTutorInputCompliance` middleware

> **为什么先做**：Task 4 改 `tutor.ask` 链时要 import 这个 middleware。先建好。

**Files：**
- Modify: `apps/web/server/trpc.ts`

- [ ] **步骤 3.1：在 `trpc.ts` 顶部 import findForbidden**

打开 `apps/web/server/trpc.ts`，在已有 import 区加：

```ts
import { findForbidden } from "@zhijiao/domain";
```

（验证 `apps/web/package.json` 已有 `@zhijiao/domain` workspace 依赖；如无，看现有 `auth-service.ts` 怎么 import 的，同样工艺。）

- [ ] **步骤 3.2：export `validateTutorInputCompliance` middleware**

在 `validateEntryOwnership` middleware 定义之后追加：

```ts
/**
 * Plan 8 spec §3.2: tutor.ask 输入合规中间件。链顺序：
 *   authedProcedure.use(validateTutorInputCompliance).use(chargeMiddleware("TUTOR_ASK"))
 *
 * 边界处理：
 *   非 string / 空 string / 超长 (>4000) → return next()，让 zod 后续抛常规 BAD_REQUEST
 *     （注意 spec §3.2 副作用：超长 stem 因 chargeMiddleware 在 zod 之前，会产生
 *      DEBIT + COMPENSATION 配对净余额不变；与违禁词路径不同。test 断言要分清两者）
 *   合法长度 → 扫 findForbidden；命中 → 抛 BAD_REQUEST / INPUT_COMPLIANCE_REJECTED
 *     （在 chargeMiddleware 之前 → 不扣费、不写 Question、不调 AI）
 *
 * 不复制 zod max(4000) 约束（单一真理源）。
 */
export const validateTutorInputCompliance = t.middleware(async ({ next, getRawInput }) => {
  const raw = (await getRawInput()) as { questionStem?: unknown } | undefined;
  const stem = typeof raw?.questionStem === "string" ? raw.questionStem : "";
  if (stem.length === 0 || stem.length > 4000) return next();
  const hits = findForbidden(stem);
  if (hits.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "题目内容未通过安全检查，请修改后再试。",
      cause: { reason: "INPUT_COMPLIANCE_REJECTED", hits },
    });
  }
  return next();
});
```

- [ ] **步骤 3.3：typecheck**

```powershell
pnpm.cmd exec turbo typecheck --force
```

期望全绿。如 `findForbidden` 未找到 → 看 `packages/domain/src/compliance.ts` 是否 export + `packages/domain/src/index.ts` 是否 re-export。

- [ ] **步骤 3.4：commit**

```powershell
git add apps/web/server/trpc.ts
git commit -m "feat(web): Plan 8 Task 3 — validateTutorInputCompliance middleware"
```

---

## Task 4：`tutor.ask` 改造 + 6 个 integration test

> **为什么这个 task 大**：tutor.ask 行为变了 6 个维度（链顺序 / 输入合规 / Question 落库 / 返 questionId / 去重 / 兼容超长 stem 与 race），必须每条都有测试守门。

**Files：**
- Modify: `apps/web/server/routers/tutor.ts`
- Create: `apps/web/tests/integration/tutor-ask-questionid.test.ts`
- Create: `apps/web/tests/integration/tutor-ask-dedup.test.ts`
- Create: `apps/web/tests/integration/tutor-ask-input-compliance.test.ts`
- Create: `apps/web/tests/integration/tutor-ask-stem-too-long.test.ts`
- Create: `apps/web/tests/integration/tutor-ask-race.test.ts`
- Create: `apps/web/tests/integration/tutor-ask-published-untouched.test.ts`

- [ ] **步骤 4.1：改 `apps/web/server/routers/tutor.ts`：middleware 链 + body 改造**

整文件替换为：

```ts
import "server-only";
import { z } from "zod";
import {
  authedProcedure,
  chargeMiddleware,
  validateTutorInputCompliance,
  router,
} from "../trpc.js";
import { TutoringInputSchema, ComplianceRejectedError } from "@zhijiao/ai";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";
import { upsertUserAdhocQuestion } from "../lib/question.js";

// Plan 8: tutor.ask 改用 explicit middleware chain（不用 chargedProcedure 糖语法），
// 因为要插 validateTutorInputCompliance 在 chargeMiddleware 之前。Plan 3/4 调用点零行 diff。
const TutorAskInputSchema = TutoringInputSchema.extend({
  clientRequestId: z.string().uuid(),
});

export const tutorRouter = router({
  ask: authedProcedure
    .use(validateTutorInputCompliance)            // Plan 8: 扣费前扫违禁词
    .use(chargeMiddleware("TUTOR_ASK"))           // 沿用 Plan 4 抽出的 factory
    .input(TutorAskInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { clientRequestId: _cri, ...aiInput } = input;
      let ai;
      try {
        ai = await getAiRouter(ctx.auth.userId).tutor(aiInput);
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "讲解内容未通过合规检查，请换一道题或稍后再试。",
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "讲解失败，请稍后再试。",
          cause: { reason: "TUTOR_INTERNAL" },
        });
      }
      // AI 成功才落 Question — 否则 chargeMiddleware 补偿，Question 已建会成孤儿。
      const question = await ctx.db.$transaction(tx =>
        upsertUserAdhocQuestion(tx, { userId: ctx.auth.userId, stemMd: input.questionStem }),
      );
      return { ...ai, questionId: question.id };
    }),
});
```

- [ ] **步骤 4.2：typecheck**

```powershell
pnpm.cmd exec turbo typecheck --force
```

期望全绿。

- [ ] **步骤 4.3：guardrail — middleware 链顺序 grep**

```powershell
Select-String -Path apps/web/server/routers/tutor.ts -Pattern "validateTutorInputCompliance|chargeMiddleware" -Context 0,2
```

期望输出顺序 `.use(validateTutorInputCompliance)` 在 `.use(chargeMiddleware("TUTOR_ASK"))` **之前**。反了即 reopen 红线 #1。

- [ ] **步骤 4.4：建 `tutor-ask-questionid.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { appRouter } from "@/server/routers/_root";
import { createCallerForUser, seedTestUserWithWallet } from "./_helpers";  // 复用现有 test helper（看 tutor-with-credit.spec.ts / charged-procedure-tutor.test.ts）

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "questions","credit_ledgers","wallets","users" RESTART IDENTITY CASCADE;`);
  // 先 seed math subject + curriculum
  await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask returns questionId + writes USER_ADHOC Question", () => {
  it("happy path", async () => {
    const userId = "u1";
    await seedTestUserWithWallet(prisma, userId, 100);
    const caller = createCallerForUser(userId);

    const r = await caller.tutor.ask({
      questionStem: "解方程 2x + 5 = 13",
      studentGrade: "G8",
      clientRequestId: crypto.randomUUID(),
    });

    expect(r.questionId).toMatch(/^c[a-z0-9]+$/);   // cuid pattern
    expect(r.restatement).toBeDefined();             // 沿用 TutoringOutput 字段

    const q = await prisma.question.findUniqueOrThrow({ where: { id: r.questionId } });
    expect(q.source).toBe("USER_ADHOC");
    expect(q.createdByUserId).toBe(userId);
    expect(q.status).toBe("DRAFT");
    expect(q.type).toBe("ESSAY");
    expect(q.normalizedStemHash).not.toBeNull();
  });
});
```

> 注：`_helpers.ts` 已存在（看其他 integration test）；如签名不一致以现有为准。`createCallerForUser` 应该模拟一个登录用户的 tRPC caller（绕过 OTP）。

- [ ] **步骤 4.5：建 `tutor-ask-dedup.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createCallerForUser, seedTestUserWithWallet } from "./_helpers";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "questions","credit_ledgers","wallets","users" RESTART IDENTITY CASCADE;`);
  await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask dedup", () => {
  it("same user + same stem returns same questionId; Question table 1 row", async () => {
    await seedTestUserWithWallet(prisma, "u1", 100);
    const caller = createCallerForUser("u1");
    const r1 = await caller.tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    const r2 = await caller.tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    expect(r2.questionId).toBe(r1.questionId);
    expect(await prisma.question.count({ where: { createdByUserId: "u1" } })).toBe(1);
  });

  it("different users with same stem each get their own questionId", async () => {
    await seedTestUserWithWallet(prisma, "u1", 100);
    await seedTestUserWithWallet(prisma, "u2", 100);
    const r1 = await createCallerForUser("u1").tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    const r2 = await createCallerForUser("u2").tutor.ask({ questionStem: "解方程 2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    expect(r2.questionId).not.toBe(r1.questionId);
  });

  it("whitespace-only differences in stem still dedupe", async () => {
    await seedTestUserWithWallet(prisma, "u1", 100);
    const caller = createCallerForUser("u1");
    const r1 = await caller.tutor.ask({ questionStem: "  2x + 5 = 13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    const r2 = await caller.tutor.ask({ questionStem: "2x   +   5   =   13", studentGrade: "G8", clientRequestId: crypto.randomUUID() });
    expect(r2.questionId).toBe(r1.questionId);
  });
});
```

- [ ] **步骤 4.6：建 `tutor-ask-input-compliance.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { PrismaClient } from "@prisma/client";
import { createCallerForUser, seedTestUserWithWallet } from "./_helpers";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "questions","credit_ledgers","wallets","users" RESTART IDENTITY CASCADE;`);
  await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask INPUT_COMPLIANCE_REJECTED path", () => {
  it("forbidden phrase in stem → BAD_REQUEST + no charge + no Question row", async () => {
    await seedTestUserWithWallet(prisma, "u1", 100);
    const caller = createCallerForUser("u1");

    let err: unknown;
    try {
      await caller.tutor.ask({
        questionStem: "解方程 押中原题 2x + 5 = 13",   // 含违禁词 "押中"
        studentGrade: "G8",
        clientRequestId: crypto.randomUUID(),
      });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(TRPCError);
    const trpc = err as TRPCError;
    expect(trpc.code).toBe("BAD_REQUEST");
    expect((trpc.cause as { reason?: string } | undefined)?.reason).toBe("INPUT_COMPLIANCE_REJECTED");

    // 不扣费
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: "u1" } });
    expect(wallet.balance).toBe(100);

    // CreditLedger 无 DEBIT row
    const debits = await prisma.creditLedger.count({
      where: { userId: "u1", kind: "DEBIT", actionKind: "TUTOR_ASK" },
    });
    expect(debits).toBe(0);

    // Question 表无新行
    expect(await prisma.question.count({ where: { createdByUserId: "u1" } })).toBe(0);
  });
});
```

- [ ] **步骤 4.7：建 `tutor-ask-stem-too-long.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { PrismaClient } from "@prisma/client";
import { createCallerForUser, seedTestUserWithWallet } from "./_helpers";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "questions","credit_ledgers","wallets","users" RESTART IDENTITY CASCADE;`);
  await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask stem > 4000 chars", () => {
  it("zod rejects with BAD_REQUEST (NOT INPUT_COMPLIANCE_REJECTED); DEBIT+COMPENSATION allowed; net balance unchanged", async () => {
    await seedTestUserWithWallet(prisma, "u1", 100);
    const caller = createCallerForUser("u1");

    const longStem = "x".repeat(5000);   // 超过 zod max(4000)
    let err: unknown;
    try {
      await caller.tutor.ask({
        questionStem: longStem,
        studentGrade: "G8",
        clientRequestId: crypto.randomUUID(),
      });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(TRPCError);
    const trpc = err as TRPCError;
    expect(trpc.code).toBe("BAD_REQUEST");
    // 关键：NOT INPUT_COMPLIANCE_REJECTED (锁 spec §3.2 边界 — 超长走 zod 兜底)
    expect((trpc.cause as { reason?: string } | undefined)?.reason).not.toBe("INPUT_COMPLIANCE_REJECTED");

    // 允许 DEBIT + COMPENSATION 配对（spec §3.2 副作用）
    const debits = await prisma.creditLedger.findMany({
      where: { userId: "u1", actionKind: "TUTOR_ASK" },
      orderBy: { createdAt: "asc" },
    });
    if (debits.length > 0) {
      // 若 chargeMiddleware 在 zod 抛错前已扣，应有配对补偿
      const debit = debits.find(d => d.kind === "DEBIT");
      const comp = debits.find(d => d.kind === "COMPENSATION");
      expect(debit).toBeDefined();
      expect(comp).toBeDefined();
    }

    // 净余额不变
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: "u1" } });
    expect(wallet.balance).toBe(100);
  });
});
```

- [ ] **步骤 4.8：建 `tutor-ask-race.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createCallerForUser, seedTestUserWithWallet } from "./_helpers";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "questions","credit_ledgers","wallets","users" RESTART IDENTITY CASCADE;`);
  await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask race", () => {
  it("two concurrent asks for same user+stem → both succeed, 1 Question row, same questionId", async () => {
    await seedTestUserWithWallet(prisma, "u1", 100);
    const caller = createCallerForUser("u1");

    const [r1, r2] = await Promise.all([
      caller.tutor.ask({ questionStem: "race test stem", studentGrade: "G8", clientRequestId: crypto.randomUUID() }),
      caller.tutor.ask({ questionStem: "race test stem", studentGrade: "G8", clientRequestId: crypto.randomUUID() }),
    ]);

    expect(r1.questionId).toBe(r2.questionId);
    expect(await prisma.question.count({ where: { createdByUserId: "u1", source: "USER_ADHOC" } })).toBe(1);
  });
});
```

- [ ] **步骤 4.9：建 `tutor-ask-published-untouched.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createCallerForUser, seedTestUserWithWallet } from "./_helpers";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "questions","credit_ledgers","wallets","users" RESTART IDENTITY CASCADE;`);
  await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("tutor.ask does NOT reuse PUBLISHED rows (spec §6.2)", () => {
  it("user input identical to a PUBLISHED stem still creates new USER_ADHOC row", async () => {
    // seed 一道 PUBLISHED 题
    const math = await prisma.subject.findUniqueOrThrow({ where: { code: "math" }, select: { id: true } });
    const published = await prisma.question.create({
      data: {
        subjectId: math.id,
        stemMd: "解方程 2x + 5 = 13",
        type: "CALCULATION",
        status: "PUBLISHED",
        // 无 createdByUserId / source / normalizedStemHash
      },
    });

    await seedTestUserWithWallet(prisma, "u1", 100);
    const caller = createCallerForUser("u1");
    const r = await caller.tutor.ask({
      questionStem: "解方程 2x + 5 = 13",
      studentGrade: "G8",
      clientRequestId: crypto.randomUUID(),
    });

    // 关键：新建 USER_ADHOC 行，不复用 PUBLISHED
    expect(r.questionId).not.toBe(published.id);
    const q = await prisma.question.findUniqueOrThrow({ where: { id: r.questionId } });
    expect(q.source).toBe("USER_ADHOC");
    expect(q.createdByUserId).toBe("u1");

    // PUBLISHED 行 unchanged
    const publishedReread = await prisma.question.findUniqueOrThrow({ where: { id: published.id } });
    expect(publishedReread.status).toBe("PUBLISHED");
    expect(publishedReread.createdByUserId).toBeNull();
  });
});
```

- [ ] **步骤 4.10：跑 6 个 integration tests 验全过**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/tutor-ask-questionid.test.ts tests/integration/tutor-ask-dedup.test.ts tests/integration/tutor-ask-input-compliance.test.ts tests/integration/tutor-ask-stem-too-long.test.ts tests/integration/tutor-ask-race.test.ts tests/integration/tutor-ask-published-untouched.test.ts
```

期望：全 6 个 spec 文件 + 内部所有 it 全绿。

- [ ] **步骤 4.11：跑 Plan 3 既有 tutor 套件证零回归（沿用 Plan 4 Task 3 工艺）**

```powershell
pnpm.cmd --filter @zhijiao/web test -- tests/integration/charged-procedure-tutor.test.ts
```

期望全绿。如失败 → middleware 改造破坏了 Plan 3 既有行为，回去看链顺序 / try-catch 包装。

- [ ] **步骤 4.12：guardrail — 0 个 it.todo**

```powershell
Select-String -Path apps/web/tests/integration -Pattern "it\.todo" -Recurse
```

期望 0 命中。

- [ ] **步骤 4.13：commit**

```powershell
git add apps/web/server/routers/tutor.ts apps/web/tests/integration/tutor-ask-*.test.ts
git commit -m "feat(web): Plan 8 Task 4 — tutor.ask middleware chain + body + questionId + 6 integration tests"
```

---

## Task 5：`TutorForm` UI 改造

> **为什么后做**：API 全绿后做 UI，避免反复改 schema 时 UI 同步改造的开销。

**Files：**
- Modify: `apps/web/components/TutorForm.tsx`

- [ ] **步骤 5.1：改 `apps/web/components/TutorForm.tsx`**

整文件替换为（在现有结构基础上加 actualAnswer state + 折叠 + snapshot + ErrorAnalysisCard）：

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_root";
import { ErrorAnalysisCard } from "@/app/(student)/tutor/error-analysis-card";

type TutorAskResult = inferRouterOutputs<AppRouter>["tutor"]["ask"];

export function TutorForm() {
  const [questionStem, setQ] = useState("");
  const [grade, setGrade] = useState<"G5"|"G6"|"G7"|"G8"|"G9"|"G10"|"G11"|"G12">("G8");
  const [actualAnswer, setActualAnswer] = useState("");
  const [showActualAnswer, setShowActualAnswer] = useState(false);
  // 快照：本次讲解时的 actualAnswer，传给 ErrorAnalysisCard。
  // 不在 submit 时清空 actualAnswer —— 学生后续编辑输入框不影响已显示的讲解和错因分析。
  const [diagnoseActualAnswer, setDiagnoseActualAnswer] = useState<string | undefined>();
  const [data, setData] = useState<TutorAskResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);

  const ask = trpc.tutor.ask.useMutation({
    onSuccess: (d) => {
      setData(d);
      setDiagnoseActualAnswer(actualAnswer.trim() || undefined);
      setErr(null);
      setInsufficientBalance(false);
      setPendingReqId(null);
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficientBalance(reason === "INSUFFICIENT_BALANCE");
      setErr(e.message);
      setData(null);
      setPendingReqId(null);
    },
  });

  function submit() {
    const clientRequestId = pendingReqId ?? crypto.randomUUID();
    if (!pendingReqId) setPendingReqId(clientRequestId);
    ask.mutate({ questionStem, studentGrade: grade, clientRequestId });
  }

  return (
    <div className="space-y-4">
      <select
        value={grade}
        onChange={(e) => setGrade(e.target.value as typeof grade)}
        className="border rounded px-2 py-1"
      >
        {(["G5","G6","G7","G8","G9","G10","G11","G12"] as const).map(g => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>
      <textarea
        value={questionStem}
        onChange={(e) => setQ(e.target.value)}
        className="w-full border rounded p-2 min-h-32"
        placeholder="粘贴或输入题目"
        data-testid="tutor-input"
      />

      <details
        open={showActualAnswer}
        onToggle={(e) => setShowActualAnswer((e.target as HTMLDetailsElement).open)}
        className="border rounded p-3 text-sm"
      >
        <summary className="cursor-pointer text-slate-700">
          我的作答（可选，能让错因分析更准确）
        </summary>
        <textarea
          value={actualAnswer}
          onChange={(e) => setActualAnswer(e.target.value)}
          className="mt-2 w-full border rounded p-2 min-h-20"
          placeholder="粘贴或输入你的作答"
          data-testid="tutor-actual-answer"
        />
      </details>

      <button
        disabled={ask.isPending || questionStem.trim().length === 0}
        onClick={submit}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        data-testid="tutor-submit"
      >
        {ask.isPending ? "讲解中..." : "讲一讲"}
      </button>

      {err && (
        <p data-testid="tutor-error" className="text-red-600">
          {err}
          {insufficientBalance && (
            <>
              {" "}
              <Link
                href="/wallet"
                className="underline text-emerald-700"
                data-testid="tutor-error-recharge-link"
              >
                去充值
              </Link>
            </>
          )}
        </p>
      )}

      {data && (
        <div data-testid="tutor-output" className="space-y-2">
          <h2 className="font-bold">{data.restatement}</h2>
          <ul className="list-disc pl-6">
            {data.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          <p><strong>答案：</strong>{data.finalAnswer}</p>
        </div>
      )}

      {data && (
        <ErrorAnalysisCard
          questionId={data.questionId}
          actualAnswerMd={diagnoseActualAnswer}
        />
      )}
    </div>
  );
}
```

- [ ] **步骤 5.2：typecheck + next build（红线 #13）**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd --filter @zhijiao/web exec next build
```

期望都 exit 0。`tsc --noEmit` 查不出 `useSearchParams()` missing Suspense / JSX `"` 未转义，`next build` 才能查出来。

- [ ] **步骤 5.3：起 dev server 手测**

```powershell
pnpm.cmd --filter @zhijiao/web dev
```

浏览器 `http://localhost:3000`，登录 dev-student-02（13800000006）—— OTP 走 mock 控制台。手测：

1. `/tutor` 打开，看到 grade selector + 题目 textarea + "我的作答（可选）" 折叠区（默认折起）+ "讲一讲" 按钮
2. 填一道简单题 + 不展开作答 → 提交 → 看到讲解 + 下方 ErrorAnalysisCard ("加入错题本并分析错因（1 credit）")
3. 点 ErrorAnalysisCard → 看到"查看错题详情 →"链接 + 跳 `/error-book/[entryId]`
4. 回 `/tutor`，再填同一道题 → 提交 → questionId 应同上（去重生效）；ErrorAnalysisCard 显示已诊断态（因为 ErrorBookEntry 已存在）
5. 展开"我的作答" → 填作答 → 提交 → 跳详情页 → 展开"查看我当时的作答" → 看到作答内容
6. 填违禁词（如题目里写 "押中"）→ 提交 → 看到"题目内容未通过安全检查"错误，**钱包余额不变**

记录手测结果。

- [ ] **步骤 5.4：commit**

```powershell
git add apps/web/components/TutorForm.tsx
git commit -m "feat(web): Plan 8 Task 5 — TutorForm 加可选作答 + snapshot + ErrorAnalysisCard mount"
```

---

## Task 6：E2E `tutor-error-book-link.spec.ts`

**Files：**
- Create: `apps/web/e2e/tutor-error-book-link.spec.ts`

- [ ] **步骤 6.1：建 spec**

```ts
import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

const PHONE = "13800000006";  // dev-student-02; avoid 001 (tutor.spec) / 004 (error-book.spec)

test("tutor → ErrorAnalysisCard → /error-book/[entryId] with actualAnswer", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/tutor");

  await page.getByTestId("tutor-input").fill("E2E 解方程 2x + 5 = 13");
  // 展开"我的作答"折叠区 + 填作答
  await page.locator("details summary").click();
  await page.getByTestId("tutor-actual-answer").fill("x = 9");

  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible();
  await expect(page.getByTestId("error-analysis-card-empty")).toBeVisible();

  // 点 ErrorAnalysisCard 触发 diagnose
  await page.getByTestId("btn-diagnose").click();
  await expect(page.getByTestId("error-analysis-card-result")).toBeVisible({ timeout: 15_000 });
  const entryLink = page.getByTestId("error-analysis-entry-link");
  await expect(entryLink).toBeVisible();

  // 跳详情页
  await entryLink.click();
  await page.waitForURL(/\/error-book\/[^/]+$/);
  await expect(page.getByTestId("entry-detail")).toBeVisible();
  await expect(page.getByTestId("entry-reasoning")).toBeVisible();

  // 展开"查看我当时的作答" + 验证作答内容
  await page.getByText("查看我当时的作答").click();
  await expect(page.getByText("x = 9")).toBeVisible();
});

test("tutor → ErrorAnalysisCard → /error-book/[entryId] without actualAnswer", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/tutor");

  // 不展开作答折叠区，直接填题目提交
  await page.getByTestId("tutor-input").fill("E2E 无作答 2x + 5 = 13");
  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible();

  await page.getByTestId("btn-diagnose").click();
  const entryLink = page.getByTestId("error-analysis-entry-link");
  await expect(entryLink).toBeVisible({ timeout: 15_000 });

  await entryLink.click();
  await page.waitForURL(/\/error-book\/[^/]+$/);
  await expect(page.getByTestId("entry-detail")).toBeVisible();

  // actualAnswerMd undefined → entry-detail.tsx 不渲染"查看我当时的作答" details
  await expect(page.getByText("查看我当时的作答")).toHaveCount(0);
});
```

> 注：`error-analysis-card-empty` / `error-analysis-card-result` / `btn-diagnose` / `error-analysis-entry-link` 这几个 testid 是 Plan 4 Task 6.5 `error-analysis-card.tsx` 已有的，直接复用。

- [ ] **步骤 6.2：跑单条 E2E 验证**

```powershell
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test tutor-error-book-link.spec.ts
```

期望 2 个 test 全过。如 timeout → 加大 `error-analysis-card-result` 的 `timeout` 到 30s（mock AI 偶尔慢）。

- [ ] **步骤 6.3：跑全量 playwright 验无回归**

```powershell
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望全 9 个 spec（原 7 + 新 2）全过。

- [ ] **步骤 6.4：guardrail — 0 个 it.todo / it("...", () => {}) 空 body**

```powershell
Select-String -Path apps/web/e2e -Pattern "it\.todo" -Recurse
```

期望 0 命中。

- [ ] **步骤 6.5：commit**

```powershell
git add apps/web/e2e/tutor-error-book-link.spec.ts
git commit -m "test(web): Plan 8 Task 6 — E2E tutor → ErrorAnalysisCard → /error-book/[entryId]"
```

---

## Task 7：全量回归 + CLAUDE.md 更新 + Merge 验收清单

> **为什么先做**：Task 1-6 都过了，最后一步全量回归 + 文档收尾，避免 merge review 时反复解释。

**Files：**
- Modify: `CLAUDE.md`

- [ ] **步骤 7.1：全量回归**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望 4 项全绿。

- [ ] **步骤 7.2：CLAUDE.md "## 开始实现时（已落地）" 加 Plan 8 条目**

在 Plan 4 条目之后追加：

```markdown
- **Plan 8**（答疑题面持久化 + ErrorAnalysisCard 接入答疑闭环：tutor.ask 接受自由输入并 upsert USER_ADHOC Question + 返 questionId + TutorForm 接 ErrorAnalysisCard）—— 见 `docs/superpowers/plans/2026-05-25-tutor-question-bank-and-error-card-integration.md`，spec 在 `docs/superpowers/specs/2026-05-25-tutor-question-bank-and-error-card-integration-design.md`
```

- [ ] **步骤 7.3：在 "错题本 / 变式现状" 段之后加 "答疑题面持久化现状（Plan 8）"**

```markdown
**答疑题面持久化现状**（Plan 8）：
- `tutor.ask` middleware 链：`authedProcedure → validateTutorInputCompliance → chargeMiddleware("TUTOR_ASK")`。compliance 在扣费**前**；违禁词命中 → `BAD_REQUEST / INPUT_COMPLIANCE_REJECTED`，不扣费、不写 Question、不调 AI
- AI 成功才落 USER_ADHOC `Question`（spec §3.3 顺序），避免 AI 失败沉淀孤儿题
- `Question` 加 `createdByUserId String?` (`onDelete: SetNull` —— 注销时归属可抹；与 `ErrorBookEntry.questionId @Restrict` 业务含义不同) + `normalizedStemHash String?`
- partial unique idx `(created_by_user_id, normalized_stem_hash) WHERE source='USER_ADHOC' AND IS NOT NULL`，同 user + 同 stem 去重；不同 user 同 stem 各建一行；PUBLISHED 不复用（spec §6.2 显式 punt）
- `upsertUserAdhocQuestion`: findFirst → create → **P2002 重读赢家 / 未命中原样抛**（不依赖 `meta.target` 字面，比 Plan 4 `isErrorBookPartialUniqueP2002` 更抗 Prisma 版本差异）
- `normalizeStem`: 仅 `trim() + 折叠空白`，**不** lowercase（数学大小写可有义）
- `TutorForm`: 加可选"我的作答（可选）"折叠 + `diagnoseActualAnswer` 快照绑定本次讲解 + 讲解后 mount ErrorAnalysisCard 传 questionId + 快照
- 超长 stem (>4000) 走 zod 兜底而非合规分支，会产生 `DEBIT + COMPENSATION` 配对（净余额不变），与违禁词路径不同；test 断言要分清两者
- E2E `tutor-error-book-link.spec.ts` 用 dev-student-02 (`13800000006`)，避开 tutor.spec=001 / error-book.spec=004 / wallet 既有用户

**Plan 8 未完成的事 —— prod ship 前需 Plan 6 接力**：
- USER_ADHOC 题 GC / 注销时去标识化（PII 治理）
- PII 扫描（手机号 / 身份证 regex）
```

- [ ] **步骤 7.4：CLAUDE.md "Merge 后必跑" 加 4 条新探针 21-24**

在现有探针 20 之后追加：

```markdown
21. **`tutor.ask` 输入扫描在扣费前**（Plan 8）：`Select-String -Path apps/web/server/routers/tutor.ts -Pattern "validateTutorInputCompliance|chargeMiddleware" -Context 0,2`，`validateTutorInputCompliance` 必须出现在 `chargeMiddleware("TUTOR_ASK")` 之前。反了即"违禁词输入也扣费"事故
22. **USER_ADHOC 去重 partial unique idx 已落 DB**（Plan 8 §2.4）：`docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d questions"` 应见 `questions_user_adhoc_dedup_idx`，定义带 `WHERE source = 'USER_ADHOC' AND created_by_user_id IS NOT NULL AND normalized_stem_hash IS NOT NULL`
23. **ErrorAnalysisCard 从 tutor 页能跳到 `/error-book/[entryId]`**（Plan 8）：`pnpm.cmd --filter @zhijiao/web exec playwright test tutor-error-book-link.spec.ts` 应 2/2 passed
24. **PUBLISHED 题不被 USER_ADHOC 复用**（Plan 8 §6.2 设计代价）：`pnpm.cmd --filter @zhijiao/web test -- tests/integration/tutor-ask-published-untouched.test.ts` 应全绿。班级题库统计无法覆盖 ad-hoc 副本是已知设计代价
```

- [ ] **步骤 7.5：CLAUDE.md "下一步候选 Plan" 移走 Plan 8 + Plan 6 加 USER_ADHOC 关联**

把现有 "下一步候选 Plan" 段改为：

```markdown
**下一步候选 Plan**（Plan 4 + Plan 8 已落地）：
- Plan 5: 真接阿里云 SMS + 微信公众号（ICP 备案通过后；**且 Plan 2 Hardening 必须先 ship**；替换 `RealSmsAdapter` / `RealWechatH5Adapter` 的 stub 实现）
- Plan 6: PII 治理（用户注销 / 去标识化 / `WechatPayEvent.rawBody` 保留期 / `TopupOrder` 孤儿订单清理 / `ErrorBookEntry` 用户注销时去标识化 / **`Question.USER_ADHOC` 孤儿清理 + 注销时去标识化** —— Plan 8 prereq）—— **Plan 3 prod ship prereq**
- Plan 7: 真接微信支付 V3 API（需 ICP 备案 + 商户号 + APIv3 + 商户证书；激活 `RealWechatPayAdapter.unifiedOrder` + `verifyNotify`）—— **Plan 3 prod ship prereq**
- Plan 9: 知识点 reconciler（把 Plan 4 输出的 `knowledgePointHints` 字符串通过 NLP 映射到 `KnowledgePoint` id 树，支撑学情画像 + 教师分层作业；Plan 8 的 USER_ADHOC 题也可落 `QuestionKPLink`）
- Plan 10: 教师端"分层作业"基于错题本扩展（教师可看班级错题热度图，按错因 / KP 分类布置分层作业）
- Plan 11: 学情画像 / 趋势报告（学生掌握度 + 薄弱点 + 趋势画像；家长简版报告）
- Plan 12: 题库去重 / PUBLISHED 复用 / 统计归并（Plan 8 §6.2 punt：当前用户输入与 PUBLISHED 完全相同的 stem 仍建 USER_ADHOC 副本，班级统计断层）
```

- [ ] **步骤 7.6：最后一次全量回归（确认 CLAUDE.md 无 markdown 语法错）**

```powershell
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web exec next build
pnpm.cmd --filter @zhijiao/web exec playwright test
```

期望全绿。

- [ ] **步骤 7.7：commit**

```powershell
git add CLAUDE.md
git commit -m "docs(claude): Plan 8 Task 7 — Plan 8 landed + Merge probes 21-24 + candidates updated"
```

回主仓 master 等待用户 review，然后按 `zhijiao-merge-workflow` memory（沿用 Plan 4 收尾工艺）merge：

```powershell
# 主仓 master 上
git switch master
git merge --no-ff plan-8-tutor-question-bank -m "Merge plan-8-tutor-question-bank: tutor 接题库 + ErrorAnalysisCard 接入答疑闭环 (Plan 8)"
git worktree remove .claude/worktrees/plan-8-tutor-question-bank   # Windows path-too-long 可失败，留空壳
git worktree prune
git branch -d plan-8-tutor-question-bank
```

Merge 后必跑 CLAUDE.md "Merge 后必跑" 全部探针（含新加 21-24）。

---

## 完成条件

- [ ] 所有 Task 1-7 步骤勾完
- [ ] `pnpm.cmd exec turbo typecheck --force` 全绿
- [ ] `pnpm.cmd exec turbo test --force` 全绿
- [ ] `pnpm.cmd --filter @zhijiao/web exec next build` exit 0
- [ ] `pnpm.cmd --filter @zhijiao/web exec playwright test` 全绿（9 个 spec：原 7 + 新 2）
- [ ] CLAUDE.md 加 Plan 8 条目 + "答疑题面持久化现状" 段 + "Merge 后必跑" 加 4 条新探针 + 候选 Plan 重排
- [ ] **Task 4 6 个 integration 测例全绿**（questionid / dedup / input-compliance / stem-too-long / race / published-untouched）
- [ ] **Task 4 步骤 4.11 零回归证明**（charged-procedure-tutor.test.ts 全绿）
- [ ] **`Select-String apps/web/tests,packages/db/tests,apps/web/e2e -Pattern "it\.todo" -Recurse` 0 命中**
- [ ] **Prisma migration checksum 一致**：`prisma migrate status` 输出 `Database schema is up to date!`，无 "modified after being applied" 警告
- [ ] **`next build` exit 0 在 Task 5 commit 前已跑过**（红线 #13）
- [ ] 手测 5.3 步骤的 6 个 UI flow 全部肉眼通过
- [ ] Merge commit message 引用 spec 路径

---

## 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| middleware 链顺序写反（compliance 在 charge 之后） | Task 4 步骤 4.3 grep 顺序不对 / 步骤 4.6 INPUT_COMPLIANCE_REJECTED 仍扣费 | 立即停；改 `tutor.ts` middleware 链顺序回 `validateTutorInputCompliance` 在前；重跑步骤 4.6 |
| Question.subject_id 必填阻断 USER_ADHOC 写入 | Task 2 步骤 2.3 unit / Task 4 步骤 4.10 integration 红 | 确认 `tx.subject.findUniqueOrThrow({ where: { code: "math" } })` 在 seed 后能查到；如 seed 顺序问题 → 看 `packages/db/prisma/seed/0_curriculum.ts` |
| partial unique idx 未落 per-pkg test DB | Task 1 步骤 1.7 grep 未命中 / Task 4 步骤 4.5/4.8 race 测试 P2002 不触发 | 沿用 Plan 4 Task 1 步骤 1.10 — `pnpm.cmd test:setup` 重建 + 手验 raw SQL 已应用 |
| `validateTutorInputCompliance` 把 zod 兜底场景吃了 | Task 4 步骤 4.7 stem-too-long red | 确认中间件 `if (stem.length === 0 \|\| stem.length > 4000) return next()` 的 length 判断；让 zod 接管 |
| Idem hit 时 Question 被重复 upsert | Task 4 反复打同 cri 后 Question 表多行 | 不该发生 —— chargeMiddleware idem hit 抛 CONFLICT，body 不执行。如果真发生 → 看 Plan 3 `chargeForAction` 是否被改 |
| TutorForm 类型 infer 失败 | Task 5 步骤 5.2 typecheck 红 | 用 `inferRouterOutputs<AppRouter>["tutor"]["ask"]`；不手写 `TutoringOutput & { questionId: string }` |
| `next build` 红但 `tsc --noEmit` 绿 | Task 5 步骤 5.2 | 看 build 输出：`useSearchParams()` missing Suspense 加 `<Suspense>` 包裹；JSX `"` 改 `&quot;`。沿用 Plan 4 Task 6 followup 经验 |
| Step 1.5 误跑成无 `--create-only` 的 `migrate dev` 把表建了 + checksum 写了 | `_prisma_migrations` 表里出现本迁移行 | drop 已加的 2 列 + 删 idx → `prisma migrate resolve --rolled-back <migration_name>` → 回步骤 1.3 重来 |
| dev-student-02 钱包未自动 seed 100 credits | Task 1 步骤 1.9 SQL 查不到 wallet 行 | 看 `packages/db/prisma/seed/1_test_users.ts` 是否对每个新用户 ensureWallet + topup 100；如未，复用 Plan 3 seed wallet 工艺补一段 |

---

## 附录：与 Plan 4 工艺一致性

| 工艺 | Plan 4 来源 | Plan 8 沿用 |
|---|---|---|
| middleware 显式 chain 顺序（validate 在 charge 前）| Plan 4 §4.2 `variant.generateForEntry` | 一致（Task 4 步骤 4.1）|
| `chargeMiddleware(kind)` factory + `chargedProcedure(kind)` 糖语法二者并存 | Plan 4 Task 3 | 一致；本 plan 兑现 factory 价值（tutor.ask 用 factory，其它路由仍可用糖语法）|
| migrate dev --create-only → 追加 raw SQL → migrate dev | Plan 4 Task 1 步骤 1.6-1.8 | 一致（Task 1 步骤 1.3-1.5）|
| partial unique idx raw SQL + `IS NOT NULL` 守门 | Plan 4 §3.3（隐含）| 加强（本 plan §2.4 显式 IS NOT NULL）|
| P2002 fall-through | Plan 4 `isErrorBookPartialUniqueP2002`（依赖 meta.target 字面）| **改进**（Task 2 步骤 2.1 改为 P2002 → 重读 → 命中返回 / 未命中抛，不依赖 meta.target）|
| 每个 task 一个 commit + 引用 task 编号 | Plan 4 红线 #14 | 一致 |
| `pnpm.cmd`（PowerShell execution policy 拦 `.ps1`）| Plan 4 红线 #15 | 一致 |
| Vitest `it.todo` / 空 body 防御 | Plan 4 红线 #16 | 一致（Task 2/4/6 commit 前 grep）|
| 测试 fixture 用户钱包初始 100 credits | Plan 3 seed 工艺 | 一致（Task 1 步骤 1.9 dev-student-02）|
| `next build` 是 UI task 的 commit prereq | Plan 4 Task 6 followup `ca69470` | 一致（Task 5 步骤 5.2）|
| 收尾走 `zhijiao-merge-workflow`（无 GitHub remote）| Plan 4 Task 8 收尾 | 一致（Task 7 步骤 7.7）|
