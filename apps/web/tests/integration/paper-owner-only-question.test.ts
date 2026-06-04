import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({ async diagnoseError() { return {}; } }) }));

const { appRouter } = await import("@/server/routers/_root");

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

it("他人无法经 questionId 探测 PAPER_GENERATED 题", async () => {
  const subject = await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });
  const teacher = await seedUserWithBalance(100);
  const q = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "x",
      type: "CALCULATION",
      status: "DRAFT",
      source: "PAPER_GENERATED",
      createdByUserId: teacher.id,
    },
  });
  const other = await seedUserWithBalance(100);
  const caller = appRouter.createCaller(makeCtx(other.id));
  await expect(
    caller.error.diagnose({
      questionId: q.id,
      actualAnswerMd: "x",
      clientRequestId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
