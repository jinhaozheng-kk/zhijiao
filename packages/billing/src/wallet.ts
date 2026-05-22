import type { PrismaClient, Wallet } from "@prisma/client";

export async function ensureWallet(
  prisma: PrismaClient,
  userId: string,
): Promise<Wallet> {
  return prisma.wallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}
