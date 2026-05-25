import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import {
  QUESTION_SOURCE_USER_ADHOC,
  normalizeStem,
  stemHashHex,
  upsertUserAdhocQuestion,
} from "@/server/lib/question";

async function seedMathSubject() {
  await prisma.subject.upsert({
    where: { code: "math" },
    create: { code: "math", name: "数学" },
    update: {},
  });
}

async function seedUser(id: string) {
  await prisma.user.upsert({
    where: { id },
    create: { id, name: id, persona: "STUDENT" },
    update: {},
  });
}

beforeEach(async () => {
  await resetDb();
  await seedMathSubject();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("normalizeStem", () => {
  it("trims and collapses whitespace; does NOT lowercase", () => {
    expect(normalizeStem("  2x + 5 = 13  ")).toBe("2x + 5 = 13");
    expect(normalizeStem("2x\n+\t5  =  13")).toBe("2x + 5 = 13");
    expect(normalizeStem("sin X")).toBe("sin X");
    expect(normalizeStem("SIN x")).toBe("SIN x");
  });

  it("preserves emoji and full-width chars", () => {
    expect(normalizeStem("题目：2x＋5＝13 🧮")).toBe("题目：2x＋5＝13 🧮");
  });
});

describe("stemHashHex", () => {
  it("returns 32 hex chars for any input", () => {
    expect(stemHashHex("x")).toHaveLength(32);
    expect(stemHashHex("a much longer stem here")).toHaveLength(32);
  });

  it("same normalized input produces same hash", () => {
    expect(stemHashHex("  2x + 5 = 13  ")).toBe(stemHashHex("2x + 5 = 13"));
    expect(stemHashHex("2x\n+\t5  =  13")).toBe(stemHashHex("2x + 5 = 13"));
  });

  it("differs by case (因为 normalizeStem 不 lowercase)", () => {
    expect(stemHashHex("sin x")).not.toBe(stemHashHex("SIN x"));
  });
});

describe("upsertUserAdhocQuestion", () => {
  it("creates a new USER_ADHOC Question row with expected fields", async () => {
    await seedUser("u1");
    const q = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "解方程 2x + 5 = 13" });
    expect(q.source).toBe(QUESTION_SOURCE_USER_ADHOC);
    expect(q.createdByUserId).toBe("u1");
    expect(q.status).toBe("DRAFT");
    expect(q.type).toBe("ESSAY");
    expect(q.normalizedStemHash).toBe(stemHashHex("解方程 2x + 5 = 13"));
  });

  it("same user + same stem returns same row (dedup via partial unique idx)", async () => {
    await seedUser("u1");
    const q1 = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "解方程 2x + 5 = 13" });
    const q2 = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "解方程 2x + 5 = 13" });
    expect(q2.id).toBe(q1.id);
    const count = await prisma.question.count({ where: { createdByUserId: "u1" } });
    expect(count).toBe(1);
  });

  it("different users with same stem each get their own row", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const q1 = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "解方程 2x + 5 = 13" });
    const q2 = await upsertUserAdhocQuestion(prisma, { userId: "u2", stemMd: "解方程 2x + 5 = 13" });
    expect(q2.id).not.toBe(q1.id);
  });

  it("whitespace-only differences in stem still dedupe (normalize 生效)", async () => {
    await seedUser("u1");
    const q1 = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "  2x + 5 = 13" });
    const q2 = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "2x   +   5   =   13" });
    expect(q2.id).toBe(q1.id);
  });

  it("case differences in stem do NOT dedupe (normalize 不 lowercase)", async () => {
    await seedUser("u1");
    const q1 = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "sin x" });
    const q2 = await upsertUserAdhocQuestion(prisma, { userId: "u1", stemMd: "SIN x" });
    expect(q2.id).not.toBe(q1.id);
  });
});
