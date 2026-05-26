import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { stemHashHex } from "@/server/lib/question-shared";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  seedErrorBookEntry,
} from "./_helpers/error-book-fixtures";

type GenerateVariantsFn = (input: unknown) => Promise<unknown>;
const aiMockRef: { generateVariants: GenerateVariantsFn } = {
  generateVariants: vi.fn<Parameters<GenerateVariantsFn>, ReturnType<GenerateVariantsFn>>(
    async (_input) => ({
      items: [
        { level: "L1" as const, stemMd: "L1 drift guard", solutionMd: "sol 1", knowledgePointHints: [] },
        { level: "L2" as const, stemMd: "L2 drift guard", solutionMd: "sol 2", knowledgePointHints: [] },
        { level: "L3" as const, stemMd: "L3 drift guard", solutionMd: "sol 3", knowledgePointHints: [] },
      ],
      modelCallId: "mock-variant-call-id",
    }),
  ),
};

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    generateVariants: (input: unknown) => aiMockRef.generateVariants(input),
  }),
}));

const { appRouter } = await import("@/server/routers/_root");

beforeAll(async () => {
  await redis.flushdb();
});

beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
});

describe("variant stem drift guard", () => {
  it("keeps VariantItem.stemMd identical to the linked generated Question stem", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const user = await seedUserWithBalance(100);
    const entry = await seedErrorBookEntry({
      userId: user.id,
      questionId,
      status: "ACTIVE",
    });

    const caller = appRouter.createCaller(makeCtx(user.id));
    const { group } = await caller.variant.generateForEntry({
      entryId: entry.id,
      clientRequestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    const items = await prisma.variantItem.findMany({
      where: { groupId: group.id },
      include: { question: true },
      orderBy: { position: "asc" },
    });

    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.question).not.toBeNull();
      expect(item.stemMd).toBe(item.question!.stemMd);
      expect(item.question!.normalizedStemHash).toBe(stemHashHex(item.stemMd));
    }
  });
});
