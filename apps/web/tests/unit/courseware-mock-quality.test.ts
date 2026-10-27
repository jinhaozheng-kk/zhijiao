import { describe, expect, it } from "vitest";
import { LessonPlanGenerationOutputSchema, MockAdapter } from "@zhijiao/ai";
import { reviewGeneratedCourseware } from "@/server/lib/courseware-review";

/**
 * E2E / 集成测试走 MockAdapter（AI_USE_MOCK=true）。课件生成现在带确定性质量门：
 * 如果 mock 课件被质量门判 BLOCKER，整条生成链路会在 E2E 里失败。
 * 这条测试把「mock 课件必须能过质量门」固化成契约（warnings 允许）。
 */
describe("MockAdapter 课件质量契约", () => {
  it("mock 五段课件通过质量门（无 BLOCKER）", async () => {
    const adapter = new MockAdapter();
    const response = await adapter.call({
      model: "mock",
      messages: [
        { role: "system", content: "你是严谨的 K12 数学课件生成助手。" },
        { role: "user", content: "生成一次函数课件" },
      ],
      responseFormat: "json_object",
      temperature: 0.4,
    });
    const parsed = LessonPlanGenerationOutputSchema.parse(JSON.parse(response.content));
    const blockers = reviewGeneratedCourseware(parsed).filter(
      (issue) => issue.severity === "BLOCKER",
    );
    expect(blockers).toEqual([]);
  });
});
