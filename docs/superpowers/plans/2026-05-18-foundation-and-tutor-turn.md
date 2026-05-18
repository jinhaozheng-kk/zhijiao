# 智教 · Foundation + TUTOR_TURN 端到端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 pnpm + Turborepo monorepo 骨架，落地 Prisma 数据模型（Identity / Curriculum / Question Bank / AI Audit 四个模块），实现 `packages/ai` 的 router + DashScope 适配 + tutoring prompt v1，最终在 `apps/web` 上有一个能在浏览器里粘贴题目→收到结构化讲解的端到端可跑通页面。

**Architecture:** TypeScript 全栈 monorepo，Next.js 14 App Router + Server Actions 直连 `packages/ai` 单入口 `callModel`。AI 调用全量同步写入 `ModelCall` 审计表（spec 强制）。Prompt 文件化 + DB 懒同步指纹。测试用 Vitest（单元 + 集成）+ Playwright（E2E），所有 LLM 在测试中 mock。

**Tech Stack:** pnpm 9 / Turborepo 2 / TypeScript 5 / Next.js 14 / Prisma 5 / PostgreSQL 16 (Docker) / Zod / DashScope SDK (通义千问) / Vitest 1 / Playwright 1 / Tailwind 3

---

## 范围与不在范围

**本 plan 做**：
- 仓库脚手架（workspace、turbo、tsconfig、env、docker-compose）
- 4 个 Prisma 模型模块 + 迁移 + seed（含初中数学 1 学科、5 个测试用户、10 道样题）
- `packages/domain` 的 RBAC 枚举 + 合规常量（最小集，后续扩展）
- `packages/ai` 完整骨架：tasks 枚举 / Zod schemas / prompt registry / DashScope adapter / 带审计与重试的 router
- `apps/web` 最小可用：landing + tutor 页面 + server action 调 AI + Playwright E2E（mock AI）

**本 plan 不做**（留给后续 plan）：
- 真实鉴权（手机号 OTP / 微信登录 / Session 表 / JWT）—— 当前用硬编码 dev 用户
- Credit 计费体系（CreditAccount / Reservation / Subscription / Order）
- tRPC（用 server action 已足够 TUTOR_TURN；tRPC 留到第二个 procedure 出现时引入）
- RAG（QuestionEmbedding 表暂留空、不接 pgvector）
- 变式生成、错因分析、出卷、预测中心
- `apps/admin`、运营后台
- 微信/支付宝/OSS/SMS 集成
- 部署、ICP、CI/CD
- LLM eval harness

---

## File Structure（本 plan 涉及到的所有新建文件）

```
D:\智教\
├── pnpm-workspace.yaml                              # 任务 1
├── package.json                                     # 任务 1
├── turbo.json                                       # 任务 1
├── tsconfig.base.json                               # 任务 1
├── .nvmrc                                           # 任务 1
├── .npmrc                                           # 任务 1
├── .env.example                                     # 任务 1
├── docker-compose.yml                               # 任务 2
├── README.md                                        # 任务 17（新增）
│
├── packages/
│   ├── db/                                          # 任务 3-5
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/seed/index.ts
│   │   ├── prisma/seed/0_curriculum.ts
│   │   ├── prisma/seed/1_test_users.ts
│   │   ├── prisma/seed/2_questions.ts
│   │   ├── src/index.ts                             # 导出 Prisma client + 类型
│   │   ├── src/test-utils.ts                        # 测试 DB 重置 + truncate helpers
│   │   └── tests/identity.test.ts                   # schema 冒烟测试
│   │
│   ├── domain/                                      # 任务 6-7
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/index.ts
│   │   ├── src/rbac.ts
│   │   ├── src/compliance.ts
│   │   ├── tests/rbac.test.ts
│   │   └── tests/compliance.test.ts
│   │
│   └── ai/                                          # 任务 8-12
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/index.ts
│       ├── src/tasks.ts                             # TaskKind + model 映射
│       ├── src/schemas.ts                           # Zod schema: TutoringOutput 等
│       ├── src/registry.ts                          # prompt 加载 + 指纹 + DB 同步
│       ├── src/adapters/dashscope.ts                # 真实适配器
│       ├── src/adapters/mock.ts                     # 测试用 mock 适配器
│       ├── src/router.ts                            # callModel 单入口（含审计 + 重试）
│       ├── src/audit.ts                             # ModelCall 写入 helper
│       ├── src/prompts/tutoring/v1.md
│       ├── tests/router.test.ts
│       └── tests/registry.test.ts
│
└── apps/
    └── web/                                         # 任务 13-16
        ├── package.json
        ├── tsconfig.json
        ├── next.config.mjs
        ├── tailwind.config.ts
        ├── postcss.config.mjs
        ├── playwright.config.ts
        ├── app/layout.tsx
        ├── app/page.tsx                             # landing
        ├── app/globals.css
        ├── app/(student)/tutor/page.tsx             # tutor UI
        ├── app/(student)/tutor/actions.ts           # server action
        ├── components/TutorForm.tsx
        └── e2e/tutor.spec.ts
```

---

## 前置：环境检查

执行 plan 前在 shell 里验证：

```bash
node --version    # 期望 >= 20.0.0
pnpm --version    # 期望 >= 9.0.0
docker --version  # 期望 Docker Desktop 在运行
git --version
```

如果 pnpm 缺失：`npm i -g pnpm@9`

---

## 任务 1：仓库骨架（pnpm + Turborepo + tsconfig + env）

**Files:**
- Create: `D:\智教\pnpm-workspace.yaml`
- Create: `D:\智教\package.json`
- Create: `D:\智教\turbo.json`
- Create: `D:\智教\tsconfig.base.json`
- Create: `D:\智教\.nvmrc`
- Create: `D:\智教\.npmrc`
- Create: `D:\智教\.env.example`

- [ ] **步骤 1.1：创建 `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **步骤 1.2：创建根 `package.json`**

```json
{
  "name": "zhijiao",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "test:e2e": "turbo test:e2e",
    "db:migrate": "pnpm --filter @zhijiao/db db:migrate",
    "db:seed": "pnpm --filter @zhijiao/db db:seed",
    "db:studio": "pnpm --filter @zhijiao/db db:studio",
    "setup": "cp .env.example .env.local && docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "prettier": "^3.2.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

- [ ] **步骤 1.3：创建 `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:e2e": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **步骤 1.4：创建 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **步骤 1.5：创建 `.nvmrc`**

```
20
```

- [ ] **步骤 1.6：创建 `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **步骤 1.7：创建 `.env.example`**

```
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zhijiao
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/zhijiao_test

# DashScope (通义千问)
DASHSCOPE_API_KEY=sk-xxx-replace-me
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Dev fallback：本地开发未配 DashScope key 时，是否用 mock adapter
AI_USE_MOCK=false

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEV_USER_ID=dev-student-01
```

- [ ] **步骤 1.8：运行 `pnpm install` 验证骨架**

```bash
cd D:\智教 && pnpm install
```

期望：无错误，生成 `pnpm-lock.yaml` 和 `node_modules/`，输出 `Done` 字样。

- [ ] **步骤 1.9：提交**

```bash
git add pnpm-workspace.yaml package.json turbo.json tsconfig.base.json .nvmrc .npmrc .env.example pnpm-lock.yaml
git commit -m "chore: monorepo skeleton (pnpm + turborepo + base tsconfig)"
```

---

## 任务 2：本地依赖（Docker Compose：PostgreSQL）

**Files:**
- Create: `D:\智教\docker-compose.yml`

- [ ] **步骤 2.1：创建 `docker-compose.yml`**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: zhijiao-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: zhijiao
    ports:
      - "5432:5432"
    volumes:
      - zhijiao-pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  zhijiao-pgdata:
```

- [ ] **步骤 2.2：创建 `docker/postgres-init/01-create-test-db.sql`**

```sql
CREATE DATABASE zhijiao_test;
```

- [ ] **步骤 2.3：启动并验证**

```bash
docker compose up -d
docker compose ps
```

期望：`zhijiao-postgres` 状态为 `running (healthy)`。

```bash
docker exec zhijiao-postgres psql -U postgres -c "\l" | grep zhijiao
```

期望输出两行：`zhijiao` 和 `zhijiao_test`。

- [ ] **步骤 2.4：提交**

```bash
git add docker-compose.yml docker/postgres-init/01-create-test-db.sql
git commit -m "chore: docker-compose with pgvector-enabled postgres + test db"
```

---

## 任务 3：`packages/db` 初始化与 Prisma schema

**Files:**
- Create: `D:\智教\packages\db\package.json`
- Create: `D:\智教\packages\db\tsconfig.json`
- Create: `D:\智教\packages\db\prisma\schema.prisma`
- Create: `D:\智教\packages\db\src\index.ts`

- [ ] **步骤 3.1：创建 `packages/db/package.json`**

```json
{
  "name": "@zhijiao/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed/index.ts",
    "db:studio": "prisma studio",
    "db:generate": "prisma generate",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@prisma/client": "^5.18.0"
  },
  "devDependencies": {
    "prisma": "^5.18.0",
    "vitest": "^1.6.0",
    "tsx": "^4.16.0",
    "typescript": "^5.4.0"
  },
  "prisma": {
    "seed": "tsx prisma/seed/index.ts"
  }
}
```

- [ ] **步骤 3.2：创建 `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src", "prisma", "tests"]
}
```

- [ ] **步骤 3.3：创建完整 `packages/db/prisma/schema.prisma`**

```prisma
// 智教 数据模型 - Plan 1 范围
// 模块分组：Identity / Curriculum / Question Bank / AI Audit
// 后续 plan 会扩展：Learning Records / Teacher Artifacts / Forecast / Credit / Content

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector")]
}

