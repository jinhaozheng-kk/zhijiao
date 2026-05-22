import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// E2E webServer 自管理：见 playwright.config.ts 的说明。本文件负责：
//   - 清理上一次跑挂留下的 .playwright-server-pid + 端口占用
//   - spawn next start，写 PID 文件
//   - 轮询 /readiness，60s 内不 ready 就把刚 spawn 的进程也清掉再 throw

const PORT = 3100;
const PID_FILE = ".playwright-server-pid";
// Per-package test DB (plan §Task -1). Shared with apps/web vitest tests; not
// concurrent because E2E and unit/integration aren't run together by design.
const TEST_DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_web";
const WORKSPACE_ROOT = resolve(process.cwd(), "../..");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function killWindowsTree(pid: string | number): void {
  try {
    execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
  } catch {
    // 进程已经不在了，忽略
  }
}

function killListenersOnPort(port: number): void {
  if (process.platform !== "win32") return;
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
    const seen = new Set<string>();
    for (const raw of out.split("\n")) {
      const line = raw.trim();
      if (!line.includes("LISTENING")) continue;
      // 行格式: TCP <local>:<port> <remote> LISTENING <pid>
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
      const m = line.match(/(\d+)$/);
      if (m && m[1]) seen.add(m[1]);
    }
    for (const pid of seen) killWindowsTree(pid);
  } catch {
    // netstat 本身报错就算了
  }
}

function clearStaleState(): void {
  // 先杀掉端口占用（不管谁），再删旧的 pidfile
  killListenersOnPort(PORT);
  if (existsSync(PID_FILE)) {
    const stale = readFileSync(PID_FILE, "utf8").trim();
    if (stale && process.platform === "win32") killWindowsTree(stale);
    try {
      unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }
}

function seedE2eDb(): void {
  execSync(`${PNPM_BIN} --filter @zhijiao/db db:seed`, {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "inherit",
  });
}

export default async function globalSetup(): Promise<void> {
  clearStaleState();
  seedE2eDb();

  // 单串命令，shell: true 走 cmd.exe /c。spawn 返回的是 cmd.exe 的 PID；teardown 用
  // taskkill /T /F 会沿树往下走，仍能干掉 next start 本身。如果到 teardown 时这个 PID
  // 已经不存在，teardown 还会按端口扫一遍兜底。
  const cmd = `${PNPM_BIN} exec next start -p ${PORT}`;
  const child = spawn(cmd, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_USE_MOCK: "true",
      DATABASE_URL: TEST_DB_URL,
      // NODE_ENV=test is intentionally omitted: next start refuses to run when NODE_ENV=test.
      // E2E_TEST_HOOKS=1 alone is sufficient to unlock /api/__test__/last-otp and route SMS
      // to sharedTestSmsAdapter inside the spawned server process.
      E2E_TEST_HOOKS: "1",
      SMS_USE_MOCK: "true",
      WECHAT_OAUTH_USE_MOCK: "true",
      WECHAT_PAY_USE_MOCK: "true",
      MOCK_WECHAT_PAY_SECRET: "e2e-mock-pay-secret-32bytes-padding",
      WECHAT_PAY_APPID: "wxpay-e2e-app",
      WECHAT_PAY_MCHID: "1900000000",
      CREDIT_PER_YUAN: "10",
      MINOR_MONTHLY_LIMIT_YUAN: "200",
      ACCESS_JWT_SECRET: "e2e-test-secret-at-least-32-bytes-long",
      // OTP_PEPPER must be >= 16 bytes (env validator min(16)). Previous value
      // "e2e-pepper" (10 bytes) would now fail boot.
      OTP_PEPPER: "e2e-otp-pepper-min16-bytes",
      WECHAT_H5_APPID: "wx-mock-app",
      // NEXT_PUBLIC_APP_URL is required by env validator. Use the E2E port so
      // route handlers that derive absolute URLs match the running server.
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    },
    stdio: "inherit",
    shell: true,
  });

  if (!child.pid) throw new Error("globalSetup: failed to spawn next start");
  writeFileSync(PID_FILE, String(child.pid));

  const url = `http://localhost:${PORT}`;
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < 60_000) {
      try {
        const r = await fetch(url);
        if (r.ok) {
          // eslint-disable-next-line no-console
          console.log(`[e2e] server up at ${url} (spawn pid=${child.pid})`);
          return;
        }
      } catch {
        // not yet
      }
      await sleep(500);
    }
    throw new Error(`globalSetup: server didn't start within 60s on ${url}`);
  } catch (e) {
    // 自清理：失败路径必须把刚刚 spawn 的进程 + pidfile + 端口占用全收掉
    clearStaleState();
    throw e;
  }
}
