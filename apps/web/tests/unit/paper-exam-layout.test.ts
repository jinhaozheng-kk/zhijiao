import { describe, it, expect } from "vitest";
import { buildExamLayout, type ExamLayoutPaperItem } from "@/lib/paper-exam-layout";

function item(p: Partial<ExamLayoutPaperItem>): ExamLayoutPaperItem {
  return {
    id: p.id ?? "x",
    type: p.type ?? "CALCULATION",
    stemMd: p.stemMd ?? "题",
    optionsJson: p.optionsJson ?? null,
    answerMd: p.answerMd ?? "答",
    solutionMd: p.solutionMd ?? "解",
    rubricMd: p.rubricMd ?? null,
    points: p.points ?? 5,
    position: p.position ?? 1,
    answerAreaHint: p.answerAreaHint,
    isCapstone: p.isCapstone,
    source: p.source,
  };
}

describe("buildExamLayout", () => {
  it("按统考题型序分大题，跨类型小题号连续，中文序号递增", () => {
    const layout = buildExamLayout([
      item({ id: "c1", type: "CALCULATION", position: 1, points: 8 }),
      item({ id: "s1", type: "SINGLE_CHOICE", position: 2, points: 3 }),
      item({ id: "s2", type: "SINGLE_CHOICE", position: 3, points: 3 }),
      item({ id: "f1", type: "FILL_BLANK", position: 4, points: 3 }),
    ]);
    expect(layout.sections.map((s) => s.type)).toEqual([
      "SINGLE_CHOICE",
      "FILL_BLANK",
      "CALCULATION",
    ]);
    expect(layout.sections.map((s) => s.cnIndex)).toEqual(["一", "二", "三"]);
    expect(layout.sections[0]!.items.map((i) => i.questionNo)).toEqual([1, 2]);
    expect(layout.sections[1]!.items.map((i) => i.questionNo)).toEqual([3]);
    expect(layout.sections[2]!.items.map((i) => i.questionNo)).toEqual([4]);
    expect(layout.totalPoints).toBe(8 + 3 + 3 + 3);
    expect(layout.sections.map((s) => s.title)).toEqual(["选择题", "填空题", "计算题"]);
  });

  it("同大题分值一致用'每小题X分'，不一致省略每小题分值", () => {
    const uniform = buildExamLayout([
      item({ id: "a", type: "SINGLE_CHOICE", position: 1, points: 3 }),
      item({ id: "b", type: "SINGLE_CHOICE", position: 2, points: 3 }),
    ]);
    expect(uniform.sections[0]!.caption).toBe("（本大题共 2 小题，每小题 3 分，共 6 分）");
    expect(uniform.sections[0]!.subtotalPoints).toBe(6);

    const varied = buildExamLayout([
      item({ id: "a", type: "CALCULATION", position: 1, points: 8 }),
      item({ id: "b", type: "CALCULATION", position: 2, points: 10 }),
    ]);
    expect(varied.sections[0]!.caption).toBe("（本大题共 2 小题，共 18 分）");
  });

  it("客观题标记 isObjective", () => {
    const layout = buildExamLayout([
      item({ id: "a", type: "SINGLE_CHOICE", position: 1 }),
      item({ id: "b", type: "FILL_BLANK", position: 2 }),
    ]);
    expect(layout.sections[0]!.isObjective).toBe(true);
    expect(layout.sections[1]!.isObjective).toBe(false);
  });

  it("空题目返回空布局", () => {
    expect(buildExamLayout([])).toEqual({ sections: [], totalPoints: 0 });
  });

  it("同大题内按 position 排序，与输入顺序无关", () => {
    const layout = buildExamLayout([
      item({ id: "c2", type: "CALCULATION", position: 5, points: 8 }),
      item({ id: "c1", type: "CALCULATION", position: 2, points: 8 }),
    ]);
    expect(layout.sections[0]!.items.map((i) => i.item.id)).toEqual(["c1", "c2"]);
    expect(layout.sections[0]!.items.map((i) => i.questionNo)).toEqual([1, 2]);
  });

  it("passes zhongkao answer area and capstone metadata through", () => {
    const layout = buildExamLayout([
      item({
        id: "capstone",
        type: "ESSAY",
        position: 24,
        answerAreaHint: "extraLarge",
        isCapstone: true,
      }),
    ]);

    expect(layout.sections[0]!.items[0]!.item.answerAreaHint).toBe("extraLarge");
    expect(layout.sections[0]!.items[0]!.item.isCapstone).toBe(true);
  });
});