// === Identity ===

enum Role {
  STUDENT
  TEACHER
  PARENT
  OPS
  ADMIN
}

model User {
  id              String     @id @default(cuid())
  phone           String?    @unique
  wechatOpenid    String?    @unique @map("wechat_openid")
  wechatUnionid   String?    @map("wechat_unionid")
  email           String?    @unique
  name            String?
  avatarUrl       String?    @map("avatar_url")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  roles           UserRole[]

  @@map("users")
}

model UserRole {
  userId    String   @map("user_id")
  role      Role
  createdAt DateTime @default(now()) @map("created_at")

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, role])
  @@map("user_roles")
}

// === Curriculum ===

enum GradeLevel {
  G5
  G6
  G7
  G8
  G9
  G10
  G11
  G12
}

model Subject {
  id        String           @id @default(cuid())
  code      String           @unique         // "math", "chinese", "english"
  name      String                          // "数学", "语文", "英语"
  createdAt DateTime         @default(now()) @map("created_at")

  knowledgePoints KnowledgePoint[]
  questions       Question[]

  @@map("subjects")
}

model KnowledgePoint {
  id          String           @id @default(cuid())
  subjectId   String           @map("subject_id")
  code        String                          // 全学科唯一编码，如 "math-g8-linear-eq-01"
  name        String
  description String?
  difficulty  Int              @default(3)    // 1-5
  parentId    String?          @map("parent_id")
  createdAt   DateTime         @default(now()) @map("created_at")

  subject     Subject          @relation(fields: [subjectId], references: [id])
  parent      KnowledgePoint?  @relation("KPTree", fields: [parentId], references: [id])
  children    KnowledgePoint[] @relation("KPTree")
  questions   QuestionKPLink[]

  @@unique([subjectId, code])
  @@map("knowledge_points")
}

// === Question Bank ===

enum QuestionType {
  SINGLE_CHOICE
  MULTI_CHOICE
  FILL_BLANK
  CALCULATION
  PROOF
  ESSAY
}

enum QuestionStatus {
  DRAFT
  REVIEW
  PUBLISHED
  RETIRED
}

model Question {
  id             String           @id @default(cuid())
  subjectId      String           @map("subject_id")
  stemMd         String           @map("stem_md")
  stemImageKeys  String[]         @default([]) @map("stem_image_keys")  // OSS object keys
  type           QuestionType
  difficulty     Int              @default(3)                            // 1-5
  status         QuestionStatus   @default(DRAFT)
  source         String?                                                  // "自有" / "公开-人教版" / etc.
  createdAt      DateTime         @default(now()) @map("created_at")
  updatedAt      DateTime         @updatedAt @map("updated_at")

  subject        Subject          @relation(fields: [subjectId], references: [id])
  answer         QuestionAnswer?
  knowledgePoints QuestionKPLink[]

  @@map("questions")
}

model QuestionAnswer {
  questionId  String   @id @map("question_id")
  contentMd   String   @map("content_md")      // 答案
  solutionMd  String   @map("solution_md")     // 解析

  question    Question @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@map("question_answers")
}

model QuestionKPLink {
  questionId String         @map("question_id")
  kpId       String         @map("kp_id")
  weight     Float          @default(1.0)

  question   Question       @relation(fields: [questionId], references: [id], onDelete: Cascade)
  kp         KnowledgePoint @relation(fields: [kpId], references: [id], onDelete: Cascade)

  @@id([questionId, kpId])
  @@map("question_kp_links")
}

// === AI Audit ===

enum ModelCallStatus {
  SUCCESS
  PARSE_FAILED
  ADAPTER_ERROR
  TIMEOUT
}

model PromptTemplate {
  id          String       @id @default(cuid())
  name        String                      // 如 "tutoring"
  version     String                      // 如 "v1"
  body        String       @db.Text       // 完整 prompt 文本
  fingerprint String       @unique         // SHA-256，用于检测漂移
  createdAt   DateTime     @default(now()) @map("created_at")
  retiredAt   DateTime?    @map("retired_at")

  modelCalls  ModelCall[]

  @@unique([name, version])
  @@map("prompt_templates")
}

model ModelCall {
  id               String           @id @default(cuid())
  taskKind         String           @map("task_kind")            // TaskKind enum 字符串值
  promptTemplateId String?          @map("prompt_template_id")
  model            String                                          // "qwen-plus" / "qwen-turbo" / "mock-v1"
  requestJson      Json             @map("request_json")
  responseJson     Json?            @map("response_json")
  latencyMs        Int?             @map("latency_ms")
  tokensIn         Int?             @map("tokens_in")
  tokensOut        Int?             @map("tokens_out")
  status           ModelCallStatus
  errorMessage     String?          @map("error_message")
  userId           String?          @map("user_id")                // 暂用字符串引用，不强制外键（dev user）
  createdAt        DateTime         @default(now()) @map("created_at")

  promptTemplate   PromptTemplate?  @relation(fields: [promptTemplateId], references: [id])

  @@index([taskKind, createdAt])
  @@index([userId, createdAt])
  @@map("model_calls")
}
```

- [ ] **步骤 3.4：创建 `packages/db/src/index.ts`**

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// 类型导出（让消费者不必直接依赖 @prisma/client）
export type {
  User,
  UserRole,
  Subject,
  KnowledgePoint,
  Question,
  QuestionAnswer,
  QuestionKPLink,
  PromptTemplate,
  ModelCall,
  Prisma,
} from "@prisma/client";

export { Role, GradeLevel, QuestionType, QuestionStatus, ModelCallStatus } from "@prisma/client";
```

- [ ] **步骤 3.5：安装包内依赖**

```bash
cd D:\智教 && pnpm install
```

期望：`@zhijiao/db` 被识别为 workspace package，`@prisma/client` / `prisma` / `vitest` / `tsx` 装好。

- [ ] **步骤 3.6：生成初始 migration 并应用到 dev DB**

```bash
cd D:\智教\packages\db && pnpm exec prisma migrate dev --name init
```

期望：在 `packages/db/prisma/migrations/<timestamp>_init/migration.sql` 生成迁移文件，dev DB 表全部建好；输出 `Your database is now in sync with your schema.`

- [ ] **步骤 3.7：提交**

```bash
cd D:\智教
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): prisma schema for Identity / Curriculum / QuestionBank / AI Audit"
```

---

## 任务 4：`packages/db` schema 冒烟测试（验证迁移真的能用）

**Files:**
- Create: `D:\智教\packages\db\src\test-utils.ts`
- Create: `D:\智教\packages\db\tests\identity.test.ts`
- Create: `D:\智教\packages\db\vitest.config.ts`

- [ ] **步骤 4.1：创建 `packages/db/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [],
    pool: "forks",                        // Prisma + 进程隔离更稳
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
  },
});
```

- [ ] **步骤 4.2：创建 `packages/db/src/test-utils.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/zhijiao_test";

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

// 截断所有表（保留 schema），按依赖反向顺序
export async function resetDb() {
  // 顺序：依赖方先 truncate
  const tables = [
    "model_calls",
    "prompt_templates",
    "question_kp_links",
    "question_answers",
    "questions",
    "knowledge_points",
    "subjects",
    "user_roles",
    "users",
  ];
  for (const t of tables) {
    await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE;`);
  }
}
```

- [ ] **步骤 4.3：写第一个冒烟测试（先看它失败）**

`packages/db/tests/identity.test.ts`：

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma, resetDb } from "../src/test-utils.js";
import { Role } from "@prisma/client";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("Identity schema", () => {
  it("creates a user with phone + role", async () => {
    const user = await testPrisma.user.create({
      data: {
        phone: "13800000001",
        name: "测试学生",
        roles: { create: [{ role: Role.STUDENT }] },
      },
      include: { roles: true },
    });

    expect(user.id).toBeDefined();
    expect(user.phone).toBe("13800000001");
    expect(user.roles.map((r) => r.role)).toEqual([Role.STUDENT]);
  });

  it("enforces unique phone constraint", async () => {
    await testPrisma.user.create({ data: { phone: "13800000002" } });
    await expect(
      testPrisma.user.create({ data: { phone: "13800000002" } }),
    ).rejects.toThrow();
  });
});
```

- [ ] **步骤 4.4：把迁移先 apply 到测试 DB**

```bash
cd D:\智教\packages\db
DATABASE_URL=$DATABASE_URL_TEST pnpm exec prisma migrate deploy
```

PowerShell 写法（Windows）：

