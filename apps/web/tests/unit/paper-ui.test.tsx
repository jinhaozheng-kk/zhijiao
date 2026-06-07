import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaperSpecTable } from "@/app/teacher/papers/paper-detail-components";
import { PaperGenerationForm, computePaperTotals } from "@/app/teacher/papers/new/paper-generation-form";

// ---------------------------------------------------------------------------
// Mock dependencies required by PaperGenerationForm (client component)
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/ui/ai-generating-panel", () => ({
  AiGeneratingPanel: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    paper: {
      generate: {
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
