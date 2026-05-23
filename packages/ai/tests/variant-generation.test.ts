import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, ComplianceRejectedError, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "variant-generation.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
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
  anchorStemMd: "解 2x+5=13",
  anchorRootCause: "CALCULATION_SLIP" as const,
  anchorKps: [{ id: "kp-1", name: "一元一次方程", difficulty: 2 }],
  studentGrade: "G7" as const,
};

describe("AiRouter.generateVariants", () => {
  it("happy path: returns 3 items {L1,L2,L3} + modelCallId + SUCCESS audit", async () => {
    const router = new AiRouter({
      prisma,
      adapter: new MockAdapter(),
      userId: "dev-student-01",
    });
    const out = await router.generateVariants(SAMPLE_INPUT);
    expect(out.items).toHaveLength(3);
    expect(out.items.map((i) => i.level).sort()).toEqual(["L1", "L2", "L3"]);
    expect(out.modelCallId).toBeTruthy();

    for (const it of out.items) {
      expect(it.stemMd.length).toBeGreaterThan(0);
      expect(it.solutionMd.length).toBeGreaterThan(0);
    }

    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.taskKind).toBe("VARIANT_GROUP_GEN");
    expect(calls[0]!.status).toBe(ModelCallStatus.SUCCESS);
    expect(calls[0]!.id).toBe(out.modelCallId);

    const templates = await prisma.promptTemplate.findMany();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.name).toBe("variant-generation");
    expect(templates[0]!.version).toBe("v1");
  });

  it("rejects when level set is not exactly {L1,L2,L3} (zod refine)", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          items: [
            { level: "L1", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
            { level: "L1", stemMd: "x", solutionMd: "y", knowledgePointHints: [] }, // 重复 L1
            { level: "L3", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
          ],
        }),
        model: "mock",
        tokensIn: 1,
        tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.generateVariants(SAMPLE_INPUT)).rejects.toThrow(
      /VARIANT_GROUP_GEN failed/,
    );
    const calls = await prisma.modelCall.findMany();
    expect(calls.at(-1)!.status).toBe(ModelCallStatus.PARSE_FAILED);
    expect(calls.at(-1)!.taskKind).toBe("VARIANT_GROUP_GEN");
  });

  it("rejects when items.length !== 3 (zod length)", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          items: [
            { level: "L1", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
            { level: "L2", stemMd: "x", solutionMd: "y", knowledgePointHints: [] },
          ],
        }),
        model: "mock",
        tokensIn: 1,
        tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.generateVariants(SAMPLE_INPUT)).rejects.toThrow(
      /VARIANT_GROUP_GEN failed/,
    );
  });

  it("ComplianceRejectedError on forbidden phrase in stemMd; ledger marks COMPLIANCE_REJECTED", async () => {
    const adapter = new MockAdapter({
      respondWith: async () => ({
        content: JSON.stringify({
          items: ["L1", "L2", "L3"].map((level) => ({
            level,
            stemMd: "押中原题",
            solutionMd: "y",
            knowledgePointHints: [],
          })),
        }),
        model: "mock",
        tokensIn: 1,
        tokensOut: 1,
      }),
    });
    const router = new AiRouter({ prisma, adapter });
    await expect(router.generateVariants(SAMPLE_INPUT)).rejects.toBeInstanceOf(
      ComplianceRejectedError,
    );
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.COMPLIANCE_REJECTED);
    expect(calls[0]!.taskKind).toBe("VARIANT_GROUP_GEN");
  });

  it("retries on invalid JSON and recovers", async () => {
    let call = 0;
    const adapter = new MockAdapter({
      respondWith: async () => {
        call++;
        if (call === 1) {
          return { content: "not json", model: "mock", tokensIn: 1, tokensOut: 1 };
        }
        return {
          content: JSON.stringify({
            items: [
              { level: "L1", stemMd: "a", solutionMd: "a", knowledgePointHints: [] },
              { level: "L2", stemMd: "b", solutionMd: "b", knowledgePointHints: [] },
              { level: "L3", stemMd: "c", solutionMd: "c", knowledgePointHints: [] },
            ],
          }),
          model: "mock",
          tokensIn: 1,
          tokensOut: 1,
        };
      },
    });
    const router = new AiRouter({ prisma, adapter });
    const out = await router.generateVariants(SAMPLE_INPUT);
    expect(out.items).toHaveLength(3);
    expect(call).toBe(2);

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
    await expect(router.generateVariants(SAMPLE_INPUT)).rejects.toThrow(/network down/);
    const calls = await prisma.modelCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.status).toBe(ModelCallStatus.ADAPTER_ERROR);
    expect(calls[0]!.taskKind).toBe("VARIANT_GROUP_GEN");
  });

  it("zod rejects bad input (empty anchorKps)", async () => {
    const router = new AiRouter({ prisma, adapter: new MockAdapter() });
    await expect(
      router.generateVariants({
        anchorStemMd: "x",
        anchorRootCause: "OTHER",
        anchorKps: [],
        studentGrade: null,
      }),
    ).rejects.toThrow();
  });
});