```powershell
cd D:\智教\packages\db
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/zhijiao_test"
pnpm exec prisma migrate deploy
# 然后还原 DATABASE_URL，或开新 shell
```

期望：`zhijiao_test` 库内也建好表。

- [ ] **步骤 4.5：运行测试**

```bash
cd D:\智教\packages\db && pnpm test
```

期望：2 tests passed。

- [ ] **步骤 4.6：提交**

```bash
cd D:\智教
git add packages/db/vitest.config.ts packages/db/src/test-utils.ts packages/db/tests/identity.test.ts
git commit -m "test(db): identity schema smoke test"
```

---

## 任务 5：`packages/db` seed 数据（curriculum + 测试用户 + 样题）

**Files:**
- Create: `D:\智教\packages\db\prisma\seed\index.ts`
- Create: `D:\智教\packages\db\prisma\seed\0_curriculum.ts`
- Create: `D:\智教\packages\db\prisma\seed\1_test_users.ts`
- Create: `D:\智教\packages\db\prisma\seed\2_questions.ts`

- [ ] **步骤 5.1：创建 `packages/db/prisma/seed/0_curriculum.ts`**

```ts
import { PrismaClient } from "@prisma/client";

export async function seedCurriculum(prisma: PrismaClient) {
  // 1 学科：初中数学（math）
  const math = await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });

  // 知识点树（极简：1 个一级 + 3 个二级）
  const linearEq = await prisma.knowledgePoint.upsert({
    where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq" } },
    create: {
      subjectId: math.id,
      code: "math-g8-linear-eq",
      name: "一次方程",
      difficulty: 2,
    },
    update: {},
  });

  for (const child of [
    { code: "math-g8-linear-eq-solve", name: "一次方程求解", difficulty: 2 },
    { code: "math-g8-linear-eq-apply", name: "一次方程应用题", difficulty: 3 },
    { code: "math-g8-linear-eq-system", name: "二元一次方程组", difficulty: 3 },
  ]) {
    await prisma.knowledgePoint.upsert({
      where: { subjectId_code: { subjectId: math.id, code: child.code } },
      create: {
        subjectId: math.id,
        code: child.code,
        name: child.name,
        difficulty: child.difficulty,
        parentId: linearEq.id,
      },
      update: {},
    });
  }

  console.log("✓ Curriculum seeded: 1 subject (math), 4 KPs");
  return { math, linearEq };
}
```

- [ ] **步骤 5.2：创建 `packages/db/prisma/seed/1_test_users.ts`**

```ts
import { PrismaClient, Role } from "@prisma/client";

export async function seedTestUsers(prisma: PrismaClient) {
  const users = [
    { id: "dev-student-01", phone: "13800000001", name: "测试学生", role: Role.STUDENT },
    { id: "dev-teacher-01", phone: "13800000002", name: "测试教师", role: Role.TEACHER },
    { id: "dev-parent-01",  phone: "13800000003", name: "测试家长", role: Role.PARENT },
    { id: "dev-ops-01",     phone: "13800000004", name: "测试运营", role: Role.OPS },
    { id: "dev-admin-01",   phone: "13800000005", name: "测试管理员", role: Role.ADMIN },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        phone: u.phone,
        name: u.name,
        roles: { create: [{ role: u.role }] },
      },
      update: { name: u.name },
    });
  }

  console.log(`✓ Test users seeded: ${users.length}`);
}
```

- [ ] **步骤 5.3：创建 `packages/db/prisma/seed/2_questions.ts`**

```ts
import { PrismaClient, QuestionType, QuestionStatus } from "@prisma/client";

export async function seedQuestions(prisma: PrismaClient) {
  const math = await prisma.subject.findUniqueOrThrow({ where: { code: "math" } });
  const kpSolve = await prisma.knowledgePoint.findUniqueOrThrow({
    where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq-solve" } },
  });

  const samples = [
    {
      stem: "解方程：2x + 5 = 13",
      answer: "x = 4",
      solution: "两边同减 5 得 2x = 8，两边同除 2 得 x = 4。",
      difficulty: 1,
    },
    {
      stem: "解方程：3(x - 2) = 2x + 1",
      answer: "x = 7",
      solution: "去括号：3x - 6 = 2x + 1，移项 x = 7。",
      difficulty: 2,
    },
    {
      stem: "解方程：(x + 1)/2 - (x - 3)/3 = 1",
      answer: "x = -3",
      solution: "通分两边乘 6：3(x+1) - 2(x-3) = 6，展开 3x+3-2x+6=6，得 x = -3。",
      difficulty: 3,
    },
  ];

  for (const s of samples) {
    const q = await prisma.question.create({
      data: {
        subjectId: math.id,
        stemMd: s.stem,
        type: QuestionType.CALCULATION,
        difficulty: s.difficulty,
        status: QuestionStatus.PUBLISHED,
        source: "自有",
        answer: { create: { contentMd: s.answer, solutionMd: s.solution } },
        knowledgePoints: { create: [{ kpId: kpSolve.id, weight: 1.0 }] },
      },
    });
    console.log(`  ✓ Question ${q.id}: ${s.stem.slice(0, 30)}...`);
  }

  console.log(`✓ ${samples.length} sample questions seeded`);
}
```

- [ ] **步骤 5.4：创建 `packages/db/prisma/seed/index.ts`**

```ts
import { PrismaClient } from "@prisma/client";
import { seedCurriculum } from "./0_curriculum.js";
import { seedTestUsers } from "./1_test_users.js";
import { seedQuestions } from "./2_questions.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");
  await seedCurriculum(prisma);
  await seedTestUsers(prisma);
  await seedQuestions(prisma);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **步骤 5.5：运行 seed**

```bash
cd D:\智教 && pnpm db:seed
```

期望输出（节选）：

```
Seeding database...
✓ Curriculum seeded: 1 subject (math), 4 KPs
✓ Test users seeded: 5
  ✓ Question <id>: 解方程：2x + 5 = 13...
✓ 3 sample questions seeded
Done.
```

重跑一次（验证 idempotent）：

```bash
pnpm db:seed
```

期望：再次成功，不抛 unique constraint 错误（问题表会重复插入；这是已知行为，后续 plan 用 `findFirst + skipDuplicates` 替代）。

⚠️ 实际上 question seed 不 idempotent（每次插入新 row）。本 plan 接受此简单实现，记录到 README「已知限制」。

- [ ] **步骤 5.6：提交**

```bash
cd D:\智教
git add packages/db/prisma/seed
git commit -m "feat(db): seed for curriculum, test users, sample questions"
```

---

## 任务 6：`packages/domain` — RBAC 枚举与角色权限映射

**Files:**
- Create: `D:\智教\packages\domain\package.json`
- Create: `D:\智教\packages\domain\tsconfig.json`
- Create: `D:\智教\packages\domain\src\index.ts`
- Create: `D:\智教\packages\domain\src\rbac.ts`
- Create: `D:\智教\packages\domain\vitest.config.ts`
- Create: `D:\智教\packages\domain\tests\rbac.test.ts`

- [ ] **步骤 6.1：创建 `packages/domain/package.json`**

```json
{
  "name": "@zhijiao/domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **步骤 6.2：创建 `packages/domain/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src", "tests"]
}
```

- [ ] **步骤 6.3：创建 `packages/domain/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { globals: true } });
```

- [ ] **步骤 6.4：写 RBAC 测试（先看它失败）**

`packages/domain/tests/rbac.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, hasPermission } from "../src/rbac.js";

describe("RBAC", () => {
  it("STUDENT can ask", () => {
    expect(ROLE_PERMISSIONS.STUDENT).toContain("STUDENT_ASK");
  });

  it("TEACHER can generate paper but cannot publish forecast", () => {
    expect(ROLE_PERMISSIONS.TEACHER).toContain("TEACHER_GEN_PAPER");
    expect(ROLE_PERMISSIONS.TEACHER).not.toContain("OPS_PUBLISH_FORECAST");
  });

  it("ADMIN has all permissions of OPS", () => {
    for (const perm of ROLE_PERMISSIONS.OPS) {
      expect(ROLE_PERMISSIONS.ADMIN).toContain(perm);
    }
  });

  it("hasPermission returns true when any of user's roles grants it", () => {
    expect(hasPermission(["STUDENT"], "STUDENT_ASK")).toBe(true);
    expect(hasPermission(["STUDENT"], "TEACHER_GEN_PAPER")).toBe(false);
    expect(hasPermission(["STUDENT", "PARENT"], "PARENT_VIEW_CHILD")).toBe(true);
  });
});
```

- [ ] **步骤 6.5：运行测试看失败**

```bash
cd D:\智教\packages\domain && pnpm test
```

期望：FAIL（`Cannot find module '../src/rbac.js'`）。

- [ ] **步骤 6.6：写最小实现 `packages/domain/src/rbac.ts`**

```ts
export type Role = "STUDENT" | "TEACHER" | "PARENT" | "OPS" | "ADMIN";

