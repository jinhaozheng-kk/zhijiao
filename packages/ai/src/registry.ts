import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "prompts");

export function fingerprintOf(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface LoadedPrompt {
  name: string;
  version: string;
  body: string;
  fingerprint: string;
  interpolate(vars: Record<string, string | undefined>): string;
}

const cache = new Map<string, LoadedPrompt>();

export async function loadPrompt(name: string, version: string): Promise<LoadedPrompt> {
  const key = `${name}@${version}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const path = join(PROMPTS_DIR, name, `${version}.md`);
  const body = await readFile(path, "utf8");
  const fingerprint = fingerprintOf(body);

  const prompt: LoadedPrompt = {
    name,
    version,
    body,
    fingerprint,
    interpolate(vars) {
      return body.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
        const v = vars[varName];
        if (v === undefined || v === null) {
          throw new Error(`Prompt ${name}@${version} missing variable: ${varName}`);
        }
        return String(v);
      });
    },
  };

  cache.set(key, prompt);
  return prompt;
}

export class PromptVersionConflictError extends Error {
  constructor(
    public promptName: string,
    public version: string,
    public dbFingerprint: string,
    public fileFingerprint: string,
  ) {
    super(
      `Prompt ${promptName}@${version} content changed without a version bump ` +
        `(db=${dbFingerprint.slice(0, 12)}…, file=${fileFingerprint.slice(0, 12)}…). ` +
        `Bump the version (rename ${promptName}/${version}.md → ${promptName}/<next>.md) instead of editing in place.`,
    );
    this.name = "PromptVersionConflictError";
  }
}

// 把 prompt 同步到 DB 表 PromptTemplate。版本一旦写入即不可变：
//   - 不存在 → 创建
//   - 存在且指纹相同 → 复用
//   - 存在但指纹不同 → 抛 PromptVersionConflictError（强制 dev 升版本号）
export async function ensurePromptInDb(
  prisma: PrismaClient,
  prompt: LoadedPrompt,
): Promise<string> {
  const existing = await prisma.promptTemplate.findUnique({
    where: { name_version: { name: prompt.name, version: prompt.version } },
  });
  if (existing) {
    if (existing.fingerprint === prompt.fingerprint) return existing.id;
    throw new PromptVersionConflictError(
      prompt.name,
      prompt.version,
      existing.fingerprint,
      prompt.fingerprint,
    );
  }
  const created = await prisma.promptTemplate.create({
    data: {
      name: prompt.name,
      version: prompt.version,
      body: prompt.body,
      fingerprint: prompt.fingerprint,
    },
  });
  return created.id;
}
