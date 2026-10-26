import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaperSpecTable } from "@/app/teacher/papers/paper-detail-components";
import { PaperGenerationForm, computePaperTotals } from "@/app/teacher/papers/new/paper-generation-form";
import { PaperPreviewView } from "@/app/teacher/papers/[paperId]/paper-preview-view";
import { PaperPrintView } from "@/app/teacher/papers/[paperId]/print/paper-print-view";

const mocks = vi.hoisted(() => ({
  paperGetResult: {
    isLoading: false,
    isError: false,
    data: null as unknown,
  },
}));

// ---------------------------------------------------------------------------
// Mock dependencies required by PaperGenerationForm (client component)
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/ui/ai-generating-panel", () => ({
  AiGeneratingPanel: ({ label }: { label?: string }) => (
    <div data-testid="ai-generating-panel">{label ?? "ai-generating"}</div>
  ),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      paper: {
        get: { invalidate: vi.fn() },
      },
    }),
    paper: {
      get: {
        useQuery: () => mocks.paperGetResult,
      },
      generate: {
        useMutation: () => ({
          isPending: false,
          mutate: vi.fn(),
          reset: vi.fn(),
        }),
      },
      markReady: {
        useMutation: () => ({
          isPending: false,
          mutate: vi.fn(),
        }),
      },
      updateItemPoints: {
        useMutation: () => ({
          isPending: false,
          mutate: vi.fn(),
        }),
      },
      removeItem: {
        useMutation: () => ({
          isPending: false,
          mutate: vi.fn(),
        }),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Existing test: PaperSpecTable static rendering
// ---------------------------------------------------------------------------
describe("paper UI components", () => {
  it("renders the spec table rows and totals", () => {
    const html = renderToStaticMarkup(
      <PaperSpecTable
        specTable={{
          rows: [
            {
              kp: "一次函数",
              cognitiveLevel: "APPLY",
              type: "CALCULATION",
              difficulty: 3,
              count: 2,
              points: 10,
            },
          ],
          totalCount: 2,
          totalPoints: 10,
        }}
      />,
    );

    expect(html).toContain("双向细目表");
    expect(html).toContain("一次函数");
    expect(html).toContain("应用");
    expect(html).toContain("计算题");
    expect(html).toContain("合计 2 题");
    expect(html).toContain("10 分");
  });
});

// ---------------------------------------------------------------------------
// SSR smoke test: PaperGenerationForm default state totals
// ---------------------------------------------------------------------------
describe("PaperGenerationForm 默认状态静态渲染", () => {
  it("默认题型配置渲染正确的总题数与满分（SINGLE_CHOICE 6×3=18 + CALCULATION 4×8=32 = 50 分，10 题）", () => {
    const html = renderToStaticMarkup(
      <PaperGenerationForm
        subjectId="s1"
        kps={[{ id: "k1", name: "一次函数" }]}
      />,
    );

    // total-count and total-points spans appear in the rendered HTML
    expect(html).toContain('data-testid="total-count"');
    expect(html).toContain('data-testid="total-points"');
    // Default: SINGLE_CHOICE 6×3=18 + CALCULATION 4×8=32 = 50 points, 10 questions
    expect(html).toContain(">10<");
    expect(html).toContain(">50<");
  });

  it("renders a one-click zhongkao generation entry", () => {
    const html = renderToStaticMarkup(
      <PaperGenerationForm
        subjectId="s1"
        kps={[{ id: "k1", name: "kp1" }]}
      />,
    );

    expect(html).toContain('data-testid="generate-zhongkao"');
  });
});

describe("PaperPreviewView READY status (no DRAFT banner)", () => {
  it("does not render DRAFT notice or warnings block when paper is READY", () => {
    mocks.paperGetResult = {
      isLoading: false,
      isError: false,
      data: {
        paper: {
          id: "p2",
          title: "Ready Paper",
          status: "READY",
          paramsJson: {
            styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
            reviewWarnings: [
              { slotQuestionNo: 1, code: "STEM_TOO_LONG", message: "too long" },
            ],
          },
          items: [],
        },
        specTable: { rows: [], totalCount: 0, totalPoints: 0 },
      },
    };

    const html = renderToStaticMarkup(<PaperPreviewView paperId="p2" />);
    expect(html).not.toContain('data-testid="ai-draft-notice"');
    expect(html).not.toContain('data-testid="review-warnings"');
  });
});

describe("PaperPreviewView zhongkao blueprint panel", () => {
  it("renders blueprint slots and review warnings from paramsJson", () => {
    mocks.paperGetResult = {
      isLoading: false,
      isError: false,
      data: {
        paper: {
          id: "p1",
          title: "Zhongkao Paper",
          status: "DRAFT",
          paramsJson: {
            styleTemplate: "JUNIOR_MATH_ZHONGKAO_GENERIC_V1",
            blueprint: {
              isTopical: true,
              slots: [
                {
                  questionNo: 24,
                  questionType: "ESSAY",
                  points: 12,
                  difficulty: 5,
                  cognitiveLevel: "ANALYZE",
                  intent: "capstone intent",
                  kpNames: ["function"],
                  isCapstone: true,
                },
              ],
            },
            reviewWarnings: [
              {
                slotQuestionNo: 24,
                code: "STEM_TOO_LONG",
                message: "check stem length",
              },
            ],
          },
          items: [],
        },
        specTable: { rows: [], totalCount: 0, totalPoints: 0 },
      },
    };

    const html = renderToStaticMarkup(<PaperPreviewView paperId="p1" />);

    expect(html).toContain('data-testid="zhongkao-blueprint"');
    expect(html).toContain("JUNIOR_MATH_ZHONGKAO_GENERIC_V1");
    expect(html).toContain("capstone intent");
    expect(html).toContain('data-testid="review-warnings"');
    expect(html).toContain("check stem length");
    // B1-UI: DRAFT notice banner is present for DRAFT status
    expect(html).toContain('data-testid="ai-draft-notice"');
    // B1-UI: warnings rendered as anchor links pointing to item anchors
    expect(html).toContain('href="#paper-item-24"');
  });

  it("renders review blockers and disables final confirmation affordance", () => {
    mocks.paperGetResult = {
      isLoading: false,
      isError: false,
      data: {
        paper: {
          id: "p-blocked",
          title: "Blocked Paper",
          status: "DRAFT",
          paramsJson: {
            reviewBlockers: [
              {
                slotQuestionNo: 1,
                code: "EMPTY_ANSWER",
                message: "answer is empty",
              },
            ],
          },
          items: [
            {
              id: "i1",
              position: 1,
              source: "AI_GENERATED",
              stemMd: "Question",
              type: "SINGLE_CHOICE",
              answerMd: "",
              solutionMd: "Because",
              points: 3,
              difficulty: 2,
              kpHints: [],
            },
          ],
        },
        specTable: { rows: [], totalCount: 1, totalPoints: 3 },
      },
    };

    const html = renderToStaticMarkup(<PaperPreviewView paperId="p-blocked" />);

    expect(html).toContain('data-testid="review-blockers"');
    expect(html).toContain("answer is empty");
    expect(html).toContain('href="#paper-item-1"');
    expect(html).toContain("不能确认完成");
    expect(html).toContain("disabled");
  });
});

describe("PaperPrintView print layout", () => {
  it("marks the printable sheet so print CSS can reserve the binding gutter", () => {
    mocks.paperGetResult = {
      isLoading: false,
      isError: false,
      data: {
        paper: {
          id: "p1",
          title: "Printable Paper",
          status: "DRAFT",
          paramsJson: { gradeLevel: "G9", durationMinutes: 120 },
          items: [
            {
              id: "i1",
              type: "SINGLE_CHOICE",
              stemMd: "Question",
              optionsJson: ["A", "B", "C", "D"],
              answerMd: "A",
              solutionMd: "Because",
              rubricMd: null,
              points: 3,
              position: 1,
              source: "AI_GENERATED",
            },
          ],
        },
        specTable: { rows: [], totalCount: 1, totalPoints: 3 },
      },
    };

    const html = renderToStaticMarkup(<PaperPrintView paperId="p1" />);

    expect(html).toContain("exam-print-sheet");
  });

  it("blocks printing when automatic review has blockers", () => {
    mocks.paperGetResult = {
      isLoading: false,
      isError: false,
      data: {
        paper: {
          id: "p-blocked",
          title: "Blocked Printable Paper",
          status: "DRAFT",
          paramsJson: {
            reviewBlockers: [
              { slotQuestionNo: 1, code: "EMPTY_ANSWER", message: "answer is empty" },
            ],
          },
          items: [],
        },
        specTable: { rows: [], totalCount: 0, totalPoints: 0 },
      },
    };

    const html = renderToStaticMarkup(<PaperPrintView paperId="p-blocked" />);

    expect(html).toContain('data-testid="print-review-blocked"');
    expect(html).toContain("answer is empty");
    expect(html).toContain("不能打印最终卷");
    expect(html).toContain("disabled");
  });
});

// ---------------------------------------------------------------------------
// Unit test: computePaperTotals pure formula
// ---------------------------------------------------------------------------
describe("computePaperTotals 按题型 count×points 汇总", () => {
  it("多题型正确汇总", () => {
    expect(
      computePaperTotals({
        SINGLE_CHOICE: { count: 3, pointsPerItem: 3 },
        CALCULATION: { count: 2, pointsPerItem: 8 },
      }),
    ).toEqual({ totalCount: 5, totalPoints: 25 });
  });

  it("空配置返回零", () => {
    expect(computePaperTotals({})).toEqual({ totalCount: 0, totalPoints: 0 });
  });

  it("默认值与组件 DEFAULT_SECTIONS 匹配（SINGLE_CHOICE 6×3 + CALCULATION 4×8）", () => {
    expect(
      computePaperTotals({
        SINGLE_CHOICE: { count: 6, pointsPerItem: 3 },
        CALCULATION: { count: 4, pointsPerItem: 8 },
      }),
    ).toEqual({ totalCount: 10, totalPoints: 50 });
  });
});