export type Permission =
  | "STUDENT_ASK"
  | "STUDENT_VIEW_OWN_ERRORS"
  | "STUDENT_VIEW_OWN_PROFILE"
  | "TEACHER_GEN_PAPER"
  | "TEACHER_EXPORT_PAPER"
  | "PARENT_VIEW_CHILD"
  | "OPS_PUBLISH_FORECAST"
  | "OPS_CURATE_CONTENT"
  | "OPS_ADJUST_CREDIT"
  | "ADMIN_MANAGE_USERS"
  | "ADMIN_MANAGE_MODELS"
  | "ADMIN_VIEW_AUDIT";

const OPS_PERMS: Permission[] = ["OPS_PUBLISH_FORECAST", "OPS_CURATE_CONTENT", "OPS_ADJUST_CREDIT"];

const ADMIN_PERMS: Permission[] = [
  ...OPS_PERMS,
  "ADMIN_MANAGE_USERS",
  "ADMIN_MANAGE_MODELS",
  "ADMIN_VIEW_AUDIT",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  STUDENT: ["STUDENT_ASK", "STUDENT_VIEW_OWN_ERRORS", "STUDENT_VIEW_OWN_PROFILE"],
  TEACHER: ["TEACHER_GEN_PAPER", "TEACHER_EXPORT_PAPER"],
  PARENT:  ["PARENT_VIEW_CHILD"],
  OPS:     OPS_PERMS,
  ADMIN:   ADMIN_PERMS,
};

export function hasPermission(roles: Role[], perm: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(perm));
}
```

- [ ] **步骤 6.7：创建 `packages/domain/src/index.ts`**

```ts
export * from "./rbac.js";
```

- [ ] **步骤 6.8：再次运行测试**

```bash
cd D:\智教\packages\domain && pnpm test
```

期望：4 tests passed。

- [ ] **步骤 6.9：提交**

```bash
cd D:\智教
git add packages/domain pnpm-lock.yaml
git commit -m "feat(domain): RBAC role-permission mapping + hasPermission helper"
```

---

## 任务 7：`packages/domain` — 合规常量（合规黑词与表述规则）

**Files:**
- Create: `D:\智教\packages\domain\src\compliance.ts`
- Create: `D:\智教\packages\domain\tests\compliance.test.ts`
- Modify: `D:\智教\packages\domain\src\index.ts`

- [ ] **步骤 7.1：写合规测试（先看它失败）**

`packages/domain/tests/compliance.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { FORBIDDEN_PHRASES, findForbidden, FORECAST_APPROVED_LANGUAGE } from "../src/compliance.js";

describe("Compliance", () => {
  it("forbids 押中原题", () => {
    expect(FORBIDDEN_PHRASES).toContain("押中原题");
  });

  it("forbids 提分保证", () => {
    expect(FORBIDDEN_PHRASES).toContain("保证提分");
  });

  it("findForbidden returns matched phrases in text", () => {
    const text = "我们押中原题的概率达 100%，保证提分。";
    const matches = findForbidden(text);
    expect(matches.sort()).toEqual(["保证提分", "押中原题"].sort());
  });

  it("findForbidden returns empty for compliant text", () => {
    expect(findForbidden("本次趋势研判覆盖主要考点方向。")).toEqual([]);
  });

  it("approved forecast language list includes 趋势研判 and 考点方向分析", () => {
    expect(FORECAST_APPROVED_LANGUAGE).toContain("趋势研判");
    expect(FORECAST_APPROVED_LANGUAGE).toContain("考点方向分析");
  });
});
```

- [ ] **步骤 7.2：运行测试看失败**

```bash
cd D:\智教\packages\domain && pnpm test
```

期望：FAIL（`Cannot find module '../src/compliance.js'`）。

- [ ] **步骤 7.3：写最小实现 `packages/domain/src/compliance.ts`**

```ts
// 合规黑词初稿；运营后台可扩展，但本地常量保留兜底
export const FORBIDDEN_PHRASES: readonly string[] = [
  "押中原题",
  "100% 命中",
  "100%命中",
  "保证提分",
  "保证升学",
  "保证通过",
  "包过",
  "内幕",
  "代做作业",
];

// 命题预测中心的许可表述
export const FORECAST_APPROVED_LANGUAGE: readonly string[] = [
  "趋势研判",
  "考点方向分析",
  "高频考点",
  "考前重点研判",
];

// 给定文本，返回命中的黑词列表（去重 + 去空）
export function findForbidden(text: string): string[] {
  const hits = new Set<string>();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) hits.add(phrase);
  }
  return [...hits];
}
```

- [ ] **步骤 7.4：更新 `packages/domain/src/index.ts`**

```ts
export * from "./rbac.js";
export * from "./compliance.js";
```

- [ ] **步骤 7.5：运行测试**

```bash
cd D:\智教\packages\domain && pnpm test
```

期望：9 tests passed (4 rbac + 5 compliance)。

- [ ] **步骤 7.6：提交**

```bash
cd D:\智教
git add packages/domain/src/compliance.ts packages/domain/src/index.ts packages/domain/tests/compliance.test.ts
git commit -m "feat(domain): compliance forbidden-phrase list + findForbidden helper"
```

---

## 任务 8：`packages/ai` — TaskKind 枚举 + model 映射 + Zod schema

**Files:**
- Create: `D:\智教\packages\ai\package.json`
- Create: `D:\智教\packages\ai\tsconfig.json`
- Create: `D:\智教\packages\ai\vitest.config.ts`
- Create: `D:\智教\packages\ai\src\tasks.ts`
- Create: `D:\智教\packages\ai\src\schemas.ts`

- [ ] **步骤 8.1：创建 `packages/ai/package.json`**

```json
{
  "name": "@zhijiao/ai",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zhijiao/db": "workspace:*",
    "@zhijiao/domain": "workspace:*",
    "@prisma/client": "^5.18.0",
    "zod": "^3.23.0",
    "openai": "^4.50.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
```

> **为什么用 `openai` SDK 调通义千问？** DashScope 提供 OpenAI-compatible endpoint (`https://dashscope.aliyuncs.com/compatible-mode/v1`)，用 OpenAI SDK + 自定义 baseURL 是阿里官方推荐的接入方式，省去自己维护 HTTP 客户端，并和后续可能的多 provider 路由同构。

- [ ] **步骤 8.2：创建 `packages/ai/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src", "tests"]
}
```

- [ ] **步骤 8.3：创建 `packages/ai/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
  },
});
```

- [ ] **步骤 8.4：创建 `packages/ai/src/tasks.ts`**

```ts
export type TaskKind =
  | "TUTOR_TURN"
  | "ERROR_DIAGNOSIS"
  | "VARIANT_L1_GEN"
  | "VARIANT_L2_GEN"
  | "VARIANT_L3_GEN"
  | "PAPER_GEN"
  | "FORECAST_PAPER_GEN"
  | "EMBEDDING";

// spec §1.2 决定的初稿 task→model 映射（router 中可调）
export const TASK_MODEL_MAP: Record<TaskKind, string> = {
  TUTOR_TURN:          "qwen-plus",
  ERROR_DIAGNOSIS:     "qwen-plus",
  VARIANT_L1_GEN:      "qwen-turbo",
  VARIANT_L2_GEN:      "qwen-plus",
  VARIANT_L3_GEN:      "qwen-plus",
  PAPER_GEN:           "qwen-max",
  FORECAST_PAPER_GEN:  "qwen-max",
  EMBEDDING:           "text-embedding-v2",
};
```

- [ ] **步骤 8.5：创建 `packages/ai/src/schemas.ts`**

```ts
import { z } from "zod";

// TUTOR_TURN 的输入与输出契约
export const TutoringInputSchema = z.object({
  questionStem: z.string().min(1).max(4000),
  studentGrade: z.enum(["G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]).optional(),
});
export type TutoringInput = z.infer<typeof TutoringInputSchema>;

// 与 spec §1（产品定位）的「题意 → 关键 KP → 分步思路 → 易错点 → 完整答案」一致
export const TutoringOutputSchema = z.object({
  restatement: z.string().min(1, "题意重述不能为空"),
  knowledgePoints: z.array(z.string()).min(1, "至少标注一个关键知识点"),
  steps: z.array(z.string()).min(1, "至少给出一步思路"),
  pitfalls: z.array(z.string()).default([]),
  finalAnswer: z.string().min(1, "最终答案不能为空"),
});
export type TutoringOutput = z.infer<typeof TutoringOutputSchema>;
```

- [ ] **步骤 8.6：安装并 typecheck**

```bash
cd D:\智教 && pnpm install
cd D:\智教\packages\ai && pnpm typecheck
```

期望：无错误。

- [ ] **步骤 8.7：提交**

```bash
cd D:\智教
git add packages/ai/package.json packages/ai/tsconfig.json packages/ai/vitest.config.ts packages/ai/src/tasks.ts packages/ai/src/schemas.ts pnpm-lock.yaml
git commit -m "feat(ai): TaskKind enum + task→model map + TutoringInput/Output Zod schemas"
```

---

## 任务 9：`packages/ai` — Prompt 文件 + registry（加载 + 指纹 + DB 同步）

**Files:**
- Create: `D:\智教\packages\ai\src\prompts\tutoring\v1.md`
- Create: `D:\智教\packages\ai\src\registry.ts`
- Create: `D:\智教\packages\ai\tests\registry.test.ts`

- [ ] **步骤 9.1：创建 prompt 文件 `packages/ai/src/prompts/tutoring/v1.md`**

```markdown
你是中国 K12 数学（及相关学科）的 AI 学习辅导助手。学生粘贴了一道题目，请按以下结构化方式讲解。

**严格遵守以下原则**：
1. 不要直接给出最终答案——把最终答案放在 `finalAnswer` 字段，让 UI 自行决定是否折叠；正文（thinking/steps）必须以引导为主。
2. 不要使用"押中原题""保证提分"等任何承诺性措辞。
3. 不要替学生完成作业；强调"理解"与"举一反三"。
4. 适龄表达：初中段用题型归类与中考导向；小学段用生活化类比；高中段强调方法迁移。

**输入**：
- 题目文本：{{questionStem}}
- 学段（可选）：{{studentGrade}}

**输出格式**：仅输出 JSON，符合以下 schema：

```json
{
  "restatement": "用一句话重述题意，确认理解",
  "knowledgePoints": ["涉及的关键知识点 1", "涉及的关键知识点 2"],
  "steps": ["第一步思路（引导）", "第二步思路", "..."],
  "pitfalls": ["常见易错点 1", "常见易错点 2"],
  "finalAnswer": "完整解答（含最终结果）"
}
```

**只输出 JSON，不要任何解释性文字、不要 markdown 代码围栏**。
```

- [ ] **步骤 9.2：写 registry 测试（先看它失败）**

`packages/ai/tests/registry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { loadPrompt, fingerprintOf } from "../src/registry.js";

describe("PromptRegistry", () => {
  it("loads tutoring v1 prompt from disk", async () => {
    const p = await loadPrompt("tutoring", "v1");
    expect(p.name).toBe("tutoring");
    expect(p.version).toBe("v1");
    expect(p.body).toContain("中国 K12");
    expect(p.body).toContain("{{questionStem}}");
    expect(p.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprint is stable for identical content", () => {
    expect(fingerprintOf("hello")).toBe(fingerprintOf("hello"));
    expect(fingerprintOf("hello")).not.toBe(fingerprintOf("hello "));
  });

  it("interpolates {{var}} placeholders", async () => {
    const p = await loadPrompt("tutoring", "v1");
    const filled = p.interpolate({ questionStem: "解 2x+5=13", studentGrade: "G8" });
    expect(filled).toContain("解 2x+5=13");
    expect(filled).toContain("G8");
    expect(filled).not.toContain("{{questionStem}}");
  });

  it("throws when an interpolation variable is missing", async () => {
    const p = await loadPrompt("tutoring", "v1");
    expect(() => p.interpolate({ questionStem: "x" } as never)).toThrow(/studentGrade/);
  });
});
```

- [ ] **步骤 9.3：运行测试看失败**

```bash
cd D:\智教\packages\ai && pnpm test
```

期望：FAIL。

- [ ] **步骤 9.4：写最小实现 `packages/ai/src/registry.ts`**

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "prompts");

