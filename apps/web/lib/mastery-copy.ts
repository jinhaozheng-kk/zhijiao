import type { MasteryTier } from "@zhijiao/analytics";

export const TIER_COLOR: Record<MasteryTier, string> = {
  SOLID: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PROGRESSING: "bg-amber-100 text-amber-800 border-amber-200",
  FOCUS: "bg-sky-100 text-sky-800 border-sky-200", // 蓝=聚焦，非红=失败
  INSUFFICIENT_DATA: "bg-slate-100 text-slate-500 border-slate-200",
};

// 中性、不制造焦虑、按学段微调。gradeBand: "primary"|"junior"|"senior"
export function tierLabel(tier: MasteryTier): string {
  switch (tier) {
    case "SOLID":
      return "掌握扎实";
    case "PROGRESSING":
      return "稳步提升";
    case "FOCUS":
      return "重点巩固方向";
    case "INSUFFICIENT_DATA":
      return "数据不足";
  }
}

export function gradeBandOf(gradeLevel: string | null): "primary" | "junior" | "senior" {
  if (!gradeLevel) return "junior";
  if (["G5", "G6"].includes(gradeLevel)) return "primary";
  if (["G7", "G8", "G9"].includes(gradeLevel)) return "junior";
  return "senior";
}
