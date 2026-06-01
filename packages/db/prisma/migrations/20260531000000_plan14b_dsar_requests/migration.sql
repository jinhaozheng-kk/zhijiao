-- CreateEnum
CREATE TYPE "DsarRequestType" AS ENUM ('EXPORT', 'DELETION');

-- CreateEnum
CREATE TYPE "DsarRequestStatus" AS ENUM ('AWAITING_GUARDIAN', 'PENDING', 'COMPLETED', 'REJECTED', 'CANCELED');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'DSAR_DELETION';

-- CreateTable
CREATE TABLE "dsar_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "DsarRequestType" NOT NULL,
    "status" "DsarRequestStatus" NOT NULL DEFAULT 'PENDING',
    "is_minor" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_ref" TEXT,
    "resolution_note" TEXT,
    "guardian_approved_by_user_id" TEXT,
    "guardian_approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dsar_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dsar_requests_status_due_at_idx" ON "dsar_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "dsar_requests_user_id_idx" ON "dsar_requests"("user_id");

-- AddForeignKey
ALTER TABLE "dsar_requests" ADD CONSTRAINT "dsar_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: at most one open DELETION request per user (Plan 14b)
CREATE UNIQUE INDEX "dsar_one_open_deletion_idx" ON "dsar_requests"("user_id")
  WHERE "type" = 'DELETION' AND "status" IN ('AWAITING_GUARDIAN', 'PENDING');
