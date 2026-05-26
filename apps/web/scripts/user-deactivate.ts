#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { deactivateUser } from "../server/lib/pii-governance.js";
import { buildInitiatorRef, resolveOperatorUserId } from "../server/lib/operator.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let reason: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--reason") {
      reason = argv[++i];
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    positional.push(arg);
  }
  if (positional.length !== 1) {
    throw new Error("Usage: user:deactivate <userId> [--reason TEXT] [--dry-run]");
  }
  return { userId: positional[0]!, reason, dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const result = await deactivateUser(prisma, {
      userId: args.userId,
      operatorId,
      initiatorRef: buildInitiatorRef(),
      reason: args.reason,
      dryRun: args.dryRun,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
