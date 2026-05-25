// Plan 9 Task 9 hotfix (review P2): resolveReviewerUserId must enforce
// OPS or ADMIN role on the KP_REVIEW_USER_ID env override path, not just
// user existence. Otherwise the env var becomes a free door past the
// OPS-operations-go-through-CLI audit boundary.

import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { resolveReviewerUserId } from "@/server/lib/kp-reconcile";

let envSnapshot: string | undefined;

beforeEach(async () => {
  await resetDb();
  envSnapshot = process.env.KP_REVIEW_USER_ID;
  delete process.env.KP_REVIEW_USER_ID;
});
afterEach(() => {
  if (envSnapshot === undefined) delete process.env.KP_REVIEW_USER_ID;
  else process.env.KP_REVIEW_USER_ID = envSnapshot;
});
afterAll(async () => { await prisma.$disconnect(); });

async function makeUser(role: "OPS" | "ADMIN" | null) {
  const u = await prisma.user.create({ data: { persona: "STUDENT", isMinor: false } });
  if (role) {
    await prisma.userRole.create({ data: { userId: u.id, role } });
  }
  return u.id;
}

describe("resolveReviewerUserId (Plan 9 Task 9 hotfix P2)", () => {
  it("no env override + no OPS user → throws", async () => {
    await expect(resolveReviewerUserId(prisma)).rejects.toThrow(/No OPS-role user found/);
  });

  it("no env override + OPS user exists → returns OPS user id", async () => {
    const opsId = await makeUser("OPS");
    const r = await resolveReviewerUserId(prisma);
    expect(r).toBe(opsId);
  });

  it("env override to non-existent user id → throws (not found)", async () => {
    process.env.KP_REVIEW_USER_ID = "clnonexistent000000000001";
    await expect(resolveReviewerUserId(prisma)).rejects.toThrow(/not found in users table/);
  });

  it("env override to regular user (no OPS/ADMIN role) → throws (not authorized)", async () => {
    const regularId = await makeUser(null);
    process.env.KP_REVIEW_USER_ID = regularId;
    // Even seed an OPS user to confirm fallback is NOT silently used when env is set
    await makeUser("OPS");
    await expect(resolveReviewerUserId(prisma)).rejects.toThrow(/not authorized.*OPS or ADMIN/);
  });

  it("env override to OPS user → returns it (env beats fallback)", async () => {
    const envOpsId = await makeUser("OPS");
    process.env.KP_REVIEW_USER_ID = envOpsId;
    // Plus a second OPS user that would otherwise be the fallback "first OPS"
    await makeUser("OPS");
    const r = await resolveReviewerUserId(prisma);
    expect(r).toBe(envOpsId);
  });

  it("env override to ADMIN user → returns it (ADMIN is also privileged)", async () => {
    const adminId = await makeUser("ADMIN");
    process.env.KP_REVIEW_USER_ID = adminId;
    const r = await resolveReviewerUserId(prisma);
    expect(r).toBe(adminId);
  });
});
