-- CreateEnum
CREATE TYPE "FamilyLinkStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "family_links" (
    "id" TEXT NOT NULL,
    "parent_user_id" TEXT NOT NULL,
    "student_user_id" TEXT NOT NULL,
    "status" "FamilyLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "family_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_links_student_user_id_status_idx" ON "family_links"("student_user_id", "status");

-- CreateIndex
CREATE INDEX "family_links_parent_user_id_status_idx" ON "family_links"("parent_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "family_links_parent_user_id_student_user_id_key" ON "family_links"("parent_user_id", "student_user_id");

-- AddForeignKey
ALTER TABLE "family_links" ADD CONSTRAINT "family_links_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_links" ADD CONSTRAINT "family_links_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
