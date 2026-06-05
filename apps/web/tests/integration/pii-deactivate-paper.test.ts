import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { deactivateUser, exportUserData } from "@/server/lib/pii-governance";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedTeacherPaper() {
  const subject = await prisma.subject.upsert({
    where: { code: "math" },
    update: {},
    create: { code: "math", name: "Math" },
  });
  const teacher = await prisma.user.create({
    data: { persona: "TEACHER", isMinor: false },
  });
  const question = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Generated paper question",
      type: "CALCULATION",
      status: "DRAFT",
      source: "PAPER_GENERATED",
      createdByUserId: teacher.id,
    },
  });
  const paper = await prisma.paper.create({
    data: {
      teacherUserId: teacher.id,
      subjectId: subject.id,
      title: "一次函数练习卷",
      paramsJson: { gradeLevel: "G8" },
      items: {
        create: {
          position: 1,
          questionId: question.id,
          source: "AI_GENERATED",
          stemMd: "Generated paper question",
          type: "CALCULATION",
          answerMd: "x = 1",
          solutionMd: "移项计算。",
          points: 5,
          difficulty: 2,
          cognitiveLevel: "APPLY",
          kpHints: ["一次函数"],
        },
      },
    },
  });
  return { teacher, paper, question };
}

describe("deactivateUser paper data", () => {
  it("deletes teacher Papers and scrubs PAPER_GENERATED question ownership", async () => {
    const { teacher, paper, question } = await seedTeacherPaper();

    const result = await deactivateUser(prisma, {
      userId: teacher.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });

    expect(result.payload.deleted.papers).toBe(1);
    expect(result.payload.scrubbed.paperGeneratedQuestions).toBe(1);
    await expect(prisma.paper.findUnique({ where: { id: paper.id } })).resolves.toBeNull();
    await expect(
      prisma.paperItem.count({ where: { paperId: paper.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.question.findUniqueOrThrow({ where: { id: question.id } }),
    ).resolves.toMatchObject({
      source: "PAPER_GENERATED",
      createdByUserId: null,
    });
  });

  it("exports a teacher's Papers without other users' Papers", async () => {
    const { teacher } = await seedTeacherPaper();
    const other = await seedTeacherPaper();

    const data = await exportUserData(prisma, teacher.id);

    expect(data.papers).toHaveLength(1);
    const exportedPaper = data.papers[0];
    expect(exportedPaper).toBeDefined();
    expect(exportedPaper).toMatchObject({
      title: "一次函数练习卷",
      status: "DRAFT",
    });
    expect(exportedPaper!.items[0]).toMatchObject({
      stemMd: "Generated paper question",
      answerMd: "x = 1",
      solutionMd: "移项计算。",
      points: 5,
      difficulty: 2,
      cognitiveLevel: "APPLY",
      kpHints: ["一次函数"],
    });
    expect(JSON.stringify(data.papers)).not.toContain(other.teacher.id);
    expect(JSON.stringify(data.papers)).not.toContain(other.paper.id);
  });
});
