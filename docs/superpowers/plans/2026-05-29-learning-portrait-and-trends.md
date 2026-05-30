# 学情画像 / 趋势 + 家长绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三端（学生/家长/教师）学情画像 + KP 掌握度三档展示 + 学生端付费 AI 学习建议 + 学生发码/家长绑定的 family-link。

**Architecture:** 新建纯计算包 `packages/analytics`（`core.ts` 纯函数 + `queries.ts` 只读 Prisma 聚合），apps/web 内加缓存/投影/建议/access 层与两个 router（analytics / family）。掌握度主源是 `AssignmentPerformance.kpIds`（绕开 QuestionKPLink 稀疏），时间衰减半衰期 30 天，三档 + 数据不足态。家长视图是学生 profile 的 stripped subset。

**Tech Stack:** TypeScript / pnpm workspace / turbo / Prisma 5 + Postgres / tRPC v11 / ioredis / Next 14 App Router / vitest / Playwright。设计见 `docs/superpowers/specs/2026-05-29-learning-portrait-and-trends-design.md`。

**前置**：本仓库已落地 Plan 1/2/3/4/6/8/9/10/12。所有命令用 `pnpm.cmd`（本机 execution policy）。每个 Prisma schema 变更后必须 `pnpm.cmd --filter @zhijiao/db db:generate` 再 typecheck。

---

### Task 1: FamilyLink schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`（User 加 2 个 relation；末尾加 enum + model）
- Create: `packages/db/prisma/migrations/<timestamp>_family_link/migration.sql`（由 `db:migrate` 生成）

- [ ] **Step 1: 在 schema 的 User model relation 区加两行**

`packages/db/prisma/schema.prisma` 的 `model User` 内，紧跟 `studentAssignments` 之后加：

```prisma
  parentLinks          FamilyLink[]        @relation("ParentLinks")
  studentLinks         FamilyLink[]        @relation("StudentLinks")
```

- [ ] **Step 2: 在 schema 末尾（OpsActionLog 之后）追加 enum + model**

```prisma
// === Plan 11: Family Link (学生发码 / 家长绑定) ===

enum FamilyLinkStatus {
  ACTIVE
  REVOKED
}

model FamilyLink {
  id            String           @id @default(cuid())
  parentUserId  String           @map("parent_user_id")
  studentUserId String           @map("student_user_id")
  status        FamilyLinkStatus @default(ACTIVE)
  createdAt     DateTime         @default(now()) @map("created_at")
  revokedAt     DateTime?        @map("revoked_at")

  // onDelete: Restrict — 与 ErrorBookEntry 同款安全默认；注销由 Plan 6 service 显式删
  parent        User @relation("ParentLinks",  fields: [parentUserId],  references: [id], onDelete: Restrict)
  student       User @relation("StudentLinks", fields: [studentUserId], references: [id], onDelete: Restrict)

  @@unique([parentUserId, studentUserId])
  @@index([studentUserId, status])
  @@index([parentUserId, status])
  @@map("family_links")
}
```

- [ ] **Step 3: 生成并应用 migration**

Run: `pnpm.cmd --filter @zhijiao/db exec prisma migrate dev --name family_link`
（Windows 上若卡，按 README 走 docker-exec 绕过。）
Expected: 新 migration 目录 + `family_links` 表创建成功。

- [ ] **Step 4: regenerate client + typecheck**

Run: `pnpm.cmd --filter @zhijiao/db db:generate; pnpm.cmd exec turbo typecheck --force`
Expected: 通过（新模型 `FamilyLink` 可见）。

- [ ] **Step 5: 验证 FK/unique 落库**

Run: `docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d family_links"`
Expected: 见 `family_links_parent_user_id_student_user_id_key`、两个 FK `ON DELETE RESTRICT`。

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add FamilyLink model for parent-student binding (Plan 11)"
```

---

### Task 2: 计费 + AI task kind 扩展

**Files:**
- Modify: `packages/billing/src/pricing.ts`
- Modify: `packages/ai/src/tasks.ts`
- Test: `packages/billing/tests/pricing.test.ts`（若不存在则创建）

- [ ] **Step 1: 写失败测试**

`packages/billing/tests/pricing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { priceOf } from "../src/pricing.js";

