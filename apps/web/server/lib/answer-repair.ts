/**
 * 答案自愈闭环：抽检 → 对判为 WRONG 的题重写答案+解析 → 复检。
 *
 * 纯逻辑（verify/fix/applyFixes 全部注入），便于单测；调用方负责真实的 AI 与 DB。
 * 约束：
 * - 只对 WRONG 题做修复（UNCERTAIN 留给教师人工核对）；
 * - 最多 maxRounds 轮（默认 1 轮，控制耗时与成本）；
 * - 修复失败（AI 抛错/fixes 缺题）不阻塞出卷：把错误抛给调用方，由调用方 best-effort 记录。
 */

export interface AnswerRepairItem {
  questionNo: number;
  stemMd: string;
  answerMd: string;
  solutionMd: string;
}

export type AnswerVerdict = "CORRECT" | "WRONG" | "UNCERTAIN";

export interface AnswerVerdictItem {
  questionNo: number;
  verdict: AnswerVerdict;
  reason: string;
}

export interface AnswerFixItem {
  questionNo: number;
  answerMd: string;
  solutionMd: string;
}

export interface AnswerRepairResult {
  before: AnswerVerdictItem[];
  after: AnswerVerdictItem[];
  beforeWrong: number;
  afterWrong: number;
  fixedCount: number;
  rounds: number;
}

export async function runAnswerRepairLoop(args: {
  items: AnswerRepairItem[];
  verify: (items: AnswerRepairItem[]) => Promise<AnswerVerdictItem[]>;
  fix: (items: Array<AnswerRepairItem & { reason: string }>) => Promise<AnswerFixItem[]>;
  applyFixes: (fixes: AnswerFixItem[]) => Promise<void>;
  maxRounds?: number;
}): Promise<AnswerRepairResult> {
  const maxRounds = Math.max(0, args.maxRounds ?? 1);
  let current = [...args.items];
  const before = await args.verify(current);
  const beforeWrong = before.filter((item) => item.verdict === "WRONG").length;
  if (beforeWrong === 0 || maxRounds === 0) {
    return { before, after: before, beforeWrong, afterWrong: beforeWrong, fixedCount: 0, rounds: 0 };
  }

  let after = before;
  let fixedCount = 0;
  let rounds = 0;
  for (let round = 0; round < maxRounds; round++) {
    const wrongNow = after.filter((item) => item.verdict === "WRONG");
    if (wrongNow.length === 0) break;
    rounds += 1;
    const wrongById = new Map(wrongNow.map((item) => [item.questionNo, item]));
    const candidates = current
      .filter((item) => wrongById.has(item.questionNo))
      .map((item) => ({ ...item, reason: wrongById.get(item.questionNo)!.reason }));
    if (candidates.length === 0) break;

    const fixes = await args.fix(candidates);
    const validFixes = fixes.filter(
      (fix) => fix.answerMd.trim().length > 0 && fix.solutionMd.trim().length > 0,
    );
    if (validFixes.length === 0) break;
    await args.applyFixes(validFixes);
    fixedCount += validFixes.length;

    const fixById = new Map(validFixes.map((fix) => [fix.questionNo, fix]));
    current = current.map((item) => {
      const fix = fixById.get(item.questionNo);
      return fix ? { ...item, answerMd: fix.answerMd, solutionMd: fix.solutionMd } : item;
    });
    after = await args.verify(current);
  }

  return {
    before,
    after,
    beforeWrong,
    afterWrong: after.filter((item) => item.verdict === "WRONG").length,
    fixedCount,
    rounds,
  };
}
