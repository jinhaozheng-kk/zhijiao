import { NextResponse } from "next/server";
import { checkReadiness } from "@/server/lib/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const readiness = await checkReadiness();
  return NextResponse.json(readiness, { status: readiness.ok ? 200 : 503 });
}
