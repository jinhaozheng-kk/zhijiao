import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { persistGeneratedCourseware } from "@/server/lib/courseware-generation";

async function mathId() {
  const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  return s.id;
}
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("courseware-generation", () => {
  it("按固定 type 顺序落 position 1..5（不信任 AI 顺序）", async () => {
    const subjectId = await mathId();
    const teacher = await prisma.user.create({ data: { persona: "TEACHER" } });
    // 故意乱序
    const sections = [
      { type: "EXERCISE", title: "练习", contentMd: "c5" },
      { type: "INTRO", title: "导入", contentMd: "c1" },
      { type: "PITFALL", title: "易错", contentMd: "c4" },
      { type: "EXAMPLE", title: "例题", contentMd: "c3" },
      { type: "EXPLANATION", title: "讲解", contentMd: "c2" },
    ];
    const cw = await persistGeneratedCourseware(prisma, {
      teacherUserId: teacher.id, subjectId, title: "课件",
      paramsJson: { gradeLevel: "G8" }, gradeLevel: "G8", debitLedgerId: null, modelCallId: "mc1", sections,
    });
    const rows = await prisma.coursewareSection.findMany({ where: { coursewareId: cw.id }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.type)).toEqual(["INTRO", "EXPLANATION", "EXAMPLE", "PITFALL", "EXERCISE"]);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.contentMd)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });
});
