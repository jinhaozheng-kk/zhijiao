import { NextResponse } from "next/server";
import { AuthProvider } from "@prisma/client";
import { prisma } from "@zhijiao/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorizedIfDisabled() {
  if (process.env.E2E_TEST_HOOKS !== "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  return null;
}

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

// Seeds a deterministic learning portrait for one student:
//   - one FOCUS KP (2 WRONG → score 0)
//   - one SOLID KP (2 CORRECT → score 1)
//   - wallet reset to balance=100 so generateAdvice can charge.
export async function POST(req: Request) {
  const disabled = unauthorizedIfDisabled();
  if (disabled) return disabled;

  const body = (await req.json()) as { phone?: string };
  const phone = body.phone ?? "";
  const user = await findUserByPhone(phone);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const kps = await prisma.knowledgePoint.findMany({
    where: { subject: { code: "math" } },
    orderBy: { code: "asc" },
    take: 2,
    select: { id: true, name: true },
  });
  if (kps.length < 2) {
    return NextResponse.json({ error: "need >= 2 math KPs seeded" }, { status: 500 });
  }
  const [focusKp, solidKp] = kps;

  const assignmentId = `e2e-an-${user.id}`;
  await prisma.assignmentPerformance.deleteMany({ where: { studentUserId: user.id } });
  await prisma.assignmentPerformance.createMany({
    data: [
      { assignmentId, studentUserId: user.id, itemId: "e2e-an-i1", gradeStatus: "WRONG", kpIds: [focusKp!.id] },
      { assignmentId, studentUserId: user.id, itemId: "e2e-an-i2", gradeStatus: "WRONG", kpIds: [focusKp!.id] },
      { assignmentId, studentUserId: user.id, itemId: "e2e-an-i3", gradeStatus: "CORRECT", kpIds: [solidKp!.id] },
      { assignmentId, studentUserId: user.id, itemId: "e2e-an-i4", gradeStatus: "CORRECT", kpIds: [solidKp!.id] },
    ],
  });
  await prisma.wallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id, balance: 100 },
    update: { balance: 100 },
  });

  return NextResponse.json({
    studentUserId: user.id,
    focusKp: focusKp!.name,
    solidKp: solidKp!.name,
  });
}
