import { describe, it, expect } from "vitest";
import { deriveIsMinor } from "../src/grade.js";

describe("deriveIsMinor", () => {
  it("STUDENT G5..G9 → true", () => {
    for (const g of ["G5","G6","G7","G8","G9"] as const) {
      expect(deriveIsMinor("STUDENT", g)).toBe(true);
    }
  });
  it("STUDENT G10..G12 → false", () => {
    for (const g of ["G10","G11","G12"] as const) {
      expect(deriveIsMinor("STUDENT", g)).toBe(false);
    }
  });
  it("STUDENT 无学段 → true（保守）", () => {
    expect(deriveIsMinor("STUDENT", null)).toBe(true);
  });
  it("TEACHER / PARENT → 不论 grade 都 false", () => {
    expect(deriveIsMinor("TEACHER", "G8")).toBe(false);
    expect(deriveIsMinor("PARENT", null)).toBe(false);
  });
});
