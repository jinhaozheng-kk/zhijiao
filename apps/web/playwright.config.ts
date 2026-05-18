import { defineConfig, devices } from "@playwright/test";

// E2E runs against an isolated port + DB + production-mode server:
//   - port 3100 (避开常驻 dev server 占用的 3000)
//   - DB zhijiao_test (避免污染开发库)
//   - `next start` against a prebuilt artifact, NOT `next dev`. dev 在 Windows 下
//     被 Playwright 的 SIGTERM 杀不干净，命令在两个测试都通过后会挂住直到 timeout；
//     start 是单进程、能干净退出。前置 next build 由 npm script test:e2e 保证。
const PORT = 3100;
const TEST_DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AI_USE_MOCK: "true",
      DATABASE_URL: TEST_DB_URL,
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
