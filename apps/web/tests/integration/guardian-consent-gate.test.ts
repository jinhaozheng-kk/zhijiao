import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertConsentOk } from "@/server/trpc";

describe("guardian consent gate", () => {
  it("PENDING → throw FORBIDDEN/GUARDIAN_CONSENT_REQUIRED", () => {
    expect(() => assertConsentOk("PENDING")).toThrowError(TRPCError);
    try { assertConsentOk("PENDING"); } catch (e) {
      expect((e as TRPCError).code).toBe("FORBIDDEN");
      expect(((e as TRPCError).cause as { reason?: string }).reason).toBe("GUARDIAN_CONSENT_REQUIRED");
    }
  });
  it("NOT_REQUIRED → ok", () => expect(() => assertConsentOk("NOT_REQUIRED")).not.toThrow());
  it("GRANTED → ok", () => expect(() => assertConsentOk("GRANTED")).not.toThrow());
});
