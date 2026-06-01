#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { listForOps } from "../server/lib/dsar.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  let status: "pending" | "all" = "pending";
  let type: "export" | "deletion" | undefined;
  let overdueOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--status") {
      status = argv[++i] === "all" ? "all" : "pending";
    } else if (a === "--type") {
      const t = argv[++i];
      type =
        t === "export" ? "export" : t === "deletion" ? "deletion" : undefined;
    } else if (a === "--overdue") {
      overdueOnly = true;
    }
  }
  return { status, type, overdueOnly };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const rows = await listForOps(prisma, args);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(rows, null, 2));
    // eslint-disable-next-line no-console
    console.log(
      `\n${rows.length} request(s); overdue: ${rows.filter((r) => r.overdue).length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
