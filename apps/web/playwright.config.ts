import { defineConfig, devices } from "@playwright/test";

// E2E:
//   - 端口 3100、库 zhijiao_test、production-mode server（next start 而非 next dev）
//   - 不用 Playwright 内置的 webServer 块——它在 Windows 上 graceful 关停被官方
//     short-circuit 掉（playwright/lib/runner/index.js:840 直接 throw），导致命令
//     测试通过后挂死。改走 globalSetup/globalTeardown，自己拿 PID 用 taskkill /T /F
//     把进程树彻底干掉。
//   - 前置依赖：`next build` 必须先跑过；test:e2e npm script 会保证这一点。
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/global-setup.ts", "**/global-teardown.ts"],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