describe("pricing", () => {
  it("prices LEARNING_ADVICE_GEN at 1 credit", () => {
    expect(priceOf("LEARNING_ADVICE_GEN")).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm.cmd --filter @zhijiao/billing test -- tests/pricing.test.ts`
Expected: FAIL（`LEARNING_ADVICE_GEN` 不在 ActionKind / PRICING）。

- [ ] **Step 3: 加 ActionKind + 价格**

`packages/billing/src/pricing.ts`：`ActionKind` union 末尾加 `| "LEARNING_ADVICE_GEN"`；`PRICING` 加 `LEARNING_ADVICE_GEN: 1,`。

- [ ] **Step 4: 加 TaskKind + 模型映射**

`packages/ai/src/tasks.ts`：`TaskKind` union 加 `| "LEARNING_ADVICE"`；`TASK_MODEL_MAP` 加 `LEARNING_ADVICE: "qwen-plus",`。

- [ ] **Step 5: 跑测试 + typecheck**

Run: `pnpm.cmd --filter @zhijiao/billing test -- tests/pricing.test.ts; pnpm.cmd exec turbo typecheck --force`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/billing/src/pricing.ts packages/ai/src/tasks.ts packages/billing/tests/pricing.test.ts
git commit -m "feat(billing,ai): add LEARNING_ADVICE_GEN action + LEARNING_ADVICE task kind"
```

---

### Task 3: packages/analytics 脚手架 + 纯核 core.ts

**Files:**
- Create: `packages/analytics/package.json`
- Create: `packages/analytics/tsconfig.json`
- Create: `packages/analytics/vitest.config.ts`
- Create: `packages/analytics/src/types.ts`
- Create: `packages/analytics/src/core.ts`
- Create: `packages/analytics/src/index.ts`
- Test: `packages/analytics/tests/core.test.ts`

参照 `packages/billing/package.json` / `tsconfig.json` / `vitest.config.ts` 的字段照抄结构（名字换成 `@zhijiao/analytics`，无 runtime deps，devDeps 只 vitest/typescript/@types/node）。

- [ ] **Step 1: package.json**

```json
{
  "name": "@zhijiao/analytics",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "@prisma/client": "workspace:*"
  }
}
```
（`@prisma/client` 仅 `queries.ts`/类型用；`core.ts` 不 import 它。版本号对齐 `packages/billing/package.json` 的实际值，照抄。）

- [ ] **Step 2: tsconfig.json + vitest.config.ts**

照抄 `packages/billing/tsconfig.json`（改 include 到 `src`/`tests`）。`vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 3: types.ts**

```typescript
export type AnalyticsWindow = "D30" | "D90" | "ALL";

export type MasteryTier =
  | "INSUFFICIENT_DATA"
  | "FOCUS"
  | "PROGRESSING"
  | "SOLID";

export type GradeStatusSignal = "CORRECT" | "PARTIAL" | "WRONG";

export interface KpMastery {
  kpId: string;
  kpName: string;
  tier: MasteryTier;
  score: number | null; // null when INSUFFICIENT_DATA
  weightedSampleSize: number;
  rawSampleSize: number;
  recentErrorCount: number;
}

export interface LearningProfile {
  window: AnalyticsWindow;
  generatedAt: string; // ISO
  totalGradedItems: number;
  overallScore: number | null;
  hasData: boolean;
  masteries: KpMastery[]; // sorted FOCUS→PROGRESSING→SOLID→INSUFFICIENT_DATA
  focusAreas: string[]; // kpNames where tier === FOCUS
  strengths: string[]; // kpNames where tier === SOLID
}

export interface ClassKpStat {
  kpId: string;
  kpName: string;
  classTier: MasteryTier;
  avgScore: number | null;
  focusStudentCount: number;
  sampleStudents: number;
}

export interface ClassDiagnosis {
  window: AnalyticsWindow;
  generatedAt: string;
  classroomId: string;
  studentCount: number;
  kpStats: ClassKpStat[];
  topFocusKps: string[];
}

// core.ts 的纯输入
export interface PerfSample {
  kpIds: string[];
  gradeStatus: GradeStatusSignal;
  ageDays: number; // now - createdAt, in days (>= 0)
}
export interface ErrorSample {
  kpIds: string[];
}
```

- [ ] **Step 4: 写失败测试 core.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { aggregateMastery, scoreOf, decayWeight, tierOf } from "../src/core.js";

const kpMeta = new Map([["k1", "一元一次方程"], ["k2", "因式分解"]]);

describe("scoreOf", () => {
  it("maps grade status to score", () => {
    expect(scoreOf("CORRECT")).toBe(1);
    expect(scoreOf("PARTIAL")).toBe(0.5);
    expect(scoreOf("WRONG")).toBe(0);
  });
});

describe("decayWeight", () => {
  it("is 1 at age 0 and 0.5 at one half-life", () => {
    expect(decayWeight(0, 30)).toBeCloseTo(1);
    expect(decayWeight(30, 30)).toBeCloseTo(0.5);
  });
});

describe("tierOf", () => {
  it("returns INSUFFICIENT_DATA when weighted sample < 1", () => {
    expect(tierOf(0.9, 0.4)).toBe("INSUFFICIENT_DATA");
  });
  it("classifies by score above the data floor", () => {
    expect(tierOf(0.3, 2)).toBe("FOCUS");
    expect(tierOf(0.6, 2)).toBe("PROGRESSING");
    expect(tierOf(0.9, 2)).toBe("SOLID");
  });
});

describe("aggregateMastery", () => {
  it("computes per-KP weighted mastery and overall", () => {
    const out = aggregateMastery({
      samples: [
        { kpIds: ["k1"], gradeStatus: "CORRECT", ageDays: 0 },
        { kpIds: ["k1"], gradeStatus: "WRONG", ageDays: 0 },
        { kpIds: ["k2"], gradeStatus: "CORRECT", ageDays: 0 },
        { kpIds: ["k2"], gradeStatus: "CORRECT", ageDays: 0 },
      ],
      errors: [{ kpIds: ["k1"] }],
      kpMeta,
      halfLifeDays: 30,
    });
    expect(out.totalGradedItems).toBe(4);
    const k1 = out.masteries.find((m) => m.kpId === "k1")!;
    expect(k1.score).toBeCloseTo(0.5);
    expect(k1.tier).toBe("PROGRESSING");
    expect(k1.recentErrorCount).toBe(1);
    const k2 = out.masteries.find((m) => m.kpId === "k2")!;
    expect(k2.score).toBeCloseTo(1);
    expect(k2.tier).toBe("SOLID");
    // sort: FOCUS/PROGRESSING before SOLID
    expect(out.masteries[0].kpId).toBe("k1");
  });

  it("marks a KP with only a single faint old sample as INSUFFICIENT_DATA", () => {
    const out = aggregateMastery({
      samples: [{ kpIds: ["k1"], gradeStatus: "WRONG", ageDays: 120 }],
      errors: [],
      kpMeta,
      halfLifeDays: 30,
    });
    const k1 = out.masteries.find((m) => m.kpId === "k1")!;
    expect(k1.tier).toBe("INSUFFICIENT_DATA");
    expect(k1.score).toBeNull();
  });

  it("returns hasData=false when no samples", () => {
    const out = aggregateMastery({ samples: [], errors: [], kpMeta, halfLifeDays: 30 });
    expect(out.hasData).toBe(false);
    expect(out.overallScore).toBeNull();
  });
});
```

- [ ] **Step 5: 跑测试确认失败**

Run: `pnpm.cmd --filter @zhijiao/analytics test -- tests/core.test.ts`
Expected: FAIL（`core.ts` 未实现）。

- [ ] **Step 6: 实现 core.ts**

```typescript
import type {
  GradeStatusSignal,
  KpMastery,
  MasteryTier,
  PerfSample,
  ErrorSample,
  LearningProfile,
  AnalyticsWindow,
  ClassDiagnosis,
  ClassKpStat,
} from "./types.js";

export const HALF_LIFE_DAYS = 30;
const DATA_FLOOR = 1.0; // weighted sample size below this → INSUFFICIENT_DATA

export function scoreOf(g: GradeStatusSignal): number {
  return g === "CORRECT" ? 1 : g === "PARTIAL" ? 0.5 : 0;
}

export function decayWeight(ageDays: number, halfLifeDays: number): number {
  const age = ageDays < 0 ? 0 : ageDays;
  return Math.pow(0.5, age / halfLifeDays);
}

export function tierOf(score: number, weightedSampleSize: number): MasteryTier {
  if (weightedSampleSize < DATA_FLOOR) return "INSUFFICIENT_DATA";
  if (score < 0.5) return "FOCUS";
  if (score < 0.8) return "PROGRESSING";
  return "SOLID";
}

const TIER_ORDER: Record<MasteryTier, number> = {
  FOCUS: 0,
  PROGRESSING: 1,
  SOLID: 2,
  INSUFFICIENT_DATA: 3,
};

export function aggregateMastery(args: {
  samples: PerfSample[];
  errors: ErrorSample[];
  kpMeta: Map<string, string>;
  halfLifeDays: number;
}): Pick<LearningProfile, "masteries" | "overallScore" | "totalGradedItems" | "hasData"> {
  const acc = new Map<
    string,
    { wScore: number; wSum: number; raw: number; errors: number }
  >();
  const ensure = (kpId: string) => {
    let a = acc.get(kpId);
    if (!a) {
      a = { wScore: 0, wSum: 0, raw: 0, errors: 0 };
      acc.set(kpId, a);
    }
    return a;
  };

  let overallW = 0;
  let overallWScore = 0;
  for (const s of args.samples) {
    const w = decayWeight(s.ageDays, args.halfLifeDays);
    const sc = scoreOf(s.gradeStatus);
    for (const kpId of s.kpIds) {
      const a = ensure(kpId);
      a.wScore += w * sc;
      a.wSum += w;
      a.raw += 1;
    }
    overallW += w;
    overallWScore += w * sc;
  }
  for (const e of args.errors) {
    for (const kpId of e.kpIds) ensure(kpId).errors += 1;
  }

  const masteries: KpMastery[] = [...acc.entries()].map(([kpId, a]) => {
    const score = a.wSum > 0 ? a.wScore / a.wSum : 0;
    const tier = tierOf(score, a.wSum);
    return {
      kpId,
      kpName: args.kpMeta.get(kpId) ?? kpId,
      tier,
      score: tier === "INSUFFICIENT_DATA" ? null : Number(score.toFixed(4)),
      weightedSampleSize: Number(a.wSum.toFixed(4)),
      rawSampleSize: a.raw,
      recentErrorCount: a.errors,
    };
  });
  masteries.sort((x, y) =>
    TIER_ORDER[x.tier] !== TIER_ORDER[y.tier]
      ? TIER_ORDER[x.tier] - TIER_ORDER[y.tier]
      : (x.score ?? -1) - (y.score ?? -1),
  );

  return {
    masteries,
    overallScore: overallW > 0 ? Number((overallWScore / overallW).toFixed(4)) : null,
    totalGradedItems: args.samples.length,
    hasData: args.samples.length > 0,
  };
}

export function aggregateClassDiagnosis(args: {
  classroomId: string;
  window: AnalyticsWindow;
  studentCount: number;
  // 每个学生已聚合好的 per-KP masteries（来自 aggregateMastery）
  perStudent: KpMastery[][];
  kpMeta: Map<string, string>;
}): ClassDiagnosis {
  const acc = new Map<
    string,
    { scoreSum: number; scored: number; focus: number; students: number }
  >();
  for (const studentMasteries of args.perStudent) {
    for (const m of studentMasteries) {
      let a = acc.get(m.kpId);
      if (!a) {
        a = { scoreSum: 0, scored: 0, focus: 0, students: 0 };
        acc.set(m.kpId, a);
      }
      a.students += 1;
      if (m.tier === "FOCUS") a.focus += 1;
      if (m.score !== null) {
        a.scoreSum += m.score;
        a.scored += 1;
      }
    }
  }
  const kpStats: ClassKpStat[] = [...acc.entries()].map(([kpId, a]) => {
    const avg = a.scored > 0 ? a.scoreSum / a.scored : null;
    return {
      kpId,
      kpName: args.kpMeta.get(kpId) ?? kpId,
      avgScore: avg === null ? null : Number(avg.toFixed(4)),
      classTier: avg === null ? "INSUFFICIENT_DATA" : tierOf(avg, a.scored),
      focusStudentCount: a.focus,
      sampleStudents: a.students,
    };
  });
  kpStats.sort((x, y) =>
    TIER_ORDER[x.classTier] !== TIER_ORDER[y.classTier]
      ? TIER_ORDER[x.classTier] - TIER_ORDER[y.classTier]
      : y.focusStudentCount - x.focusStudentCount,
  );
  return {
    classroomId: args.classroomId,
    window: args.window,
    generatedAt: new Date().toISOString(),
    studentCount: args.studentCount,
    kpStats,
    topFocusKps: kpStats
      .filter((s) => s.classTier === "FOCUS")
      .slice(0, 5)
      .map((s) => s.kpName),
  };
}
```

- [ ] **Step 7: index.ts**

```typescript
export * from "./types.js";
export * from "./core.js";
export * from "./queries.js";
```
（`queries.js` Task 4 创建；先建空文件 `export {};` 让 index 不报错，Task 4 填实现。）

- [ ] **Step 8: 跑测试 PASS**

Run: `pnpm.cmd --filter @zhijiao/analytics test -- tests/core.test.ts`
Expected: PASS。

- [ ] **Step 9: 把包接入 turbo + 装依赖**

Run: `pnpm.cmd install`（让 workspace 认识新包）。确认根 `turbo.json` 的 `typecheck`/`test` pipeline 是 glob（通常 `"//#..."` 或 `tasks` 默认覆盖所有 package），无需改；若 `turbo.json` 显式列 package 则补 `@zhijiao/analytics`。
Run: `pnpm.cmd exec turbo typecheck --force --filter @zhijiao/analytics`
Expected: PASS。

- [ ] **Step 10: Commit**

```bash
git add packages/analytics pnpm-lock.yaml
git commit -m "feat(analytics): new package with pure mastery aggregation core (Plan 11)"
```

---

### Task 4: analytics queries.ts（profileForStudent / classDiagnosis）

**Files:**
- Modify: `packages/analytics/src/queries.ts`
- Test: `apps/web/tests/integration/analytics-queries.test.ts`（用 apps/web 的 test DB + fixtures，因为要 seed AssignmentPerformance/ErrorBookEntry）

> queries 用 `PrismaClient` 做只读聚合，集成测放 apps/web（已有 6 个 per-package test DB + fixtures 套路）。

- [ ] **Step 1: 实现 queries.ts**

```typescript
import type { PrismaClient } from "@prisma/client";
import { aggregateMastery, aggregateClassDiagnosis, HALF_LIFE_DAYS } from "./core.js";
import type {
  AnalyticsWindow,
  LearningProfile,
  ClassDiagnosis,
  PerfSample,
  ErrorSample,
  KpMastery,
} from "./types.js";

const WINDOW_DAYS: Record<AnalyticsWindow, number | null> = {
  D30: 30,
  D90: 90,
  ALL: null,
};

function cutoffFor(window: AnalyticsWindow, now: Date): Date | null {
  const days = WINDOW_DAYS[window];
  return days === null ? null : new Date(now.getTime() - days * 86_400_000);
}

function ageDays(createdAt: Date, now: Date): number {
  return (now.getTime() - createdAt.getTime()) / 86_400_000;
}

// 把一批学生的原始行聚合成 KpMastery[]，并解析 kpMeta（KP 名）。
async function loadKpMeta(
  db: PrismaClient,
  kpIds: Set<string>,
): Promise<Map<string, string>> {
  if (kpIds.size === 0) return new Map();
  const kps = await db.knowledgePoint.findMany({
    where: { id: { in: [...kpIds] } },
    select: { id: true, name: true },
  });
  return new Map(kps.map((k) => [k.id, k.name]));
}

export async function profileForStudent(
  db: PrismaClient,
  args: { userId: string; window: AnalyticsWindow; now?: Date },
): Promise<LearningProfile> {
  const now = args.now ?? new Date();
  const cutoff = cutoffFor(args.window, now);

  const perf = await db.assignmentPerformance.findMany({
    where: {
      studentUserId: args.userId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
    },
    select: { kpIds: true, gradeStatus: true, createdAt: true },
  });

  // 错题弱信号：ACTIVE entry → question.knowledgePoints（QuestionKPLink）→ kpId
  const errorEntries = await db.errorBookEntry.findMany({
    where: { userId: args.userId, status: "ACTIVE" },
    select: { question: { select: { knowledgePoints: { select: { kpId: true } } } } },
  });

  const samples: PerfSample[] = perf.map((p) => ({
    kpIds: p.kpIds,
    gradeStatus: p.gradeStatus as PerfSample["gradeStatus"],
    ageDays: ageDays(p.createdAt, now),
  }));
  const errors: ErrorSample[] = errorEntries.map((e) => ({
    kpIds: e.question.knowledgePoints.map((l) => l.kpId),
  }));

  const kpIds = new Set<string>();
  for (const s of samples) for (const k of s.kpIds) kpIds.add(k);
  for (const e of errors) for (const k of e.kpIds) kpIds.add(k);
  const kpMeta = await loadKpMeta(db, kpIds);

  const agg = aggregateMastery({ samples, errors, kpMeta, halfLifeDays: HALF_LIFE_DAYS });
  return {
    window: args.window,
    generatedAt: now.toISOString(),
    ...agg,
    focusAreas: agg.masteries.filter((m) => m.tier === "FOCUS").map((m) => m.kpName),
    strengths: agg.masteries.filter((m) => m.tier === "SOLID").map((m) => m.kpName),
  };
}

export async function classDiagnosis(
  db: PrismaClient,
  args: { classroomId: string; window: AnalyticsWindow; now?: Date },
): Promise<ClassDiagnosis> {
  const now = args.now ?? new Date();
  const cutoff = cutoffFor(args.window, now);

  const studentMembers = await db.classroomMember.findMany({
    where: { classroomId: args.classroomId, role: "STUDENT" },
    select: { userId: true },
  });
  const studentIds = studentMembers.map((m) => m.userId);

  const perf = studentIds.length
    ? await db.assignmentPerformance.findMany({
        where: {
          studentUserId: { in: studentIds },
          ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
        },
        select: { studentUserId: true, kpIds: true, gradeStatus: true, createdAt: true },
      })
    : [];

  const kpIds = new Set<string>();
  for (const p of perf) for (const k of p.kpIds) kpIds.add(k);
  const kpMeta = await loadKpMeta(db, kpIds);

  // 按学生分桶 → 每个学生 aggregateMastery → perStudent KpMastery[][]
  const byStudent = new Map<string, PerfSample[]>();
  for (const p of perf) {
    const arr = byStudent.get(p.studentUserId) ?? [];
    arr.push({
      kpIds: p.kpIds,
      gradeStatus: p.gradeStatus as PerfSample["gradeStatus"],
      ageDays: ageDays(p.createdAt, now),
    });
    byStudent.set(p.studentUserId, arr);
  }
  const perStudent: KpMastery[][] = [...byStudent.values()].map(
    (samples) =>
      aggregateMastery({ samples, errors: [], kpMeta, halfLifeDays: HALF_LIFE_DAYS })
        .masteries,
  );

  return aggregateClassDiagnosis({
    classroomId: args.classroomId,
    window: args.window,
    studentCount: studentIds.length,
    perStudent,
    kpMeta,
  });
}
```

- [ ] **Step 2: 写集成测试**

`apps/web/tests/integration/analytics-queries.test.ts`（参照 `apps/web/tests/integration/_helpers/error-book-fixtures.ts` 建 fixture：1 subject、2 KP、1 classroom、1 student member、若干 AssignmentPerformance 行）：

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@zhijiao/db";
import { profileForStudent, classDiagnosis } from "@zhijiao/analytics";

// 用 cuid 固定前缀，测试前清自身数据；参照同目录其它集成测的 setup 习惯。
const SUBJECT = "an-subj-1";
const KP1 = "an-kp-1";
const KP2 = "an-kp-2";
const STUDENT = "an-stu-1";
const CLASSROOM = "an-class-1";

beforeAll(async () => {
  await prisma.subject.upsert({
    where: { id: SUBJECT },
    update: {},
    create: { id: SUBJECT, code: "an-math", name: "AN数学" },
  });
  for (const [id, name] of [[KP1, "一元一次方程"], [KP2, "因式分解"]] as const) {
    await prisma.knowledgePoint.upsert({
      where: { id },
      update: {},
      create: { id, subjectId: SUBJECT, code: id, name },
    });
  }
  await prisma.user.upsert({
    where: { id: STUDENT },
    update: {},
    create: { id: STUDENT, persona: "STUDENT", gradeLevel: "G8" },
  });
  await prisma.classroom.upsert({
    where: { id: CLASSROOM },
    update: {},
    create: { id: CLASSROOM, name: "AN班", subjectId: SUBJECT },
  });
  await prisma.classroomMember.upsert({
    where: { classroomId_userId: { classroomId: CLASSROOM, userId: STUDENT } },
    update: {},
    create: { classroomId: CLASSROOM, userId: STUDENT, role: "STUDENT" },
  });
  await prisma.assignmentPerformance.deleteMany({ where: { studentUserId: STUDENT } });
  // KP1: 1对1错 → 0.5 PROGRESSING；KP2: 2对 → SOLID
  const now = new Date();
  await prisma.assignmentPerformance.createMany({
    data: [
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i1", gradeStatus: "CORRECT", kpIds: [KP1], createdAt: now },
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i2", gradeStatus: "WRONG", kpIds: [KP1], createdAt: now },
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i3", gradeStatus: "CORRECT", kpIds: [KP2], createdAt: now },
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i4", gradeStatus: "CORRECT", kpIds: [KP2], createdAt: now },
    ],
  });
});

describe("profileForStudent", () => {
  it("aggregates mastery from AssignmentPerformance", async () => {
    const p = await profileForStudent(prisma, { userId: STUDENT, window: "ALL" });
    expect(p.hasData).toBe(true);
    expect(p.totalGradedItems).toBe(4);
    const k1 = p.masteries.find((m) => m.kpName === "一元一次方程")!;
    expect(k1.tier).toBe("PROGRESSING");
    expect(p.strengths).toContain("因式分解");
  });
});

describe("classDiagnosis", () => {
  it("aggregates across class members", async () => {
    const d = await classDiagnosis(prisma, { classroomId: CLASSROOM, window: "ALL" });
    expect(d.studentCount).toBe(1);
    expect(d.kpStats.length).toBeGreaterThanOrEqual(2);
  });
});
```

> 注：`AssignmentPerformance` 的 `assignmentId`/`itemId` 是裸字段无 FK 到这里强约束之外的表（schema 里 `assignment_performance` 无 FK），可填占位字符串。若实际 schema 有 FK 报错，则先建对应 Assignment/Item fixture。

- [ ] **Step 3: 跑测试**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/analytics-queries.test.ts`
Expected: PASS（首次跑前确保 `pnpm.cmd test:setup` 已建 test DB）。

- [ ] **Step 4: Commit**

```bash
git add packages/analytics/src/queries.ts apps/web/tests/integration/analytics-queries.test.ts
git commit -m "feat(analytics): profileForStudent + classDiagnosis query wrappers"
```

---

### Task 5: AI 学习建议（schema + prompt + router.generateLearningAdvice）

**Files:**
- Modify: `packages/ai/src/schemas.ts`
- Create: `packages/ai/src/prompts/learning-advice/v1.md`
- Modify: `packages/ai/src/router.ts`
- Modify: `packages/ai/src/index.ts`（导出新类型）
- Test: `packages/ai/tests/learning-advice.test.ts`

- [ ] **Step 1: schemas.ts 加输入/输出 schema**

`packages/ai/src/schemas.ts` 末尾追加（参照 ErrorAnalysis schema 风格）：

```typescript
export const LearningAdviceInputSchema = z.object({
  studentGrade: z.string().optional(),
  focusAreas: z.array(z.object({ kpName: z.string(), score: z.number().nullable() })).max(10),
  strengths: z.array(z.string()).max(10),
});
export type LearningAdviceInput = z.infer<typeof LearningAdviceInputSchema>;

export const LearningAdviceOutputSchema = z.object({
  summaryMd: z.string(),
  suggestions: z
    .array(z.object({ focusKp: z.string(), methodMd: z.string() }))
    .min(1)
    .max(5),
  encouragementMd: z.string(),
});
export type LearningAdviceOutput = z.infer<typeof LearningAdviceOutputSchema>;
```

- [ ] **Step 2: prompt 文件**

`packages/ai/src/prompts/learning-advice/v1.md`（措辞遵守合规：方法论导向、按学段、无提分/分数/通过保证、无恐吓）：

```markdown
你是面向中国 K12 的学习方法顾问。基于学生的知识点掌握情况，给出**可迁移的学习方法建议**，不要承诺分数、不要制造焦虑、不要使用"提分/保过"等措辞。

学段：{{studentGrade}}（小学用生活类比，初中讲题型归类，高中谈方法迁移）。

需要重点巩固的知识点（含掌握度参考，分数越低越需关注）：
{{focusAreas}}

已经掌握扎实的知识点：
{{strengths}}

请输出 JSON，字段：
- summaryMd: 一段总体学习状态的中性、鼓励性概述（不含分数承诺）
- suggestions: 数组，每项 { focusKp: 知识点名, methodMd: 针对该知识点的具体可执行学习方法 }，1-5 条
- methodMd 要给"怎么学"的方法，而不是"做这道题的答案"
- encouragementMd: 一句正向鼓励（不施压、不制造焦虑）

只输出 JSON。
```

- [ ] **Step 3: router.ts 加 generateLearningAdvice**

`packages/ai/src/router.ts`：
1. import 区加 `LearningAdviceInputSchema, LearningAdviceOutputSchema, type LearningAdviceOutput`。
2. 加扫描函数：

```typescript
function scanLearningAdviceForForbidden(out: LearningAdviceOutput): string[] {
  const corpus = [
    out.summaryMd,
    out.encouragementMd,
    ...out.suggestions.flatMap((s) => [s.focusKp, s.methodMd]),
  ].join("\n");
  return findForbidden(corpus);
}
```

3. 在 `AiRouter` class 内加方法（用既有 `runJsonTaskWithAudit` 复用重试/审计/合规）：

```typescript
async generateLearningAdvice(
  input: unknown,
): Promise<LearningAdviceOutput & { modelCallId: string }> {
  const parsed = LearningAdviceInputSchema.parse(input);
  const taskKind: TaskKind = "LEARNING_ADVICE";
  const prompt = await loadPrompt("learning-advice", this.opts.promptVersion ?? "v1");
  const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

  const focusRendered = parsed.focusAreas
    .map((f) => `- ${f.kpName}（参考掌握度=${f.score === null ? "数据不足" : f.score}）`)
    .join("\n") || "（暂无）";
  const strengthsRendered = parsed.strengths.map((s) => `- ${s}`).join("\n") || "（暂无）";

  const userContent = prompt.interpolate({
    studentGrade: parsed.studentGrade ?? "G8",
    focusAreas: focusRendered,
    strengths: strengthsRendered,
  });

  const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
  const request = {
    model,
    messages: [
      { role: "system" as const, content: "你是面向中国 K12、强调方法论的学习顾问。" },
      { role: "user" as const, content: userContent },
    ],
    responseFormat: "json_object" as const,
    temperature: 0.4,
  };

  return this.runJsonTaskWithAudit({
    taskKind,
    promptTemplateId,
    request,
    schema: LearningAdviceOutputSchema,
    scanForbidden: scanLearningAdviceForForbidden,
  });
}
```

4. `packages/ai/src/index.ts`：导出 `LearningAdviceOutput` / `LearningAdviceInput` 类型（参照已导出的 `AssignmentQuestionGenerationOutput`）。

- [ ] **Step 4: 写测试（用 mock adapter）**

`packages/ai/tests/learning-advice.test.ts`（参照现有 AI 测如何构造 `AiRouter` + mock adapter；mock 返回合法 JSON 一次成功，再测合规命中抛 `ComplianceRejectedError`）：

```typescript
import { describe, it, expect } from "vitest";
// 参照 packages/ai/tests 既有 helper 构造 router（mock adapter + test prisma）。
// 这里给断言骨架，setup 复用现有 test harness。
import { makeTestRouter } from "./_helpers.js"; // 若无则照现有测试内联构造

describe("generateLearningAdvice", () => {
  it("returns validated advice on good JSON", async () => {
    const router = makeTestRouter({
      content: JSON.stringify({
        summaryMd: "你在方程方面进步明显。",
        suggestions: [{ focusKp: "因式分解", methodMd: "先识别公因式再尝试公式法。" }],
        encouragementMd: "保持节奏，继续加油。",
      }),
    });
    const out = await router.generateLearningAdvice({
      studentGrade: "G8",
      focusAreas: [{ kpName: "因式分解", score: 0.4 }],
      strengths: ["一元一次方程"],
    });
    expect(out.suggestions[0].focusKp).toBe("因式分解");
    expect(out.modelCallId).toBeTruthy();
  });

  it("throws ComplianceRejectedError when output hits forbidden phrase", async () => {
    const router = makeTestRouter({
      content: JSON.stringify({
        summaryMd: "保证提分 30 分。", // 违禁
        suggestions: [{ focusKp: "x", methodMd: "y" }],
        encouragementMd: "z",
      }),
    });
    await expect(
      router.generateLearningAdvice({ focusAreas: [], strengths: [] }),
    ).rejects.toThrow(/compliance|rejected/i);
  });
});
```

> 若 `packages/ai/tests` 没有 `_helpers.ts`，照同目录现有测试（如 error-analysis / variant 测）的 router 构造方式内联，沿用其 mock adapter + test prisma fixture。违禁词以 `@zhijiao/domain` 的 `findForbidden` 实际词表为准（"提分"等），测前 grep 确认一个真实命中词。

- [ ] **Step 5: 跑测试**

Run: `pnpm.cmd --filter @zhijiao/ai test -- tests/learning-advice.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/schemas.ts packages/ai/src/router.ts packages/ai/src/index.ts packages/ai/src/prompts/learning-advice packages/ai/tests/learning-advice.test.ts
git commit -m "feat(ai): LEARNING_ADVICE task — generateLearningAdvice with compliance scan"
```

---

### Task 6: learning-cache.ts（Redis 5min）

**Files:**
- Create: `apps/web/server/lib/learning-cache.ts`
- Test: `apps/web/tests/integration/learning-cache.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { redis } from "@/lib/redis";
import { getCachedJson, ANALYTICS_TTL_SEC } from "@/server/lib/learning-cache";

describe("getCachedJson", () => {
  const key = "analytics:test:cache:1";
  beforeAll(async () => { await redis.del(key); });

  it("calls loader on miss, caches on hit", async () => {
    let calls = 0;
    const loader = async () => { calls++; return { n: 42 }; };
    const first = await getCachedJson(key, ANALYTICS_TTL_SEC, loader);
    const second = await getCachedJson(key, ANALYTICS_TTL_SEC, loader);
    expect(first).toEqual({ n: 42 });
    expect(second).toEqual({ n: 42 });
    expect(calls).toBe(1); // 第二次命中缓存，loader 不再调
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ANALYTICS_TTL_SEC);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/learning-cache.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 learning-cache.ts**

```typescript
import "server-only";
import { redis } from "@/lib/redis";

export const ANALYTICS_TTL_SEC = 300; // 5 分钟纯 TTL，无主动失效

// LearningProfile / ClassDiagnosis 都是 JSON-safe（数字/字符串/数组 + ISO string），
// 直接 JSON.stringify；不放 Date 对象，不需要 superjson。
export async function getCachedJson<T>(
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // 损坏缓存：丢弃，重算
    }
  }
  const fresh = await loader();
  await redis.set(key, JSON.stringify(fresh), "EX", ttlSec);
  return fresh;
}

export const profileCacheKey = (userId: string, window: string) =>
  `analytics:profile:${userId}:${window}`;
export const classCacheKey = (classroomId: string, window: string) =>
  `analytics:class:${classroomId}:${window}`;
```

- [ ] **Step 4: 跑测试 PASS**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/learning-cache.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/learning-cache.ts apps/web/tests/integration/learning-cache.test.ts
git commit -m "feat(web): learning-cache 5min TTL helper (Plan 11)"
```

---

### Task 7: learning-projection.ts（家长简版）

**Files:**
- Create: `apps/web/server/lib/learning-projection.ts`
- Test: `apps/web/tests/unit/learning-projection.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from "vitest";
import { familyView } from "@/server/lib/learning-projection";
import type { LearningProfile } from "@zhijiao/analytics";

const profile: LearningProfile = {
  window: "D90",
  generatedAt: "2026-05-29T00:00:00.000Z",
  totalGradedItems: 10,
  overallScore: 0.72,
  hasData: true,
  masteries: [
    { kpId: "k1", kpName: "因式分解", tier: "FOCUS", score: 0.4, weightedSampleSize: 3, rawSampleSize: 3, recentErrorCount: 2 },
    { kpId: "k2", kpName: "方程", tier: "SOLID", score: 0.9, weightedSampleSize: 4, rawSampleSize: 4, recentErrorCount: 0 },
    { kpId: "k3", kpName: "几何", tier: "INSUFFICIENT_DATA", score: null, weightedSampleSize: 0.2, rawSampleSize: 1, recentErrorCount: 0 },
  ],
  focusAreas: ["因式分解"],
  strengths: ["方程"],
};

describe("familyView", () => {
  it("strips per-KP scores, keeps coarse counts + names", () => {
    const v = familyView(profile);
    expect(v.hasData).toBe(true);
    expect(v.solidCount).toBe(1);
    expect(v.progressingCount).toBe(0);
    expect(v.focusCount).toBe(1);
    expect(v.focusAreas).toEqual(["因式分解"]);
    expect(v.strengths).toEqual(["方程"]);
    // 不泄露原始分数
    expect(JSON.stringify(v)).not.toContain("0.4");
    expect(JSON.stringify(v)).not.toContain("overallScore");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/learning-projection.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 learning-projection.ts**

```typescript
import type { LearningProfile } from "@zhijiao/analytics";

export interface FamilyProfileView {
  window: string;
  generatedAt: string;
  hasData: boolean;
  solidCount: number;
  progressingCount: number;
  focusCount: number;
  focusAreas: string[]; // 建议关注的知识点名（无分数）
  strengths: string[]; // 掌握扎实的知识点名
}

// 家长简版：剥掉每-KP 数字/分数/overallScore，只给粗粒度计数 + 知识点名。
// 不含排名、不含百分比、不含 INSUFFICIENT_DATA 噪音。
export function familyView(profile: LearningProfile): FamilyProfileView {
  const count = (tier: string) =>
    profile.masteries.filter((m) => m.tier === tier).length;
  return {
    window: profile.window,
    generatedAt: profile.generatedAt,
    hasData: profile.hasData,
    solidCount: count("SOLID"),
    progressingCount: count("PROGRESSING"),
    focusCount: count("FOCUS"),
    focusAreas: profile.focusAreas,
    strengths: profile.strengths,
  };
}
```

- [ ] **Step 4: 跑测试 PASS + commit**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/unit/learning-projection.test.ts`

```bash
git add apps/web/server/lib/learning-projection.ts apps/web/tests/unit/learning-projection.test.ts
git commit -m "feat(web): familyView projection (stripped parent subset)"
```

---

### Task 8: profile-access.ts（requireProfileAccess）

**Files:**
- Create: `apps/web/server/lib/profile-access.ts`
- Test: `apps/web/tests/integration/profile-access.test.ts`

- [ ] **Step 1: 实现 profile-access.ts**

```typescript
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

export type ProfileRelationship = "self" | "parent" | "teacher";

// 返回 viewer 对 target 学情的访问关系；无任何关系 → NOT_FOUND（不用 FORBIDDEN，
// 避免暴露 "此 userId 存在"。与 validateEntryOwnership / validateQuestionAccess 同款隐私不变量）。
export async function requireProfileAccess(
  db: PrismaClient,
  viewerId: string,
  targetId: string,
): Promise<ProfileRelationship> {
  if (viewerId === targetId) return "self";

  const parentLink = await db.familyLink.findFirst({
    where: { parentUserId: viewerId, studentUserId: targetId, status: "ACTIVE" },
    select: { id: true },
  });
  if (parentLink) return "parent";

  // teacher: viewer 拥有的 classroom（role TEACHER）中存在 target 作为 STUDENT 成员
  const teacherClassrooms = await db.classroomMember.findMany({
    where: { userId: viewerId, role: "TEACHER" },
    select: { classroomId: true },
  });
  if (teacherClassrooms.length > 0) {
    const shared = await db.classroomMember.findFirst({
      where: {
        userId: targetId,
        role: "STUDENT",
        classroomId: { in: teacherClassrooms.map((c) => c.classroomId) },
      },
      select: { classroomId: true },
    });
    if (shared) return "teacher";
  }

  throw new TRPCError({
    code: "NOT_FOUND",
    message: "无法访问该学情",
    cause: { reason: "PROFILE_NOT_ACCESSIBLE" },
  });
}
```

- [ ] **Step 2: 写集成测试（self / parent / teacher / stranger）**

`apps/web/tests/integration/profile-access.test.ts`：seed 1 student、1 parent（ACTIVE FamilyLink）、1 teacher（同 classroom）、1 stranger。断言四种返回：`'self'`/`'parent'`/`'teacher'`/throw `NOT_FOUND` reason `PROFILE_NOT_ACCESSIBLE`。再补一例：REVOKED FamilyLink 的家长 → throw（撤销后失效）。

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@zhijiao/db";
import { TRPCError } from "@trpc/server";
import { requireProfileAccess } from "@/server/lib/profile-access";

const STU = "pa-stu", PAR = "pa-par", TEA = "pa-tea", STR = "pa-str";
const SUBJ = "pa-subj", CLS = "pa-cls";

beforeAll(async () => {
  await prisma.subject.upsert({ where: { id: SUBJ }, update: {}, create: { id: SUBJ, code: "pa-m", name: "PA数学" } });
  for (const id of [STU, PAR, TEA, STR]) {
    await prisma.user.upsert({ where: { id }, update: {}, create: { id, persona: "STUDENT" } });
  }
  await prisma.classroom.upsert({ where: { id: CLS }, update: {}, create: { id: CLS, name: "PA班", subjectId: SUBJ } });
  await prisma.classroomMember.upsert({ where: { classroomId_userId: { classroomId: CLS, userId: TEA } }, update: {}, create: { classroomId: CLS, userId: TEA, role: "TEACHER" } });
  await prisma.classroomMember.upsert({ where: { classroomId_userId: { classroomId: CLS, userId: STU } }, update: {}, create: { classroomId: CLS, userId: STU, role: "STUDENT" } });
  await prisma.familyLink.deleteMany({ where: { studentUserId: STU } });
  await prisma.familyLink.create({ data: { parentUserId: PAR, studentUserId: STU, status: "ACTIVE" } });
});

describe("requireProfileAccess", () => {
  it("self", async () => expect(await requireProfileAccess(prisma, STU, STU)).toBe("self"));
  it("parent", async () => expect(await requireProfileAccess(prisma, PAR, STU)).toBe("parent"));
  it("teacher", async () => expect(await requireProfileAccess(prisma, TEA, STU)).toBe("teacher"));
  it("stranger → NOT_FOUND", async () => {
    await expect(requireProfileAccess(prisma, STR, STU)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("revoked parent → NOT_FOUND", async () => {
    await prisma.familyLink.updateMany({ where: { parentUserId: PAR, studentUserId: STU }, data: { status: "REVOKED" } });
    await expect(requireProfileAccess(prisma, PAR, STU)).rejects.toBeInstanceOf(TRPCError);
    await prisma.familyLink.updateMany({ where: { parentUserId: PAR, studentUserId: STU }, data: { status: "ACTIVE" } });
  });
});
```

- [ ] **Step 3: 跑测试 PASS + commit**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/profile-access.test.ts`

```bash
git add apps/web/server/lib/profile-access.ts apps/web/tests/integration/profile-access.test.ts
git commit -m "feat(web): requireProfileAccess (self/parent/teacher, NOT_FOUND on none)"
```

---

### Task 9: routers/analytics.ts + 注册

**Files:**
- Create: `apps/web/server/routers/analytics.ts`
- Create: `apps/web/server/lib/learning-advice.ts`
- Modify: `apps/web/server/routers/_root.ts`
- Test: `apps/web/tests/integration/analytics-router.test.ts`

- [ ] **Step 1: learning-advice.ts（建议输入构造 + 调 AI）**

```typescript
import "server-only";
import type { LearningProfile } from "@zhijiao/analytics";
import { getAiRouter } from "@/lib/ai-client";

// 从 profile 派生 AI 输入（只取 KP 名 + tier/score，无 PII、无自由文本）
export function buildAdviceInput(profile: LearningProfile, studentGrade: string | null) {
  return {
    studentGrade: studentGrade ?? undefined,
    focusAreas: profile.masteries
      .filter((m) => m.tier === "FOCUS")
      .slice(0, 8)
      .map((m) => ({ kpName: m.kpName, score: m.score })),
    strengths: profile.strengths.slice(0, 8),
  };
}

export async function generateAdviceForProfile(
  userId: string,
  profile: LearningProfile,
  studentGrade: string | null,
) {
  const aiRouter = getAiRouter(userId);
  return aiRouter.generateLearningAdvice(buildAdviceInput(profile, studentGrade));
}
```

- [ ] **Step 2: routers/analytics.ts**

```typescript
import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, chargeMiddleware, router } from "../trpc.js";
import { profileForStudent, classDiagnosis } from "@zhijiao/analytics";
import { getCachedJson, ANALYTICS_TTL_SEC, profileCacheKey, classCacheKey } from "../lib/learning-cache.js";
import { familyView } from "../lib/learning-projection.js";
import { requireProfileAccess } from "../lib/profile-access.js";
import { requireTeacherClassroom } from "../lib/assignment-access.js";
import { generateAdviceForProfile } from "../lib/learning-advice.js";
import { ComplianceRejectedError } from "@zhijiao/ai";

const WindowSchema = z.enum(["D30", "D90", "ALL"]).default("D90");

export const analyticsRouter = router({
  profile: router({
    // 学生本人完整画像
    mine: authedProcedure
      .input(z.object({ window: WindowSchema }))
      .query(async ({ ctx, input }) => {
        const profile = await getCachedJson(
          profileCacheKey(ctx.auth.userId, input.window),
          ANALYTICS_TTL_SEC,
          () => profileForStudent(ctx.db, { userId: ctx.auth.userId, window: input.window }),
        );
        return { relationship: "self" as const, profile };
      }),

    // 家长/教师查指定学生：access helper 决定可见性 + 投影
    get: authedProcedure
      .input(z.object({ studentUserId: z.string().cuid(), window: WindowSchema }))
      .query(async ({ ctx, input }) => {
        const rel = await requireProfileAccess(ctx.db, ctx.auth.userId, input.studentUserId);
        const profile = await getCachedJson(
          profileCacheKey(input.studentUserId, input.window),
          ANALYTICS_TTL_SEC,
          () => profileForStudent(ctx.db, { userId: input.studentUserId, window: input.window }),
        );
        if (rel === "parent") {
          return { relationship: rel, view: familyView(profile) };
        }
        return { relationship: rel, profile };
      }),

    // 学生本人付费 AI 学习建议（1 credit）。链：authed → charge（合规走 AI 输出扫描白名单不补偿）
    generateAdvice: authedProcedure
      .use(chargeMiddleware("LEARNING_ADVICE_GEN"))
      .input(z.object({ window: WindowSchema, clientRequestId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const user = await ctx.db.user.findUnique({
          where: { id: ctx.auth.userId },
          select: { gradeLevel: true },
        });
        const profile = await getCachedJson(
          profileCacheKey(ctx.auth.userId, input.window),
          ANALYTICS_TTL_SEC,
          () => profileForStudent(ctx.db, { userId: ctx.auth.userId, window: input.window }),
        );
        if (!profile.hasData) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "数据不足，完成一些练习后再生成学习建议。",
            cause: { reason: "INSUFFICIENT_PROFILE_DATA" },
          });
        }
        try {
          const advice = await generateAdviceForProfile(ctx.auth.userId, profile, user?.gradeLevel ?? null);
          return {
            summaryMd: advice.summaryMd,
            suggestions: advice.suggestions,
            encouragementMd: advice.encouragementMd,
          };
        } catch (e) {
          if (e instanceof ComplianceRejectedError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "学习建议未通过合规检查",
              cause: { reason: "COMPLIANCE_REJECTED", original: e },
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "生成学习建议失败",
            cause: { reason: "LEARNING_ADVICE_INTERNAL", original: e },
          });
        }
      }),
  }),

  classroom: router({
    diagnosis: authedProcedure
      .input(z.object({ classroomId: z.string().cuid(), window: WindowSchema }))
      .query(async ({ ctx, input }) => {
        await requireTeacherClassroom(ctx.db, ctx.auth.userId, input.classroomId);
        const diagnosis = await getCachedJson(
          classCacheKey(input.classroomId, input.window),
          ANALYTICS_TTL_SEC,
          () => classDiagnosis(ctx.db, { classroomId: input.classroomId, window: input.window }),
        );
        return { diagnosis };
      }),
  }),
});
```

> 注意（INSUFFICIENT_PROFILE_DATA 早退发生在 charge 之后）：此时 body 抛非合规错 → chargeMiddleware 默认补偿（净余额不变）。可接受——数据不足是边缘路径，且会退钱。若想 0 噪音 ledger，可后续把 hasData 检查抽成 charge 前中间件；MVP 不做。

- [ ] **Step 3: 注册到 _root.ts**

`apps/web/server/routers/_root.ts`：import `analyticsRouter` 与（Task 10 的）`familyRouter`，加到 `router({...})`：

```typescript
import { analyticsRouter } from "./analytics.js";
// ...
  analytics: analyticsRouter,
```
（family 在 Task 10 加。）

- [ ] **Step 4: 写集成测试**

`apps/web/tests/integration/analytics-router.test.ts`：用既有 tRPC caller 测试套路（参照 `charged-procedure-tutor.test.ts` 怎么构造 caller + ctx）。覆盖：
1. `profile.mine` 返回 self profile。
2. `profile.get` 家长 → 返回 `view`（familyView，无 profile 字段）；教师 → 返回 `profile`；stranger → NOT_FOUND。
3. `classroom.diagnosis` 非教师 → NOT_FOUND（requireTeacherClassroom）。
4. `generateAdvice` mock AI 成功路径返回 suggestions；余额扣 1。

（断言骨架略——复用现有 caller helper；mock AI adapter 同 Task 5。）

- [ ] **Step 5: 跑测试 + typecheck**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/analytics-router.test.ts; pnpm.cmd exec turbo typecheck --force`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/server/routers/analytics.ts apps/web/server/lib/learning-advice.ts apps/web/server/routers/_root.ts apps/web/tests/integration/analytics-router.test.ts
git commit -m "feat(web): analytics router (profile.mine/get/generateAdvice + classroom.diagnosis)"
```

---

### Task 10: routers/family.ts + 注册

**Files:**
- Create: `apps/web/server/routers/family.ts`
- Modify: `apps/web/server/routers/_root.ts`
- Test: `apps/web/tests/integration/family-router.test.ts`

- [ ] **Step 1: family.ts**

```typescript
import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, router } from "../trpc.js";

const INVITE_TTL_SEC = 900; // 15 分钟
const inviteKey = (code: string) => `family:invite:${code}`;

// 8 字符 URL-safe（base64url 去歧义字符）
function genCode(): string {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

export const familyRouter = router({
  // 学生发码（数据主体持发起权）
  createInviteCode: authedProcedure.mutation(async ({ ctx }) => {
    const code = genCode();
    await ctx.redis.set(inviteKey(code), ctx.auth.userId, "EX", INVITE_TTL_SEC);
    return { code, expiresInSec: INVITE_TTL_SEC };
  }),

  // 家长绑定
  bindByCode: authedProcedure
    .input(z.object({ code: z.string().min(4).max(16) }))
    .mutation(async ({ ctx, input }) => {
      const studentUserId = await ctx.redis.get(inviteKey(input.code));
      if (!studentUserId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请码无效或已过期", cause: { reason: "INVITE_INVALID" } });
      }
      if (studentUserId === ctx.auth.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能绑定自己", cause: { reason: "CANNOT_BIND_SELF" } });
      }
      // upsert：复活 REVOKED / 幂等 ACTIVE
      await ctx.db.familyLink.upsert({
        where: { parentUserId_studentUserId: { parentUserId: ctx.auth.userId, studentUserId } },
        update: { status: "ACTIVE", revokedAt: null },
        create: { parentUserId: ctx.auth.userId, studentUserId, status: "ACTIVE" },
      });
      await ctx.redis.del(inviteKey(input.code)); // 单次用尽
      const student = await ctx.db.user.findUnique({
        where: { id: studentUserId },
        select: { id: true, name: true, gradeLevel: true },
      });
      return { studentUserId, name: student?.name ?? null, gradeLevel: student?.gradeLevel ?? null };
    }),

  listMyChildren: authedProcedure.query(async ({ ctx }) => {
    const links = await ctx.db.familyLink.findMany({
      where: { parentUserId: ctx.auth.userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, student: { select: { id: true, name: true, gradeLevel: true } } },
    });
    return {
      children: links.map((l) => ({
        linkId: l.id,
        userId: l.student.id,
        name: l.student.name,
        gradeLevel: l.student.gradeLevel,
      })),
    };
  }),

  // 任一方可撤销；非 link 双方 → NOT_FOUND（不暴露存在性）
  revoke: authedProcedure
    .input(z.object({ linkId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const link = await ctx.db.familyLink.findUnique({ where: { id: input.linkId } });
      if (!link || (link.parentUserId !== ctx.auth.userId && link.studentUserId !== ctx.auth.userId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "绑定不存在", cause: { reason: "LINK_NOT_FOUND" } });
      }
      if (link.status === "ACTIVE") {
        await ctx.db.familyLink.update({
          where: { id: link.id },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
      }
      return { ok: true as const };
    }),
});
```

- [ ] **Step 2: 注册 _root.ts**

import `familyRouter` 并加 `family: familyRouter,`。

- [ ] **Step 3: 写集成测试**

`apps/web/tests/integration/family-router.test.ts`，覆盖：
1. 学生 createInviteCode → 家长 bindByCode 成功，建 ACTIVE FamilyLink。
2. 同 code 第二次 bind → NOT_FOUND/INVITE_INVALID（单次用尽）。
3. 自己 bind 自己的 code → BAD_REQUEST/CANNOT_BIND_SELF。
4. revoke → status REVOKED；revoke 他人的 link（非双方）→ NOT_FOUND/LINK_NOT_FOUND。
5. listMyChildren 只返 ACTIVE。

（用 caller helper + 真 redis；测试用唯一 userId 前缀。）

- [ ] **Step 4: 跑测试 PASS + typecheck + commit**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/family-router.test.ts; pnpm.cmd exec turbo typecheck --force`

```bash
git add apps/web/server/routers/family.ts apps/web/server/routers/_root.ts apps/web/tests/integration/family-router.test.ts
git commit -m "feat(web): family router (student-issued invite code, parent binds)"
```

---

### Task 11: PII 增量（注销删 FamilyLink / 导出含 link / payload guard）

**Files:**
- Modify: `apps/web/server/lib/pii-governance.ts`
- Test: `apps/web/tests/integration/pii-deactivate-user.test.ts`（扩）、`apps/web/tests/integration/pii-export-user-data.test.ts`（扩）、`apps/web/tests/unit/pii-ops-action-log-payload.test.ts`（扩）

- [ ] **Step 1: 扩 DeactivatePayload + UserDataExport 类型**

`pii-governance.ts`：`DeactivatePayload.deleted` 加 `familyLinks: number`；`UserDataExport` 加：

```typescript
  familyLinks: Array<{
    id: string;
    role: "parent" | "student";
    counterpartUserId: string;
    status: string;
    createdAt: Date;
  }>;
```

- [ ] **Step 2: buildDeactivatePlan + empty payload 加 familyLinks 计数**

`empty.deleted` 加 `familyLinks: 0`；`Promise.all` 里加：

```typescript
    prisma.familyLink.count({ where: { OR: [{ parentUserId: userId }, { studentUserId: userId }] } }),
```
解构变量 `familyLinks`，写入返回 `payload.deleted.familyLinks`。

- [ ] **Step 3: deactivateUser 事务内删 FamilyLink**

在 `tx.studentAssignment.deleteMany` 附近加：

```typescript
    const familyLinks = await tx.familyLink.deleteMany({
      where: { OR: [{ parentUserId: args.userId }, { studentUserId: args.userId }] },
    });
```
payload `deleted` 加 `familyLinks: familyLinks.count`。

- [ ] **Step 4: exportUserData 查并映射 familyLinks**

`Promise.all` 加：

```typescript
    prisma.familyLink.findMany({
      where: { OR: [{ parentUserId: userId }, { studentUserId: userId }] },
      orderBy: { createdAt: "asc" },
      select: { id: true, parentUserId: true, studentUserId: true, status: true, createdAt: true },
    }),
```
返回对象加：

```typescript
    familyLinks: familyLinks.map((l) => ({
      id: l.id,
      role: l.parentUserId === userId ? ("parent" as const) : ("student" as const),
      counterpartUserId: l.parentUserId === userId ? l.studentUserId : l.parentUserId,
      status: l.status,
      createdAt: l.createdAt,
    })),
```

- [ ] **Step 5: 扩测试**

- `pii-deactivate-user.test.ts`：seed 一个有 FamilyLink（作 parent 和 student 各一条）的 user，注销后断言 `payload.deleted.familyLinks` 计数正确，且 DB 中相关 link 已删。
- `pii-export-user-data.test.ts`：断言导出含 `familyLinks` 且 `counterpartUserId` 正确、role 正确。
- `pii-ops-action-log-payload.test.ts`：断言 payload 仅含计数，不含 parentUserId/studentUserId/name 等字段（扩既有 guard 的禁词集合，加 `parent_user_id`/`student_user_id` 检查）。

- [ ] **Step 6: 跑三测 PASS + typecheck + commit**

Run: `pnpm.cmd --filter @zhijiao/web test -- tests/integration/pii-deactivate-user.test.ts tests/integration/pii-export-user-data.test.ts tests/unit/pii-ops-action-log-payload.test.ts; pnpm.cmd exec turbo typecheck --force`

```bash
git add apps/web/server/lib/pii-governance.ts apps/web/tests/integration/pii-deactivate-user.test.ts apps/web/tests/integration/pii-export-user-data.test.ts apps/web/tests/unit/pii-ops-action-log-payload.test.ts
git commit -m "feat(web): PII governance covers FamilyLink (deactivate delete + export)"
```

---

### Task 12: 学生端 /portrait 页 + 掌握度色块 + AdviceCard

**Files:**
- Create: `apps/web/lib/mastery-copy.ts`（学段措辞常量）
- Create: `apps/web/app/(student)/portrait/page.tsx`
- Create: `apps/web/app/(student)/portrait/portrait-view.tsx`（client，调 `analytics.profile.mine`）
- Create: `apps/web/app/(student)/portrait/advice-card.tsx`（client，付费 mutation）

- [ ] **Step 1: mastery-copy.ts**

```typescript
import type { MasteryTier } from "@zhijiao/analytics";

export const TIER_COLOR: Record<MasteryTier, string> = {
  SOLID: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PROGRESSING: "bg-amber-100 text-amber-800 border-amber-200",
  FOCUS: "bg-sky-100 text-sky-800 border-sky-200", // 蓝=聚焦，非红=失败
  INSUFFICIENT_DATA: "bg-slate-100 text-slate-500 border-slate-200",
};

// 中性、不制造焦虑、按学段微调。gradeBand: "primary"|"junior"|"senior"
export function tierLabel(tier: MasteryTier): string {
  switch (tier) {
    case "SOLID": return "掌握扎实";
    case "PROGRESSING": return "稳步提升";
    case "FOCUS": return "重点巩固方向";
    case "INSUFFICIENT_DATA": return "数据不足";
  }
}

export function gradeBandOf(gradeLevel: string | null): "primary" | "junior" | "senior" {
  if (!gradeLevel) return "junior";
  if (["G5", "G6"].includes(gradeLevel)) return "primary";
  if (["G7", "G8", "G9"].includes(gradeLevel)) return "junior";
  return "senior";
}
```

- [ ] **Step 2: portrait-view.tsx（client）**

```tsx
"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { TIER_COLOR, tierLabel } from "@/lib/mastery-copy";
import { AdviceCard } from "./advice-card";

export function PortraitView() {
  const [window, setWindow] = useState<"D30" | "D90" | "ALL">("D90");
  const q = trpc.analytics.profile.mine.useQuery({ window });

  if (q.isLoading) return <p className="text-sm text-slate-500">加载中…</p>;
  const profile = q.data?.profile;
  if (!profile || !profile.hasData) {
    return (
      <p className="text-sm text-slate-600" data-testid="portrait-empty">
        还没有足够的学情数据。完成一些练习或作业后，这里会显示你的知识点掌握情况。
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2" data-testid="portrait-window">
        {(["D30", "D90", "ALL"] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWindow(w)}
            className={`rounded border px-3 py-1 text-sm ${w === window ? "bg-slate-900 text-white" : ""}`}
          >
            {w === "D30" ? "近30天" : w === "D90" ? "近90天" : "全部"}
          </button>
        ))}
      </div>

      <section>
        <h2 className="mb-3 font-medium">知识点掌握情况</h2>
        <div className="grid gap-2 sm:grid-cols-2" data-testid="portrait-masteries">
          {profile.masteries.map((m) => (
            <div key={m.kpId} className={`rounded border px-3 py-2 ${TIER_COLOR[m.tier]}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.kpName}</span>
                <span className="text-xs">{tierLabel(m.tier)}</span>
              </div>
              {m.recentErrorCount > 0 && (
                <p className="mt-1 text-xs opacity-80">近期错题 {m.recentErrorCount} 道</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <AdviceCard window={window} />
    </div>
  );
}
```

- [ ] **Step 3: advice-card.tsx（client，付费 mutation；沿用 ErrorAnalysisCard 的 idemKey/余额不足习惯）**

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function AdviceCard({ window }: { window: "D30" | "D90" | "ALL" }) {
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState(false);
  const advise = trpc.analytics.profile.generateAdvice.useMutation({
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficient(reason === "INSUFFICIENT_BALANCE");
      setPendingReqId(null);
    },
    onSuccess: () => setPendingReqId(null),
  });

  function onGenerate() {
    const clientRequestId = pendingReqId ?? crypto.randomUUID();
    if (!pendingReqId) setPendingReqId(clientRequestId);
    advise.mutate({ window, clientRequestId });
  }

  return (
    <section className="rounded border border-amber-200 bg-amber-50 p-4" data-testid="advice-card">
      <h3 className="font-semibold">AI 学习方法建议</h3>
      <p className="mt-1 text-sm text-slate-600">基于你的掌握情况，生成可执行的学习方法（消耗 1 credit）。</p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={advise.isPending}
        className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        data-testid="btn-generate-advice"
      >
        {advise.isPending ? "生成中…" : "生成学习建议"}
      </button>
      {advise.error && (
        <p className="mt-2 text-sm text-red-600" data-testid="advice-error">
          {advise.error.message}
          {insufficient && (
            <> <Link href="/wallet" className="underline text-emerald-700">去充值</Link></>
          )}
        </p>
      )}
      {advise.data && (
        <div className="mt-3 space-y-2 text-sm" data-testid="advice-result">
          <p className="whitespace-pre-wrap">{advise.data.summaryMd}</p>
          <ul className="list-disc pl-5">
            {advise.data.suggestions.map((s, i) => (
              <li key={i}><span className="font-medium">{s.focusKp}：</span>{s.methodMd}</li>
            ))}
          </ul>
          <p className="text-slate-600">{advise.data.encouragementMd}</p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: page.tsx**

```tsx
import { PortraitView } from "./portrait-view";

export default function PortraitPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">我的学情</h1>
      <p className="mt-1 text-sm text-slate-600">看看自己各知识点的掌握情况，找到下一步重点。</p>
      <div className="mt-6"><PortraitView /></div>
    </main>
  );
}
```

- [ ] **Step 5: next build 验证（Suspense / 转义）+ commit**

Run: `pnpm.cmd --filter @zhijiao/web exec next build`
Expected: build 成功（无 missing-suspense / no-unescaped-entities）。本页未用 `useSearchParams`，应无 Suspense 要求。

```bash
git add apps/web/lib/mastery-copy.ts "apps/web/app/(student)/portrait"
git commit -m "feat(web): student learning portrait page + advice card"
```

---

### Task 13: 学生端 /family-link 页（发码）

**Files:**
- Create: `apps/web/app/(student)/family-link/page.tsx`
- Create: `apps/web/app/(student)/family-link/family-link-view.tsx`（client）

- [ ] **Step 1: family-link-view.tsx**

```tsx
"use client";
import { trpc } from "@/lib/trpc-client";

export function FamilyLinkView() {
  const create = trpc.family.createInviteCode.useMutation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        生成邀请码给家长，家长输入后即可<strong>只读</strong>查看你的学情。邀请码 15 分钟内有效、仅可使用一次。
      </p>
      <button
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        data-testid="btn-create-invite"
      >
        {create.isPending ? "生成中…" : "生成邀请码"}
      </button>
      {create.data && (
        <div className="rounded border bg-slate-50 p-4" data-testid="invite-code">
          <p className="text-sm text-slate-600">把这串邀请码发给家长：</p>
          <p className="mt-1 font-mono text-2xl tracking-widest">{create.data.code}</p>
          <p className="mt-1 text-xs text-slate-500">{Math.round(create.data.expiresInSec / 60)} 分钟内有效</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: page.tsx**

```tsx
import { FamilyLinkView } from "./family-link-view";
export default function FamilyLinkPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">绑定家长</h1>
      <div className="mt-6"><FamilyLinkView /></div>
    </main>
  );
}
```

- [ ] **Step 3: build + commit**

Run: `pnpm.cmd --filter @zhijiao/web exec next build`

```bash
git add "apps/web/app/(student)/family-link"
git commit -m "feat(web): student family-link page (issue invite code)"
```

---

### Task 14: 家长端 /parent（子女列表 + 绑定）+ /parent/children/[childId]

**Files:**
- Modify: `apps/web/app/parent/page.tsx`
- Create: `apps/web/app/parent/parent-view.tsx`（client）
- Create: `apps/web/app/parent/children/[childId]/page.tsx`
- Create: `apps/web/app/parent/children/[childId]/child-portrait.tsx`（client）

- [ ] **Step 1: parent-view.tsx（绑定表单 + 子女列表）**

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";

export function ParentView() {
  const [code, setCode] = useState("");
  const utils = trpc.useUtils();
  const children = trpc.family.listMyChildren.useQuery();
  const bind = trpc.family.bindByCode.useMutation({
    onSuccess: () => { setCode(""); utils.family.listMyChildren.invalidate(); },
  });

  return (
    <div className="space-y-6">
      <section className="rounded border p-4">
        <h2 className="font-medium">绑定孩子</h2>
        <p className="mt-1 text-sm text-slate-600">输入孩子在「绑定家长」页生成的邀请码。</p>
        <div className="mt-3 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder="邀请码"
            className="rounded border px-3 py-2 text-sm font-mono"
            data-testid="input-invite-code"
          />
          <button
            onClick={() => bind.mutate({ code })}
            disabled={bind.isPending || code.length < 4}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            data-testid="btn-bind"
          >绑定</button>
        </div>
        {bind.error && <p className="mt-2 text-sm text-red-600" data-testid="bind-error">{bind.error.message}</p>}
      </section>

      <section>
        <h2 className="mb-2 font-medium">我的孩子</h2>
        <div className="divide-y rounded border" data-testid="children-list">
          {children.data?.children.map((c) => (
            <div key={c.linkId} className="flex items-center justify-between px-4 py-3">
              <span>{c.name ?? "（未设置昵称）"} · {c.gradeLevel ?? "—"}</span>
              <Link href={`/parent/children/${c.userId}`} className="text-sm text-emerald-700 underline">查看学情</Link>
            </div>
          ))}
          {children.data && children.data.children.length === 0 && (
            <p className="px-4 py-6 text-sm text-slate-600">还没有绑定孩子。</p>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: parent/page.tsx 替换 stub**

```tsx
import { ParentView } from "./parent-view";
export default function ParentHome() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold">家长面板</h1>
      <div className="mt-6"><ParentView /></div>
    </main>
  );
}
```

- [ ] **Step 3: child-portrait.tsx（client，调 profile.get → familyView 分支）**

```tsx
"use client";
import { trpc } from "@/lib/trpc-client";

export function ChildPortrait({ childId }: { childId: string }) {
  const q = trpc.analytics.profile.get.useQuery({ studentUserId: childId, window: "D90" });
  if (q.isLoading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (q.error) return <p className="text-sm text-red-600" data-testid="child-error">{q.error.message}</p>;
  // 家长视角后端返回 { relationship:'parent', view }
  const view = q.data && "view" in q.data ? q.data.view : null;
  if (!view || !view.hasData) {
    return <p className="text-sm text-slate-600" data-testid="child-empty">孩子还没有足够的学情数据。</p>;
  }
  return (
    <div className="space-y-4" data-testid="child-portrait">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded border bg-emerald-50 p-3"><div className="text-2xl font-semibold">{view.solidCount}</div><div className="text-xs">掌握扎实</div></div>
        <div className="rounded border bg-amber-50 p-3"><div className="text-2xl font-semibold">{view.progressingCount}</div><div className="text-xs">稳步提升</div></div>
        <div className="rounded border bg-sky-50 p-3"><div className="text-2xl font-semibold">{view.focusCount}</div><div className="text-xs">建议关注</div></div>
      </div>
      {view.focusAreas.length > 0 && (
        <p className="text-sm text-slate-700">建议一起关注：{view.focusAreas.join("、")}</p>
      )}
      {view.strengths.length > 0 && (
        <p className="text-sm text-slate-600">掌握扎实：{view.strengths.join("、")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: parent/children/[childId]/page.tsx**

```tsx
import { ChildPortrait } from "./child-portrait";

export default function ChildPage({ params }: { params: { childId: string } }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold">孩子学情</h1>
      <div className="mt-6"><ChildPortrait childId={params.childId} /></div>
    </main>
  );
}
```

- [ ] **Step 5: build + commit**

Run: `pnpm.cmd --filter @zhijiao/web exec next build`

```bash
git add apps/web/app/parent
git commit -m "feat(web): parent panel — bind child + read-only family view"
```

---

### Task 15: 教师端班级诊断 + 单学生画像

**Files:**
- Modify: `apps/web/app/teacher/classes/[classroomId]/page.tsx`（加诊断区）
- Create: `apps/web/app/teacher/classes/[classroomId]/class-diagnosis.tsx`（client）
- Create: `apps/web/app/teacher/students/[studentId]/page.tsx`
- Create: `apps/web/app/teacher/students/[studentId]/student-portrait.tsx`（client）

- [ ] **Step 1: class-diagnosis.tsx（client，调 classroom.diagnosis）**

```tsx
"use client";
import { trpc } from "@/lib/trpc-client";
import { TIER_COLOR, tierLabel } from "@/lib/mastery-copy";

export function ClassDiagnosis({ classroomId }: { classroomId: string }) {
  const q = trpc.analytics.classroom.diagnosis.useQuery({ classroomId, window: "D90" });
  if (q.isLoading) return <p className="text-sm text-slate-500">加载诊断中…</p>;
  if (q.error) return <p className="text-sm text-red-600">{q.error.message}</p>;
  const d = q.data?.diagnosis;
  if (!d || d.kpStats.length === 0) return <p className="text-sm text-slate-600" data-testid="class-diagnosis-empty">暂无足够数据生成班级诊断。</p>;
  return (
    <div className="space-y-3" data-testid="class-diagnosis">
      {d.topFocusKps.length > 0 && (
        <p className="text-sm text-slate-700">建议优先讲评：{d.topFocusKps.join("、")}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {d.kpStats.map((s) => (
          <div key={s.kpId} className={`rounded border px-3 py-2 ${TIER_COLOR[s.classTier]}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.kpName}</span>
              <span className="text-xs">{tierLabel(s.classTier)}</span>
            </div>
            <p className="mt-1 text-xs opacity-80">需重点巩固学生 {s.focusStudentCount}/{s.sampleStudents}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 teacher/classes/[classroomId]/page.tsx 嵌入诊断区**

Read 现有文件，在合适位置（班级标题下）加一个 section 渲染 `<ClassDiagnosis classroomId={params.classroomId} />`（import 上面组件）。保留页面其余内容不动。

- [ ] **Step 3: student-portrait.tsx（client，调 profile.get → teacher 分支返回 profile）**

```tsx
"use client";
import { trpc } from "@/lib/trpc-client";
import { TIER_COLOR, tierLabel } from "@/lib/mastery-copy";

export function StudentPortrait({ studentId }: { studentId: string }) {
  const q = trpc.analytics.profile.get.useQuery({ studentUserId: studentId, window: "D90" });
  if (q.isLoading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (q.error) return <p className="text-sm text-red-600" data-testid="student-error">{q.error.message}</p>;
  const profile = q.data && "profile" in q.data ? q.data.profile : null;
  if (!profile || !profile.hasData) return <p className="text-sm text-slate-600" data-testid="student-empty">该学生暂无足够学情数据。</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="student-portrait">
      {profile.masteries.map((m) => (
        <div key={m.kpId} className={`rounded border px-3 py-2 ${TIER_COLOR[m.tier]}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">{m.kpName}</span>
            <span className="text-xs">{tierLabel(m.tier)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: teacher/students/[studentId]/page.tsx**

```tsx
import { StudentPortrait } from "./student-portrait";
export default function TeacherStudentPage({ params }: { params: { studentId: string } }) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">学生学情</h1>
      <div className="mt-6"><StudentPortrait studentId={params.studentId} /></div>
    </main>
  );
}
```

- [ ] **Step 5: build + commit**

Run: `pnpm.cmd --filter @zhijiao/web exec next build`

```bash
git add "apps/web/app/teacher/classes/[classroomId]" apps/web/app/teacher/students
git commit -m "feat(web): teacher class diagnosis + single-student portrait"
```

---

### Task 16: E2E — 学情画像 + family-link 闭环

**Files:**
- Modify: `apps/web/app/api/e2e-hooks/.../route.ts`（新增或扩 hook，seed AssignmentPerformance + family fixture；仅 `E2E_TEST_HOOKS=1`）
- Create: `apps/web/e2e/learning-portrait.spec.ts`
- Create: `apps/web/e2e/family-link.spec.ts`

- [ ] **Step 1: E2E hook — seed 画像数据**

参照 `apps/web/app/api/e2e-hooks/error-book/route.ts` 的结构（`if (process.env.E2E_TEST_HOOKS !== "1") return 404`），新增 `apps/web/app/api/e2e-hooks/analytics/route.ts`：POST `{ phone }` → 找到该 user → 清并 seed 一组 `AssignmentPerformance`（含 FOCUS / SOLID KP）+ 确保 KP 行存在 → reset 钱包 balance=100。返回 `{ studentUserId }`。

- [ ] **Step 2: learning-portrait.spec.ts**

用 dev student 账号（避开其它 spec 占用的手机号；参照 CLAUDE.md 用 dev-student-02/03 习惯，选一个未被占用的）。流程：登录 → POST analytics hook → 访问 `/portrait` → 断言 `portrait-masteries` 可见、出现至少一个 FOCUS 蓝块 → 点 `btn-generate-advice` → 断言 `advice-result` 出现（mock AI）。用 per-run 唯一性不需要（hook 每次 reset）。

- [ ] **Step 3: family-link.spec.ts**

两账号流程：学生登录 → `/family-link` → 点 `btn-create-invite` → 抓 `invite-code` 文本。家长登录（另一 context/账号）→ `/parent` → 填 `input-invite-code` → 点 `btn-bind` → 断言 `children-list` 出现该学生 → 点"查看学情"→ `/parent/children/[id]` 断言 `child-portrait` 或 `child-empty`。再测：同 code 再 bind → `bind-error`（单次用尽）。

- [ ] **Step 4: 跑 E2E（单独跑，不与 typecheck/test 并发）**

Run: `pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/learning-portrait.spec.ts e2e/family-link.spec.ts`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/e2e-hooks/analytics apps/web/e2e/learning-portrait.spec.ts apps/web/e2e/family-link.spec.ts
git commit -m "test(web): E2E for learning portrait + family-link lifecycle"
```

---

### Task 17: 收尾 — CLAUDE.md 更新 + 全量回归

**Files:**
- Modify: `CLAUDE.md`（加 Plan 11 现状段 + 验收红线 53-59）

- [ ] **Step 1: CLAUDE.md 追加 Plan 11 现状**

在「已落地」列表加 Plan 11 条目（指向本 plan + spec）；加一段「学情画像现状（Plan 11）」概述（analytics 包纯核/查询壳分层、掌握度主源 AssignmentPerformance、三档+数据不足、5min 缓存纯 TTL、学生发码/家长绑定、合规色块措辞、PII 覆盖 FamilyLink）；「Merge 后必跑」加 §8 的 7 条红线（编号续 53）；「下一步候选」移除 Plan 11。

- [ ] **Step 2: 全量回归（按 CLAUDE.md「Merge 后必跑」）**

```bash
pnpm.cmd --filter @zhijiao/db db:generate
pnpm.cmd exec turbo typecheck --force
pnpm.cmd exec turbo test --force
pnpm.cmd --filter @zhijiao/web test:e2e
```
Expected: 全绿。`packages/analytics` 出现在 turbo typecheck/test 输出里。

- [ ] **Step 3: 红线探针**

```bash
# analytics 包不依赖 redis/ai/server-only
grep -rn "ioredis\|@zhijiao/ai\|server-only" packages/analytics/src   # 期望 0 命中
# family_links 落库
docker exec zhijiao-postgres psql -U postgres -d zhijiao -c "\d family_links"
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): Plan 11 learning portrait + family-link landed"
```

---

## Self-Review Notes（写 plan 时已核对）

- **Spec 覆盖**：§1 模块切分→Task 3/4/6/7/8/9/10；§2 算法→Task 3/4；§3 合规→Task 5（AI 扫描）+ Task 12（色块措辞）；§4 计费→Task 2 + Task 9；§5 family-link→Task 1/10/13/14；§6 缓存→Task 6；§7 PII→Task 11；§8 红线→Task 16/17。全部有对应任务。
- **类型一致**：`LearningProfile` / `KpMastery` / `MasteryTier` / `AnalyticsWindow` 在 Task 3 types.ts 定义，Task 4/7/9/12/15 一致引用；`familyView` 返回 `FamilyProfileView`（Task 7 定义，Task 14 消费 `view`）；`profile.get` 返回联合 `{view}`|`{profile}`，前端用 `"view" in q.data` / `"profile" in q.data` 判别（Task 14/15）。
- **TDD 顺序**：纯核（Task 3）先于查询壳（Task 4）先于 router（Task 9）；access（Task 8）先于 router 用它。
- **已知设计代价**（写入 spec §6 / Task 9 注）：5min 缓存纯 TTL 无主动失效；`generateAdvice` 数据不足早退发生在 charge 后会产生 DEBIT+COMPENSATION 配对（净额不变）。
- **未决小项**：`turbo.json` 是否需显式列新包（Task 3 Step 9 视实际配置处理）；AI 测 `_helpers` 是否存在（Task 5 Step 4 给了 fallback）。
</content>
