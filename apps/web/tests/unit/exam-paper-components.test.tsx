import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ObjectiveAnswerGrid,
  StudentSection,
  TeacherSection,
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

describe("StudentSection zhongkao answer areas", () => {
  it("uses extraLarge answer area height for capstone items", () => {
    const html = renderToStaticMarkup(<StudentSection section={capstoneSection} />);
    expect(html).toContain("11.5cm");
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
