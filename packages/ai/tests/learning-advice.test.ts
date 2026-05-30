import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, ComplianceRejectedError, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "learning-advice.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
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

const SAMPLE_INPUT = {
  studentGrade: "G8" as const,
  focusAreas: [{ kpName: "因式分解", score: 0.4 }],
  strengths: ["一元一次方程"],
};

describe("AiRouter.generateLearningAdvice", () => {
  it("happy path: returns validated advice + writes SUCCESS ModelCall(LEARNING_ADVICE)", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          summaryMd: "你在方程方面进步明显。",
          suggestions: [
            { focusKp: "因式分解", methodMd: "先识别公因式再尝试公式法。" },
          ],
          encouragementMd: "保持节奏，继续加油。",
        }),
        model: "mock",
        tokensIn: 1,
        tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter, userId: "dev-student-01" });
    const out = await router.generateLearningAdvice(SAMPLE_INPUT);

    expect(out.suggestions[0]!.focusKp).toBe("因式分解");
    expect(out.modelCallId).toBeTruthy();

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
    expect(calls[0]!.taskKind).toBe("LEARNING_ADVICE");
  });

  it("uses the MockAdapter default advice when no respondWith is injected", async () => {
    const router = new AiRouter({ prisma, adapter: new MockAdapter() });
    const out = await router.generateLearningAdvice(SAMPLE_INPUT);
    expect(out.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(out.summaryMd.length).toBeGreaterThan(0);
  });

  it("throws ComplianceRejectedError when output hits a forbidden phrase", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          summaryMd: "保证提分 30 分。", // 违禁
          suggestions: [{ focusKp: "x", methodMd: "y" }],
          encouragementMd: "z",
        }),
        model: "mock",
        tokensIn: 1,
        tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(
      router.generateLearningAdvice({ focusAreas: [], strengths: [] }),
    ).rejects.toBeInstanceOf(ComplianceRejectedError);
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.COMPLIANCE_REJECTED);
    expect(calls[0]!.taskKind).toBe("LEARNING_ADVICE");
  });
});
