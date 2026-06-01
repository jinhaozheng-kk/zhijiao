#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { verifyDemoData } from "../server/demo/seed.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

async function main() {
  if (process.env.DEMO_MODE !== "1") {
    throw new Error("Refusing to verify demo data unless DEMO_MODE=1.");
  }

  const prisma = new PrismaClient();
  try {
    const result = await verifyDemoData(prisma);
    // eslint-disable-next-line no-console
    console.log(`Demo data verified (${result.checked.length} checks).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
