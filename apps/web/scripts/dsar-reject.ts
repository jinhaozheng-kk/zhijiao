#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { rejectDeletion } from "../server/lib/dsar.js";
import { buildInitiatorRef } from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  let requestId: string | undefined;
  let note: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--note") {
      note = argv[++i];
    } else if (!a.startsWith("--")) {
      requestId = a;
    }
  }
  if (!requestId || !note) {
    throw new Error('Usage: dsar:reject <requestId> --note "..."');
  }
  return { requestId, note };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const r = await rejectDeletion(prisma, {
      requestId: args.requestId,
      note: args.note,
      initiatorRef: buildInitiatorRef(),
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
