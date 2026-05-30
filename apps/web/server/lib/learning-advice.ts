import "server-only";
import type { LearningProfile } from "@zhijiao/analytics";
import { getAiRouter } from "@/lib/ai-client";

// 从 profile 派生 AI 输入（只取 KP 名 + tier/score，无 PII、无自由文本）
export function buildAdviceInput(profile: LearningProfile, studentGrade: string | null) {
  return {
    studentGrade: studentGrade ?? undefined,
    focusAreas: profile.masteries
      .filter((m) => m.tier === "FOCUS")
      .slice(0, 8)
      .map((m) => ({ kpName: m.kpName, score: m.score })),
    strengths: profile.strengths.slice(0, 8),
  };
}

export async function generateAdviceForProfile(
  userId: string,
  profile: LearningProfile,
  studentGrade: string | null,
) {
  const aiRouter = getAiRouter(userId);
  return aiRouter.generateLearningAdvice(buildAdviceInput(profile, studentGrade));
}
