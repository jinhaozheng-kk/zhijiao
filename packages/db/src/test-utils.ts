import { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/zhijiao_test";

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
