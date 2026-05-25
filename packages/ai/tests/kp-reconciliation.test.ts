import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, ModelCallStatus } from "@prisma/client";
import { AiRouter, MockAdapter } from "../src/index.js";

const TEST_DB_URL = process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error(
    "kp-reconciliation.test.ts: DATABASE_URL must come from vitest.config.ts `test.env`",
  );
}

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "kp_reconcile_matches","kp_aliases","question_kp_links","model_calls","prompt_templates","error_book_entries","questions","knowledge_points","subjects","users" RESTART IDENTITY CASCADE;`,
  );
}

async function seedSubjectAndKps() {
  const subject = await prisma.subject.create({ data: { code: "math", name: "数学" } });
  const kp1 = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-linear-eq", name: "一元一次方程", difficulty: 2 },
  });
  const kp2 = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-g7-substitution", name: "代入消元", difficulty: 2 },
  });
  return { subjectId: subject.id, kp1Id: kp1.id, kp2Id: kp2.id };
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// 26-char cuid-shape fakes (Zod's z.string().cuid() requires /^c[^\s-]{8,}$/i)
const HINT1 = "clrelid000000000000000001";
const HINT2 = "clrelid000000000000000002";
const HINT_EXTRA = "clrelid000000000000000099";

describe("AiRouter.kpReconcile", () => {
  it("happy path: returns aligned items + writes ModelCall(SUCCESS, taskKind=KP_RECONCILE)", async () => {
    const { subjectId, kp1Id, kp2Id } = await seedSubjectAndKps();
    const adapter = new MockAdapter({
      respondWith: () =>
        Promise.resolve({
          content: JSON.stringify([
            { matchId: HINT1, kpId: kp1Id, confidence: 0.92 },
            { matchId: HINT2, kpId: null, confidence: 0 },
          ]),
          tokensIn: 100,
          tokensOut: 50,
          model: "mock-v1",
        }),
    });
    const router = new AiRouter({ prisma, adapter });

    const r = await router.kpReconcile({
      subjectId,
      candidates: [
        { id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" },
        { id: kp2Id, code: "math-g7-substitution", name: "代入消元", description: null, parentPath: "数学" },
      ],
      hints: [
        { matchId: HINT1, rawHint: "linear equation", normalizedHint: "linear equation" },
        { matchId: HINT2, rawHint: "未知概念", normalizedHint: "未知概念" },
      ],
    });

    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ matchId: HINT1, kpId: kp1Id, confidence: 0.92 });
    expect(r.items[1]).toEqual({ matchId: HINT2, kpId: null, confidence: 0 });
    expect(r.modelCallId).toBeTruthy();

    const mc = await prisma.modelCall.findUniqueOrThrow({ where: { id: r.modelCallId } });
    expect(mc.taskKind).toBe("KP_RECONCILE");
    expect(mc.status).toBe(ModelCallStatus.SUCCESS);
  });

  it("LLM 多返不在本批 matchId 的项 → 静默忽略，不算异常", async () => {
    const { subjectId, kp1Id } = await seedSubjectAndKps();
    const adapter = new MockAdapter({
      respondWith: () =>
        Promise.resolve({
          content: JSON.stringify([
            { matchId: HINT1, kpId: kp1Id, confidence: 0.9 },
            { matchId: HINT_EXTRA, kpId: kp1Id, confidence: 0.5 },   // 不在本批
          ]),
          tokensIn: 50,
          tokensOut: 30,
          model: "mock-v1",
        }),
    });
    const router = new AiRouter({ prisma, adapter });

    const r = await router.kpReconcile({
      subjectId,
      candidates: [
        { id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" },
      ],
      hints: [{ matchId: HINT1, rawHint: "linear", normalizedHint: "linear" }],
    });

    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.matchId).toBe(HINT1);
  });

  it("LLM 漏返一个 matchId → retry 3 次 → 最终 PARSE_FAILED", async () => {
    const { subjectId, kp1Id, kp2Id } = await seedSubjectAndKps();
    let calls = 0;
    const adapter = new MockAdapter({
      respondWith: () => {
        calls++;
        return Promise.resolve({
          content: JSON.stringify([
            { matchId: HINT1, kpId: kp1Id, confidence: 0.9 },
            // 永远漏 HINT2
          ]),
          tokensIn: 50,
          tokensOut: 30,
          model: "mock-v1",
        });
      },
    });
    const router = new AiRouter({ prisma, adapter });

    await expect(
      router.kpReconcile({
        subjectId,
        candidates: [
          { id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" },
          { id: kp2Id, code: "math-g7-substitution", name: "代入消元", description: null, parentPath: "数学" },
        ],
        hints: [
          { matchId: HINT1, rawHint: "a", normalizedHint: "a" },
          { matchId: HINT2, rawHint: "b", normalizedHint: "b" },
        ],
      }),
    ).rejects.toThrow(/KP_RECONCILE failed/);

    expect(calls).toBe(3); // 初次 + 2 retry
    const mc = await prisma.modelCall.findFirst({
      where: { taskKind: "KP_RECONCILE" },
      orderBy: { createdAt: "desc" },
    });
    expect(mc?.status).toBe(ModelCallStatus.PARSE_FAILED);
  });

  it("LLM 返非 JSON → retry → 最终 PARSE_FAILED", async () => {
    const { subjectId, kp1Id } = await seedSubjectAndKps();
    const adapter = new MockAdapter({
      respondWith: () =>
        Promise.resolve({
          content: "不是 JSON 啊",
          tokensIn: 50,
          tokensOut: 30,
          model: "mock-v1",
        }),
    });
    const router = new AiRouter({ prisma, adapter });

    await expect(
      router.kpReconcile({
        subjectId,
        candidates: [
          { id: kp1Id, code: "math-g7-linear-eq", name: "一元一次方程", description: null, parentPath: "数学" },
        ],
        hints: [{ matchId: HINT1, rawHint: "x", normalizedHint: "x" }],
      }),
    ).rejects.toThrow();

    const mc = await prisma.modelCall.findFirst({
      where: { taskKind: "KP_RECONCILE" },
      orderBy: { createdAt: "desc" },
    });
    expect(mc?.status).toBe(ModelCallStatus.PARSE_FAILED);
  });
});
