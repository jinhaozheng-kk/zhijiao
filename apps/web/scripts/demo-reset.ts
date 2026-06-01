#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";
import { resetDemoData, verifyDemoData } from "../server/demo/seed.js";
import { loadCliEnv } from "./load-cli-env.js";

loadCliEnv();

async function main() {
  if (process.env.DEMO_MODE !== "1") {
    throw new Error("Refusing to reset demo data unless DEMO_MODE=1.");
  }

  const prisma = new PrismaClient();
  try {
    await resetDemoData(prisma);
    const result = await verifyDemoData(prisma);
    // eslint-disable-next-line no-console
    console.log(`Demo data reset complete (${result.checked.length} checks).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
