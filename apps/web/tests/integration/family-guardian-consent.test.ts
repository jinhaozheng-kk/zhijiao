import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import type { Role } from "@zhijiao/domain";

const { appRouter } = await import("@/server/routers/_root");
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma, redis,
    auth: {
      userId, sessionId: "test-session", persona: "STUDENT" as const,
      roles: [] as Role[], isMinor: false, guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null, ip: "127.0.0.1", ua: "vitest",
    requestId: "test-req-fconsent", resHeaders: new Headers(), cookies: {},
  };
}

// child = <14 student (PENDING)；guardian = adult
async function makePendingChild(name: string): Promise<string> {
  const u = await prisma.user.create({
    data: { isMinor: true, persona: "STUDENT", name, birthYear: 2015, guardianConsentStatus: "PENDING" },
  });
  return u.id;
}
async function makeAdult(name: string): Promise<string> {
  const u = await prisma.user.create({ data: { isMinor: false, persona: "PARENT", name } });
  return u.id;
}

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

describe("family guardian consent (Plan 14a)", () => {
  it("PENDING child + bind 不带 consent → GUARDIAN_CONSENT_NOT_PROVIDED，不写任何行，child 仍 PENDING", async () => {
    const childId = await makePendingChild("童1");
    const parentId = await makeAdult("家长1");
    const { code } = await appRouter.createCaller(makeCtx(childId)).family.createInviteCode();
    await expect(
      appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code }),
    ).rejects.toMatchObject({ cause: { reason: "GUARDIAN_CONSENT_NOT_PROVIDED" } });

    expect(await prisma.guardianConsent.count()).toBe(0);
    expect(await prisma.familyLink.count()).toBe(0);
    const child = await prisma.user.findUniqueOrThrow({ where: { id: childId } });
    expect(child.guardianConsentStatus).toBe("PENDING");
  });

  it("PENDING child + bind 带 guardianConsent → 写 GuardianConsent + FamilyLink ACTIVE + child GRANTED", async () => {
    const childId = await makePendingChild("童2");
    const parentId = await makeAdult("家长2");
    const { code } = await appRouter.createCaller(makeCtx(childId)).family.createInviteCode();
    await appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code, guardianConsent: true });

    const consents = await prisma.guardianConsent.findMany({ where: { childUserId: childId } });
    expect(consents).toHaveLength(1);
    expect(consents[0]!.revokedAt).toBeNull();
    expect(consents[0]!.method).toBe("FAMILY_LINK_BIND");
    expect(consents[0]!.guardianUserId).toBe(parentId);
    const link = await prisma.familyLink.findUniqueOrThrow({
      where: { parentUserId_studentUserId: { parentUserId: parentId, studentUserId: childId } },
    });
    expect(link.status).toBe("ACTIVE");
    const child = await prisma.user.findUniqueOrThrow({ where: { id: childId } });
    expect(child.guardianConsentStatus).toBe("GRANTED");
  });

  it("NOT_REQUIRED child（≥14）+ bind 不带 consent → 正常绑定，不写 consent，状态不变（Plan 11 回归）", async () => {
    const studentId = await prisma.user.create({
      data: { isMinor: true, persona: "STUDENT", name: "童3", birthYear: 2009, guardianConsentStatus: "NOT_REQUIRED" },
    }).then((u) => u.id);
    const parentId = await makeAdult("家长3");
    const { code } = await appRouter.createCaller(makeCtx(studentId)).family.createInviteCode();
    await appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code });

    expect(await prisma.guardianConsent.count()).toBe(0);
    const link = await prisma.familyLink.findUniqueOrThrow({
      where: { parentUserId_studentUserId: { parentUserId: parentId, studentUserId: studentId } },
    });
    expect(link.status).toBe("ACTIVE");
    const child = await prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    expect(child.guardianConsentStatus).toBe("NOT_REQUIRED");
  });

  it("撤回唯一 link → consent.revokedAt 落，child 回 PENDING", async () => {
    const childId = await makePendingChild("童4");
    const parentId = await makeAdult("家长4");
    const { code } = await appRouter.createCaller(makeCtx(childId)).family.createInviteCode();
    await appRouter.createCaller(makeCtx(parentId)).family.bindByCode({ code, guardianConsent: true });
    const list = await appRouter.createCaller(makeCtx(parentId)).family.listMyChildren();
    const linkId = list.children[0]!.linkId;

    await appRouter.createCaller(makeCtx(parentId)).family.revoke({ linkId });

    const consent = await prisma.guardianConsent.findFirstOrThrow({ where: { childUserId: childId } });
    expect(consent.revokedAt).not.toBeNull();
    const child = await prisma.user.findUniqueOrThrow({ where: { id: childId } });
    expect(child.guardianConsentStatus).toBe("PENDING");
  });

  it("多监护人：两家长各自同意 → 撤其一，child 仍 GRANTED", async () => {
    const childId = await makePendingChild("童5");
    const p1 = await makeAdult("家长5a");
    const p2 = await makeAdult("家长5b");
    const c1 = (await appRouter.createCaller(makeCtx(childId)).family.createInviteCode()).code;
    await appRouter.createCaller(makeCtx(p1)).family.bindByCode({ code: c1, guardianConsent: true });
    const c2 = (await appRouter.createCaller(makeCtx(childId)).family.createInviteCode()).code;
    await appRouter.createCaller(makeCtx(p2)).family.bindByCode({ code: c2, guardianConsent: true });

    const list1 = await appRouter.createCaller(makeCtx(p1)).family.listMyChildren();
    await appRouter.createCaller(makeCtx(p1)).family.revoke({ linkId: list1.children[0]!.linkId });

    const child = await prisma.user.findUniqueOrThrow({ where: { id: childId } });
    expect(child.guardianConsentStatus).toBe("GRANTED"); // p2 的 consent 仍有效
    expect(await prisma.guardianConsent.count({ where: { childUserId: childId, revokedAt: null } })).toBe(1);
  });
});
