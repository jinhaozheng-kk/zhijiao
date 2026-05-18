import { describe, expect, it } from "vitest";
import { loadPrompt, fingerprintOf } from "../src/registry.js";

describe("PromptRegistry", () => {
  it("loads tutoring v1 prompt from disk", async () => {
    const p = await loadPrompt("tutoring", "v1");
    expect(p.name).toBe("tutoring");
    expect(p.version).toBe("v1");
    expect(p.body).toContain("中国 K12");
    expect(p.body).toContain("{{questionStem}}");
    expect(p.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprint is stable for identical content", () => {
    expect(fingerprintOf("hello")).toBe(fingerprintOf("hello"));
    expect(fingerprintOf("hello")).not.toBe(fingerprintOf("hello "));
  });

  it("interpolates {{var}} placeholders", async () => {
    const p = await loadPrompt("tutoring", "v1");
    const filled = p.interpolate({ questionStem: "解 2x+5=13", studentGrade: "G8" });
    expect(filled).toContain("解 2x+5=13");
    expect(filled).toContain("G8");
    expect(filled).not.toContain("{{questionStem}}");
  });

  it("throws when an interpolation variable is missing", async () => {
    const p = await loadPrompt("tutoring", "v1");
    expect(() => p.interpolate({ questionStem: "x" } as never)).toThrow(/studentGrade/);
  });
});
