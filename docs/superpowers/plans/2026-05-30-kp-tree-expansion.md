# KP 树扩充（初中数学优先，全学段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 4 个占位 KP 扩成全学段（小学/初中/高中）数学知识点树，单 `math` subject、4 层（学段→领域→主题→叶子），并交付配套的数据校验器、通用 seed loader、reconciler leaf-only 守卫。

**Architecture:** 无 schema migration（复用 `KnowledgePoint.parentId` 树）。分学段手写数据文件（`KpNode` 递归结构，叶子内联 aliases）→ `validateKpData` 在 seed 入口与单测两处做全局 code/alias 唯一与"alias 只挂叶子"校验 → 通用 `seedSubjectKpTree` loader 深度优先 upsert（幂等）→ `3_kp_aliases.ts` 改为消费同一批 data 的叶子 aliases（单一真源）→ reconciler `loadSubjectCandidates` 只把叶子放进 EXACT 池，杜绝容器节点污染 Plan 11 掌握度聚合。本 plan 交付**机制 + 初中实迁的 4 KP + 小学/高中样本骨架**；课标全量知识点内容由用户后续按学段手写数据文件迭代填充（不属代码任务）。

**Tech Stack:** TypeScript、Prisma 5、Vitest、pnpm workspace。数据/loader/校验器在 `packages/db`；reconciler 守卫在 `apps/web`。

**Spec:** `docs/superpowers/specs/2026-05-30-kp-tree-expansion-design.md`

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/db/prisma/seed/kp-data/types.ts` | `KpNode` 类型、`normalizeAlias`、`validateKpData`、`collectLeafAliases`、`flattenLeafCodes` 纯函数（零 Prisma 依赖） |
| `packages/db/prisma/seed/kp-data/junior-math.ts` | 初中树（含实迁的现有 4 KP，叶子内联 aliases） |
| `packages/db/prisma/seed/kp-data/primary-math.ts` | 小学树（样本骨架，供用户扩） |
| `packages/db/prisma/seed/kp-data/senior-math.ts` | 高中树（样本骨架；领域按普高课标，非义教四领域） |
| `packages/db/prisma/seed/kp-data/index.ts` | 聚合 `mathKpRoots`（三学段拼接），供 curriculum / alias seed 共用 |
| `packages/db/tests/kp-data.test.ts` | `validateKpData` / `collectLeafAliases` 纯单测 |
| `packages/db/prisma/seed/0_curriculum.ts` | 重写：`seedSubjectKpTree` 通用 loader + 调 `validateKpData` |
| `packages/db/prisma/seed/3_kp_aliases.ts` | 重构：从 `collectLeafAliases(mathKpRoots)` 喂 alias，单一真源 |
| `apps/web/server/lib/kp-reconcile.ts` | 改 `loadSubjectCandidates`：仅叶子进 `kpByNormalized` |
| `apps/web/tests/integration/kp-reconcile-leaf-only.test.ts` | leaf-only 守卫集成测试 |

---

## Task 1: KpNode 类型 + 数据校验器（纯函数 + 单测）

**Files:**
- Create: `packages/db/prisma/seed/kp-data/types.ts`
- Test: `packages/db/tests/kp-data.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/db/tests/kp-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateKpData,
  collectLeafAliases,
  flattenLeafCodes,
  type KpNode,
} from "../prisma/seed/kp-data/types.js";

const good: KpNode[] = [
  {
    code: "math-jh",
    name: "初中",
    children: [
      {
        code: "math-jh-alg",
        name: "数与代数",
        children: [
          { code: "math-jh-alg-linear-solve", name: "一次方程求解", difficulty: 2, aliases: ["一元一次方程"] },
          { code: "math-jh-alg-linear-apply", name: "一次方程应用题", difficulty: 3 },
        ],
      },
    ],
  },
];

