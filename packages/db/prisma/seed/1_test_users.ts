import { AuthProvider, Persona, PrismaClient, Role } from "@prisma/client";

export async function seedTestUsers(prisma: PrismaClient) {
  const users: Array<{
    id: string;
    phone: string;
    name: string;
    persona: Persona;
    role?: Role;
  }> = [
    { id: "dev-student-01", phone: "13800000001", name: "测试学生",   persona: Persona.STUDENT },
    { id: "dev-teacher-01", phone: "13800000002", name: "测试教师",   persona: Persona.TEACHER },
    { id: "dev-parent-01",  phone: "13800000003", name: "测试家长",   persona: Persona.PARENT },
    { id: "dev-ops-01",     phone: "13800000004", name: "测试运营",   persona: Persona.STUDENT, role: Role.OPS },
    { id: "dev-admin-01",   phone: "13800000005", name: "测试管理员", persona: Persona.STUDENT, role: Role.ADMIN },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        name: u.name,
        persona: u.persona,
        identities: {
          create: [
            {
              provider: AuthProvider.PHONE,
              providerScope: "GLOBAL",
              providerUserId: u.phone,
            },
          ],
        },
        ...(u.role
          ? { roles: { create: [{ role: u.role }] } }
          : {}),
      },
      update: { name: u.name, persona: u.persona },
    });
  }

  console.log(`✓ Test users seeded: ${users.length}`);
}
