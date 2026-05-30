import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@zhijiao/db";
import { profileForStudent, classDiagnosis } from "@zhijiao/analytics";

const SUBJECT = "an-subj-1";
const KP1 = "an-kp-1";
const KP2 = "an-kp-2";
const STUDENT = "an-stu-1";
const CLASSROOM = "an-class-1";

beforeAll(async () => {
  await prisma.subject.upsert({
    where: { id: SUBJECT },
    update: {},
    create: { id: SUBJECT, code: "an-math", name: "AN数学" },
  });
  for (const [id, name] of [[KP1, "一元一次方程"], [KP2, "因式分解"]] as const) {
    await prisma.knowledgePoint.upsert({
      where: { id },
      update: {},
      create: { id, subjectId: SUBJECT, code: id, name },
    });
  }
  await prisma.user.upsert({
    where: { id: STUDENT },
    update: {},
    create: { id: STUDENT, persona: "STUDENT", gradeLevel: "G8" },
  });
  await prisma.classroom.upsert({
    where: { id: CLASSROOM },
    update: {},
    create: { id: CLASSROOM, name: "AN班", subjectId: SUBJECT },
  });
  await prisma.classroomMember.upsert({
    where: { classroomId_userId: { classroomId: CLASSROOM, userId: STUDENT } },
    update: {},
    create: { classroomId: CLASSROOM, userId: STUDENT, role: "STUDENT" },
  });
  await prisma.assignmentPerformance.deleteMany({ where: { studentUserId: STUDENT } });
  // KP1: 1对1错 → 0.5 PROGRESSING；KP2: 2对 → SOLID
  const now = new Date();
  await prisma.assignmentPerformance.createMany({
    data: [
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i1", gradeStatus: "CORRECT", kpIds: [KP1], createdAt: now },
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i2", gradeStatus: "WRONG", kpIds: [KP1], createdAt: now },
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i3", gradeStatus: "CORRECT", kpIds: [KP2], createdAt: now },
      { assignmentId: "an-a1", studentUserId: STUDENT, itemId: "an-i4", gradeStatus: "CORRECT", kpIds: [KP2], createdAt: now },
    ],
  });
});

describe("profileForStudent", () => {
  it("aggregates mastery from AssignmentPerformance", async () => {
    const p = await profileForStudent(prisma, { userId: STUDENT, window: "ALL" });
    expect(p.hasData).toBe(true);
    expect(p.totalGradedItems).toBe(4);
    const k1 = p.masteries.find((m) => m.kpName === "一元一次方程")!;
    expect(k1.tier).toBe("PROGRESSING");
    expect(p.strengths).toContain("因式分解");
  });
});

describe("classDiagnosis", () => {
  it("aggregates across class members", async () => {
    const d = await classDiagnosis(prisma, { classroomId: CLASSROOM, window: "ALL" });
    expect(d.studentCount).toBe(1);
    expect(d.kpStats.length).toBeGreaterThanOrEqual(2);
  });
});
