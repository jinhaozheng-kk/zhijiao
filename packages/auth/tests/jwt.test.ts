import { describe, it, expect } from "vitest";
import { signAccess, verifyAccess } from "../src/jwt.js";

const SECRET = "test-secret-at-least-32-bytes-long-aaaa";

describe("jwt", () => {
  it("sign + verify round-trip", async () => {
    const token = await signAccess(
      { userId: "u1", sessionId: "s1", persona: "STUDENT", roles: [] },
      SECRET,
    );
    const v = await verifyAccess(token, SECRET);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.claims.userId).toBe("u1");
      expect(v.claims.sessionId).toBe("s1");
      expect(v.claims.persona).toBe("STUDENT");
    }
  });

  it("篡改后 verify 返 ACCESS_INVALID", async () => {
    const token = await signAccess(
      { userId: "u1", sessionId: "s1", persona: "STUDENT", roles: [] },
      SECRET,
    );
    const tampered = token.slice(0, -2) + "xx";
    const v = await verifyAccess(tampered, SECRET);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("ACCESS_INVALID");
  });

  it("用错 secret → ACCESS_INVALID", async () => {
    const token = await signAccess(
      { userId: "u1", sessionId: "s1", persona: "STUDENT", roles: [] },
      SECRET,
    );
    const v = await verifyAccess(token, "another-secret-at-least-32-bytes-aa");
    expect(v.ok).toBe(false);
  });
});
