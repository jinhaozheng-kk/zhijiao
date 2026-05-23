import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, ComplianceRejectedError, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "error-analysis.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
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
  stemMd: "解 2x+5=13",
  correctAnswerMd: "x=4",
  actualAnswerMd: "x=9（学生把 -5 写成 +5）",
  studentGrade: "G7" as const,
};

describe("AiRouter.diagnoseError", () => {
  it("happy path: returns parsed ErrorAnalysisOutput + writes SUCCESS ModelCall + returns modelCallId", async () => {
    const router = new AiRouter({
      prisma,
      adapter: new MockAdapter(),
      userId: "dev-student-01",
    });
    const out = await router.diagnoseError(SAMPLE_INPUT);

    expect(out.rootCause).toMatch(
      /^(CONCEPT_CONFUSION|READING_ERROR|FORMULA_MISUSE|CALCULATION_SLIP|TRANSFER_GAP|OTHER)$/,
    );
    expect(out.reasoning.length).toBeGreaterThan(0);
    expect(out.modelCallId).toBeTruthy();

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
    expect(calls[0]!.taskKind).toBe("ERROR_ANALYSIS");
    expect(calls[0]!.userId).toBe("dev-student-01");
    expect(calls[0]!.id).toBe(out.modelCallId);

    const templates = await prisma.promptTemplate.findMany();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.name).toBe("error-analysis");
    expect(templates[0]!.version).toBe("v1");
  });

  it("rejects rootCause outside enum (zod parse) and audits PARSE_FAILED after retries", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          rootCause: "NOT_A_VALID_CAUSE",
          reasoning: "x",
          suggestedKnowledgePoints: [],
        }),
        model: "mock",
        tokensIn: 1,
        tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.diagnoseError(SAMPLE_INPUT)).rejects.toThrow(
      /ERROR_ANALYSIS failed/,
    );
    const calls = await prisma.modelCall.findMany({ orderBy: { createdAt: "asc" } });
    expect(calls.at(-1)!.status).toBe(ModelCallStatus.PARSE_FAILED);
    expect(calls.at(-1)!.taskKind).toBe("ERROR_ANALYSIS");
  });

  it("ComplianceRejectedError on forbidden phrase in reasoning; ledger marks COMPLIANCE_REJECTED", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          rootCause: "CONCEPT_CONFUSION",
          reasoning: "包过 必考", // 含违禁词
          suggestedKnowledgePoints: [],
        }),
        model: "mock",
        tokensIn: 1,
        tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.diagnoseError(SAMPLE_INPUT)).rejects.toBeInstanceOf(
      ComplianceRejectedError,
    );
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.COMPLIANCE_REJECTED);
    expect(calls[0]!.taskKind).toBe("ERROR_ANALYSIS");
  });

  it("retries on invalid JSON and recovers if a later attempt is valid", async () => {
    let call = 0;
    const adapter = new MockAdapter({
      respondWith: async () => {
        call++;
        if (call === 1) {
          return { content: "not json", model: "mock", tokensIn: 1, tokensOut: 1 };
        }
        return {
          content: JSON.stringify({
            rootCause: "OTHER",
            reasoning: "Recovered on retry.",
            suggestedKnowledgePoints: [],
          }),
          model: "mock",
          tokensIn: 1,
          tokensOut: 1,
        };
      },
    });
    const router = new AiRouter({ prisma, adapter });
    const out = await router.diagnoseError(SAMPLE_INPUT);
    expect(out.rootCause).toBe("OTHER");
    expect(call).toBe(2);

    // SUCCESS audit (parse-fail attempts don't write per-attempt audit rows
    // in this router — only the terminal status does).
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
  });

  it("adapter throw (non-parse) audits ADAPTER_ERROR and rethrows", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => {
        throw new Error("network down");
      },
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.diagnoseError(SAMPLE_INPUT)).rejects.toThrow(/network down/);
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.ADAPTER_ERROR);
    expect(calls[0]!.taskKind).toBe("ERROR_ANALYSIS");
  });

  it("zod rejects bad input (stemMd missing)", async () => {
    const router = new AiRouter({ prisma, adapter: new MockAdapter() });
    await expect(
      router.diagnoseError({
        stemMd: "",
        correctAnswerMd: null,
        actualAnswerMd: null,
        studentGrade: null,
      }),
    ).rejects.toThrow();
  });
});
