// 合规黑词初稿；运营后台可扩展，但本地常量保留兜底
export const FORBIDDEN_PHRASES: readonly string[] = [
  "押中原题",
  "100% 命中",
  "100%命中",
  "保证提分",
  "保证升学",
  "保证通过",
  "包过",
  "内幕",
  "代做作业",
  "押题",
  "必考",
  "预测题",
  "原题还原",
  "还原原题",
  "考前答案",
];

// 命题预测中心的许可表述
export const FORECAST_APPROVED_LANGUAGE: readonly string[] = [
  "趋势研判",
  "考点方向分析",
  "高频考点",
  "考前重点研判",
];

// 给定文本，返回命中的黑词列表（去重 + 去空）
export function findForbidden(text: string): string[] {
  const hits = new Set<string>();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) hits.add(phrase);
  }
  return [...hits];
}
