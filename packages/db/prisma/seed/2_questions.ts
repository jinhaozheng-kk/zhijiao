import { PrismaClient, QuestionType, QuestionStatus } from "@prisma/client";

export async function seedQuestions(prisma: PrismaClient) {
  const math = await prisma.subject.findUniqueOrThrow({ where: { code: "math" } });
  const kpSolve = await prisma.knowledgePoint.findUniqueOrThrow({
    where: { subjectId_code: { subjectId: math.id, code: "math-g8-linear-eq-solve" } },
  });

  const samples = [
    {
      stem: "解方程：2x + 5 = 13",
      answer: "x = 4",
      solution: "两边同减 5 得 2x = 8，两边同除 2 得 x = 4。",
      difficulty: 1,
    },
    {
      stem: "解方程：3(x - 2) = 2x + 1",
      answer: "x = 7",
      solution: "去括号：3x - 6 = 2x + 1，移项 x = 7。",
      difficulty: 2,
    },
    {
      stem: "解方程：(x + 1)/2 - (x - 3)/3 = 1",
      answer: "x = -3",
      solution: "通分两边乘 6：3(x+1) - 2(x-3) = 6，展开 3x+3-2x+6=6，得 x = -3。",
      difficulty: 3,
    },
  ];

  for (const s of samples) {
    const q = await prisma.question.create({
      data: {
        subjectId: math.id,
        stemMd: s.stem,
        type: QuestionType.CALCULATION,
        difficulty: s.difficulty,
        status: QuestionStatus.PUBLISHED,
        source: "自有",
        answer: { create: { contentMd: s.answer, solutionMd: s.solution } },
        knowledgePoints: { create: [{ kpId: kpSolve.id, weight: 1.0 }] },
      },
    });
    console.log(`  ✓ Question ${q.id}: ${s.stem.slice(0, 30)}...`);
  }

  console.log(`✓ ${samples.length} sample questions seeded`);
}
