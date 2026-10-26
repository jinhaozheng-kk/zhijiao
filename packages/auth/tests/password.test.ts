import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";

describe("password auth", () => {
  it("hashes and verifies passwords without storing plaintext", async () => {
    const hash = await hashPassword("Teacher123!");

    expect(hash).not.toContain("Teacher123!");
    await expect(verifyPassword("Teacher123!", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects malformed password hashes", async () => {
    await expect(verifyPassword("Teacher123!", "not-a-valid-hash")).resolves.toBe(false);
  });
});
