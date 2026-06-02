import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  it("renders an animated placeholder", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain("animate-pulse");
  });

  it("renders N rows", () => {
    const html = renderToStaticMarkup(<SkeletonList rows={3} />);
    expect(html.match(/animate-pulse/g)?.length).toBe(3);
  });
});
