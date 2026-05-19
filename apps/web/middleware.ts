import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/profile", "/error-book", "/teacher", "/parent", "/admin"];

export function middleware(req: NextRequest) {
  const hasAt = req.cookies.has("__Host-zj_at");
  const { pathname } = req.nextUrl;
  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) && !hasAt) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/profile/:path*", "/error-book/:path*", "/teacher/:path*", "/parent/:path*", "/admin/:path*"],
};
