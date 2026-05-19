export const COOKIE_AT          = "__Host-zj_at";              // access JWT，Path=/
export const COOKIE_RT          = "zj_rt";                     // refresh token，Path=/api/auth
export const COOKIE_REGISTER    = "__Host-zj_register_token";  // register nonce，Path=/
export const COOKIE_WX_STATE    = "__Host-zj_wx_state";        // wechat state，Path=/

type CookieOpts = {
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  maxAge?: number;   // seconds; 0 = clear
};

export function serializeCookie(name: string, opts: CookieOpts): string {
  const parts = [`${name}=${encodeURIComponent(opts.value)}`];
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  if (opts.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

export function buildAccessCookie(value: string): string {
  return serializeCookie(COOKIE_AT, { value, httpOnly:true, secure:true, sameSite:"Lax", path:"/", maxAge:900 });
}
export function buildRefreshCookie(value: string): string {
  return serializeCookie(COOKIE_RT, { value, httpOnly:true, secure:true, sameSite:"Strict", path:"/api/auth", maxAge:2592000 });
}
export function buildRegisterCookie(value: string): string {
  return serializeCookie(COOKIE_REGISTER, { value, httpOnly:true, secure:true, sameSite:"Lax", path:"/", maxAge:600 });
}
export function buildWxStateCookie(value: string): string {
  return serializeCookie(COOKIE_WX_STATE, { value, httpOnly:true, secure:true, sameSite:"Lax", path:"/", maxAge:300 });
}

/** 清 cookie：相同 name + 相同 path，Max-Age=0 */
export function clearCookie(name: string, path: string): string {
  return serializeCookie(name, { value:"", httpOnly:true, secure:true, sameSite:"Lax", path, maxAge:0 });
}
