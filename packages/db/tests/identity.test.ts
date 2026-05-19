import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma, resetDb } from "../src/test-utils.js";
import { AuthProvider, Persona, Role } from "@prisma/client";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("Identity schema", () => {
  it("creates a user with phone identity + persona", async () => {
    const user = await testPrisma.user.create({
      data: {
        name: "测试学生",
        persona: Persona.STUDENT,
        identities: {
          create: [
            {
              provider: AuthProvider.PHONE,
              providerScope: "GLOBAL",
              providerUserId: "13800000001",
            },
          ],
        },
        roles: { create: [{ role: Role.OPS }] },
      },
      include: { roles: true, identities: true },
    });

    expect(user.id).toBeDefined();
    expect(user.persona).toBe(Persona.STUDENT);
    expect(user.identities[0]?.providerUserId).toBe("13800000001");
    expect(user.roles.map((r) => r.role)).toEqual([Role.OPS]);
  });

  it("enforces unique identity constraint (same provider+scope+userId)", async () => {
    await testPrisma.user.create({
      data: {
        identities: {
          create: [
            {
              provider: AuthProvider.PHONE,
              providerScope: "GLOBAL",
              providerUserId: "13800000002",
            },
          ],
        },
      },
    });
    const user2 = await testPrisma.user.create({ data: {} });
    await expect(
      testPrisma.authIdentity.create({
        data: {
          userId: user2.id,
          provider: AuthProvider.PHONE,
          providerScope: "GLOBAL",
          providerUserId: "13800000002",
        },
      }),
    ).rejects.toThrow();
  });
});
