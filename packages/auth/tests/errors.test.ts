import { describe, it, expect } from "vitest";
import { AuthError, AUTH_ERROR_REASONS } from "../src/errors.js";

describe("AuthError", () => {
  it("name == 'AuthError'", () => {
    expect(new AuthError("OTP_EXPIRED").name).toBe("AuthError");
  });
  it("reason 是常量数组里的", () => {
    expect(AUTH_ERROR_REASONS).toContain("ACCESS_EXPIRED");
    expect(AUTH_ERROR_REASONS).toContain("REGISTER_CONFLICT");
  });
});
