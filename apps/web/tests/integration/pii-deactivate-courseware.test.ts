import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { deactivateUser, exportUserData } from "@/server/lib/pii-governance";

async function mathId() {
  const s = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  return s.id;
}
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("deactivateUser courseware data", () => {
  it("注销教师：删 Courseware 级联 sections", async () => {
    const subjectId = await mathId();
    const t = await prisma.user.create({ data: { persona: "TEACHER" } });
    const cw = await prisma.courseware.create({
      data: {
        teacherUserId: t.id,
        subjectId,
        title: "课件",
        paramsJson: {},
        sections: { create: [{ position: 1, type: "INTRO", title: "导入", contentMd: "c1" }] },
      },
    });
    const result = await deactivateUser(prisma, { userId: t.id, operatorId: null, initiatorRef: "cli:test:operator" });
    expect(result.payload.deleted.coursewares).toBe(1);
    expect(await prisma.courseware.count({ where: { id: cw.id } })).toBe(0);
    expect(await prisma.coursewareSection.count({ where: { coursewareId: cw.id } })).toBe(0);
  });

  it("导出含本人 courseware（不含他人）", async () => {
    const subjectId = await mathId();
    const t = await prisma.user.create({ data: { persona: "TEACHER" } });
    await prisma.courseware.create({
      data: {
        teacherUserId: t.id,
        subjectId,
        title: "我的课件",
        status: "READY",
        gradeLevel: "G8",
        paramsJson: {},
        sections: { create: [{ position: 1, type: "INTRO", title: "导入", contentMd: "导入内容" }] },
      },
    });
    const other = await prisma.user.create({ data: { persona: "TEACHER" } });
    await prisma.courseware.create({ data: { teacherUserId: other.id, subjectId, title: "他人课件", paramsJson: {} } });

    const data = await exportUserData(prisma, t.id);
    expect(data.coursewares).toHaveLength(1);
    const cw = data.coursewares[0]!;
    expect(cw).toMatchObject({ title: "我的课件", status: "READY", gradeLevel: "G8" });
    expect(cw.sections[0]).toMatchObject({ type: "INTRO", title: "导入", contentMd: "导入内容" });
    expect(JSON.stringify(data.coursewares)).not.toContain("他人课件");
  });
});
