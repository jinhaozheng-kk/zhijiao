import type { PrismaClient } from "@prisma/client";

const SHANGHAI_OFFSET_HOURS = 8;

export function startOfMonthInShanghai(now: Date): Date {
  const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000);
  const y = shanghai.getUTCFullYear();
  const m = shanghai.getUTCMonth();
  return new Date(Date.UTC(y, m, 1, 0, 0, 0) - SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000);
}

export async function sumMonthlyTopupCents(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const monthStart = startOfMonthInShanghai(now);
  const [unpaidAgg, paidAgg] = await Promise.all([
    prisma.topupOrder.aggregate({
      where: {
        userId,
        status: { in: ["CREATED", "PENDING"] },
        createdAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    }),
    prisma.topupOrder.aggregate({
      where: {
        userId,
        status: "PAID",
        paidAt: { gte: monthStart },
      },
      _sum: { amountCents: true },
    }),
  ]);
  return (unpaidAgg._sum.amountCents ?? 0) + (paidAgg._sum.amountCents ?? 0);
}
