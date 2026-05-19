import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { Persona, Role } from "@zhijiao/domain";

const ACCESS_TTL = "15m";

export interface AccessClaims {
  userId: string;
  sessionId: string;
  persona: Persona;
  roles: Role[];
}

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function signAccess(claims: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .setSubject(claims.userId)
    .sign(key(secret));
}

export type VerifyResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; reason: "ACCESS_EXPIRED" | "ACCESS_INVALID" };

export async function verifyAccess(token: string, secret: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    const claims: AccessClaims = {
      userId: payload.sub as string,
      sessionId: payload.sessionId as string,
      persona: payload.persona as Persona,
      roles: (payload.roles as Role[]) ?? [],
    };
    return { ok: true, claims };
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) return { ok: false, reason: "ACCESS_EXPIRED" };
    return { ok: false, reason: "ACCESS_INVALID" };
  }
}
