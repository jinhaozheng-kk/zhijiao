import { PrismaClient } from "@prisma/client";

// Per-package test DB: each vitest.config.ts injects its own DATABASE_URL via
// `test.env`. We fail-close instead of falling back, otherwise a missing config
// would silently point every package at the same legacy `zhijiao_test` DB and
// re-introduce the cross-package TRUNCATE race that Task -1 fixed.
const TEST_DATABASE_URL = process.env.DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error(
    "@zhijiao/db/test-utils: DATABASE_URL is not set. " +
      "Vitest config must inject it via `test.env.DATABASE_URL` " +
      "(see plan §Task -1 / packages/<pkg>/vitest.config.ts).",
  );
}

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

// Alias so consumers can `import { prisma, resetDb } from "@zhijiao/db/test-utils"`
export const prisma = testPrisma;

// 截断所有表（保留 schema），按依赖反向顺序
export async function resetDb() {
  const tables = [
    "model_calls",
    "prompt_templates",
    "question_kp_links",
    "question_answers",
    "questions",
    "knowledge_points",
    "subjects",
    "otp_requests",
    "sessions",
    "auth_identities",
    "user_roles",
    "users",
  ];
  for (const t of tables) {
    await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE;`);
  }
}
