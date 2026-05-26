import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { deactivateUser } from "@/server/lib/pii-governance";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("relogin after user deactivation", () => {
  it("same phone can register a new User after old AuthIdentity is deleted", async () => {
    const oldUser = await prisma.user.create({
      data: { name: "Old User", persona: "STUDENT", isMinor: false },
    });
    await prisma.authIdentity.create({
      data: {
        userId: oldUser.id,
        provider: "PHONE",
        providerScope: "GLOBAL",
        providerUserId: "13800000777",
      },
    });

    await deactivateUser(prisma, {
      userId: oldUser.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });

    await expect(prisma.user.findUnique({ where: { id: oldUser.id } })).resolves.toMatchObject({
      name: null,
      deletedAt: expect.any(Date),
    });
    await expect(
      prisma.authIdentity.findUnique({
        where: {
          uniq_identity: {
            provider: "PHONE",
            providerScope: "GLOBAL",
            providerUserId: "13800000777",
          },
        },
      }),
    ).resolves.toBeNull();

    const newUser = await prisma.user.create({
      data: { name: "New User", persona: "STUDENT", isMinor: false },
    });
    await prisma.authIdentity.create({
      data: {
        userId: newUser.id,
        provider: "PHONE",
        providerScope: "GLOBAL",
        providerUserId: "13800000777",
      },
    });
    expect(newUser.id).not.toBe(oldUser.id);
    await expect(prisma.user.count()).resolves.toBe(2);
  });
});
