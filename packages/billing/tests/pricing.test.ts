import { describe, it, expect } from "vitest";
import { priceOf, type ActionKind } from "../src/pricing";

describe("priceOf", () => {
  it("TUTOR_ASK = 1", () => expect(priceOf("TUTOR_ASK")).toBe(1));
  it("PAPER_GEN = 5", () => expect(priceOf("PAPER_GEN")).toBe(5));
  it("LESSON_PLAN_GEN = 3", () =>
    expect(priceOf("LESSON_PLAN_GEN")).toBe(3));
  it("PPT_GEN = 5", () => expect(priceOf("PPT_GEN")).toBe(5));
  it("VARIANT_GROUP_GEN = 3", () =>
    expect(priceOf("VARIANT_GROUP_GEN")).toBe(3));
  it("ERROR_ANALYSIS = 1", () =>
    expect(priceOf("ERROR_ANALYSIS")).toBe(1));
  it("unknown kind throws", () => {
    expect(() => priceOf("NOPE" as ActionKind)).toThrow(/Unknown action kind/);
  });
});
