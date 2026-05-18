import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

const PORT = 3100;
const PID_FILE = ".playwright-server-pid";

function killWindowsTree(pid: string | number): boolean {
  try {
    execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function killListenersOnPort(port: number): string[] {
  if (process.platform !== "win32") return [];
  const killed: string[] = [];
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
    const seen = new Set<string>();
    for (const raw of out.split("\n")) {
      const line = raw.trim();
      if (!line.includes("LISTENING")) continue;
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
      const m = line.match(/(\d+)$/);
      if (m && m[1]) seen.add(m[1]);
    }
    for (const pid of seen) {
      if (killWindowsTree(pid)) killed.push(pid);
    }
  } catch {
    // netstat itself failed; nothing to do
  }
  return killed;
}

export default async function globalTeardown(): Promise<void> {
  // 优先按 pidfile 走：spawn 返回的 cmd.exe PID 走 /T 应该能带走 next 子树
  let killedFromPid = false;
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, "utf8").trim();
    if (pid) {
      if (process.platform === "win32") {
        killedFromPid = killWindowsTree(pid);
      } else {
        try {
          process.kill(Number(pid), "SIGTERM");
          killedFromPid = true;
        } catch {
          // already gone
        }
      }
    }
    try {
      unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }

  // 兜底：不管 pidfile 命没命中，按端口扫一遍，保证 :3100 没有残留监听
  const killedByPort = killListenersOnPort(PORT);

  // 日志含义：
  //   pidfile-kill=true → taskkill 真的杀掉了 spawn 记下的 PID
  //   pidfile-kill=false → 那个 PID 在 teardown 时已经不存在了，taskkill 没事做
  //   port-kill=[...]   → 按端口扫到并杀掉的残留 PID 列表
  //   port-kill=[none]  → 端口已经没监听，不用兜底
  // 正常路径常见 false + [none]：服务进程自己退完了，这里只确认无残留。
  // eslint-disable-next-line no-console
  console.log(
    `[e2e] teardown: pidfile-kill=${killedFromPid}, port-kill=[${killedByPort.join(",") || "none"}]`,
  );
}
