import { describe, expect, it } from "vitest";
import { afterAll, beforeEach } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, MockAdapter } from "../src/index.js";
import {
  AssignmentQuestionGenerationInputSchema,
  AssignmentQuestionGenerationOutputSchema,
} from "../src/schemas.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "assignment-question-generation.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
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

describe("assignment question generation schemas", () => {
  it("accepts three-tier generated assignments", () => {
    const input = AssignmentQuestionGenerationInputSchema.parse({
      mode: "MANUAL_CRITERIA",
      subject: "Math",
      gradeLevel: "G8",
      tierCounts: { BASIC: 1, CONSOLIDATION: 1, CHALLENGE: 1 },
      questionTypes: ["SINGLE_CHOICE", "CALCULATION"],
      kpNames: ["linear equations"],
      difficultyRange: [2, 4],
      teachingGoalMd: "Practice transposition and combining like terms.",
    });
    expect(input.tierCounts.BASIC).toBe(1);

    const output = AssignmentQuestionGenerationOutputSchema.parse({
      title: "Linear equations tiered practice",
      tiers: [
        {
          level: "BASIC",
          rationaleMd: "Consolidate basic transposition.",
          items: [
            {
              type: "SINGLE_CHOICE",
              stemMd: "Solve x + 3 = 7.",
              options: [
                { key: "A", text: "x = 4" },
                { key: "B", text: "x = 10" },
              ],
              answerMd: "A",
              solutionMd: "Subtract 3 from both sides to get x = 4.",
              rubricMd: "Can write the transposition step.",
              knowledgePointHints: ["linear equations"],
              difficulty: 2,
            },
          ],
        },
        {
          level: "CONSOLIDATION",
          rationaleMd: "Change the expression format.",
          items: [],
        },
        {
          level: "CHALLENGE",
          rationaleMd: "Transfer the skill to application tasks.",
          items: [],
        },
      ],
    });
    expect(output.tiers.map((t) => t.level)).toEqual([
      "BASIC",
      "CONSOLIDATION",
      "CHALLENGE",
    ]);
  });

  it("rejects unsupported question type values", () => {
    expect(() =>
      AssignmentQuestionGenerationOutputSchema.parse({
        title: "bad",
        tiers: [
          {
            level: "BASIC",
            rationaleMd: "bad",
            items: [
              {
                type: "RANDOM",
                stemMd: "bad",
                answerMd: "bad",
                solutionMd: "bad",
                knowledgePointHints: [],
                difficulty: 3,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("AiRouter.generateAssignmentQuestions", () => {
  it("returns parsed tiers and writes a SUCCESS audit", async () => {
    const router = new AiRouter({
      prisma,
      adapter: new MockAdapter({
        respondWith: async () => ({
          content: JSON.stringify({
            title: "Linear equations tiered practice",
            tiers: [
              {
                level: "BASIC",
                rationaleMd: "Consolidate basic transposition.",
                items: [
                  {
                    type: "CALCULATION",
                    stemMd: "Solve 2x + 5 = 13.",
                    answerMd: "x = 4",
                    solutionMd: "Move 5 to the other side and divide by 2.",
                    knowledgePointHints: ["linear equations"],
                    difficulty: 2,
                  },
                ],
              },
            ],
          }),
          model: "mock-v1",
          tokensIn: 1,
          tokensOut: 1,
        }),
      }),
      userId: "dev-teacher-01",
    });

    const out = await router.generateAssignmentQuestions({
      mode: "MANUAL_CRITERIA",
      subject: "Math",
      gradeLevel: "G8",
      tierCounts: { BASIC: 1, CONSOLIDATION: 0, CHALLENGE: 0 },
      questionTypes: ["CALCULATION"],
      kpNames: ["linear equations"],
      difficultyRange: [2, 4],
    });

    expect(out.title).toBe("Linear equations tiered practice");
    expect(out.tiers[0]!.level).toBe("BASIC");
    expect(out.modelCallId).toBeTruthy();

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe(out.modelCallId);
    expect(calls[0]!.taskKind).toBe("ASSIGNMENT_QUESTION_GEN");
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
    expect(calls[0]!.userId).toBe("dev-teacher-01");

    const templates = await prisma.promptTemplate.findMany();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.name).toBe("assignment-question-gen");
    expect(templates[0]!.version).toBe("v1");
  });
});
