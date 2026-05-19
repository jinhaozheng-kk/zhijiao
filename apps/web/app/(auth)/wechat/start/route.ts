import { NextResponse } from "next/server";
import { buildWechatH5Adapter } from "@zhijiao/integrations";
import { redis } from "@/lib/redis";
import { putWechatState, buildWxStateCookie, verifyAccess, COOKIE_AT } from "@zhijiao/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") === "bind" ? "bind" : "login") as "login" | "bind";

  let bindUserId: string | undefined;
  if (mode === "bind") {
    const cookies = parseCookies(req.headers.get("cookie"));
    const at = cookies[COOKIE_AT];
    if (!at) return NextResponse.redirect(new URL("/login?next=/profile", url));
    const v = await verifyAccess(at, process.env.ACCESS_JWT_SECRET ?? "");
    if (!v.ok) return NextResponse.redirect(new URL("/login?next=/profile", url));
    bindUserId = v.claims.userId;
  }

  const state = await putWechatState(redis, { mode, userId: bindUserId });
  const adapter = buildWechatH5Adapter(process.env);
  const target = adapter.buildAuthorizeUrl({ state, scope: "snsapi_userinfo" });
  const absoluteTarget = target.startsWith("/") ? new URL(target, url) : target;

  const res = NextResponse.redirect(absoluteTarget);
  res.headers.append("Set-Cookie", buildWxStateCookie(state));
  return res;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}
