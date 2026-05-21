import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { Persona, SessionRevokeReason } from "@prisma/client";
import { createSession, rotateSession, hashRefresh } from "../src/session.js";
import { AuthError } from "../src/errors.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

async function seedUser() {
  return prisma.user.create({ data: { name: "x", persona: Persona.STUDENT, isMinor: false } });
}

describe("session", () => {
  it("create + rotate happy path", async () => {
    const u = await seedUser();
    const { refreshToken: rt1, sessionId: s1 } = await createSession(prisma, u.id, {});
    const { refreshToken: rt2, sessionId: s2 } = await rotateSession(prisma, rt1, {});
    expect(s2).not.toBe(s1);
    expect(rt2).not.toBe(rt1);
    const old = await prisma.session.findUniqueOrThrow({ where: { id: s1 } });
    expect(old.revokedReason).toBe(SessionRevokeReason.ROTATED);
  });

  it("重放检测：用 rotated refresh 再 rotate → REUSE_DETECTED + 全部 session revoke", async () => {
    const u = await seedUser();
    const { refreshToken: rt1 } = await createSession(prisma, u.id, {});
    const { refreshToken: rt2 } = await rotateSession(prisma, rt1, {});
    await expect(rotateSession(prisma, rt1, {})).rejects.toMatchObject({ reason: "REUSE_DETECTED" });
    const active = await prisma.session.count({ where: { userId: u.id, revokedAt: null } });
    expect(active).toBe(0);
  });

  it("不存在的 refresh → NO_SESSION", async () => {
    await expect(rotateSession(prisma, "totally-fake", {})).rejects.toMatchObject({ reason: "NO_SESSION" });
  });

  it("过期 → SESSION_REVOKED", async () => {
    const u = await seedUser();
    const { refreshToken: rt } = await createSession(prisma, u.id, {});
    await prisma.session.updateMany({
      where: { refreshTokenHash: hashRefresh(rt) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(rotateSession(prisma, rt, {})).rejects.toMatchObject({ reason: "SESSION_REVOKED" });
  });

  // Plan 2 Hardening — Task 3 (I1): atomic refresh rotation. Concurrent calls
  // with the same refresh token must NOT both win. The old code did
  // findUnique → check revokedAt → tx.update({where:{id}}); the WHERE clause
  // had no `revokedAt: null` predicate, so two parallel transactions both
  // updated the row and both went on to create new sessions (two new refresh
  // tokens issued for one revoked one). This is a token-multiplication bug.
  //
  // Fix is predicate-on-update inside a single $transaction: only the caller
  // whose `updateMany({hash, revokedAt:null, expiresAt:{gt:now}})` returns
  // count===1 proceeds; the others read the (now-revoked) row and see
  // REUSE_DETECTED. Postgres READ COMMITTED + EvalPlanQual guarantees the
  // re-evaluation of the predicate after the row lock releases.
  it("并发 rotate (N=5) → 仅 1 个成功 + 其余 REUSE_DETECTED + 不重复颁发", async () => {
    const u = await seedUser();
    const { refreshToken: rt1 } = await createSession(prisma, u.id, {});

    const N = 5;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => rotateSession(prisma, rt1, {})),
    );
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ refreshToken: string; sessionId: string; userId: string }> =>
        r.status === "fulfilled",
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    // 1) 仅 1 个 caller 成功
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(N - 1);

    // 2) 失败者必须是 REUSE_DETECTED — 任何 SESSION_REVOKED / NO_SESSION 都说明
    //    predicate 没拦住，或者诊断分支挑错了 reason
    for (const r of rejected) {
      const err = r.reason as AuthError;
      expect(err).toBeInstanceOf(AuthError);
      expect(err.reason).toBe("REUSE_DETECTED");
    }

    // 3) 新颁发的 refresh token 只有 1 个 unique 值（不允许多发）
    const issuedTokens = new Set(fulfilled.map((r) => r.value.refreshToken));
    expect(issuedTokens.size).toBe(1);
    expect(issuedTokens.has(rt1)).toBe(false);

    // 4) 数据库里 user 名下 session 总数 = 1 (original revoked) + 1 (winner new) = 2.
    //    旧代码的 race bug 会让此数变成 1 + N。
    const total = await prisma.session.count({ where: { userId: u.id } });
    expect(total).toBe(2);

    // 5) REUSE_DETECTED 触发后所有 user session（含 winner 的新 session）都 revoke
    const active = await prisma.session.count({ where: { userId: u.id, revokedAt: null } });
    expect(active).toBe(0);
  });
});
