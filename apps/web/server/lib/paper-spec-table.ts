export interface SpecItem { kpHints: string[]; cognitiveLevel: string; type: string; difficulty: number; points: number; }
export interface SpecRow { kp: string; cognitiveLevel: string; type: string; difficulty: number; count: number; points: number; }
export interface SpecTable { rows: SpecRow[]; totalCount: number; totalPoints: number; }

export function buildSpecTable(items: SpecItem[]): SpecTable {
  const map = new Map<string, SpecRow>();
  let totalCount = 0;
  let totalPoints = 0;
  for (const it of items) {
    const kp = it.kpHints[0] ?? "(未标注)";
    const key = `${kp}|${it.cognitiveLevel}|${it.type}|${it.difficulty}`;
    const row = map.get(key) ?? { kp, cognitiveLevel: it.cognitiveLevel, type: it.type, difficulty: it.difficulty, count: 0, points: 0 };
    row.count += 1;
    row.points += it.points;
    map.set(key, row);
    totalCount += 1;
    totalPoints += it.points;
  }
  return { rows: [...map.values()], totalCount, totalPoints };
}
