/**
 * 知识点选择器：按「学段 + 领域」整理 KP，避免把 185 个 KP（小学/初中/高中混在一起）
 * 平铺成一屏，教师找不到目标。
 *
 * 数据来源：knowledge_points.code，形如
 *   math-pri-*（小学）、math-jh-*（初中）、math-sh-*（高中）、math-g8-*（旧种子，按年级推断）、
 *   math-jh-alg-*（初中·数与代数）、math-jh-geo-*（图形与几何）、math-jh-stat-*、math-jh-prac-*。
 */

export type KpPickerItem = { id: string; name: string; code: string };
export type KpStage = "pri" | "jh" | "sh" | "other";

const GRADE_TO_STAGE: Record<string, KpStage> = {
  G1: "pri", G2: "pri", G3: "pri", G4: "pri", G5: "pri", G6: "pri",
  G7: "jh", G8: "jh", G9: "jh",
  G10: "sh", G11: "sh", G12: "sh",
};

export function stageForGrade(gradeLevel: string | undefined | null): KpStage {
  if (!gradeLevel) return "jh";
  return GRADE_TO_STAGE[gradeLevel] ?? "jh";
}

export function stageLabel(stage: KpStage): string {
  return stage === "pri" ? "小学" : stage === "jh" ? "初中" : stage === "sh" ? "高中" : "其它";
}

export function stageOfCode(code: string | undefined | null): KpStage {
  // 防御：旧缓存/RSC 数据里可能缺 code（页面更新过渡期），按初中处理而不是崩页面。
  const parts = String(code ?? "").split("-");
  if (parts.includes("pri")) return "pri";
  if (parts.includes("jh")) return "jh";
  if (parts.includes("sh")) return "sh";
  // 旧种子 code 如 math-g8-* / demo-g8-*：按年级推断学段
  const gradeToken = parts.find((part) => /^g(?:[1-9]|1[0-2])$/.test(part));
  if (gradeToken) return GRADE_TO_STAGE[gradeToken.toUpperCase()] ?? "other";
  return "other";
}

export type KpDomainKey = "alg" | "geo" | "stat" | "prac" | "other";

const DOMAIN_LABEL: Record<KpDomainKey, string> = {
  alg: "数与代数",
  geo: "图形与几何",
  stat: "统计与概率",
  prac: "综合与实践",
  other: "其它",
};
const DOMAIN_ORDER: KpDomainKey[] = ["alg", "geo", "stat", "prac", "other"];

export function domainOfCode(code: string | undefined | null): KpDomainKey {
  const parts = String(code ?? "").split("-");
  const token = parts.find((part) => part === "alg" || part === "geo" || part === "stat" || part === "prac");
  return (token as KpDomainKey | undefined) ?? "other";
}

export function domainLabel(domain: KpDomainKey): string {
  return DOMAIN_LABEL[domain];
}

export interface KpPickerGroup {
  key: KpDomainKey;
  label: string;
  items: KpPickerItem[];
}

export interface KpPickerResult {
  groups: KpPickerGroup[];
  /** 通过搜索+学段过滤后可见的数量（不含强制保留的已选项）。 */
  matchedCount: number;
  /** 因学段过滤被隐藏的数量（提示用）。 */
  hiddenByStage: number;
}

/**
 * 过滤 + 分组：
 * - 只显示当前学段的 KP（避免小学/高中串场）；
 * - `query` 按名称/代码模糊匹配；
 * - **已选中的 KP 始终保留**（否则搜索/切年级后无法取消选择）。
 */
export function groupKpsForPicker(
  items: KpPickerItem[],
  options: { gradeLevel?: string | null; query?: string; selectedIds?: string[] },
): KpPickerResult {
  const stage = stageForGrade(options.gradeLevel);
  const query = (options.query ?? "").trim().toLowerCase();
  const selected = new Set(options.selectedIds ?? []);

  const groups = new Map<KpDomainKey, KpPickerItem[]>();
  let matchedCount = 0;
  let hiddenByStage = 0;

  for (const item of items) {
    const itemStage = stageOfCode(item.code);
    const isSelected = selected.has(item.id);
    if (itemStage !== stage && !isSelected) {
      hiddenByStage += 1;
      continue;
    }
    // 搜索不匹配时也保留已选项，否则搜索/切年级后就无法取消选择
    if (query && !item.name.toLowerCase().includes(query) && !item.code.toLowerCase().includes(query) && !isSelected) {
      continue;
    }
    if (!isSelected) matchedCount += 1;
    const domain = domainOfCode(item.code);
    const list = groups.get(domain) ?? [];
    list.push(item);
    groups.set(domain, list);
  }

  return {
    groups: DOMAIN_ORDER.filter((domain) => (groups.get(domain)?.length ?? 0) > 0).map((domain) => ({
      key: domain,
      label: DOMAIN_LABEL[domain],
      items: groups.get(domain) ?? [],
    })),
    matchedCount,
    hiddenByStage,
  };
}
