import { describe, it, expect } from "vitest";
import { familyView } from "@/server/lib/learning-projection";
import type { LearningProfile } from "@zhijiao/analytics";

const profile: LearningProfile = {
  window: "D90",
  generatedAt: "2026-05-29T00:00:00.000Z",
  totalGradedItems: 10,
  overallScore: 0.72,
  hasData: true,
  masteries: [
    { kpId: "k1", kpName: "因式分解", tier: "FOCUS", score: 0.4, weightedSampleSize: 3, rawSampleSize: 3, recentErrorCount: 2 },
    { kpId: "k2", kpName: "方程", tier: "SOLID", score: 0.9, weightedSampleSize: 4, rawSampleSize: 4, recentErrorCount: 0 },
    { kpId: "k3", kpName: "几何", tier: "INSUFFICIENT_DATA", score: null, weightedSampleSize: 0.2, rawSampleSize: 1, recentErrorCount: 0 },
  ],
  focusAreas: ["因式分解"],
  strengths: ["方程"],
};

describe("familyView", () => {
  it("strips per-KP scores, keeps coarse counts + names", () => {
    const v = familyView(profile);
    expect(v.hasData).toBe(true);
    expect(v.solidCount).toBe(1);
    expect(v.progressingCount).toBe(0);
    expect(v.focusCount).toBe(1);
    expect(v.focusAreas).toEqual(["因式分解"]);
    expect(v.strengths).toEqual(["方程"]);
    // 不泄露原始分数
    expect(JSON.stringify(v)).not.toContain("0.4");
    expect(JSON.stringify(v)).not.toContain("overallScore");
  });
});
