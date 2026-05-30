import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import type { Role } from "@zhijiao/domain";

const { appRouter } = await import("@/server/routers/_root");

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as Role[],
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-family",
    resHeaders: new Headers(),
    cookies: {},
  };
}

async function makeUser(name: string): Promise<string> {
  const u = await prisma.user.create({
    data: { isMinor: false, persona: "STUDENT", name },
  });
  return u.id;
}

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
});
afterAll(async () => {
  await redis.quit();
});

describe("family router", () => {
  it("student issues code → parent binds → ACTIVE FamilyLink created", async () => {
    const studentId = await makeUser("学生A");
    const parentId = await makeUser("家长A");

    const { code } = await appRouter.createCaller(makeCtx(studentId)).family.createInviteCode();
    expect(code.length).toBeGreaterThanOrEqual(4);

    const bound = await appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code });
    expect(bound.studentUserId).toBe(studentId);
    expect(bound.name).toBe("学生A");

    const link = await prisma.familyLink.findUnique({
      where: { parentUserId_studentUserId: { parentUserId: parentId, studentUserId: studentId } },
    });
    expect(link?.status).toBe("ACTIVE");
  });

  it("same code can only be used once (single-use)", async () => {
    const studentId = await makeUser("学生B");
    const parentId = await makeUser("家长B");
    const { code } = await appRouter.createCaller(makeCtx(studentId)).family.createInviteCode();
    await appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code });
    await expect(
      appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cannot bind your own code", async () => {
    const studentId = await makeUser("学生C");
    const { code } = await appRouter.createCaller(makeCtx(studentId)).family.createInviteCode();
    await expect(
      appRouter.createCaller(makeCtx(studentId)).family.bindByCode({ code }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("listMyChildren returns only ACTIVE links; revoke flips to REVOKED", async () => {
    const studentId = await makeUser("学生D");
    const parentId = await makeUser("家长D");
    const { code } = await appRouter.createCaller(makeCtx(studentId)).family.createInviteCode();
    await appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code });

    let list = await appRouter.createCaller(makeCtx(parentId)).family.listMyChildren();
    expect(list.children).toHaveLength(1);
    const linkId = list.children[0]!.linkId;

    await appRouter.createCaller(makeCtx(parentId)).family.revoke({ linkId });
    list = await appRouter.createCaller(makeCtx(parentId)).family.listMyChildren();
    expect(list.children).toHaveLength(0);
    const link = await prisma.familyLink.findUnique({ where: { id: linkId } });
    expect(link?.status).toBe("REVOKED");
  });

  it("revoking a link you are not part of → NOT_FOUND", async () => {
    const studentId = await makeUser("学生E");
    const parentId = await makeUser("家长E");
    const strangerId = await makeUser("陌生人E");
    const { code } = await appRouter.createCaller(makeCtx(studentId)).family.createInviteCode();
    await appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code });
    const list = await appRouter.createCaller(makeCtx(parentId)).family.listMyChildren();
    const linkId = list.children[0]!.linkId;

    await expect(
      appRouter.createCaller(makeCtx(strangerId)).family.revoke({ linkId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
