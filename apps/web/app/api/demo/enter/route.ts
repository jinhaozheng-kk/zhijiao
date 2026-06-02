import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";
import {
  isDemoModeEnabled,
  type DemoRole,
} from "@/server/demo/config";
import { clearDemoAnalyticsCache } from "@/server/demo/cache";
import { resetDemoData } from "@/server/demo/seed";
import { issueDemoSession } from "@/server/demo/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_ROLES = new Set<string>(["student", "teacher", "parent"]);

// POST (not GET): entering the demo resets data, mints a real session, and
// sets auth cookies — side effects that must not be triggerable by link
// prefetch, crawlers, or cross-site GET. The /demo page submits a form.
export async function POST(req: Request) {
  if (!isDemoModeEnabled()) {
    return NextResponse.json(
      { error: "DEMO_MODE_DISABLED" },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  if (!role || !DEMO_ROLES.has(role)) {
    return NextResponse.json(
      { error: "DEMO_ROLE_INVALID" },
      { status: 400 },
    );
  }

  await resetDemoData(prisma);
  await clearDemoAnalyticsCache();

  const resHeaders = new Headers();
  const { redirectTo } = await issueDemoSession({
    prisma,
    role: role as DemoRole,
    resHeaders,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: req.headers.get("user-agent") ?? null,
  });

  // 303 See Other: the browser follows with a GET to redirectTo (a 307 would
  // re-issue the POST against the target page).
  const res = NextResponse.redirect(new URL(redirectTo, url), 303);
  resHeaders.getSetCookie().forEach((cookie) => {
    res.headers.append("Set-Cookie", cookie);
  });
  return res;
}
