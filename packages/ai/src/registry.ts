import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

// 把 prompt 同步到 DB 表 PromptTemplate，幂等
import type { PrismaClient } from "@prisma/client";

export async function ensurePromptInDb(
  prisma: PrismaClient,
  prompt: LoadedPrompt,
): Promise<string> {
  const existing = await prisma.promptTemplate.findUnique({
    where: { name_version: { name: prompt.name, version: prompt.version } },
  });
  if (existing && existing.fingerprint === prompt.fingerprint) return existing.id;

  const upserted = await prisma.promptTemplate.upsert({
    where: { name_version: { name: prompt.name, version: prompt.version } },
    create: {
      name: prompt.name,
      version: prompt.version,
      body: prompt.body,
      fingerprint: prompt.fingerprint,
    },
    update: {
      body: prompt.body,
      fingerprint: prompt.fingerprint,
    },
  });
  return upserted.id;
}
