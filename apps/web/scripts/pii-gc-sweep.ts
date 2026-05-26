#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { sweepPii, type SweepBucket } from "../server/lib/pii-governance.js";
import { buildInitiatorRef, resolveOperatorUserId } from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  let bucket: SweepBucket | "all" = "all";
  let dryRun = false;
  let now: Date | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--bucket") {
      bucket = argv[++i] as SweepBucket | "all";
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--now") {
      now = new Date(argv[++i]!);
      if (Number.isNaN(now.getTime())) throw new Error("Invalid --now ISO date");
      continue;
    }
    throw new Error(`Unknown arg: ${arg}`);
  }
  if (!["short", "medium", "orphan", "all"].includes(bucket)) {
    throw new Error(`Invalid --bucket: ${bucket}`);
  }
  return { bucket, dryRun, now };
}

function loadThresholds() {
  const shortDays = Number(process.env.PII_RETENTION_SHORT_DAYS ?? "30");
  const mediumDays = Number(process.env.PII_RETENTION_MEDIUM_DAYS ?? "90");
  const orphanDays = Number(process.env.PII_RETENTION_ORPHAN_TOPUP_DAYS ?? "180");
  if (!Number.isInteger(shortDays) || shortDays < 1) {
    throw new Error("Invalid PII_RETENTION_SHORT_DAYS");
  }
  if (!Number.isInteger(mediumDays) || mediumDays <= shortDays) {
    throw new Error("Invalid PII_RETENTION_MEDIUM_DAYS");
  }
  if (!Number.isInteger(orphanDays) || orphanDays <= mediumDays) {
    throw new Error("Invalid PII_RETENTION_ORPHAN_TOPUP_DAYS");
  }
  return { shortDays, mediumDays, orphanDays };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = loadThresholds();
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const results = await sweepPii(prisma, {
      ...args,
      ...thresholds,
      operatorId,
      initiatorRef: buildInitiatorRef(),
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
