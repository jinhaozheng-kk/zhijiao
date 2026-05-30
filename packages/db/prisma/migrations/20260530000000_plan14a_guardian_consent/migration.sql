-- CreateEnum
CREATE TYPE "GuardianConsentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'GRANTED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_year" INTEGER,
ADD COLUMN     "guardian_consent_status" "GuardianConsentStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- CreateTable
CREATE TABLE "guardian_consents" (
    "id" TEXT NOT NULL,
    "child_user_id" TEXT NOT NULL,
    "guardian_user_id" TEXT NOT NULL,
    "consent_scope" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guardian_consents_child_user_id_idx" ON "guardian_consents"("child_user_id");

-- CreateIndex
CREATE INDEX "guardian_consents_guardian_user_id_idx" ON "guardian_consents"("guardian_user_id");

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_child_user_id_fkey" FOREIGN KEY ("child_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_guardian_user_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