describe("validateKpData", () => {
  it("通过结构良好的树", () => {
    expect(() => validateKpData(good)).not.toThrow();
  });

  it("重复 code 抛错（含两个 code）", () => {
    const dup: KpNode[] = [
      { code: "math-jh-alg-linear-solve", name: "A" },
      { code: "math-jh-alg-linear-solve", name: "B" },
    ];
    expect(() => validateKpData(dup)).toThrowError(/duplicate code.*math-jh-alg-linear-solve/i);
  });

  it("跨学段重复 alias 抛错（堵 alias 静默错绑雷）", () => {
    const dup: KpNode[] = [
      { code: "math-jh-fn", name: "初中函数", aliases: ["函数"] },
      { code: "math-sh-fn", name: "高中函数", aliases: ["函数"] },
    ];
    expect(() => validateKpData(dup)).toThrowError(/duplicate alias.*函数/i);
  });

  it("容器节点带 alias 抛错（alias 只挂叶子）", () => {
    const bad: KpNode[] = [
      { code: "math-jh-alg", name: "数与代数", aliases: ["代数"], children: [{ code: "x", name: "x" }] },
    ];
    expect(() => validateKpData(bad)).toThrowError(/alias on non-leaf.*math-jh-alg/i);
  });

  it("collectLeafAliases 仅收集叶子 alias", () => {
    expect(collectLeafAliases(good)).toEqual([
      { kpCode: "math-jh-alg-linear-solve", alias: "一元一次方程" },
    ]);
  });

  it("flattenLeafCodes 仅返回叶子 code", () => {
    expect(flattenLeafCodes(good).sort()).toEqual(
      ["math-jh-alg-linear-apply", "math-jh-alg-linear-solve"].sort(),
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/db test -- tests/kp-data.test.ts`
Expected: FAIL —— `Cannot find module '../prisma/seed/kp-data/types.js'`

- [ ] **Step 3: 实现 types.ts**

`packages/db/prisma/seed/kp-data/types.ts`:

```ts
// 全学段 KP 树数据结构 + 纯校验器。零 Prisma 依赖（可在单测直接 import）。
// normalizeAlias 必须与 apps/web/server/lib/kp-reconcile.ts 的 normalizeKpHint 一致：
// trim + 折叠空白 + lowercase。

export type KpNode = {
  code: string; // 学科内唯一，如 "math-jh-alg-linear-solve"
  name: string;
  difficulty?: number; // 仅叶子有意义；容器忽略，叶子默认 3
  aliases?: string[]; // 仅叶子可有；容器带 alias 视为数据错误
  children?: KpNode[];
};

export function normalizeAlias(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function isLeaf(node: KpNode): boolean {
  return !node.children || node.children.length === 0;
}

function walk(nodes: KpNode[], visit: (n: KpNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.children?.length) walk(n.children, visit);
  }
}

// 收集所有叶子上的 (kpCode, normalizedAlias) 对。
export function collectLeafAliases(roots: KpNode[]): Array<{ kpCode: string; alias: string }> {
  const out: Array<{ kpCode: string; alias: string }> = [];
  walk(roots, (n) => {
    if (isLeaf(n) && n.aliases) {
      for (const a of n.aliases) out.push({ kpCode: n.code, alias: normalizeAlias(a) });
    }
  });
  return out;
}

export function flattenLeafCodes(roots: KpNode[]): string[] {
  const out: string[] = [];
  walk(roots, (n) => {
    if (isLeaf(n)) out.push(n.code);
  });
  return out;
}

// seed 入口与单测共用。命中即 throw —— 把"别犯错"变成"犯错即报"。
export function validateKpData(roots: KpNode[]): void {
  const seenCodes = new Set<string>();
  const aliasOwner = new Map<string, string>(); // normalizedAlias → kpCode

  walk(roots, (n) => {
    // 1. code 全局唯一
    if (seenCodes.has(n.code)) {
      throw new Error(`validateKpData: duplicate code "${n.code}"`);
    }
    seenCodes.add(n.code);

    if (!n.aliases || n.aliases.length === 0) return;

    // 3. alias 只挂叶子
    if (!isLeaf(n)) {
      throw new Error(`validateKpData: alias on non-leaf node "${n.code}"`);
    }

    // 2. alias 全局唯一（同 math subject 内，否则 seed upsert 会静默错绑）
    for (const raw of n.aliases) {
      const norm = normalizeAlias(raw);
      const prev = aliasOwner.get(norm);
      if (prev && prev !== n.code) {
        throw new Error(
          `validateKpData: duplicate alias "${norm}" claimed by both "${prev}" and "${n.code}"`,
        );
      }
      aliasOwner.set(norm, n.code);
    }
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/db test -- tests/kp-data.test.ts`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/db/prisma/seed/kp-data/types.ts packages/db/tests/kp-data.test.ts
git commit -m "feat(db): KpNode type + validateKpData (global code/alias uniqueness, alias-leaf-only)"
```

---

## Task 2: 分学段数据文件 + 聚合入口

**Files:**
- Create: `packages/db/prisma/seed/kp-data/junior-math.ts`
- Create: `packages/db/prisma/seed/kp-data/primary-math.ts`
- Create: `packages/db/prisma/seed/kp-data/senior-math.ts`
- Create: `packages/db/prisma/seed/kp-data/index.ts`

> 说明：初中把现有 4 个 KP（code 不变）实迁进新树——`math-g8-linear-eq`（一次方程）作 L3 主题挂到 `math-jh-alg`（数与代数）下，3 个叶子保持原 code 不变；现有 3 条 alias 内联进对应叶子。小学/高中为样本骨架，用户后续按课标手写扩充。

- [ ] **Step 1: 写初中数据文件**

`packages/db/prisma/seed/kp-data/junior-math.ts`:

```ts
import type { KpNode } from "./types.js";

// 初中数学（首发做全做透）。现有 4 KP 实迁：code 保持不变，仅纳入新树层级。
export const juniorMath: KpNode = {
  code: "math-jh",
  name: "初中",
  children: [
    {
      code: "math-jh-alg",
      name: "数与代数",
      children: [
        {
          code: "math-g8-linear-eq", // 实迁：原顶层"一次方程"，code 不变，改作主题
          name: "一次方程",
          children: [
            {
              code: "math-g8-linear-eq-solve", // 实迁，code 不变
              name: "一次方程求解",
              difficulty: 2,
              aliases: ["一元一次方程", "linear equation", "一次方程"],
            },
            {
              code: "math-g8-linear-eq-apply", // 实迁，code 不变
              name: "一次方程应用题",
              difficulty: 3,
              aliases: ["一次方程应用题", "linear equation word problem"],
            },
            {
              code: "math-g8-linear-eq-system", // 实迁，code 不变
              name: "二元一次方程组",
              difficulty: 3,
              aliases: ["二元一次方程组", "system of equations", "方程组"],
            },
          ],
        },
      ],
    },
    // TODO(用户按课标手写)：图形与几何 / 统计与概率 / 综合与实践 等领域与主题。
  ],
};
```

> 注：上面 `aliases` 字段不是占位——它们是从现有 `3_kp_aliases.ts` 1:1 迁移的真实数据。`// TODO(用户...)` 注释标注的是**数据录入**留白（非代码留白）：机制已完整，内容由用户迭代。

- [ ] **Step 2: 写小学样本骨架**

`packages/db/prisma/seed/kp-data/primary-math.ts`:

```ts
import type { KpNode } from "./types.js";

// 小学数学（样本骨架；用户按课标手写扩充）。
export const primaryMath: KpNode = {
  code: "math-pri",
  name: "小学",
  children: [
    {
      code: "math-pri-num",
      name: "数与代数",
      children: [
        {
          code: "math-pri-num-int",
          name: "整数运算",
          children: [
            { code: "math-pri-num-int-addsub", name: "整数加减法", difficulty: 1, aliases: ["整数加减"] },
            { code: "math-pri-num-int-muldiv", name: "整数乘除法", difficulty: 2, aliases: ["整数乘除"] },
          ],
        },
      ],
    },
    // TODO(用户按课标手写)：图形与几何 / 统计与概率 / 综合与实践。
  ],
};
```

- [ ] **Step 3: 写高中样本骨架（领域按普高课标，非义教四领域）**

`packages/db/prisma/seed/kp-data/senior-math.ts`:

```ts
import type { KpNode } from "./types.js";

// 高中数学（样本骨架）。领域按《普通高中数学课标 2017/2020》主线，不沿用义教四领域。
export const seniorMath: KpNode = {
  code: "math-sh",
  name: "高中",
  children: [
    {
      code: "math-sh-fn",
      name: "函数",
      children: [
        {
          code: "math-sh-fn-quadratic",
          name: "二次函数",
          children: [
            // 注意 alias 用消歧词，避免与未来初中"函数"撞全局 alias 唯一（validateKpData 会拦）
            { code: "math-sh-fn-quadratic-graph", name: "二次函数图象", difficulty: 3, aliases: ["二次函数图象"] },
          ],
        },
      ],
    },
    // TODO(用户按课标手写)：几何与代数 / 概率与统计 / 数学建模与探究。
  ],
};
```

- [ ] **Step 4: 写聚合入口**

`packages/db/prisma/seed/kp-data/index.ts`:

```ts
import type { KpNode } from "./types.js";
import { juniorMath } from "./junior-math.js";
import { primaryMath } from "./primary-math.js";
import { seniorMath } from "./senior-math.js";

// 全 math subject 的根集合（三学段）。curriculum / alias seed 共用此真源。
export const mathKpRoots: KpNode[] = [primaryMath, juniorMath, seniorMath];

export type { KpNode };
```

- [ ] **Step 5: 校验数据文件本身合法（用 Task 1 的校验器跑真数据）**

在 `packages/db/tests/kp-data.test.ts` 末尾追加：

```ts
import { mathKpRoots } from "../prisma/seed/kp-data/index.js";

describe("real seed data", () => {
  it("mathKpRoots 通过 validateKpData", () => {
    expect(() => validateKpData(mathKpRoots)).not.toThrow();
  });
});
```

Run: `pnpm.cmd --filter @zhijiao/db test -- tests/kp-data.test.ts`
Expected: PASS（含真数据校验）

- [ ] **Step 6: 提交**

```bash
git add packages/db/prisma/seed/kp-data/ packages/db/tests/kp-data.test.ts
git commit -m "feat(db): per-学段 math KP data files (junior migrates existing 4 KP, primary/senior skeleton)"
```

---

## Task 3: 通用 seed loader + curriculum 重写 + alias 重构

**Files:**
- Modify: `packages/db/prisma/seed/0_curriculum.ts`（整体重写）
- Modify: `packages/db/prisma/seed/3_kp_aliases.ts`（整体重构）

- [ ] **Step 1: 重写 0_curriculum.ts（通用 loader + validate）**

`packages/db/prisma/seed/0_curriculum.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { mathKpRoots, type KpNode } from "./kp-data/index.js";
import { validateKpData } from "./kp-data/types.js";

// 深度优先 upsert KP 树。按 (subjectId, code) 幂等：重跑只刷 name/difficulty/parentId。
async function seedSubjectKpTree(
  prisma: PrismaClient,
  subjectId: string,
  nodes: KpNode[],
  parentId: string | null,
): Promise<number> {
  let count = 0;
  for (const node of nodes) {
    const isLeaf = !node.children || node.children.length === 0;
    const difficulty = isLeaf ? node.difficulty ?? 3 : 3; // 容器 difficulty 无意义，取 default 3
    const row = await prisma.knowledgePoint.upsert({
      where: { subjectId_code: { subjectId, code: node.code } },
      create: { subjectId, code: node.code, name: node.name, difficulty, parentId },
      update: { name: node.name, difficulty, parentId },
    });
    count++;
    if (node.children?.length) {
      count += await seedSubjectKpTree(prisma, subjectId, node.children, row.id);
    }
  }
  return count;
}

export async function seedCurriculum(prisma: PrismaClient) {
  // 数据自检：坏数据（重复 code/alias、容器带 alias）直接 throw，不静默 seed。
  validateKpData(mathKpRoots);

  const math = await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });

  const total = await seedSubjectKpTree(prisma, math.id, mathKpRoots, null);

  console.log(`✓ Curriculum seeded: 1 subject (math), ${total} KPs (全学段树)`);
  return { math };
}
```

> 注：返回值去掉了旧的 `linearEq`。下一步确认无 seed 文件依赖它（`2_questions.ts` 用 `findUniqueOrThrow({ code })` 自取，不依赖返回值）。

- [ ] **Step 2: 确认 0_curriculum 返回值无外部依赖**

Run: `pnpm.cmd exec rg -n "seedCurriculum\(" packages/db`
Expected: 仅 `index.ts` 调用且不解构 `linearEq`。若有解构 `.linearEq` 的调用点，改为按 code 查询。

- [ ] **Step 3: 重构 3_kp_aliases.ts（消费同一真源）**

`packages/db/prisma/seed/3_kp_aliases.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { mathKpRoots } from "./kp-data/index.js";
import { collectLeafAliases } from "./kp-data/types.js";

// Plan 13: alias 单一真源 = data 文件叶子的内联 aliases（已 normalize）。
// 不再手维护独立列表。全局唯一由 validateKpData（curriculum seed 时）保证。
export async function seedKpAliases(prisma: PrismaClient): Promise<void> {
  const subject = await prisma.subject.findUnique({ where: { code: "math" } });
  if (!subject) {
    console.warn("  ⚠️ subject math not found, skipping aliases");
    return;
  }

  const pairs = collectLeafAliases(mathKpRoots); // [{ kpCode, alias(normalized) }]
  let seeded = 0;
  for (const { kpCode, alias } of pairs) {
    const kp = await prisma.knowledgePoint.findUnique({
      where: { subjectId_code: { subjectId: subject.id, code: kpCode } },
    });
    if (!kp) {
      console.warn(`  ⚠️ kp ${kpCode} not found, skipping alias "${alias}"`);
      continue;
    }
    await prisma.kpAlias.upsert({
      where: { subjectId_normalizedAlias: { subjectId: subject.id, normalizedAlias: alias } },
      create: { subjectId: subject.id, kpId: kp.id, normalizedAlias: alias, source: "SEED" },
      update: { kpId: kp.id }, // 单一真源下可安全刷新归属（validateKpData 已保证无跨 KP 冲突）
    });
    seeded++;
  }
  console.log(`✓ KP aliases seeded: ${seeded} total (from data files)`);
}
```

- [ ] **Step 4: typecheck**

Run: `pnpm.cmd --filter @zhijiao/db typecheck`
Expected: PASS（无类型错误）

- [ ] **Step 5: 提交**

```bash
git add packages/db/prisma/seed/0_curriculum.ts packages/db/prisma/seed/3_kp_aliases.ts
git commit -m "refactor(db): generic seedSubjectKpTree loader + validate at seed entry + alias single-source"
```

---

## Task 4: seed 幂等 + 实迁正确性（集成测试）

**Files:**
- Test: `packages/db/tests/kp-seed.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/db/tests/kp-seed.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma, resetDb } from "../src/test-utils.js";
import { seedCurriculum } from "../prisma/seed/0_curriculum.js";
import { seedKpAliases } from "../prisma/seed/3_kp_aliases.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await testPrisma.$disconnect(); });

describe("KP tree seed", () => {
  it("连跑两次幂等：KP 行数不变、无重复", async () => {
    await seedCurriculum(testPrisma);
    const after1 = await testPrisma.knowledgePoint.count();
    await seedCurriculum(testPrisma);
    const after2 = await testPrisma.knowledgePoint.count();
    expect(after2).toBe(after1);
    expect(after1).toBeGreaterThan(4); // 全学段 > 旧的 4
  });

  it("现有 4 KP code 保留且被 re-parent 到新树", async () => {
    await seedCurriculum(testPrisma);
    const math = await testPrisma.subject.findUniqueOrThrow({ where: { code: "math" } });

    const solve = await testPrisma.knowledgePoint.findUniqueOrThrow({
      where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq-solve" } },
    });
    const linearEq = await testPrisma.knowledgePoint.findUniqueOrThrow({
      where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq" } },
    });
    // 一次方程求解 的父是 一次方程
    expect(solve.parentId).toBe(linearEq.id);
    // 一次方程 的父是 数与代数(L2)，再上是 初中(L1)
    const alg = await testPrisma.knowledgePoint.findUniqueOrThrow({ where: { id: linearEq.parentId! } });
    expect(alg.code).toBe("math-jh-alg");
    const jh = await testPrisma.knowledgePoint.findUniqueOrThrow({ where: { id: alg.parentId! } });
    expect(jh.code).toBe("math-jh");
    expect(jh.parentId).toBeNull();
  });

  it("alias seed 幂等且内联 alias 落库", async () => {
    await seedCurriculum(testPrisma);
    await seedKpAliases(testPrisma);
    await seedKpAliases(testPrisma); // 第二次幂等
    const math = await testPrisma.subject.findUniqueOrThrow({ where: { code: "math" } });
    const alias = await testPrisma.kpAlias.findUniqueOrThrow({
      where: { subjectId_normalizedAlias: { subjectId: math.id, normalizedAlias: "一元一次方程" } },
    });
    const solve = await testPrisma.knowledgePoint.findUniqueOrThrow({
      where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq-solve" } },
    });
    expect(alias.kpId).toBe(solve.id);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/db test -- tests/kp-seed.test.ts`
Expected: FAIL（实现已在 Task 3 完成，此步若直接 PASS 亦可——核心是确认实迁/幂等断言成立。若 FAIL 须修 Task 3 实现而非改断言）

- [ ] **Step 3: 跑通（无新实现，验证 Task 3）**

Run: `pnpm.cmd --filter @zhijiao/db test -- tests/kp-seed.test.ts`
Expected: PASS（3 用例全绿）

- [ ] **Step 4: 提交**

```bash
git add packages/db/tests/kp-seed.test.ts
git commit -m "test(db): KP tree seed idempotency + existing-4-KP re-parent + alias inline"
```

---

## Task 5: reconciler leaf-only 守卫

**Files:**
- Modify: `apps/web/server/lib/kp-reconcile.ts:62-93`（`loadSubjectCandidates`）
- Test: `apps/web/tests/integration/kp-reconcile-leaf-only.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/tests/integration/kp-reconcile-leaf-only.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { reconcileHintsSync } from "@/server/lib/kp-reconcile";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

// Plan 13 Finding C: 容器节点(有子)永不进 EXACT 池，避免粗粒度污染 Plan 11 掌握度。
describe("reconciler leaf-only EXACT guard", () => {
  it("唯一名的容器节点不被 hint EXACT 命中 → UNMATCHED，不写 QuestionKPLink", async () => {
    const math = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    // 容器："数与代数"(有子)
    const alg = await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg", name: "数与代数", difficulty: 3 },
    });
    // 叶子挂在容器下
    await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg-leaf", name: "一次方程求解", difficulty: 2, parentId: alg.id },
    });
    const q = await prisma.question.create({
      data: { subjectId: math.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });

    const r = await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["数与代数"], // 文本等于容器名
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: "clrelid000000000000000010",
    });

    expect(r.linked).toBe(0);
    expect(r.queued).toBe(1);
    const match = await prisma.kpReconcileMatch.findFirstOrThrow({ where: { questionId: q.id } });
    expect(match.status).toBe("UNMATCHED");
    const links = await prisma.questionKPLink.count({ where: { questionId: q.id } });
    expect(links).toBe(0);
  });

  it("叶子名照常 EXACT 命中 → LINKED + 写 QuestionKPLink", async () => {
    const math = await prisma.subject.create({ data: { code: "math", name: "数学" } });
    const alg = await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg", name: "数与代数", difficulty: 3 },
    });
    const leaf = await prisma.knowledgePoint.create({
      data: { subjectId: math.id, code: "math-jh-alg-leaf", name: "一次方程求解", difficulty: 2, parentId: alg.id },
    });
    const q = await prisma.question.create({
      data: { subjectId: math.id, stemMd: "x", type: "ESSAY", status: "PUBLISHED" },
    });

    const r = await reconcileHintsSync(prisma, {
      questionId: q.id,
      hints: ["一次方程求解"],
      source: "ERROR_ANALYSIS",
      sourceRefType: "ERROR_BOOK_ENTRY",
      sourceRefId: "clrelid000000000000000011",
    });

    expect(r.linked).toBe(1);
    const link = await prisma.questionKPLink.findFirstOrThrow({ where: { questionId: q.id } });
    expect(link.knowledgePointId).toBe(leaf.id);
  });
});
```

> 注：上面 `questionKPLink` 的 KP 外键字段名按现有 schema 写——实现前用 `rg -n "model QuestionKPLink" -A8 packages/db/prisma/schema.prisma` 确认是 `knowledgePointId` 还是别名，对齐断言里的字段。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-leaf-only.test.ts`
Expected: FAIL —— 第一个用例 `r.linked` 为 1（容器当前会被命中），与期望 0 冲突

- [ ] **Step 3: 改 loadSubjectCandidates 加 leaf-only**

`apps/web/server/lib/kp-reconcile.ts`，把 `loadSubjectCandidates` 的循环改为（仅叶子进 name/code 池）：

```ts
  const kpById = new Map<string, KnowledgePoint>();
  const kpByNormalized = new Map<string, string>();
  const kpNameCounts = new Map<string, number>();
  const kpNameByNormalized = new Map<string, string>();

  // Plan 13 Finding C: 容器节点(被任意 KP 当 parentId)永不进 EXACT 池。
  const parentIds = new Set<string>();
  for (const kp of kps) {
    if (kp.parentId) parentIds.add(kp.parentId);
  }
  const isLeaf = (kp: KnowledgePoint) => !parentIds.has(kp.id);

  for (const kp of kps) {
    kpById.set(kp.id, kp); // kpById 仍含全部节点（ALIAS 命中后查 subject 用）
    if (!isLeaf(kp)) continue; // 容器不进 name/code EXACT 池
    const normalizedName = normalizeKpHint(kp.name);
    kpNameCounts.set(normalizedName, (kpNameCounts.get(normalizedName) ?? 0) + 1);
    kpNameByNormalized.set(normalizedName, kp.id);
    kpByNormalized.set(normalizeKpHint(kp.code), kp.id);
  }
  for (const [normalizedName, count] of kpNameCounts) {
    if (count === 1 && !kpByNormalized.has(normalizedName)) {
      kpByNormalized.set(normalizedName, kpNameByNormalized.get(normalizedName)!);
    }
  }
```

> `kpById` 保留全部节点不变（§5：ALIAS 命中后用 `kpById.get(aliasKpId)` 做 cross-subject 防御查询，且 alias 已保证只指叶子）。只有 `kpByNormalized`（name+code EXACT 池）被限制为叶子。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-leaf-only.test.ts`
Expected: PASS（2 用例全绿）

- [ ] **Step 5: 回归——现有 reconcile 测试全绿**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/kp-reconcile-subject-isolation.test.ts tests/integration/kp-reconcile-sync-tutor-ask.test.ts tests/integration/kp-reconcile-sync-error-diagnose.test.ts tests/integration/kp-reconcile-sync-variant.test.ts tests/integration/kp-reconcile-alias-conflict.test.ts`
Expected: 全 PASS（叶子-only 不破坏既有行为——既有 fixture 的 KP 多为无子叶子）

- [ ] **Step 6: 提交**

```bash
git add apps/web/server/lib/kp-reconcile.ts apps/web/tests/integration/kp-reconcile-leaf-only.test.ts
git commit -m "feat(web): reconciler leaf-only EXACT guard (containers never pollute QuestionKPLink)"
```

---

## Task 6: 全量验证 + CLAUDE.md 红线 + 收尾

**Files:**
- Modify: `CLAUDE.md`（追加 Plan 13 现状 + 红线）

- [ ] **Step 1: regenerate client（无 schema 变更，确认 client 同步）**

Run: `pnpm.cmd --filter @zhijiao/db db:generate`
Expected: 成功（本 plan 无 schema 改动，此步仅保险）

- [ ] **Step 2: 全量 typecheck（不走 cache）**

Run: `pnpm.cmd exec turbo typecheck --force`
Expected: 全 PASS

- [ ] **Step 3: 全量 unit + integration（不走 cache）**

Run: `pnpm.cmd exec turbo test --force`
Expected: 全 PASS

- [ ] **Step 4: db:seed 真跑一次（验证主库 seed 不崩 + validate 生效）**

Run: `pnpm.cmd --filter @zhijiao/db db:seed`
Expected: 打印 `✓ Curriculum seeded: 1 subject (math), N KPs (全学段树)` 且 `✓ KP aliases seeded: M total (from data files)`，无 throw

- [ ] **Step 5: 负向探针——坏数据 seed 立即 throw**

临时在 `junior-math.ts` 复制一个已存在的叶子 code（制造重复），运行：

Run: `pnpm.cmd --filter @zhijiao/db db:seed`
Expected: 进程立刻 throw `validateKpData: duplicate code "..."`。验证后**撤销**临时改动。

- [ ] **Step 6: 更新 CLAUDE.md**

在「开始实现时（已落地）」列表追加一行 Plan 13 条目；在「**KP 树现状**」新增段落记录：单 math subject 4 层树、分学段 data 文件、`validateKpData` seed 入口校验、reconciler leaf-only 守卫、现有 4 KP code 保留 re-parent；并在「Merge 后必跑」追加红线：
- `validateKpData` 在 seed 入口运行：`Select-String -Path packages/db/prisma/seed/0_curriculum.ts -Pattern "validateKpData"` 应命中。
- reconciler leaf-only：`Select-String -Path apps/web/server/lib/kp-reconcile.ts -Pattern "isLeaf|parentIds"` 应命中。
- KP data 校验单测：`pnpm.cmd --filter @zhijiao/db test -- tests/kp-data.test.ts` 全绿。

并把「下一步候选 Plan」里 Plan 13 行移除（已落地）。

- [ ] **Step 7: 提交**

```bash
git add CLAUDE.md
git commit -m "docs(claude): Plan 13 KP tree expansion landed"
```

- [ ] **Step 8: E2E 冒烟（受影响 specs）**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/learning-portrait.spec.ts e2e/assignment-lifecycle.spec.ts`
Expected: 全 PASS（验证 KP re-parent 未破坏依赖 KP 的画像/作业闭环）。如遇 per-IP OTP burst 限频零散失败，按 spec 分批重跑（pre-existing，非本 plan 回归）。

---

## Self-Review 记录

- **Spec coverage**：§2 数据结构→Task 1/2；§3 数据文件+loader→Task 2/3；§4 alias 单一真源+校验→Task 1(校验)/Task 3(消费)；§5 leaf-only→Task 5；§6 决策无代码项（记录性）；§7 测试→Task 1/4/5 + Task 6 探针；现有 4 KP 实迁→Task 2/4。无缺口。
- **Placeholder scan**：数据文件里的 `// TODO(用户按课标手写)` 是**数据录入**留白（机制完整、内容用户迭代，spec §1 已声明），非代码占位；其余步骤均含完整代码/命令/期望输出。
- **Type consistency**：`KpNode` / `validateKpData` / `collectLeafAliases` / `flattenLeafCodes` / `mathKpRoots` / `seedSubjectKpTree` 跨 Task 1→3→4 签名一致；`QuestionKPLink` 外键字段名在 Task 5 Step 1 标注实现前核对 schema。
```
