import "server-only";
import { cookies } from "next/headers";
import type { Persona } from "@prisma/client";
import { prisma } from "@zhijiao/db";
import { verifyAccess, COOKIE_AT } from "@zhijiao/auth";
import { env } from "./env.js";

export interface ShellIdentity {
  userId: string;
  persona: Persona;
  displayName: string;
  primaryClassroomId?: string;
}

export function roleBadgeLabel(persona: Persona): string {
  if (persona === "STUDENT") return "学生";
  if (persona === "TEACHER") return "教师";
  return "家长";
}

// Resolve the current authenticated/demo identity for the product shell. This
// intentionally mirrors server/context.ts at the depth needed for *display*
// only: it verifies the access JWT and drops deactivated users, but does not
// reproduce session-revocation/refresh logic — a null identity simply degrades
// the shell to a brand-only header (these routes are middleware-gated anyway).
// The JWT carries persona/userId/roles but NOT the display name, so one User
// lookup is required.
export async function getShellIdentity(): Promise<ShellIdentity | null> {
  const token = cookies().get(COOKIE_AT)?.value;
  if (!token) return null;

  const v = await verifyAccess(token, env.ACCESS_JWT_SECRET);
  if (!v.ok) return null;

  const user = await prisma.user.findUnique({
    where: { id: v.claims.userId },
    select: { name: true, deletedAt: true },
  });
  if (!user || user.deletedAt != null) return null;

  let primaryClassroomId: string | undefined;
  if (v.claims.persona === "TEACHER") {
    const member = await prisma.classroomMember.findFirst({
      where: { userId: v.claims.userId, role: "TEACHER" },
      orderBy: { createdAt: "desc" },
      select: { classroomId: true },
    });
    primaryClassroomId = member?.classroomId ?? undefined;
  }

  return {
    userId: v.claims.userId,
    persona: v.claims.persona,
    displayName: user.name ?? roleBadgeLabel(v.claims.persona),
    primaryClassroomId,
  };
}
