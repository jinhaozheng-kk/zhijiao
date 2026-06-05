import { describe, it, expect } from "vitest";
import { LessonPlanGenerationOutputSchema } from "../src/schemas.js";

const sec = (type: string) => ({ type, title: type, contentMd: "内容" });
const five = ["INTRO", "EXPLANATION", "EXAMPLE", "PITFALL", "EXERCISE"].map(sec);

describe("LessonPlanGenerationOutputSchema", () => {
  it("五段齐全过", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({ title: "课件", sections: five }),
    ).not.toThrow();
  });
  it("缺段拒", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({ title: "x", sections: five.slice(0, 4) }),
    ).toThrow();
  });
  it("重复段拒", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({
        title: "x",
        sections: [
          sec("INTRO"),
          sec("INTRO"),
          sec("EXPLANATION"),
          sec("EXAMPLE"),
          sec("PITFALL"),
        ],
      }),
    ).toThrow();
  });
  it("六段拒", () => {
    expect(() =>
      LessonPlanGenerationOutputSchema.parse({ title: "x", sections: [...five, sec("INTRO")] }),
    ).toThrow();
  });
});
