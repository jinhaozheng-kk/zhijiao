import type { LearningProfile } from "@zhijiao/analytics";

export interface FamilyProfileView {
  window: string;
  generatedAt: string;
  hasData: boolean;
  solidCount: number;
  progressingCount: number;
  focusCount: number;
  focusAreas: string[]; // 建议关注的知识点名（无分数）
  strengths: string[]; // 掌握扎实的知识点名
}

// 家长简版：剥掉每-KP 数字/分数/overallScore，只给粗粒度计数 + 知识点名。
// 不含排名、不含百分比、不含 INSUFFICIENT_DATA 噪音。
export function familyView(profile: LearningProfile): FamilyProfileView {
  const count = (tier: string) =>
    profile.masteries.filter((m) => m.tier === tier).length;
  return {
    window: profile.window,
    generatedAt: profile.generatedAt,
    hasData: profile.hasData,
    solidCount: count("SOLID"),
    progressingCount: count("PROGRESSING"),
    focusCount: count("FOCUS"),
    focusAreas: profile.focusAreas,
    strengths: profile.strengths,
  };
}
