#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { fulfillDeletion } from "../server/lib/dsar.js";
import {
  buildInitiatorRef,
  resolveOperatorUserId,
} from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  let requestId: string | undefined;
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") {
      dryRun = true;
    } else if (!a.startsWith("--")) {
      requestId = a;
    }
  }
  if (!requestId) {
    throw new Error("Usage: dsar:fulfill <requestId> [--dry-run]");
  }
  return { requestId, dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const r = await fulfillDeletion(prisma, {
      requestId: args.requestId,
      operatorId,
      initiatorRef: buildInitiatorRef(),
      dryRun: args.dryRun,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
