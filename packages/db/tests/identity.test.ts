import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma, resetDb } from "../src/test-utils.js";
import { Role } from "@prisma/client";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("Identity schema", () => {
  it("creates a user with phone + role", async () => {
    const user = await testPrisma.user.create({
      data: {
        phone: "13800000001",
        name: "测试学生",
        roles: { create: [{ role: Role.STUDENT }] },
      },
      include: { roles: true },
    });

    expect(user.id).toBeDefined();
    expect(user.phone).toBe("13800000001");
    expect(user.roles.map((r) => r.role)).toEqual([Role.STUDENT]);
  });

  it("enforces unique phone constraint", async () => {
    await testPrisma.user.create({ data: { phone: "13800000002" } });
    await expect(
      testPrisma.user.create({ data: { phone: "13800000002" } }),
    ).rejects.toThrow();
  });
});
