// Plan 14c: 输入侧 PII 脱敏 —— tutor.ask 题面 + error.diagnose actualAnswerMd
// 在喂 AI 与持久化之前脱敏。断言：落库文本含占位符、不含原值，且传给 AI
// adapter 的入参也已脱敏（用 mock 捕获入参）。
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { redis, makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

// vi.mock 被 hoist 到文件顶；用 vi.hoisted 让 mock 闭包能写回一个测试可见的捕获对象。
const captured = vi.hoisted(() => ({
  tutorStem: null as string | null,
  diagnoseActualAnswer: null as string | null | undefined,
}));

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async tutor(input: { questionStem: string }) {
      captured.tutorStem = input.questionStem;
      return {
        restatement: "重述",
        knowledgePoints: ["一元一次方程"],
        steps: ["移项"],
        pitfalls: [],
        finalAnswer: "x=4",
      };
    },
    async diagnoseError(input: { actualAnswerMd: string | null }) {
      captured.diagnoseActualAnswer = input.actualAnswerMd;
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
  captured.tutorStem = null;
  captured.diagnoseActualAnswer = null;
});
afterAll(async () => {
  await redis.quit();
});

async function ensureMathSubject(): Promise<{ id: string }> {
  return prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
    select: { id: true },
  });
}

async function seedUserAdhocQuestion(userId: string, stem: string): Promise<string> {
  const math = await ensureMathSubject();
  const q = await prisma.question.create({
    data: {
      subjectId: math.id,
      stemMd: stem,
      type: "ESSAY",
      status: "DRAFT",
      source: "USER_ADHOC",
      createdByUserId: userId,
      normalizedStemHash: stem.toLowerCase().slice(0, 32).padEnd(32, "0"),
    },
  });
  return q.id;
}

describe("Plan 14c: input-side PII redaction", () => {
  it("tutor.ask redacts phone from stem before AI + persist", async () => {
    const u = await seedUserWithBalance(5);
    await ensureMathSubject(); // upsertUserAdhocQuestion 需要 math subject
    const caller = appRouter.createCaller(makeCtx(u.id));
    await caller.tutor.ask({
      questionStem: "我手机13812345678，解方程 2x+5=13",
      clientRequestId: crypto.randomUUID(),
    });

    // 落库的 USER_ADHOC Question.stemMd 已脱敏
    const q = await prisma.question.findFirstOrThrow({
      where: { createdByUserId: u.id, source: "USER_ADHOC" },
    });
    expect(q.stemMd).toContain("[手机号]");
    expect(q.stemMd).not.toContain("13812345678");

    // 传给 AI 的 stem 也已脱敏
    expect(captured.tutorStem).toContain("[手机号]");
    expect(captured.tutorStem).not.toContain("13812345678");
  });

  it("error.diagnose redacts ID card from actualAnswerMd before AI + persist", async () => {
    const u = await seedUserWithBalance(5);
    const qid = await seedUserAdhocQuestion(u.id, "解方程 2x+5=13");
    const caller = appRouter.createCaller(makeCtx(u.id));
    await caller.error.diagnose({
      questionId: qid,
      actualAnswerMd: "我身份证 440524198001010013 算错了",
      clientRequestId: crypto.randomUUID(),
    });

    const entry = await prisma.errorBookEntry.findFirstOrThrow({
      where: { userId: u.id, questionId: qid },
    });
    expect(entry.actualAnswerMd).toContain("[身份证号]");
    expect(entry.actualAnswerMd).not.toContain("440524198001010013");

    expect(captured.diagnoseActualAnswer).toContain("[身份证号]");
    expect(captured.diagnoseActualAnswer).not.toContain("440524198001010013");
  });
});
