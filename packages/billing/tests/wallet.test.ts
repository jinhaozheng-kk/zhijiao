import { describe, it, expect, beforeEach } from "vitest";
import { ensureWallet } from "../src/wallet";
import { prismaTest, resetBillingTables } from "../src/test-utils";

describe("ensureWallet", () => {
  beforeEach(resetBillingTables);

  it("creates wallet on first call", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const w = await ensureWallet(prismaTest, u.id);
    expect(w.balance).toBe(0);
    expect(w.userId).toBe(u.id);
  });

  it("returns existing wallet on second call (no duplicate)", async () => {
    const u = await prismaTest.user.create({ data: { isMinor: false } });
    const w1 = await ensureWallet(prismaTest, u.id);
    const w2 = await ensureWallet(prismaTest, u.id);
    expect(w2.id).toBe(w1.id);
    const count = await prismaTest.wallet.count({ where: { userId: u.id } });
    expect(count).toBe(1);
  });
});
