import { prisma } from "@zhijiao/db/test-utils";

export async function seedAssignmentSubject() {
  const subject = await prisma.subject.create({
    data: { code: `math-${crypto.randomUUID()}`, name: "Math" },
  });
  const kp = await prisma.knowledgePoint.create({
    data: {
      subjectId: subject.id,
      code: `linear-${crypto.randomUUID()}`,
      name: "linear equations",
      difficulty: 2,
    },
  });
  return { subject, kp };
}

export async function seedAssignmentUser(persona: "TEACHER" | "STUDENT") {
  return prisma.user.create({
    data: {
      isMinor: persona === "STUDENT",
      persona,
      gradeLevel: persona === "STUDENT" ? "G8" : null,
    },
  });
}

export async function seedDraftAssignment() {
  const { subject } = await seedAssignmentSubject();
  const teacher = await seedAssignmentUser("TEACHER");
  const otherTeacher = await seedAssignmentUser("TEACHER");
  const students = await Promise.all([
    seedAssignmentUser("STUDENT"),
    seedAssignmentUser("STUDENT"),
  ]);
  const otherStudent = await seedAssignmentUser("STUDENT");

  const classroom = await prisma.classroom.create({
    data: {
      name: "G8 Math 1",
      subjectId: subject.id,
      gradeLevel: "G8",
      members: {
        create: [
          { userId: teacher.id, role: "TEACHER" },
          ...students.map((student) => ({
            userId: student.id,
            role: "STUDENT" as const,
          })),
        ],
      },
    },
  });

  const assignment = await prisma.assignment.create({
    data: {
      classroomId: classroom.id,
      teacherUserId: teacher.id,
      title: "Draft assignment",
      source: "MANUAL_AI",
      tiers: {
        create: [
          {
            level: "BASIC",
            title: "BASIC",
            rationaleMd: "Basic",
            items: {
              create: {
                position: 1,
                stemMd: "Solve x + 1 = 2.",
                type: "CALCULATION",
                answerMd: "x = 1",
                solutionMd: "Subtract 1.",
                kpHints: ["linear equations"],
              },
            },
          },
          {
            level: "CONSOLIDATION",
            title: "CONSOLIDATION",
            rationaleMd: "Consolidation",
            items: {
              create: {
                position: 1,
                stemMd: "Solve x + 3 = 7.",
                type: "CALCULATION",
                answerMd: "x = 4",
                solutionMd: "Subtract 3.",
                kpHints: ["linear equations"],
              },
            },
          },
          {
            level: "CHALLENGE",
            title: "CHALLENGE",
            rationaleMd: "Challenge",
            items: {
              create: {
                position: 1,
                stemMd: "Solve 2x + 5 = 13.",
                type: "CALCULATION",
                answerMd: "x = 4",
                solutionMd: "Subtract 5, then divide by 2.",
                kpHints: ["linear equations"],
              },
            },
          },
        ],
      },
    },
    include: { tiers: { include: { items: true } } },
  });

  return {
    teacher,
    otherTeacher,
    students,
    otherStudent,
    classroom,
    assignment,
  };
}

export async function seedPublishedAssignment() {
  const seeded = await seedDraftAssignment();
  const assignment = await prisma.assignment.update({
    where: { id: seeded.assignment.id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
    include: { tiers: { include: { items: true } } },
  });
  return { ...seeded, assignment };
}

export async function seedPublishedStudentAssignment() {
  const seeded = await seedPublishedAssignment();
  const assignedTier = seeded.assignment.tiers.find(
    (tier) => tier.level === "CONSOLIDATION",
  )!;
  const otherTier = seeded.assignment.tiers.find((tier) => tier.level === "BASIC")!;
  const student = seeded.students[0]!;
  const otherStudent = seeded.otherStudent;
  const studentAssignment = await prisma.studentAssignment.create({
    data: {
      assignmentId: seeded.assignment.id,
      studentUserId: student.id,
      tierId: assignedTier.id,
      suggestedTier: assignedTier.level,
    },
  });
  return {
    ...seeded,
    student,
    otherStudent,
    studentAssignment,
    assignedItem: assignedTier.items[0]!,
    otherTierItem: otherTier.items[0]!,
  };
}

export async function seedSubmittedAssignmentAnswer() {
  const seeded = await seedPublishedStudentAssignment();
  const kp = await prisma.knowledgePoint.create({
    data: {
      subjectId: seeded.classroom.subjectId,
      code: `assignment-linear-${crypto.randomUUID()}`,
      name: "assignment linear equations",
      difficulty: 2,
    },
  });
  const question = await prisma.question.create({
    data: {
      subjectId: seeded.classroom.subjectId,
      stemMd: seeded.assignedItem.stemMd,
      type: seeded.assignedItem.type,
      difficulty: 2,
      status: "PUBLISHED",
      source: "ASSIGNMENT_TEST",
      answer: {
        create: {
          contentMd: seeded.assignedItem.answerMd,
          solutionMd: seeded.assignedItem.solutionMd,
        },
      },
      knowledgePoints: {
        create: {
          kpId: kp.id,
          weight: 1,
        },
      },
    },
  });
  const assignedItem = await prisma.assignmentItem.update({
    where: { id: seeded.assignedItem.id },
    data: { questionId: question.id },
  });
  const studentAssignment = await prisma.studentAssignment.update({
    where: { id: seeded.studentAssignment.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  const answer = await prisma.assignmentAnswer.create({
    data: {
      studentAssignmentId: studentAssignment.id,
      itemId: assignedItem.id,
      answerJson: { text: "x = 4" },
    },
  });

  return {
    ...seeded,
    kp,
    question,
    assignedItem,
    studentAssignment,
    answer,
  };
}
