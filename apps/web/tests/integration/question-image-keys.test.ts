import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { upsertUserAdhocQuestion } from "@/server/lib/question";

beforeEach(async () => {
  await resetDb();
  await prisma.subject.upsert({
    where: { code: "math" },
    update: {},
    create: { code: "math", name: "数学" },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("upsertUserAdhocQuestion stemImageKeys", () => {
  it("persists the image key on a new adhoc question", async () => {
    const userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, name: "学生", persona: "STUDENT" },
    });
    const q = await upsertUserAdhocQuestion(prisma, {
      userId,
      stemMd: "解方程 2x+1=0",
      stemImageKeys: [`adhoc/${userId}/a.png`],
    });
    expect(q.stemImageKeys).toEqual([`adhoc/${userId}/a.png`]);
  });
});
