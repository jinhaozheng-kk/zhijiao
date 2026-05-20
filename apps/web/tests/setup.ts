// Vitest global setup — runs before any test module is evaluated.
//
// The env validator at apps/web/server/env.ts (Task 1) runs at module-load
// time and throws if any required env is missing or malformed. Integration
// tests (and now the unit-style env.test.ts that re-imports env.ts after
// vi.resetModules) transitively pull in env.ts via auth-service / context /
// route handlers, so every required key must already be on process.env
// before any test module evaluates. We provide a complete, mock-mode set
// here; per-test overrides (e.g. env.test.ts mutating ACCESS_JWT_SECRET to
// reproduce a failure) are responsible for snapshot + restore.

// DATABASE_URL comes from vitest.config.ts `test.env` (plan §Task -1).
// Fail-close if missing — a silent regression to the old shared `zhijiao_test`
// DB would reintroduce the cross-package race that Task -1 fixed.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "apps/web tests/setup.ts: DATABASE_URL is not set. " +
      "Did you forget vitest.config.ts `test.env.DATABASE_URL`?",
  );
}

// Infra
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

// Auth secrets — long enough to pass min(32) / min(16) refines.
process.env.ACCESS_JWT_SECRET ??= "test-only-access-secret-at-least-32-bytes-long";
process.env.OTP_PEPPER ??= "test-only-otp-pepper-min16-x";

// Mock switches — tests run fully mocked unless an individual case sets them.
process.env.AI_USE_MOCK ??= "true";
process.env.SMS_USE_MOCK ??= "true";
process.env.WECHAT_OAUTH_USE_MOCK ??= "true";
// WECHAT_H5_APPID is used by MockWechatH5Adapter when WECHAT_OAUTH_USE_MOCK=true;
// integration tests assert on this value via the route handler.
process.env.WECHAT_H5_APPID ??= "wx-mock-app";

// E2E hooks off by default; individual E2E setups opt in by setting to "1".
process.env.E2E_TEST_HOOKS ??= "0";
