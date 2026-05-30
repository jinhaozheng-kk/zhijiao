import Redis from "ioredis";
import { prisma } from "@zhijiao/db/test-utils";
import type {
  ErrorBookEntry,
  ErrorBookStatus,
  ErrorRootCause,
  Question,
} from "@prisma/client";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

// Single deterministic test subject so error-book / variant tests don't repeat
// the (subject + KPs + questions) ceremony from per-package seed scripts.
// Returned questionId is stable per test (re-seeded after resetDb()).
export async function seedTestSubjectAndQuestion(): Promise<{
  subjectId: string;
  kpId: string;
  questionId: string;
}> {
  const subject = await prisma.subject.create({
    data: { code: "math", name: "数学" },
  });
  const kp = await prisma.knowledgePoint.create({
    data: {
      subjectId: subject.id,
      code: "math-g7-linear-eq",
      name: "一元一次方程",
      difficulty: 2,
    },
  });
  const question = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "解方程：2x + 5 = 13",
      type: "CALCULATION",
      difficulty: 2,
      status: "PUBLISHED",
      answer: {
        create: { contentMd: "x = 4", solutionMd: "移项得 2x = 8，两边除 2 得 x = 4。" },
      },
      knowledgePoints: { create: [{ kpId: kp.id, weight: 1.0 }] },
    },
  });
  return { subjectId: subject.id, kpId: kp.id, questionId: question.id };
}

export interface SeededUser {
  id: string;
  walletId: string;
}

// Seeds a user + wallet with the given starting balance, mirroring the
// bootstrap-topup-ledger pattern used by Plan 3 charged-procedure tests.
export async function seedUserWithBalance(
  balance: number,
  opts: { isMinor?: boolean; gradeLevel?: "G5" | "G6" | "G7" | "G8" | "G9" | "G10" | "G11" | "G12" } = {},
): Promise<SeededUser> {
  const u = await prisma.user.create({
    data: {
      isMinor: opts.isMinor ?? false,
      persona: "STUDENT",
      gradeLevel: opts.gradeLevel ?? "G7",
    },
  });
  const w = await prisma.wallet.create({ data: { userId: u.id, balance } });
  if (balance > 0) {
    await prisma.creditLedger.create({
      data: {
        walletId: w.id,
        kind: "TOPUP",
        delta: balance,
        balanceAfter: balance,
        idemKey: `topup:bootstrap:${u.id}`,
      },
    });
  }
  return { id: u.id, walletId: w.id };
}

// ErrorBookEntry seeder with overridable status / nextReviewAt / reviewCount.
// Auto-creates user + question if not supplied so that "ARCHIVED entry not in
// list" / "DELETED entry not visible" tests can stand alone.
export interface ErrorBookSeedOpts {
  userId: string;
  questionId: string;
  status?: ErrorBookStatus;
  rootCause?: ErrorRootCause;
  rootCauseReasoning?: string;
  reviewCount?: number;
  nextReviewAt?: Date | null;
  lastReviewedAt?: Date | null;
  diagnoseLedgerId?: string | null;
}

export async function seedErrorBookEntry(
  opts: ErrorBookSeedOpts,
): Promise<ErrorBookEntry> {
  return prisma.errorBookEntry.create({
    data: {
      userId: opts.userId,
      questionId: opts.questionId,
      status: opts.status ?? "ACTIVE",
      rootCause: opts.rootCause ?? "CONCEPT_CONFUSION",
      rootCauseReasoning: opts.rootCauseReasoning ?? "Fixture reasoning.",
      reviewCount: opts.reviewCount ?? 0,
      // Default nextReviewAt for ACTIVE is now+1d; ARCHIVED/DELETED should be
      // null to mirror runtime behaviour (archive/delete clear it).
      nextReviewAt:
        opts.nextReviewAt !== undefined
          ? opts.nextReviewAt
          : opts.status === "ARCHIVED" || opts.status === "DELETED"
            ? null
            : new Date(Date.now() + 24 * 60 * 60 * 1000),
      lastReviewedAt: opts.lastReviewedAt ?? null,
      diagnoseLedgerId: opts.diagnoseLedgerId ?? null,
    },
  });
}

// Standard ctx factory for appRouter.createCaller(...). Mirrors the shape
// used by charged-procedure-tutor.test.ts so any new test importing it gets
// the same auth / requestId / headers assumptions.
export function makeCtx(
  userId: string,
  overrides: Partial<{ requestId: string; isMinor: boolean }> = {},
) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor: overrides.isMinor ?? false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: overrides.requestId ?? "test-req-error",
    resHeaders: new Headers(),
    cookies: {},
  };
}

// Mirrors the AccessClaims shape that routers expect for `Question` lookups.
// Useful when tests need to bypass question seeding and assert on missing-row
// behaviour.
export function genCuid(label: string): string {
  // Produce a syntactically valid cuid (z.string().cuid()): "c" + 24 chars
  // lowercase alphanumeric. We pad/truncate from a deterministic prefix so
  // tests stay reproducible.
  const sanitised = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  const padded = (sanitised + "0".repeat(24)).slice(0, 24);
  return "c" + padded;
}
