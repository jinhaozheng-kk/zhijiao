import "server-only";
import type { PrismaClient } from "@prisma/client";
import { issueSessionAndCookies } from "../auth-service.js";
import {
  DEMO_TARGETS,
  type DemoRole,
  userIdForDemoRole,
} from "./config.js";

export async function issueDemoSession(opts: {
  prisma: PrismaClient;
  role: DemoRole;
  resHeaders: Headers;
  ip?: string | null;
  ua?: string | null;
}) {
  await issueSessionAndCookies({
    prisma: opts.prisma,
    userId: userIdForDemoRole(opts.role),
    resHeaders: opts.resHeaders,
    ip: opts.ip,
    ua: opts.ua,
  });

  return { redirectTo: DEMO_TARGETS[opts.role] };
}
