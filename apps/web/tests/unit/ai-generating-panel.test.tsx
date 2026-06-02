import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";

describe("AiGeneratingPanel", () => {
  it("shows calm generating copy with an animation", () => {
    const html = renderToStaticMarkup(<AiGeneratingPanel label="AI 生成中…" />);
    expect(html).toContain("AI 生成中");
    expect(html).toContain("animate-pulse");
  });
});
