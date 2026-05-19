import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
// Must be dynamic: reads env at request time and queries Redis.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (process.env.E2E_TEST_HOOKS !== "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone") ?? "";
  const code = await redis.get(`e2e:last-otp:${phone}`);
  return NextResponse.json({ code: code ?? null });
}
