// Idempotently create + migrate the per-package test DBs.
// Usage: pnpm.cmd test:setup
//
// Each test package gets its own Postgres database so concurrent `turbo test --force`
// runs cannot race each other's `resetDb()` TRUNCATEs. See plan §Task -1 for full
// context (docs/superpowers/plans/2026-05-20-plan2-hardening.md).
import { execSync, spawnSync } from "node:child_process";

const HOST = process.env.PGHOST ?? "127.0.0.1";
const PORT = process.env.PGPORT ?? "5432";
const USER = process.env.PGUSER ?? "postgres";
const PWD  = process.env.PGPASSWORD ?? "postgres";

const dbs = [
  "zhijiao_test_ai",
  "zhijiao_test_auth",
  "zhijiao_test_db",
  "zhijiao_test_integrations",
  "zhijiao_test_web",
];

function rootDsn(): string {
  return `postgresql://${USER}:${PWD}@${HOST}:${PORT}/postgres`;
}
function dbDsn(name: string): string {
  return `postgresql://${USER}:${PWD}@${HOST}:${PORT}/${name}`;
}

// Run a psql -c statement against the root DSN. Try host psql first; if not
// available, fall back to `docker exec -i zhijiao-postgres psql ...`.
function psqlExec(sql: string): { stdout: string; stderr: string; code: number } {
  const cmd1 = spawnSync("psql", [rootDsn(), "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  });
  if (cmd1.error == null && cmd1.status === 0) {
    return { stdout: cmd1.stdout, stderr: cmd1.stderr, code: 0 };
  }
  // Host psql unavailable or errored. Fall back to docker exec.
  const cmd2 = spawnSync(
    "docker",
    ["exec", "-i", "zhijiao-postgres", "psql", "-U", USER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", env: { ...process.env, PGPASSWORD: PWD } },
  );
  return { stdout: cmd2.stdout, stderr: cmd2.stderr, code: cmd2.status ?? 1 };
}

function ensureDb(name: string): void {
  const result = psqlExec(`CREATE DATABASE "${name}";`);
  if (result.code === 0) {
    console.log(`[setup-test-dbs] created ${name}`);
    return;
  }
  const msg = (result.stderr + result.stdout).toLowerCase();
  if (msg.includes("already exists")) {
    console.log(`[setup-test-dbs] ${name} already exists`);
    return;
  }
  console.error(`[setup-test-dbs] failed to create ${name}:\n${result.stdout}\n${result.stderr}`);
  process.exit(1);
}

function migrate(name: string): void {
  const url = dbDsn(name);
  console.log(`[setup-test-dbs] migrating ${name} …`);
  execSync(`pnpm.cmd --filter @zhijiao/db db:migrate:deploy`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}

for (const db of dbs) {
  ensureDb(db);
  migrate(db);
}
console.log(`[setup-test-dbs] all ${dbs.length} test DBs ready`);
