#!/usr/bin/env tsx
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { exportUserData } from "../server/lib/pii-governance.js";
import { buildInitiatorRef, resolveOperatorUserId } from "../server/lib/operator.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out") {
      out = argv[++i];
      continue;
    }
    positional.push(arg);
  }
  if (positional.length !== 1 || !out) {
    throw new Error("Usage: user:export <userId> --out <path.json>");
  }
  if (!out.endsWith(".json")) {
    throw new Error("--out must end with .json");
  }
  if (fs.existsSync(out)) {
    throw new Error(`Refuse to overwrite existing file: ${out}`);
  }
  return { userId: positional[0]!, out };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const operatorId = await resolveOperatorUserId(prisma);
    const initiatorRef = buildInitiatorRef();
    const data = await exportUserData(prisma, args.userId);
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(args.out, json, { encoding: "utf8", flag: "wx" });
    try {
      fs.chmodSync(args.out, 0o600);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`chmod 0600 failed (best effort): ${(error as Error).message}`);
    }

    await prisma.opsActionLog.create({
      data: {
        kind: "EXPORT_USER_DATA",
        initiatorId: operatorId,
        initiatorRef,
        targetUserId: args.userId,
        payload: {
          exportSizeBytes: Buffer.byteLength(json, "utf8"),
          outputWritten: true,
          recordCounts: {
            authIdentities: data.authIdentities.length,
            creditLedger: data.creditLedger.length,
            topupOrders: data.topupOrders.length,
            errorBookEntries: data.errorBookEntries.length,
            userAdhocQuestions: data.userAdhocQuestions.length,
            modelCalls: data.modelCalls.length,
            studentAssignments: data.studentAssignments.length,
            assignmentAnswers: data.assignmentAnswers.length,
            assignmentPerformance: data.assignmentPerformance.length,
          },
        },
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Exported ${Buffer.byteLength(json, "utf8")} bytes to ${args.out}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
