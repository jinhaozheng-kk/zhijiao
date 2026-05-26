import os from "node:os";
import type { PrismaClient } from "@prisma/client";

// CLI-safe helper: do not import Next-only guards, env.ts, or app logging modules here.
// Plan 6 CLI scripts import this file directly through tsx.

export async function resolveOperatorUserId(prisma: PrismaClient): Promise<string> {
  const fromEnv = process.env.OPERATOR_USER_ID;
  if (fromEnv) {
    const user = await prisma.user.findUnique({
      where: { id: fromEnv },
      select: { id: true, deletedAt: true, roles: { select: { role: true } } },
    });
    if (!user) {
      throw new Error(`OPERATOR_USER_ID=${fromEnv} not found in users table`);
    }
    if (user.deletedAt) {
      throw new Error(
        `OPERATOR_USER_ID=${fromEnv} is not authorized: user is deactivated`,
      );
    }
    const hasPrivileged = user.roles.some(
      (r) => r.role === "OPS" || r.role === "ADMIN",
    );
    if (!hasPrivileged) {
      throw new Error(
        `OPERATOR_USER_ID=${fromEnv} is not authorized: requires OPS or ADMIN role`,
      );
    }
    return user.id;
  }

  const opsRole = await prisma.userRole.findFirst({
    where: { role: "OPS", user: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!opsRole) {
    throw new Error(
      "No OPS-role user found. Set OPERATOR_USER_ID env (must be OPS/ADMIN) or seed an OPS user (pnpm db:seed).",
    );
  }
  return opsRole.userId;
}

export function buildInitiatorRef(): string {
  const hostname = os.hostname() || "unknown-host";
  let username = process.env.USERNAME || process.env.USER || "unknown-user";
  try {
    username = os.userInfo().username || username;
  } catch {
    // Some locked-down service accounts cannot resolve userInfo(); env fallback is enough.
  }
  return `cli:${hostname}:${username}`;
}
