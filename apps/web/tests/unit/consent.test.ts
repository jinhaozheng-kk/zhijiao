import { describe, it, expect } from "vitest";
import { isUnder14, initialConsentStatus } from "@/server/lib/consent";

const NOW = new Date("2026-06-01T00:00:00Z");

describe("isUnder14（保守：当前年−birthYear ≤ 14）", () => {
  it("2014 → true（≤14）", () => expect(isUnder14(2014, NOW)).toBe(true));
  it("2012 → true（=14，保守仍触发）", () => expect(isUnder14(2012, NOW)).toBe(true));
  it("2011 → false（=15）", () => expect(isUnder14(2011, NOW)).toBe(false));
});

describe("initialConsentStatus", () => {
  it("STUDENT + <14 → PENDING", () =>
    expect(initialConsentStatus("STUDENT", 2014, NOW)).toBe("PENDING"));
  it("STUDENT + ≥14 → NOT_REQUIRED", () =>
    expect(initialConsentStatus("STUDENT", 2011, NOW)).toBe("NOT_REQUIRED"));
  it("STUDENT + birthYear null → NOT_REQUIRED（grandfather）", () =>
    expect(initialConsentStatus("STUDENT", null, NOW)).toBe("NOT_REQUIRED"));
  it("TEACHER → NOT_REQUIRED", () =>
    expect(initialConsentStatus("TEACHER", 2014, NOW)).toBe("NOT_REQUIRED"));
  it("PARENT → NOT_REQUIRED", () =>
    expect(initialConsentStatus("PARENT", 2014, NOW)).toBe("NOT_REQUIRED"));
});
