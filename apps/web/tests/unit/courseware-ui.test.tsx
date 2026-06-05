import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  coursewareSectionTypeLabel,
  coursewareStatusLabel,
  type CoursewareSectionTypeValue,
} from "@/lib/courseware-copy";
import { LESSON_SECTION_ORDER } from "@zhijiao/ai";

describe("courseware UI copy", () => {
  it("五段类型各有中文标签且顺序固定", () => {
    const labels = LESSON_SECTION_ORDER.map((t) =>
      coursewareSectionTypeLabel(t as CoursewareSectionTypeValue),
    );
    expect(labels).toEqual([
      "课堂导入",
      "讲解结构",
      "例题",
      "易错点",
      "课堂练习",
    ]);
  });

  it("状态徽标中文", () => {
    expect(coursewareStatusLabel("DRAFT")).toBe("草稿");
    expect(coursewareStatusLabel("READY")).toBe("已完成");
  });

  it("五段标题渲染为静态标记", () => {
    const html = renderToStaticMarkup(
      <ul>
        {LESSON_SECTION_ORDER.map((t) => (
          <li key={t}>{coursewareSectionTypeLabel(t as CoursewareSectionTypeValue)}</li>
        ))}
      </ul>,
    );
    expect(html).toContain("课堂导入");
    expect(html).toContain("讲解结构");
    expect(html).toContain("例题");
    expect(html).toContain("易错点");
    expect(html).toContain("课堂练习");
  });
});
