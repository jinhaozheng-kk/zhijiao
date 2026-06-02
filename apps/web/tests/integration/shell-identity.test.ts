import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const cookieStore: { value: string | undefined } = { value: undefined };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      cookieStore.value ? { name, value: cookieStore.value } : undefined,
  }),
}));

import { prisma } from "@zhijiao/db";
import { signAccess, COOKIE_AT } from "@zhijiao/auth";
import { env } from "@/server/env";
import { getShellIdentity } from "@/server/shell-identity";

async function tokenFor(
  userId: string,
  persona: "STUDENT" | "TEACHER" | "PARENT",
) {
  return signAccess(
    { userId, sessionId: randomUUID(), persona, roles: [] },
    env.ACCESS_JWT_SECRET,
  );
}

describe("getShellIdentity", () => {
  beforeEach(() => {
    cookieStore.value = undefined;
  });

  it("returns null when there is no session cookie", async () => {
    expect(await getShellIdentity()).toBeNull();
  });

  it("returns null for a deactivated user", async () => {
    const id = randomUUID();
    await prisma.user.create({
      data: { id, name: "走了", persona: "STUDENT", deletedAt: new Date() },
    });
    cookieStore.value = await tokenFor(id, "STUDENT");
    expect(await getShellIdentity()).toBeNull();
  });

  it("resolves displayName + persona for a student", async () => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "周予安", persona: "STUDENT" } });
    cookieStore.value = await tokenFor(id, "STUDENT");
    const got = await getShellIdentity();
    expect(got).toMatchObject({
      userId: id,
      persona: "STUDENT",
      displayName: "周予安",
    });
    expect(got?.primaryClassroomId).toBeUndefined();
  });

  it("includes the teacher's primaryClassroomId", async () => {
    const tid = randomUUID();
    const cid = randomUUID();
    const subjectId = randomUUID();
    await prisma.user.create({ data: { id: tid, name: "李老师", persona: "TEACHER" } });
    await prisma.subject.create({
      data: { id: subjectId, code: `s-${cid}`, name: "数学" },
    });
    await prisma.classroom.create({
      data: { id: cid, name: "初二 3 班", subjectId, gradeLevel: "G8" },
    });
    await prisma.classroomMember.create({
      data: { classroomId: cid, userId: tid, role: "TEACHER" },
    });
    cookieStore.value = await tokenFor(tid, "TEACHER");
    const got = await getShellIdentity();
    expect(got).toMatchObject({ persona: "TEACHER", primaryClassroomId: cid });
  });
});