export function fingerprintOf(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface LoadedPrompt {
  name: string;
  version: string;
  body: string;
  fingerprint: string;
  interpolate(vars: Record<string, string | undefined>): string;
}

const cache = new Map<string, LoadedPrompt>();

export async function loadPrompt(name: string, version: string): Promise<LoadedPrompt> {
  const key = `${name}@${version}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const path = join(PROMPTS_DIR, name, `${version}.md`);
  const body = await readFile(path, "utf8");
  const fingerprint = fingerprintOf(body);

  const prompt: LoadedPrompt = {
    name,
    version,
    body,
    fingerprint,
    interpolate(vars) {
      return body.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
        const v = vars[varName];
        if (v === undefined || v === null) {
          throw new Error(`Prompt ${name}@${version} missing variable: ${varName}`);
        }
        return String(v);
      });
    },
  };

  cache.set(key, prompt);
  return prompt;
}

// 把 prompt 同步到 DB 表 PromptTemplate，幂等
import type { PrismaClient } from "@prisma/client";

export async function ensurePromptInDb(
  prisma: PrismaClient,
  prompt: LoadedPrompt,
): Promise<string> {
  const existing = await prisma.promptTemplate.findUnique({
    where: { name_version: { name: prompt.name, version: prompt.version } },
  });
  if (existing && existing.fingerprint === prompt.fingerprint) return existing.id;

  const upserted = await prisma.promptTemplate.upsert({
    where: { name_version: { name: prompt.name, version: prompt.version } },
    create: {
      name: prompt.name,
      version: prompt.version,
      body: prompt.body,
      fingerprint: prompt.fingerprint,
    },
    update: {
      body: prompt.body,
      fingerprint: prompt.fingerprint,
    },
  });
  return upserted.id;
}
```

- [ ] **步骤 9.5：让 vitest 能解析 prompt 文件路径——配置 vitest 的 resolve 与运行行为**

不需要额外配置：`import.meta.url` 在 Vitest 下解析正确，prompt 文件随 `src/prompts/...` 被 fs 读到。

- [ ] **步骤 9.6：运行测试**

```bash
cd D:\智教\packages\ai && pnpm test
```

期望：4 tests passed。

- [ ] **步骤 9.7：提交**

```bash
cd D:\智教
git add packages/ai/src/prompts packages/ai/src/registry.ts packages/ai/tests/registry.test.ts
git commit -m "feat(ai): prompt registry with fingerprint + interpolation + DB upsert"
```

---

## 任务 10：`packages/ai` — DashScope 真适配器 + mock 适配器

**Files:**
- Create: `D:\智教\packages\ai\src\adapters\dashscope.ts`
- Create: `D:\智教\packages\ai\src\adapters\mock.ts`
- Create: `D:\智教\packages\ai\src\adapters\types.ts`

- [ ] **步骤 10.1：创建 adapter 公共类型 `packages/ai/src/adapters/types.ts`**

```ts
export interface AdapterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AdapterRequest {
  model: string;
  messages: AdapterMessage[];
  responseFormat?: "json_object" | "text";
  temperature?: number;
}

export interface AdapterResponse {
  content: string;             // 模型输出（JSON 字符串或纯文本）
  tokensIn?: number;
  tokensOut?: number;
  model: string;               // 实际使用的模型名
}

export interface ModelAdapter {
  name: string;
  call(req: AdapterRequest): Promise<AdapterResponse>;
}
```

- [ ] **步骤 10.2：创建真适配器 `packages/ai/src/adapters/dashscope.ts`**

```ts
import OpenAI from "openai";
import type { ModelAdapter, AdapterRequest, AdapterResponse } from "./types.js";

export class DashScopeAdapter implements ModelAdapter {
  name = "dashscope";
  private client: OpenAI;

  constructor(opts: { apiKey?: string; baseURL?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY is required for DashScopeAdapter");
    this.client = new OpenAI({
      apiKey,
      baseURL:
        opts.baseURL ??
        process.env.DASHSCOPE_BASE_URL ??
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
  }

  async call(req: AdapterRequest): Promise<AdapterResponse> {
    const resp = await this.client.chat.completions.create({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      response_format:
        req.responseFormat === "json_object" ? { type: "json_object" } : undefined,
    });

    const choice = resp.choices[0];
    if (!choice?.message?.content) {
      throw new Error("DashScope returned no content");
    }
    return {
      content: choice.message.content,
      tokensIn: resp.usage?.prompt_tokens,
      tokensOut: resp.usage?.completion_tokens,
      model: resp.model,
    };
  }
}
```

- [ ] **步骤 10.3：创建 mock 适配器 `packages/ai/src/adapters/mock.ts`**

```ts
import type { ModelAdapter, AdapterRequest, AdapterResponse } from "./types.js";

export class MockAdapter implements ModelAdapter {
  name = "mock";

  constructor(
    private opts: {
      // 测试可注入指定响应；否则返回符合 TutoringOutput 的占位 JSON
      respondWith?: (req: AdapterRequest) => Promise<AdapterResponse> | AdapterResponse;
    } = {},
  ) {}

  async call(req: AdapterRequest): Promise<AdapterResponse> {
    if (this.opts.respondWith) return this.opts.respondWith(req);
    const fakeTutoring = {
      restatement: "求解一元一次方程。",
      knowledgePoints: ["一次方程求解"],
      steps: ["把常数移到等号一边", "两边同除以未知数系数"],
      pitfalls: ["注意符号"],
      finalAnswer: "x = 4",
    };
    return {
      content: JSON.stringify(fakeTutoring),
      tokensIn: 100,
      tokensOut: 80,
      model: "mock-v1",
    };
  }
}
```

- [ ] **步骤 10.4：typecheck**

```bash
cd D:\智教\packages\ai && pnpm typecheck
```

期望：无错误。

- [ ] **步骤 10.5：提交**

```bash
cd D:\智教
git add packages/ai/src/adapters
git commit -m "feat(ai): adapters: DashScope (OpenAI-compatible) + MockAdapter for tests"
```

---

## 任务 11：`packages/ai` — router 单入口（含审计 + JSON 重试）

**Files:**
- Create: `D:\智教\packages\ai\src\audit.ts`
- Create: `D:\智教\packages\ai\src\router.ts`
- Create: `D:\智教\packages\ai\src\index.ts`

- [ ] **步骤 11.1：创建审计 helper `packages/ai/src/audit.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { Prisma, ModelCallStatus } from "@prisma/client";
import type { AdapterRequest, AdapterResponse } from "./adapters/types.js";

export interface AuditWriteInput {
  taskKind: string;
  promptTemplateId: string | null;
  request: AdapterRequest;
  response: AdapterResponse | null;
  latencyMs: number;
  status: ModelCallStatus;
  errorMessage: string | null;
  userId: string | null;
}

export async function writeAudit(prisma: PrismaClient, input: AuditWriteInput): Promise<string> {
  const row = await prisma.modelCall.create({
    data: {
      taskKind:         input.taskKind,
      promptTemplateId: input.promptTemplateId,
      model:            input.response?.model ?? input.request.model,
      requestJson:      input.request as unknown as Prisma.InputJsonValue,
      responseJson:     input.response
        ? (input.response as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      latencyMs:        input.latencyMs,
      tokensIn:         input.response?.tokensIn,
      tokensOut:        input.response?.tokensOut,
      status:           input.status,
      errorMessage:     input.errorMessage,
      userId:           input.userId,
    },
  });
  return row.id;
}
```

> **Note**: `Prisma.JsonNull` is the explicit "null in JSON column" value (distinct from `null` which Prisma reads as "leave unset"). Required because `responseJson` is a nullable JSON column.

- [ ] **步骤 11.2：创建 router `packages/ai/src/router.ts`**

```ts
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { ModelCallStatus } from "@prisma/client";
import type { ModelAdapter } from "./adapters/types.js";
import { TASK_MODEL_MAP, type TaskKind } from "./tasks.js";
import { TutoringInputSchema, TutoringOutputSchema, type TutoringOutput } from "./schemas.js";
import { loadPrompt, ensurePromptInDb } from "./registry.js";
import { writeAudit } from "./audit.js";

export interface RouterOptions {
  prisma: PrismaClient;
  adapter: ModelAdapter;
  userId?: string | null;        // 后续真鉴权落地后由调用方传入
  modelOverride?: string;        // 测试或 A/B 时覆盖
  promptVersion?: string;        // 默认 "v1"
}

export class AiRouter {
  constructor(private opts: RouterOptions) {}

  async tutor(input: unknown): Promise<TutoringOutput> {
    const parsed = TutoringInputSchema.parse(input);
    const taskKind: TaskKind = "TUTOR_TURN";
    const prompt = await loadPrompt("tutoring", this.opts.promptVersion ?? "v1");
    const promptTemplateId = await ensurePromptInDb(this.opts.prisma, prompt);

    const userContent = prompt.interpolate({
      questionStem: parsed.questionStem,
      studentGrade: parsed.studentGrade ?? "G8",
    });

    const model = this.opts.modelOverride ?? TASK_MODEL_MAP[taskKind];
    const request = {
      model,
      messages: [
        { role: "system" as const, content: "你是严谨、面向中国 K12 的数学辅导助手。" },
        { role: "user" as const, content: userContent },
      ],
      responseFormat: "json_object" as const,
      temperature: 0.3,
    };

    const start = Date.now();
    let response = null as Awaited<ReturnType<typeof this.opts.adapter.call>> | null;
    let parseAttempts = 0;
    let lastError: unknown = null;

    // JSON 解析最多重试 2 次（spec §3.4: retry-on-JSON-parse-fail）
    while (parseAttempts < 3) {
      try {
        response = await this.opts.adapter.call(request);
        const json = JSON.parse(response.content);
        const validated = TutoringOutputSchema.parse(json);

        await writeAudit(this.opts.prisma, {
          taskKind,
          promptTemplateId,
          request,
          response,
          latencyMs: Date.now() - start,
          status: ModelCallStatus.SUCCESS,
          errorMessage: null,
          userId: this.opts.userId ?? null,
        });

        return validated;
      } catch (e) {
        lastError = e;
        parseAttempts++;
        if (e instanceof z.ZodError || e instanceof SyntaxError) {
          // 解析失败：再来一次；告诉模型「上次输出不是合法 JSON」
          request.messages.push({
            role: "user",
            content: "上次输出不是符合 schema 的 JSON，请重新只输出 JSON。",
          });
          continue;
        }
        // 适配器层错误，直接走审计 + 抛
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

    // 用尽重试都解析失败
    await writeAudit(this.opts.prisma, {
      taskKind,
      promptTemplateId,
      request,
      response,
      latencyMs: Date.now() - start,
      status: ModelCallStatus.PARSE_FAILED,
      errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
      userId: this.opts.userId ?? null,
    });
    throw new Error(
      `TUTOR_TURN failed after ${parseAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
```

- [ ] **步骤 11.3：创建 `packages/ai/src/index.ts`**

```ts
export { AiRouter, type RouterOptions } from "./router.js";
export { DashScopeAdapter } from "./adapters/dashscope.js";
export { MockAdapter } from "./adapters/mock.js";
export type { ModelAdapter, AdapterRequest, AdapterResponse } from "./adapters/types.js";
export { TASK_MODEL_MAP, type TaskKind } from "./tasks.js";
export {
  TutoringInputSchema,
  TutoringOutputSchema,
  type TutoringInput,
  type TutoringOutput,
} from "./schemas.js";
```

- [ ] **步骤 11.4：typecheck**

```bash
cd D:\智教\packages\ai && pnpm typecheck
```

期望：无错误。

- [ ] **步骤 11.5：提交**

```bash
cd D:\智教
git add packages/ai/src/audit.ts packages/ai/src/router.ts packages/ai/src/index.ts
git commit -m "feat(ai): AiRouter.tutor with synchronous ModelCall audit + JSON-parse retry"
```

---

## 任务 12：`packages/ai` — Router 集成测试（mock adapter 走完审计）

**Files:**
- Create: `D:\智教\packages\ai\tests\router.test.ts`

- [ ] **步骤 12.1：写 router 集成测试**

`packages/ai/tests/router.test.ts`：

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, MockAdapter } from "../src/index.js";

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/zhijiao_test";

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "model_calls" RESTART IDENTITY CASCADE;`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "prompt_templates" RESTART IDENTITY CASCADE;`);
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("AiRouter.tutor", () => {
  it("happy path: returns parsed TutoringOutput and writes a SUCCESS ModelCall", async () => {
    const router = new AiRouter({ prisma, adapter: new MockAdapter(), userId: "dev-student-01" });

    const out = await router.tutor({ questionStem: "解 2x+5=13", studentGrade: "G8" });

    expect(out.restatement).toBeDefined();
    expect(out.knowledgePoints.length).toBeGreaterThan(0);
    expect(out.steps.length).toBeGreaterThan(0);
    expect(out.finalAnswer).toBeDefined();

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
    expect(calls[0]!.taskKind).toBe("TUTOR_TURN");
    expect(calls[0]!.userId).toBe("dev-student-01");

    const templates = await prisma.promptTemplate.findMany();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.name).toBe("tutoring");
    expect(templates[0]!.version).toBe("v1");
  });

  it("retries on invalid JSON and eventually fails with PARSE_FAILED audit", async () => {
    let count = 0;
    const adapter = new MockAdapter({
      respondWith: async () => {
        count++;
        return { content: "this is not json", model: "mock-v1", tokensIn: 1, tokensOut: 1 };
      },
    });
    const router = new AiRouter({ prisma, adapter });

    await expect(router.tutor({ questionStem: "x" })).rejects.toThrow(/failed after/);
    expect(count).toBe(3);

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.PARSE_FAILED);
  });

  it("retries on schema mismatch and succeeds on second try", async () => {
    let count = 0;
    const adapter = new MockAdapter({
      respondWith: async () => {
        count++;
        if (count === 1) {
          return { content: JSON.stringify({ wrong: "shape" }), model: "mock-v1" };
        }
        return {
          content: JSON.stringify({
            restatement: "ok",
            knowledgePoints: ["kp"],
            steps: ["step"],
            pitfalls: [],
            finalAnswer: "x=1",
          }),
          model: "mock-v1",
        };
      },
    });

    const router = new AiRouter({ prisma, adapter });
    const out = await router.tutor({ questionStem: "x" });
    expect(out.finalAnswer).toBe("x=1");
    expect(count).toBe(2);

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
  });

  it("validates input via Zod", async () => {
    const router = new AiRouter({ prisma, adapter: new MockAdapter() });
    await expect(router.tutor({ questionStem: "" })).rejects.toThrow();
  });
});
```

- [ ] **步骤 12.2：运行测试看通过**

```bash
cd D:\智教\packages\ai && pnpm test
```

期望：4 router 测试 + 4 registry 测试 = 8 tests passed。

⚠️ 如果失败：检查测试 DB 是否已 apply 当前 schema（任务 4.4 已 deploy 过；schema 改了之后要重 deploy）。

- [ ] **步骤 12.3：提交**

```bash
cd D:\智教
git add packages/ai/tests/router.test.ts
git commit -m "test(ai): integration tests for router happy path / retry / parse fail"
```

---

## 任务 13：`apps/web` — Next.js 14 + Tailwind 初始化

**Files:**
- Create: `D:\智教\apps\web\package.json`
- Create: `D:\智教\apps\web\tsconfig.json`
- Create: `D:\智教\apps\web\next.config.mjs`
- Create: `D:\智教\apps\web\tailwind.config.ts`
- Create: `D:\智教\apps\web\postcss.config.mjs`
- Create: `D:\智教\apps\web\app\layout.tsx`
- Create: `D:\智教\apps\web\app\page.tsx`
- Create: `D:\智教\apps\web\app\globals.css`

- [ ] **步骤 13.1：创建 `apps/web/package.json`**

```json
{
  "name": "@zhijiao/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@zhijiao/ai": "workspace:*",
    "@zhijiao/db": "workspace:*",
    "@zhijiao/domain": "workspace:*",
    "next": "14.2.5",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.5",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **步骤 13.2：创建 `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] },
    "noEmit": true,
    "allowJs": true,
    "verbatimModuleSyntax": false
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **步骤 13.3：创建 `apps/web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
  transpilePackages: ["@zhijiao/ai", "@zhijiao/db", "@zhijiao/domain"],
};

export default nextConfig;
```

- [ ] **步骤 13.4：创建 `apps/web/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

- [ ] **步骤 13.5：创建 `apps/web/postcss.config.mjs`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **步骤 13.6：创建 `apps/web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
```

- [ ] **步骤 13.7：创建 `apps/web/app/layout.tsx`**

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "智教 · AI K12 学习平台",
  description: "一道题，学会一类题。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **步骤 13.8：创建 `apps/web/app/page.tsx`（landing）**

```tsx
import Link from "next/link";

export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">智教</h1>
      <p className="mt-2 text-slate-600">一道题，学会一类题。</p>
      <div className="mt-8">
        <Link
          href="/tutor"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
          data-testid="cta-tutor"
        >
          试问一道题 →
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **步骤 13.9：装包并启动验证**

```bash
cd D:\智教 && pnpm install
cd D:\智教 && pnpm dev
```

期望：terminal 显示 `Local: http://localhost:3000`；浏览器打开能看到「智教 · 一道题，学会一类题」+「试问一道题 →」按钮。

按 `Ctrl+C` 关闭 dev server。

- [ ] **步骤 13.10：提交**

```bash
cd D:\智教
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): next.js 14 + tailwind scaffold + landing page"
```

---

## 任务 14：`apps/web` — Tutor 页面 + Server Action 调 AI

**Files:**
- Create: `D:\智教\apps\web\app\(student)\tutor\page.tsx`
- Create: `D:\智教\apps\web\app\(student)\tutor\actions.ts`
- Create: `D:\智教\apps\web\components\TutorForm.tsx`
- Create: `D:\智教\apps\web\lib\ai-client.ts`

- [ ] **步骤 14.1：创建 AI 客户端工厂 `apps/web/lib/ai-client.ts`**

```ts
import "server-only";
import { AiRouter, DashScopeAdapter, MockAdapter, type ModelAdapter } from "@zhijiao/ai";
import { prisma } from "@zhijiao/db";

function buildAdapter(): ModelAdapter {
  if (process.env.AI_USE_MOCK === "true" || !process.env.DASHSCOPE_API_KEY) {
    return new MockAdapter();
  }
  return new DashScopeAdapter();
}

export function getAiRouter(userId: string | null) {
  return new AiRouter({ prisma, adapter: buildAdapter(), userId });
}

export const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-student-01";
```

- [ ] **步骤 14.2：创建 server action `apps/web/app/(student)/tutor/actions.ts`**

```ts
"use server";

import { getAiRouter, DEV_USER_ID } from "@/lib/ai-client";
import { TutoringInputSchema, type TutoringOutput } from "@zhijiao/ai";

export type TutorActionResult =
  | { ok: true; data: TutoringOutput }
  | { ok: false; error: string };

export async function askTutor(formData: FormData): Promise<TutorActionResult> {
  const raw = {
    questionStem: String(formData.get("questionStem") ?? ""),
    studentGrade: (formData.get("studentGrade") || undefined) as
      | "G5" | "G6" | "G7" | "G8" | "G9" | "G10" | "G11" | "G12" | undefined,
  };

  const parsed = TutoringInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "输入无效" };
  }

  try {
    const router = getAiRouter(DEV_USER_ID);
    const data = await router.tutor(parsed.data);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "调用失败" };
  }
}
```

- [ ] **步骤 14.3：创建 form 组件 `apps/web/components/TutorForm.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { askTutor, type TutorActionResult } from "@/app/(student)/tutor/actions";

export function TutorForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TutorActionResult | null>(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await askTutor(formData);
      setResult(r);
    });
  }

  return (
    <div className="space-y-6">
      <form action={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">题目</span>
          <textarea
            name="questionStem"
            required
            rows={5}
            placeholder="粘贴或输入题目..."
            className="mt-1 block w-full rounded-md border border-slate-300 p-2 font-mono"
            data-testid="input-stem"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">学段</span>
          <select
            name="studentGrade"
            defaultValue="G8"
            className="mt-1 block w-40 rounded-md border border-slate-300 p-2"
            data-testid="input-grade"
          >
            {(["G5","G6","G7","G8","G9","G10","G11","G12"] as const).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          data-testid="submit"
        >
          {pending ? "讲解中..." : "提问"}
        </button>
      </form>

      {result && !result.ok && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800" data-testid="error">
          {result.error}
        </div>
      )}

      {result && result.ok && (
        <article className="space-y-4 rounded-md border border-slate-200 bg-white p-4" data-testid="result">
          <Section title="题意重述">{result.data.restatement}</Section>
          <Section title="涉及知识点">
            <ul className="list-disc pl-5">
              {result.data.knowledgePoints.map((k, i) => (<li key={i}>{k}</li>))}
            </ul>
          </Section>
          <Section title="分步思路">
            <ol className="list-decimal pl-5 space-y-1">
              {result.data.steps.map((s, i) => (<li key={i}>{s}</li>))}
            </ol>
          </Section>
          {result.data.pitfalls.length > 0 && (
            <Section title="易错点">
              <ul className="list-disc pl-5">
                {result.data.pitfalls.map((p, i) => (<li key={i}>{p}</li>))}
              </ul>
            </Section>
          )}
          <details>
            <summary className="cursor-pointer font-medium text-slate-700" data-testid="reveal-answer">
              查看完整答案
            </summary>
            <div className="mt-2 rounded bg-slate-50 p-2 font-mono" data-testid="final-answer">
              {result.data.finalAnswer}
            </div>
          </details>
        </article>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <div className="mt-1 text-slate-700">{children}</div>
    </section>
  );
}
```

- [ ] **步骤 14.4：创建 tutor 页面 `apps/web/app/(student)/tutor/page.tsx`**

```tsx
import { TutorForm } from "@/components/TutorForm";

export default function TutorPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">AI 答疑</h1>
      <p className="mt-1 text-sm text-slate-600">
        粘贴或输入一道题，AI 会先讲思路，再展开完整答案。
      </p>
      <div className="mt-8">
        <TutorForm />
      </div>
    </main>
  );
}
```

- [ ] **步骤 14.5：手动验证（mock 模式）**

设置环境变量启动 dev：

PowerShell：

```powershell
cd D:\智教
$env:AI_USE_MOCK = "true"
pnpm dev
```

打开 `http://localhost:3000`，点「试问一道题」→ 输入「解 2x+5=13」→ 提交 → 应看到结构化讲解（mock 返回的固定内容）。

按 `Ctrl+C` 关闭。

- [ ] **步骤 14.6：提交**

```bash
cd D:\智教
git add "apps/web/app/(student)" apps/web/components apps/web/lib
git commit -m "feat(web): tutor page with server action calling AiRouter"
```

---

## 任务 15：`apps/web` — Playwright E2E 测试（mock AI 模式）

**Files:**
- Create: `D:\智教\apps\web\playwright.config.ts`
- Create: `D:\智教\apps\web\e2e\tutor.spec.ts`

- [ ] **步骤 15.1：创建 Playwright 配置 `apps/web/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,                  // 共享 dev server，避免抢端口
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      AI_USE_MOCK: "true",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

- [ ] **步骤 15.2：写 E2E 测试 `apps/web/e2e/tutor.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test.describe("Tutor flow (mock AI)", () => {
  test("landing → tutor page → submit → see structured result", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "智教" })).toBeVisible();

    await page.getByTestId("cta-tutor").click();
    await expect(page).toHaveURL(/\/tutor$/);

    await page.getByTestId("input-stem").fill("解 2x + 5 = 13");
    await page.getByTestId("input-grade").selectOption("G8");
    await page.getByTestId("submit").click();

    const result = page.getByTestId("result");
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toContainText("题意重述");
    await expect(result).toContainText("涉及知识点");
    await expect(result).toContainText("分步思路");

    // 默认答案折叠，需点开
    await page.getByTestId("reveal-answer").click();
    await expect(page.getByTestId("final-answer")).toBeVisible();
  });

  test("empty input shows validation error", async ({ page }) => {
    await page.goto("/tutor");
    // 不填，直接 submit；浏览器原生 required 会阻拦，所以构造一个空提交：
    // 用 evaluate 强制移除 required，模拟极端用户绕过
    await page.evaluate(() => {
      document.querySelector<HTMLTextAreaElement>('[data-testid="input-stem"]')!.removeAttribute("required");
    });
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("error")).toBeVisible({ timeout: 5_000 });
  });
});
```

- [ ] **步骤 15.3：安装 Playwright 浏览器**

```bash
cd D:\智教\apps\web && pnpm exec playwright install chromium
```

- [ ] **步骤 15.4：跑 E2E**

```bash
cd D:\智教\apps\web && pnpm test:e2e
```

期望：2 tests passed。Playwright 会自动启动 dev server（mock 模式），跑完关闭。

- [ ] **步骤 15.5：提交**

```bash
cd D:\智教
git add apps/web/playwright.config.ts apps/web/e2e
git commit -m "test(web): playwright e2e for tutor flow (mock AI)"
```

---

## 任务 16：DashScope 真调用冒烟（可选，需有效 API key）

**Files:** 无新增

- [ ] **步骤 16.1：准备 DashScope key**

在阿里云控制台 → DashScope → API-KEY 申请一把 key。

把 key 加进 `D:\智教\.env.local`（不要进 git）：

```
DASHSCOPE_API_KEY=sk-<你的真key>
AI_USE_MOCK=false
```

- [ ] **步骤 16.2：手动跑一次真调用**

PowerShell：

```powershell
cd D:\智教
$env:AI_USE_MOCK = "false"
pnpm dev
```

浏览器访问 `http://localhost:3000/tutor`，输入「解一元二次方程 x² - 5x + 6 = 0」，提交。

