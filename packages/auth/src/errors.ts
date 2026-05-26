export const AUTH_ERROR_REASONS = [
  "ACCESS_EXPIRED", "ACCESS_INVALID", "NO_SESSION",
  "SESSION_REVOKED", "REUSE_DETECTED",
  "PERMISSION_DENIED",
  "OTP_SEND_TOO_FREQUENT", "OTP_VERIFY_TOO_FREQUENT",
  "OTP_EXPIRED", "OTP_INVALID", "OTP_MAX_ATTEMPTS",
  "RATELIMIT_BACKEND_DOWN",
  "WECHAT_STATE_MISMATCH", "WECHAT_CODE_INVALID", "WECHAT_BIND_CONFLICT",
  "REGISTER_TOKEN_MISSING", "REGISTER_GRADE_REQUIRED", "REGISTER_TOO_FREQUENT", "REGISTER_CONFLICT",
  "USER_DEACTIVATED",
] as const;

export type AuthErrorReason = typeof AUTH_ERROR_REASONS[number];

export class AuthError extends Error {
  constructor(public reason: AuthErrorReason, public extra?: Record<string, unknown>) {
    super(reason);
    this.name = "AuthError";
  }
}
