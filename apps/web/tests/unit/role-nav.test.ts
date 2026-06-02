import { describe, expect, it } from "vitest";
import { navForRole } from "@/components/shell/RoleNav";

describe("role navigation", () => {
  it("returns student nav", () => {
    expect(navForRole("STUDENT").map((item) => item.label)).toEqual([
      "答疑",
      "错题本",
      "作业",
      "学情",
    ]);
  });

  it("returns teacher nav with Plan 17 and 18 preview entries", () => {
    expect(navForRole("TEACHER").map((item) => item.label)).toEqual([
      "班级",
      "作业",
      "学生",
      "AI 出卷",
      "AI 课件",
    ]);
  });

  it("returns parent nav", () => {
    expect(navForRole("PARENT").map((item) => item.label)).toEqual([
      "孩子",
      "学情",
      "隐私",
    ]);
  });
});
