// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaperSpecTable } from "@/app/teacher/papers/paper-detail-components";
import { PaperGenerationForm } from "@/app/teacher/papers/new/paper-generation-form";

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
        useMutation: ({ onError }: { onSuccess?: unknown; onError?: (e: unknown) => void } = {}) => ({
          isPending: false,
          mutate: vi.fn(),
          ...(onError ? {} : {}),
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
// New interactive test: PaperGenerationForm live total
// ---------------------------------------------------------------------------
describe("PaperGenerationForm 满分实时汇总", () => {
  it("满分随题型题数与每题分值实时汇总", async () => {
    const user = userEvent.setup();

    render(
      <PaperGenerationForm
        subjectId="s1"
        kps={[{ id: "k1", name: "一次函数" }]}
      />,
    );

    // Default state: SINGLE_CHOICE (6×3=18) + CALCULATION (4×8=32) = 50 pts, 10 questions
    expect(screen.getByTestId("total-points")).toHaveTextContent("50");
    expect(screen.getByTestId("total-count")).toHaveTextContent("10");

    // Deselect CALCULATION so only SINGLE_CHOICE remains
    await user.click(screen.getByTestId("type-toggle-CALCULATION"));

    // Now only SINGLE_CHOICE: 6×3 = 18 pts
    expect(screen.getByTestId("total-points")).toHaveTextContent("18");

    // Change count to 3
    const countInput = screen.getByTestId("count-SINGLE_CHOICE");
    await user.clear(countInput);
    await user.type(countInput, "3");

    // Change points per item to 3
    const pointsInput = screen.getByTestId("points-SINGLE_CHOICE");
    await user.clear(pointsInput);
    await user.type(pointsInput, "3");

    // 3 × 3 = 9
    expect(screen.getByTestId("total-points")).toHaveTextContent("9");
    expect(screen.getByTestId("total-count")).toHaveTextContent("3");
  });
});
