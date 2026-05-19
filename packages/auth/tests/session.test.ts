import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { Persona, SessionRevokeReason } from "@prisma/client";
import { createSession, rotateSession, hashRefresh } from "../src/session.js";
import { AuthError } from "../src/errors.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

async function seedUser() {
  return prisma.user.create({ data: { name: "x", persona: Persona.STUDENT, isMinor: false } });
}

describe("session", () => {
  it("create + rotate happy path", async () => {
    const u = await seedUser();
    const { refreshToken: rt1, sessionId: s1 } = await createSession(prisma, u.id, {});
    const { refreshToken: rt2, sessionId: s2 } = await rotateSession(prisma, rt1, {});
    expect(s2).not.toBe(s1);
    expect(rt2).not.toBe(rt1);
    const old = await prisma.session.findUniqueOrThrow({ where: { id: s1 } });
    expect(old.revokedReason).toBe(SessionRevokeReason.ROTATED);
  });

  it("重放检测：用 rotated refresh 再 rotate → REUSE_DETECTED + 全部 session revoke", async () => {
    const u = await seedUser();
    const { refreshToken: rt1 } = await createSession(prisma, u.id, {});
    const { refreshToken: rt2 } = await rotateSession(prisma, rt1, {});
    await expect(rotateSession(prisma, rt1, {})).rejects.toMatchObject({ reason: "REUSE_DETECTED" });
    const active = await prisma.session.count({ where: { userId: u.id, revokedAt: null } });
    expect(active).toBe(0);
  });

  it("不存在的 refresh → NO_SESSION", async () => {
    await expect(rotateSession(prisma, "totally-fake", {})).rejects.toMatchObject({ reason: "NO_SESSION" });
  });

  it("过期 → SESSION_REVOKED", async () => {
    const u = await seedUser();
    const { refreshToken: rt } = await createSession(prisma, u.id, {});
    await prisma.session.updateMany({
      where: { refreshTokenHash: hashRefresh(rt) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(rotateSession(prisma, rt, {})).rejects.toMatchObject({ reason: "SESSION_REVOKED" });
  });
});
