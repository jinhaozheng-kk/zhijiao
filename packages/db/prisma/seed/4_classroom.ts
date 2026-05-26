import { ClassroomMemberRole, PrismaClient } from "@prisma/client";

export async function seedClassroom(prisma: PrismaClient) {
  const math = await prisma.subject.findUniqueOrThrow({
    where: { code: "math" },
  });

  const classroom = await prisma.classroom.upsert({
    where: { id: "dev-classroom-math-g8-01" },
    update: {
      name: "八年级数学 1 班",
      subjectId: math.id,
      gradeLevel: "G8",
    },
    create: {
      id: "dev-classroom-math-g8-01",
      name: "八年级数学 1 班",
      subjectId: math.id,
      gradeLevel: "G8",
    },
  });

  const members = [
    { userId: "dev-teacher-01", role: ClassroomMemberRole.TEACHER },
    { userId: "dev-student-01", role: ClassroomMemberRole.STUDENT },
    { userId: "dev-student-02", role: ClassroomMemberRole.STUDENT },
    { userId: "dev-student-03", role: ClassroomMemberRole.STUDENT },
  ];

  for (const member of members) {
    await prisma.classroomMember.upsert({
      where: {
        classroomId_userId: {
          classroomId: classroom.id,
          userId: member.userId,
        },
      },
      update: { role: member.role },
      create: {
        classroomId: classroom.id,
        userId: member.userId,
        role: member.role,
      },
    });
  }
}
