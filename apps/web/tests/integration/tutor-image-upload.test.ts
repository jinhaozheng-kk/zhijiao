import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";

const cookieStore: { value: string | undefined } = { value: undefined };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) =>
      cookieStore.value ? { name: n, value: cookieStore.value } : undefined,
  }),
}));

import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { signAccess } from "@zhijiao/auth";
import { env } from "@/server/env";
import { POST } from "@/app/api/uploads/tutor-image/route";

async function token(userId: string) {
  return signAccess(
    { userId, sessionId: randomUUID(), persona: "STUDENT", roles: [] },
    env.ACCESS_JWT_SECRET,
  );
}
function form(bytes: Uint8Array, type: string, name = "x.png") {
  const fd = new FormData();
  fd.set("file", new File([bytes], name, { type }));
  return fd;
}

beforeEach(async () => {
  await resetDb();
  cookieStore.value = undefined;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/uploads/tutor-image", () => {
  it("401 when unauthenticated", async () => {
    const res = await POST(
      new Request("http://localhost/api/uploads/tutor-image", {
        method: "POST",
        body: form(new Uint8Array([1]), "image/png"),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("400 on non-image type", async () => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "s", persona: "STUDENT" } });
    cookieStore.value = await token(id);
    const res = await POST(
      new Request("http://localhost/api/uploads/tutor-image", {
        method: "POST",
        body: form(new Uint8Array([1]), "text/plain", "x.txt"),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("stores and returns an owner-scoped key", async () => {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "s", persona: "STUDENT" } });
    cookieStore.value = await token(id);
    const res = await POST(
      new Request("http://localhost/api/uploads/tutor-image", {
        method: "POST",
        body: form(new Uint8Array([1, 2, 3]), "image/png"),
      }),
    );
    expect(res.status).toBe(200);
    const { imageKey } = (await res.json()) as { imageKey: string };
    expect(imageKey.startsWith(`adhoc/${id}/`)).toBe(true);
  });
});
