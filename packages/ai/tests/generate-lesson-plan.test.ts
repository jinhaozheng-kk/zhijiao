import { describe, expect, it } from "vitest";
import { afterAll, beforeEach } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "generate-lesson-plan.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
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

describe("AiRouter.generateLessonPlan", () => {
  it("mock 返回五段课件 + modelCallId 并写 SUCCESS 审计", async () => {
    const router = new AiRouter({
      prisma,
      adapter: new MockAdapter(),
      userId: "dev-teacher-01",
    });

    const out = await router.generateLessonPlan({
      gradeLevel: "G8",
      kpNames: ["一次函数"],
      teachingGoal: "理解一次函数",
    });

    expect(out.sections.length).toBe(5);
    expect(new Set(out.sections.map((s) => s.type)).size).toBe(5);
    expect(out.modelCallId).toBeTruthy();

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe(out.modelCallId);
    expect(calls[0]!.taskKind).toBe("LESSON_PLAN_GEN");
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);

    const templates = await prisma.promptTemplate.findMany();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.name).toBe("lesson-plan-gen");
    expect(templates[0]!.version).toBe("v1");
  });
});
