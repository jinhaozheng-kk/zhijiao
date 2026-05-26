import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { stemHashHex } from "@/server/lib/question-shared";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  genCuid,
} from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async diagnoseError(_input: unknown) {
      return {
        rootCause: "CALCULATION_SLIP" as const,
        reasoning: "Mock diagnosis.",
        suggestedKnowledgePoints: ["mock-kp"],
        modelCallId: "mock-call-id",
      };
    },
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

async function seedVariantGeneratedQuestion(opts: {
  userId: string;
  subjectId: string;
  stem: string;
}): Promise<string> {
  const question = await prisma.question.create({
    data: {
      subjectId: opts.subjectId,
      stemMd: opts.stem,
      type: "CALCULATION",
      difficulty: 2,
      status: "DRAFT",
      source: "VARIANT_GENERATED",
      createdByUserId: opts.userId,
      normalizedStemHash: stemHashHex(opts.stem),
      answer: {
        create: { contentMd: "x = 4", solutionMd: "Move terms, then divide." },
      },
    },
  });
  return question.id;
}

async function expectQuestionNotFound(promise: Promise<unknown>) {
  const err = await promise.catch((e) => e);

  expect(err).toBeInstanceOf(TRPCError);
  const trpc = err as TRPCError;
  expect(trpc.code).toBe("NOT_FOUND");
  expect((trpc.cause as { reason?: string } | undefined)?.reason).toBe(
    "QUESTION_NOT_FOUND",
  );
}

describe("error.diagnose VARIANT_GENERATED question access control", () => {
  it("allows owners and public questions while hiding cross-user variants before debit", async () => {
    const { subjectId, questionId: publicQuestionId } = await seedTestSubjectAndQuestion();
    const owner = await seedUserWithBalance(5);
    const other = await seedUserWithBalance(5);
    const variantQuestionId = await seedVariantGeneratedQuestion({
      userId: owner.id,
      subjectId,
      stem: "Generated variant owned by owner",
    });

    const ownerCaller = appRouter.createCaller(makeCtx(owner.id));
    const ownerResult = await ownerCaller.error.diagnose({
      questionId: variantQuestionId,
      clientRequestId: crypto.randomUUID(),
    });
    expect(ownerResult.entryId).toBeTruthy();

    const otherCaller = appRouter.createCaller(makeCtx(other.id));
    await expectQuestionNotFound(
      otherCaller.error.diagnose({
        questionId: variantQuestionId,
        clientRequestId: crypto.randomUUID(),
      }),
    );

    const otherWalletAfterCrossUser = await prisma.wallet.findUniqueOrThrow({
      where: { userId: other.id },
    });
    expect(otherWalletAfterCrossUser.balance).toBe(5);
    await expect(
      prisma.creditLedger.count({
        where: {
          walletId: other.walletId,
          kind: "DEBIT",
          actionKind: "ERROR_ANALYSIS",
        },
      }),
    ).resolves.toBe(0);

    await expectQuestionNotFound(
      otherCaller.error.diagnose({
        questionId: genCuid("missing-variant-question"),
        clientRequestId: crypto.randomUUID(),
      }),
    );

    const publicResult = await otherCaller.error.diagnose({
      questionId: publicQuestionId,
      clientRequestId: crypto.randomUUID(),
    });
    expect(publicResult.entryId).toBeTruthy();
  });
});
