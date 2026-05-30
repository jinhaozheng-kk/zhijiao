import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AiRouter, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "pii-redaction.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
  );
}

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "model_calls" RESTART IDENTITY CASCADE;`,
  );
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "prompt_templates" RESTART IDENTITY CASCADE;`,
  );
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("Plan 14c: AI response PII redaction at runJsonTaskWithAudit chokepoint", () => {
  it("redacts a phone number from the parsed output AND the persisted ModelCall.responseJson", async () => {
    // 有效 schema 的 LEARNING_ADVICE 输出，free-text 字段内嵌一个手机号
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          summaryMd: "如有疑问请联系老师 13812345678 进一步沟通。",
          suggestions: [
            { focusKp: "一元一次方程", methodMd: "先合并同类项，再移项求解。" },
          ],
          encouragementMd: "保持练习，方法会越来越熟练。",
        }),
        model: "mock-v1",
      }),
    });

    const router = new AiRouter({ prisma, adapter, userId: "dev-student-01" });

    const out = await router.generateLearningAdvice({
      studentGrade: "G8",
      focusAreas: [{ kpName: "一元一次方程", score: 0.4 }],
      strengths: ["计算"],
    });

    // 1) 解析结果脱敏
    expect(out.summaryMd).toContain("[手机号]");
    expect(out.summaryMd).not.toContain("13812345678");

    // 2) 持久化的 ModelCall.responseJson 脱敏
    const calls = await prisma.modelCall.findMany({
      orderBy: { createdAt: "desc" },
    });
    expect(calls.length).toBeGreaterThan(0);
    const responseJson = calls[0]!.responseJson as { content?: string } | null;
    const persistedContent = responseJson?.content ?? "";
    expect(persistedContent).toContain("[手机号]");
    expect(persistedContent).not.toContain("13812345678");
  });
});