期望：看到通义千问真实生成的结构化讲解；`packages/db` Studio 里 `model_calls` 表新增一条 `taskKind=TUTOR_TURN`, `status=SUCCESS`, `model=qwen-plus`, 有 token 数。

```bash
cd D:\智教 && pnpm db:studio
```

打开 `http://localhost:5555` 检查 `ModelCall` 表。

- [ ] **步骤 16.3：如果出错**

常见问题：
- `401` → key 错或没开通对应模型权限
- `429` → 限流，等几秒重试
- JSON parse fail → 模型偶尔不严格遵守 JSON 输出；router 已带 2 次重试，若仍失败检查 prompt 是否清晰

无需提交，本任务纯验证。

---

## 任务 17：根 `README.md` 与最终验证

**Files:**
- Create: `D:\智教\README.md`

- [ ] **步骤 17.1：创建 `README.md`**

```markdown
# 智教 · AI K12 学习与教学平台

> 一道题，学会一类题。

## 仓库当前状态

- ✅ Monorepo 骨架（pnpm + Turborepo）
- ✅ Postgres 16 (pgvector) 本地 docker
- ✅ Prisma 数据模型：Identity / Curriculum / Question Bank / AI Audit
- ✅ `packages/domain`：RBAC + 合规黑词
- ✅ `packages/ai`：router + DashScope 适配 + tutoring prompt v1
- ✅ `apps/web`：landing + tutor 页面，端到端可跑通（mock 或真 DashScope）
- ⬜ 真实鉴权（手机号/微信）—— 后续 plan
- ⬜ Credit 计费 —— 后续 plan
- ⬜ 变式生成、错题本、出卷、预测中心 —— 后续 plan
- ⬜ admin app —— 后续 plan
- ⬜ 部署、ICP、CI/CD —— 后续 plan

## 文档

- `CLAUDE.md` —— Claude Code 工作指引
- `需求与架构文档.md` —— 全量需求规格（docx 派生）
- `docs/superpowers/specs/` —— 设计 spec
- `docs/superpowers/plans/` —— 实施 plan

## 本地开发

### 前置依赖
- Node.js 20+ LTS
- pnpm 9+
- Docker Desktop

### 一键启动

```bash
git clone <repo>
cd 智教
pnpm setup          # 复制 .env.example → .env.local + docker compose + db migrate + seed
pnpm dev            # 启动 apps/web (3000)
```

`.env.local` 默认会用 mock AI 适配器；要用真 DashScope，设置 `DASHSCOPE_API_KEY` 并把 `AI_USE_MOCK=false`。

### 测试账号（seed 创建）

| 角色 | id | phone |
|---|---|---|
| 学生 | dev-student-01 | 13800000001 |
| 教师 | dev-teacher-01 | 13800000002 |
| 家长 | dev-parent-01 | 13800000003 |
| 运营 | dev-ops-01 | 13800000004 |
| 管理员 | dev-admin-01 | 13800000005 |

（本 plan 没接真鉴权；server action 默认使用 `DEV_USER_ID` env 指定的学生身份）

### 常用脚本

```bash
pnpm dev                    # 启动所有 app
pnpm test                   # 全量单测 + 集测
pnpm --filter @zhijiao/web test:e2e   # E2E
pnpm db:migrate             # apply 新 migration
pnpm db:seed                # 重 seed
pnpm db:studio              # Prisma Studio 浏览数据
pnpm typecheck              # 全量 TS 检查
```

## 已知限制（Plan 1 范围）
- `pnpm db:seed` 的 question seed 不是 idempotent，重跑会重复插入
- 没有真鉴权；所有用户身份都是硬编码 `dev-student-01`
- 没有 Credit / 订阅 / 支付
- AI 仅实现 TUTOR_TURN；变式生成、错因分析等留待后续
```

