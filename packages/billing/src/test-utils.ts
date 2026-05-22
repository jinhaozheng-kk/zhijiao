import { PrismaClient } from "@prisma/client";
import type { User, Wallet } from "@prisma/client";
import { ensureWallet } from "./wallet";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "test-utils.ts: DATABASE_URL must be set by vitest config (per-pkg test DB).",
  );
}

export const prismaTest = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

export async function resetBillingTables(): Promise<void> {
  await prismaTest.$executeRawUnsafe(
    'TRUNCATE TABLE "wallets", "credit_ledger", "topup_orders", "wechat_pay_events", "users" RESTART IDENTITY CASCADE;',
  );
}

export async function makeUserWithBalance(
  initial: number,
): Promise<{ user: User; wallet: Wallet }> {
  const user = await prismaTest.user.create({ data: { isMinor: false } });
  const wallet = await ensureWallet(prismaTest, user.id);
  if (initial > 0) {
    await prismaTest.wallet.update({
      where: { id: wallet.id },
      data: { balance: initial },
    });
    await prismaTest.creditLedger.create({
      data: {
        walletId: wallet.id,
        kind: "TOPUP",
        delta: initial,
        balanceAfter: initial,
        idemKey: `topup:bootstrap:${user.id}`,
      },
    });
  }
  return { user, wallet };
}

export async function waitForCondition(
  fn: () => Promise<boolean> | boolean,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeout = opts.timeoutMs ?? 3000;
  const interval = opts.intervalMs ?? 25;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitForCondition timeout after ${timeout}ms: ${opts.label ?? "(unlabeled)"}`,
  );
}
