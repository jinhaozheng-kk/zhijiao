import type { PrismaClient } from "@prisma/client";

export async function expireStaleOrders(
  prisma: PrismaClient,
  now: Date,
): Promise<{ expired: number }> {
  const r = await prisma.topupOrder.updateMany({
    where: {
      status: { in: ["CREATED", "PENDING"] },
      expiredAt: { lt: now },
    },
    data: { status: "EXPIRED" },
  });
  return { expired: r.count };
}
