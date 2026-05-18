import { defineConfig, devices } from "@playwright/test";

// E2E runs against an isolated port + DB:
//   - port 3100 (避开常驻 dev server 占用的 3000)
//   - DB zhijiao_test (避免污染开发库)
//   - 每次冷启动 dev server，本地与 CI 行为一致
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
    command: `pnpm exec next dev -p ${PORT}`,
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
