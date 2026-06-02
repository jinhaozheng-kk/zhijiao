import { describe, expect, it } from "vitest";
import { copyForReason } from "@/lib/error-copy";

describe("error copy", () => {
  it("maps insufficient balance", () => {
    expect(copyForReason("INSUFFICIENT_BALANCE")).toContain("余额不足");
  });

  it("maps guardian consent", () => {
    expect(copyForReason("GUARDIAN_CONSENT_REQUIRED")).toContain("监护人同意");
  });

  it("uses a recoverable default", () => {
    expect(copyForReason("SOMETHING_UNKNOWN")).toContain("稍后再试");
  });
});