- [ ] **步骤 17.2：跑全套验证**

```bash
cd D:\智教
pnpm typecheck                                  # 期望全绿
pnpm test                                       # 期望全绿（db identity + domain rbac + domain compliance + ai registry + ai router）
pnpm --filter @zhijiao/web test:e2e             # 期望 2 tests passed
```

如任一步骤失败：回到对应任务排查。

- [ ] **步骤 17.3：手动烟测 dev server**

```bash
pnpm dev
```

访问 `http://localhost:3000`：landing 显示 → 点击 CTA → /tutor 显示 form → 输入题目 + 提交 → 看到结构化讲解 → 展开「查看完整答案」看到 finalAnswer。

按 `Ctrl+C` 关闭。

- [ ] **步骤 17.4：提交并打 tag**

```bash
git add README.md
git commit -m "docs: README quickstart + plan 1 status"
git tag -a plan-1-complete -m "Foundation + TUTOR_TURN end-to-end"
git log --oneline
```

- [ ] **步骤 17.5：更新 CLAUDE.md 的「开始实现时」节**

把 spec §1.2 的所选技术栈与上面的 npm scripts 填进 `D:\智教\CLAUDE.md` 末尾「开始实现时」一节（替换原占位说明）。具体改法：

```bash
# 用编辑器把 CLAUDE.md 末尾「开始实现时」改写为：
#   ## 开始实现时（已落地）
#   栈：见 docs/superpowers/specs/2026-05-18-tech-stack-and-project-structure-design.md §1.2
#   - 启动开发：pnpm setup && pnpm dev
#   - 测试：pnpm test, pnpm --filter @zhijiao/web test:e2e
#   - 单条测试：pnpm --filter <pkg> test -- <test-file-pattern>
#   - 数据库：pnpm db:migrate, pnpm db:seed, pnpm db:studio
```

