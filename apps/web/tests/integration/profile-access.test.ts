import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@zhijiao/db";
import { TRPCError } from "@trpc/server";
import { requireProfileAccess } from "@/server/lib/profile-access";

const STU = "pa-stu", PAR = "pa-par", TEA = "pa-tea", STR = "pa-str";
const SUBJ = "pa-subj", CLS = "pa-cls";

beforeAll(async () => {
  await prisma.subject.upsert({ where: { id: SUBJ }, update: {}, create: { id: SUBJ, code: "pa-m", name: "PA数学" } });
  for (const id of [STU, PAR, TEA, STR]) {
    await prisma.user.upsert({ where: { id }, update: {}, create: { id, persona: "STUDENT" } });
  }
  await prisma.classroom.upsert({ where: { id: CLS }, update: {}, create: { id: CLS, name: "PA班", subjectId: SUBJ } });
  await prisma.classroomMember.upsert({ where: { classroomId_userId: { classroomId: CLS, userId: TEA } }, update: {}, create: { classroomId: CLS, userId: TEA, role: "TEACHER" } });
  await prisma.classroomMember.upsert({ where: { classroomId_userId: { classroomId: CLS, userId: STU } }, update: {}, create: { classroomId: CLS, userId: STU, role: "STUDENT" } });
  await prisma.familyLink.deleteMany({ where: { studentUserId: STU } });
  await prisma.familyLink.create({ data: { parentUserId: PAR, studentUserId: STU, status: "ACTIVE" } });
});

describe("requireProfileAccess", () => {
  it("self", async () => expect(await requireProfileAccess(prisma, STU, STU)).toBe("self"));
  it("parent", async () => expect(await requireProfileAccess(prisma, PAR, STU)).toBe("parent"));
  it("teacher", async () => expect(await requireProfileAccess(prisma, TEA, STU)).toBe("teacher"));
  it("stranger → NOT_FOUND", async () => {
    await expect(requireProfileAccess(prisma, STR, STU)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("revoked parent → NOT_FOUND", async () => {
    await prisma.familyLink.updateMany({ where: { parentUserId: PAR, studentUserId: STU }, data: { status: "REVOKED" } });
    await expect(requireProfileAccess(prisma, PAR, STU)).rejects.toBeInstanceOf(TRPCError);
    await prisma.familyLink.updateMany({ where: { parentUserId: PAR, studentUserId: STU }, data: { status: "ACTIVE" } });
  });
});
