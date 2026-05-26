import fs from "node:fs";
import path from "node:path";

interface LoadCliEnvOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  nodeEnv?: string;
}

function findWorkspaceRoot(startDir: string) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function parseDotenvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq < 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return key ? { key, value } : null;
}

function loadDotenvFile(filePath: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotenvLine(line);
    if (!parsed) continue;
    if (env[parsed.key] === undefined) {
      env[parsed.key] = parsed.value;
    }
  }
  return true;
}

export function loadCliEnvFrom(startDir: string, options: LoadCliEnvOptions = {}) {
  const env = options.env ?? process.env;
  const root = findWorkspaceRoot(startDir);
  const loadedLocal =
    loadDotenvFile(path.join(root, ".env.local"), env) ||
    loadDotenvFile(path.join(root, ".env"), env);

  const nodeEnv = options.nodeEnv ?? env.NODE_ENV;
  if (!loadedLocal && nodeEnv !== "production") {
    loadDotenvFile(path.join(root, ".env.example"), env);
  }
}

export function loadCliEnv() {
  loadCliEnvFrom(process.cwd());
}