提交：

```bash
git add CLAUDE.md
git commit -m "docs(claude): update CLAUDE.md to reflect implemented stack + commands"
```

---

## 完成条件 (Definition of Done)

执行完所有任务后：

1. `pnpm typecheck` 全绿
2. `pnpm test` 全绿（≥ 9 tests across packages：db identity 2 + domain rbac 4 + domain compliance 5 + ai registry 4 + ai router 4 = 19 tests）
3. `pnpm --filter @zhijiao/web test:e2e` 2 tests passed
4. `pnpm dev` 起来后，浏览器走完 landing → tutor → 提问 → 看结构化讲解 → 展开答案 全流程
5. （可选）配 DashScope key 后真调通义千问 → `pnpm db:studio` 看到 `ModelCall` 表有 `SUCCESS` 行
6. git log 有 ~17 个清晰提交（每个任务 1-2 个 commit），plan-1-complete tag 已打
7. `CLAUDE.md` 末尾的「开始实现时」节已更新为已落地状态

## 下一个 plan 候选

- **Plan 2: 真鉴权**——手机号 OTP（阿里云 SMS）+ 微信 H5 OAuth + Session 表 + JWT；引入 tRPC（多 procedure 出现）；server action 替换为 tRPC mutation
- **Plan 3: Credit 计费**——CreditAccount + CreditReservation + 单价表 + 充值订单 + 微信支付沙箱
- **Plan 4: 举一反三 + 错因分析**——VariantGroup + 三阶变式生成 + ErrorBookEntry + 错因分类
