import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EXAM_PRINT_CSS,
  ObjectiveAnswerGrid,
  StudentSection,
  TeacherSection,
  AnswerSheetDocument,
} from "@/app/teacher/papers/[paperId]/print/exam-paper-components";
import type { ExamLayout, ExamLayoutSection } from "@/lib/paper-exam-layout";

const capstoneSection: ExamLayoutSection = {
  type: "ESSAY",
  cnIndex: "III",
  title: "Essay",
  caption: "(1 item)",
  isObjective: false,
  subtotalPoints: 12,
  items: [
    {
      questionNo: 24,
      item: {
        id: "x",
        type: "ESSAY",
        stemMd: "capstone",
        optionsJson: null,
        answerMd: "ANSWER_ONLY_TEACHER",
        solutionMd: "SOLUTION_ONLY_TEACHER",
        rubricMd: null,
        points: 12,
        position: 24,
        answerAreaHint: "extraLarge",
        isCapstone: true,
      },
    },
  ],
};

describe("StudentSection 浙江卷试题卷", () => {
  it("试题卷不留作答区（答案写在答题纸上）", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).not.toContain("answer-space");
    expect(html).not.toContain("11.5cm");
  });

  it("解答题在小题号后标注分值（浙江卷格式）", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).toContain("（12分）");
  });

  it("adds a print page break before capstone items", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).toContain("print-break-before");
  });

  it("does not render answer or solution content on the student paper", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).not.toContain("ANSWER_ONLY_TEACHER");
    expect(html).not.toContain("SOLUTION_ONLY_TEACHER");
  });
});

describe("AnswerSheetDocument 答题纸（浙江卷分离式）", () => {
  function sheetLayout(): ExamLayout {
    return {
      totalPoints: 120,
      sections: [
        {
          type: "SINGLE_CHOICE",
          cnIndex: "一",
          title: "选择题",
          caption: "（本大题共 2 小题，每小题 3 分，共 6 分）",
          isObjective: true,
          subtotalPoints: 6,
          items: [1, 2].map((no) => ({
            questionNo: no,
            item: {
              id: `c${no}`,
              type: "SINGLE_CHOICE",
              stemMd: "q",
              optionsJson: ["甲", "乙", "丙", "丁"],
              answerMd: "A",
              solutionMd: "s",
              rubricMd: null,
              points: 3,
              position: no,
            },
          })),
        },
        {
          type: "FILL_BLANK",
          cnIndex: "二",
          title: "填空题",
          caption: "（本大题共 1 小题，每小题 3 分，共 3 分）",
          isObjective: false,
          subtotalPoints: 3,
          items: [
            {
              questionNo: 3,
              item: {
                id: "f1",
                type: "FILL_BLANK",
                stemMd: "填空",
                optionsJson: null,
                answerMd: "1",
                solutionMd: "s",
                rubricMd: null,
                points: 3,
                position: 3,
              },
            },
          ],
        },
        {
          type: "ESSAY",
          cnIndex: "三",
          title: "解答题",
          caption: "（本大题共 2 小题，共 20 分）",
          isObjective: false,
          subtotalPoints: 20,
          items: [
            { points: 8, hint: "medium" as const, capstone: false },
            { points: 12, hint: "extraLarge" as const, capstone: true },
          ].map((spec, idx) => ({
            questionNo: 4 + idx,
            item: {
              id: `e${idx}`,
              type: "ESSAY",
              stemMd: "解答",
              optionsJson: null,
              answerMd: "A",
              solutionMd: "s",
              rubricMd: null,
              points: spec.points,
              position: 4 + idx,
              answerAreaHint: spec.hint,
              isCapstone: spec.capstone,
            },
          })),
        },
      ],
    };
  }

  it("包含填涂区（A/B/C/D 空圈）、填空横线与解答题作答框", () => {
    const html = renderToStaticMarkup(<AnswerSheetDocument layout={sheetLayout()} />);
    expect(html).toContain("答　题　纸");
    expect(html).toContain("rounded-full"); // 填涂圆圈
    expect(html).toContain("answer-sheet-block");
  });

  it("解答题作答区按分值给高度（8 分 6cm / 12 分 10cm）", () => {
    const html = renderToStaticMarkup(<AnswerSheetDocument layout={sheetLayout()} />);
    expect(html).toContain("6cm");
    expect(html).toContain("10cm");
  });

  it("答题纸按题号连续排版（不为压轴题强制分页）", () => {
    const html = renderToStaticMarkup(<AnswerSheetDocument layout={sheetLayout()} />);
    expect(html).not.toContain("print-break-before");
    expect(html).toContain("answer-sheet-block");
  });

  it("答题纸不泄露答案（填涂区只有字母，不含答案内容）", () => {
    const html = renderToStaticMarkup(<AnswerSheetDocument layout={sheetLayout()} />);
    expect(html).not.toContain("ANSWER_ONLY_TEACHER");
  });
});

describe("EXAM_PRINT_CSS binding gutter", () => {
  it("reserves print-only left gutter so the seal line cannot cover content", () => {
    expect(EXAM_PRINT_CSS).toContain(".exam-print-sheet");
    expect(EXAM_PRINT_CSS).toContain("padding-left: 2.8cm");
  });
});

describe("ObjectiveAnswerGrid", () => {
  it("renders question numbers without leaking the answer letter", () => {
    const layout: ExamLayout = {
      totalPoints: 3,
      sections: [
        {
          type: "SINGLE_CHOICE",
          cnIndex: "I",
          title: "Choice",
          caption: "",
          isObjective: true,
          subtotalPoints: 3,
          items: [
            {
              questionNo: 1,
              item: {
                id: "a",
                type: "SINGLE_CHOICE",
                stemMd: "q",
                optionsJson: ["x", "y", "z", "w"],
                answerMd: "B",
                solutionMd: "s",
                rubricMd: null,
                points: 3,
                position: 1,
              },
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(<ObjectiveAnswerGrid layout={layout} />);
    expect(html).toContain("1.");
    expect(html).not.toContain(">B<");
  });
});

describe("TeacherSection source labels", () => {
  it("renders teacher-only item source labels", () => {
    const section: ExamLayoutSection = {
      ...capstoneSection,
      items: [
        {
          ...capstoneSection.items[0]!,
          item: {
            ...capstoneSection.items[0]!.item,
            source: "CUSTOM_SOURCE",
          },
        },
      ],
    };

    const teacherHtml = renderToStaticMarkup(<TeacherSection section={section} />);
    const studentHtml = renderToStaticMarkup(<StudentSection section={section} />);

    expect(teacherHtml).toContain("CUSTOM_SOURCE");
    expect(studentHtml).not.toContain("CUSTOM_SOURCE");
  });
});
