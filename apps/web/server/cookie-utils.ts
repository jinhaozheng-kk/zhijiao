export function appendSetCookie(resHeaders: Headers, cookie: string) {
  resHeaders.append("Set-Cookie", cookie);
}
