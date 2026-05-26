import { PrismaClient } from "@prisma/client";
import { seedCurriculum } from "./0_curriculum.js";
import { seedTestUsers } from "./1_test_users.js";
import { seedQuestions } from "./2_questions.js";
import { seedKpAliases } from "./3_kp_aliases.js";
import { seedClassroom } from "./4_classroom.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");
  await seedCurriculum(prisma);
  await seedTestUsers(prisma);
  await seedQuestions(prisma);
  await seedKpAliases(prisma);
  await seedClassroom(prisma);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
