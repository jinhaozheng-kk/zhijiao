import { describe, it, expect } from "vitest";
import {
  TEXTBOOK_VERSIONS,
  textbookVersionLabel,
  examSectionTitle,
  EXAM_NOTICE,
} from "@/lib/paper-copy";

describe("paper-copy 统考扩展", () => {
  it("教材版本含通用且默认 label 正确", () => {
    expect(TEXTBOOK_VERSIONS).toContain("GENERIC");
    expect(textbookVersionLabel("RENJIAO")).toBe("人教版");
    expect(textbookVersionLabel("GENERIC")).toBe("通用");
  });

  it("大题标题把单选/多选都归到选择题口径", () => {
    expect(examSectionTitle("SINGLE_CHOICE")).toBe("选择题");
    expect(examSectionTitle("MULTI_CHOICE")).toBe("多选题");
    expect(examSectionTitle("FILL_BLANK")).toBe("填空题");
    expect(examSectionTitle("CALCULATION")).toBe("计算题");
    expect(examSectionTitle("PROOF")).toBe("证明题");
    expect(examSectionTitle("ESSAY")).toBe("解答题");
  });

  it("注意事项是数组且不含违规措辞", () => {
    expect(EXAM_NOTICE.length).toBeGreaterThan(0);
    const joined = EXAM_NOTICE.join("");
    for (const bad of ["提分", "涨分", "保过", "必考", "分数"]) {
      expect(joined).not.toContain(bad);
    }
  });
});
