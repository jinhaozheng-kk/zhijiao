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
