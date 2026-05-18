import { PrismaClient } from "@prisma/client";
import { seedCurriculum } from "./0_curriculum.js";
import { seedTestUsers } from "./1_test_users.js";
import { seedQuestions } from "./2_questions.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");
  await seedCurriculum(prisma);
  await seedTestUsers(prisma);
  await seedQuestions(prisma);
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
