import { MockWechatH5Adapter } from "./mock.js";
import { RealWechatH5Adapter } from "./real.js";
import type { WechatH5Adapter } from "./types.js";

// Plan 2 Hardening — Task 2 (C2 + C3): no silent mock fallback, no legacy
// /auth/wechat/callback redirect URI.
//
// `WECHAT_OAUTH_USE_MOCK === "true"` is the SOLE entry into MockWechatH5Adapter.
// Real-mode missing config throws here; in the apps/web call path the env
// validator (apps/web/server/env.ts) catches it earlier still. Any other caller
// gets the same fail-close behaviour from this layer.
//
// The callback path is `${NEXT_PUBLIC_APP_URL}/wechat/callback`. The Next.js
// `(auth)` route group does NOT appear in URLs, so the legacy
// `/auth/wechat/callback` was a 404 against a real public-account callback.
export function buildWechatH5Adapter(env: NodeJS.ProcessEnv): WechatH5Adapter {
  if (env.WECHAT_OAUTH_USE_MOCK === "true") {
    // Mock branch: APPID is optional. We keep a fixed sentinel so mock-mode
    // AuthIdentity rows are stable across reboots (and migrating real APPID
    // in later doesn't have to clean up random placeholders).
    return new MockWechatH5Adapter(env.WECHAT_H5_APPID || "wx-mock-app");
  }

  const missing: string[] = [];
  if (!env.WECHAT_H5_APPID) missing.push("WECHAT_H5_APPID");
  if (!env.WECHAT_H5_SECRET) missing.push("WECHAT_H5_SECRET");
  if (!env.NEXT_PUBLIC_APP_URL) missing.push("NEXT_PUBLIC_APP_URL");
  if (missing.length > 0) {
    throw new Error(
      `buildWechatH5Adapter: real mode requires ${missing.join(" + ")}. ` +
        `Set WECHAT_OAUTH_USE_MOCK="true" for the mock path.`,
    );
  }

  return new RealWechatH5Adapter({
    appId: env.WECHAT_H5_APPID!,
    secret: env.WECHAT_H5_SECRET!,
    redirectUri: `${env.NEXT_PUBLIC_APP_URL!}/wechat/callback`,
  });
}
