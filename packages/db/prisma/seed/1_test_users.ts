import { PrismaClient, Role } from "@prisma/client";

export async function seedTestUsers(prisma: PrismaClient) {
  const users = [
    { id: "dev-student-01", phone: "13800000001", name: "测试学生", role: Role.STUDENT },
    { id: "dev-teacher-01", phone: "13800000002", name: "测试教师", role: Role.TEACHER },
    { id: "dev-parent-01",  phone: "13800000003", name: "测试家长", role: Role.PARENT },
    { id: "dev-ops-01",     phone: "13800000004", name: "测试运营", role: Role.OPS },
    { id: "dev-admin-01",   phone: "13800000005", name: "测试管理员", role: Role.ADMIN },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        phone: u.phone,
        name: u.name,
        roles: { create: [{ role: u.role }] },
      },
      update: { name: u.name },
    });
  }

  console.log(`✓ Test users seeded: ${users.length}`);
}
