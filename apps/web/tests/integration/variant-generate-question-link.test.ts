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
        { level: "L1" as const, stemMd: "L1 generated", solutionMd: "sol 1", knowledgePointHints: [] },
        { level: "L2" as const, stemMd: "L2 generated", solutionMd: "sol 2", knowledgePointHints: [] },
        { level: "L3" as const, stemMd: "L3 generated", solutionMd: "sol 3", knowledgePointHints: [] },
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
  aiMockRef.generateVariants = vi.fn<
    Parameters<GenerateVariantsFn>,
    ReturnType<GenerateVariantsFn>
  >(async (_input) => ({
    items: [
      { level: "L1" as const, stemMd: "L1 generated", solutionMd: "sol 1", knowledgePointHints: [] },
      { level: "L2" as const, stemMd: "L2 generated", solutionMd: "sol 2", knowledgePointHints: [] },
      { level: "L3" as const, stemMd: "L3 generated", solutionMd: "sol 3", knowledgePointHints: [] },
    ],
    modelCallId: "mock-variant-call-id",
  }));
});

afterAll(async () => {
  await redis.quit();
});

describe("variant.generateForEntry generated Question link", () => {
  it("creates a linked VARIANT_GENERATED Question for every generated VariantItem", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const parentQuestion = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
    });
    const user = await seedUserWithBalance(100);
    const entry = await seedErrorBookEntry({
      userId: user.id,
      questionId,
      status: "ACTIVE",
    });

    const caller = appRouter.createCaller(makeCtx(user.id));
    const { group } = await caller.variant.generateForEntry({
      entryId: entry.id,
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const items = await prisma.variantItem.findMany({
      where: { groupId: group.id },
      include: { question: true },
      orderBy: { position: "asc" },
    });

    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.questionId).not.toBeNull();
      expect(item.question).not.toBeNull();
      expect(item.question!.id).toBe(item.questionId);
      expect(item.question!.source).toBe("VARIANT_GENERATED");
      expect(item.question!.createdByUserId).toBe(user.id);
      expect(item.question!.subjectId).toBe(parentQuestion.subjectId);
      expect(item.question!.status).toBe("DRAFT");
      expect(item.question!.normalizedStemHash).toBe(stemHashHex(item.stemMd));
    }
  });

  it("rolls back VariantGroup, VariantItems, and generated Questions when item insert fails", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const user = await seedUserWithBalance(100);
    const entry = await seedErrorBookEntry({
      userId: user.id,
      questionId,
      status: "ACTIVE",
    });

    aiMockRef.generateVariants = vi.fn<
      Parameters<GenerateVariantsFn>,
      ReturnType<GenerateVariantsFn>
    >(async (_input) => ({
      items: [
        { level: "L1" as const, stemMd: "duplicate level 1", solutionMd: "sol 1", knowledgePointHints: [] },
        { level: "L1" as const, stemMd: "duplicate level 2", solutionMd: "sol 2", knowledgePointHints: [] },
      ],
      modelCallId: "mock-variant-call-id",
    }));

    const caller = appRouter.createCaller(makeCtx(user.id));
    const err = await caller.variant
      .generateForEntry({
        entryId: entry.id,
        clientRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      })
      .catch((e) => e);
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    expect(err.cause).toMatchObject({ code: "P2002" });

    await expect(prisma.variantGroup.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.variantItem.count()).resolves.toBe(0);
    await expect(
      prisma.question.count({
        where: { source: "VARIANT_GENERATED", createdByUserId: user.id },
      }),
    ).resolves.toBe(0);
  });
});
