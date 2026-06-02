import { describe, expect, it } from "vitest";
import {
  assignmentStatusLabel,
  assignmentTierLabel,
  gradeStatusLabel,
  questionTypeLabel,
  rootCauseLabel,
} from "@/lib/assignment-copy";

describe("assignment copy helpers", () => {
  it("maps assignment enums to Chinese product labels", () => {
    expect(assignmentStatusLabel("PUBLISHED")).toBe("已发布");
    expect(assignmentTierLabel("CONSOLIDATION")).toBe("巩固层");
    expect(questionTypeLabel("CALCULATION")).toBe("计算题");
    expect(gradeStatusLabel("WRONG")).toBe("待订正");
    expect(rootCauseLabel("CALCULATION_SLIP")).toBe("计算疏漏");
  });
});
