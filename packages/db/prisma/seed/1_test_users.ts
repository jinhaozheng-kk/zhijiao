import { PrismaClient, Role, Persona, AuthProvider, GradeLevel, GuardianConsentStatus } from "@prisma/client";

type SeedUser = {
  id: string;
  phone: string;
  name: string;
  persona: Persona;
  gradeLevel: GradeLevel | null;
  isMinor: boolean;
  roles: Role[];
  birthYear?: number | null;
  guardianConsentStatus?: GuardianConsentStatus;
};

export async function seedTestUsers(prisma: PrismaClient) {
  const users: SeedUser[] = [
    { id: "dev-student-01", phone: "13800000001", name: "测试学生",   persona: Persona.STUDENT, gradeLevel: GradeLevel.G8, isMinor: true,  roles: [] },
    { id: "dev-teacher-01", phone: "13800000002", name: "测试教师",   persona: Persona.TEACHER, gradeLevel: null,          isMinor: false, roles: [] },
    { id: "dev-parent-01",  phone: "13800000003", name: "测试家长",   persona: Persona.PARENT,  gradeLevel: null,          isMinor: false, roles: [] },
    { id: "dev-ops-01",     phone: "13800000004", name: "测试运营",   persona: Persona.STUDENT, gradeLevel: null,          isMinor: false, roles: [Role.OPS] },
    { id: "dev-admin-01",   phone: "13800000005", name: "测试管理员", persona: Persona.STUDENT, gradeLevel: null,          isMinor: false, roles: [Role.ADMIN] },
    { id: "dev-student-02", phone: "13800000006", name: "测试学生 02", persona: Persona.STUDENT, gradeLevel: GradeLevel.G9, isMinor: false, roles: [] },  // Plan 8: 专给 tutor-error-book-link.spec.ts 用
    { id: "dev-student-03", phone: "13800000007", name: "测试学生 03", persona: Persona.STUDENT, gradeLevel: GradeLevel.G8, isMinor: true,  roles: [] },
    { id: "dev-student-04", phone: "13800000008", name: "测试学生 04", persona: Persona.STUDENT, gradeLevel: GradeLevel.G8, isMinor: true,  roles: [] },  // Plan 11: 专给 family-link.spec.ts 用（发码方）
    { id: "dev-parent-02",  phone: "13800000009", name: "测试家长 02", persona: Persona.PARENT,  gradeLevel: null,          isMinor: false, roles: [] },  // Plan 11: 专给 family-link.spec.ts 用（绑定方）
    { id: "dev-student-05", phone: "13800000010", name: "测试学生 05", persona: Persona.STUDENT, gradeLevel: GradeLevel.G7, isMinor: true,  roles: [], birthYear: 2015, guardianConsentStatus: GuardianConsentStatus.PENDING },  // Plan 14a: <14 待监护人同意，专给 guardian-consent.spec.ts（发码方）
    { id: "dev-parent-03",  phone: "13800000011", name: "测试家长 03", persona: Persona.PARENT,  gradeLevel: null,          isMinor: false, roles: [] },  // Plan 14a: 专给 guardian-consent.spec.ts（绑定方）
    { id: "dev-student-06", phone: "13800000012", name: "测试学生 06", persona: Persona.STUDENT, gradeLevel: GradeLevel.G9, isMinor: false, roles: [], birthYear: 2000, guardianConsentStatus: GuardianConsentStatus.NOT_REQUIRED },  // Plan 14b: 成年独占（注销会销号），专给 dsar.spec.ts
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        name: u.name,
        persona: u.persona,
        gradeLevel: u.gradeLevel ?? undefined,
        isMinor: u.isMinor,
        birthYear: u.birthYear ?? undefined,
        guardianConsentStatus: u.guardianConsentStatus ?? undefined,
        roles: { create: u.roles.map((role) => ({ role })) },
        identities: {
          create: [
            {
              provider: AuthProvider.PHONE,
              providerScope: "GLOBAL",
              providerUserId: u.phone,
            },
          ],
        },
      },
      update: {
        name: u.name,
        persona: u.persona,
        gradeLevel: u.gradeLevel ?? null,
        isMinor: u.isMinor,
        birthYear: u.birthYear ?? null,
        guardianConsentStatus: u.guardianConsentStatus ?? "NOT_REQUIRED",
      },
    });

    // 角色 idempotent upsert（upsert 内的 create 在 update 分支不会重跑）
    for (const role of u.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: u.id, role } },
        create: { userId: u.id, role },
        update: {},
      });
    }

    // Plan 3 Task 14: seed a 100-credit wallet for every test user so
    // chargedProcedure flows (tutor.ask costs 1 credit, etc.) work in
    // E2E without first running a top-up. Idempotent: only seeds when
    // the wallet doesn't already have an audit-trail entry to anchor
    // its balance. Re-running db:seed in an already-credited DB is a
    // no-op for the wallet/ledger.
    const wallet = await prisma.wallet.upsert({
      where: { userId: u.id },
      create: { userId: u.id, balance: 100 },
      update: {},
    });
    const seedIdemKey = `topup:seed:${u.id}`;
    const existing = await prisma.creditLedger.findUnique({
      where: { idemKey: seedIdemKey },
    });
    if (!existing) {
      await prisma.creditLedger.create({
        data: {
          walletId: wallet.id,
          kind: "TOPUP",
          delta: 100,
          balanceAfter: 100,
          idemKey: seedIdemKey,
          actionKind: null,
          metadata: { reason: "DEV/E2E test fixture" },
        },
      });
    }
  }

  console.log(`✓ Test users seeded: ${users.length}`);
}
