import { NextResponse } from "next/server";
import { AuthProvider } from "@prisma/client";
import { prisma } from "@zhijiao/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCENARIOS = new Set(["empty", "active", "due", "future"]);

async function findUserByPhone(phone: string) {
  return prisma.user.findFirst({
    where: {
      identities: {
        some: {
          provider: AuthProvider.PHONE,
          providerScope: "GLOBAL",
          providerUserId: phone,
        },
      },
    },
    select: { id: true },
  });
}

async function firstPublishedQuestionId() {
  const question = await prisma.question.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!question) throw new Error("No published question seeded for E2E");
  return question.id;
}

async function readState(userId: string) {
  const [questionId, wallet, entries] = await Promise.all([
    firstPublishedQuestionId(),
    prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
    prisma.errorBookEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        reviewCount: true,
        _count: { select: { variantGroups: true } },
      },
    }),
  ]);

  return {
    questionId,
    balance: wallet?.balance ?? 0,
    entries: entries.map((entry) => ({
      id: entry.id,
      status: entry.status,
      reviewCount: entry.reviewCount,
      variantGroupCount: entry._count.variantGroups,
    })),
  };
}

async function resetUserErrorBook(userId: string, balance = 100) {
  await prisma.variantItem.deleteMany({
    where: { group: { userId } },
  });
  await prisma.variantGroup.deleteMany({ where: { userId } });
  await prisma.errorBookEntry.deleteMany({ where: { userId } });
  await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balance },
    update: { balance },
  });
}

function unauthorizedIfDisabled() {
  if (process.env.E2E_TEST_HOOKS !== "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  return null;
}

export async function GET(req: Request) {
  const disabled = unauthorizedIfDisabled();
  if (disabled) return disabled;

  const url = new URL(req.url);
  const phone = url.searchParams.get("phone") ?? "";
  const user = await findUserByPhone(phone);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  return NextResponse.json(await readState(user.id));
}

export async function POST(req: Request) {
  const disabled = unauthorizedIfDisabled();
  if (disabled) return disabled;

  const body = (await req.json()) as { phone?: string; scenario?: string };
  const phone = body.phone ?? "";
  const scenario = body.scenario ?? "";
  if (!SCENARIOS.has(scenario)) {
    return NextResponse.json({ error: "invalid scenario" }, { status: 400 });
  }

  const user = await findUserByPhone(phone);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const questionId = await firstPublishedQuestionId();
  await resetUserErrorBook(user.id);

  if (scenario !== "empty") {
    const now = Date.now();
    const nextReviewAt =
      scenario === "due"
        ? new Date(now - 60_000)
        : new Date(now + (scenario === "future" ? 2 : 1) * DAY_MS);

    await prisma.errorBookEntry.create({
      data: {
        userId: user.id,
        questionId,
        status: "ACTIVE",
        rootCause: "CONCEPT_CONFUSION",
        rootCauseReasoning: "E2E fixture reasoning.",
        actualAnswerMd: "x = 5",
        reviewCount: 0,
        nextReviewAt,
      },
    });
  }

  return NextResponse.json(await readState(user.id));
}
