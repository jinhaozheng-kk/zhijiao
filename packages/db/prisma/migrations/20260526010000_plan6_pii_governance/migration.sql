-- CreateEnum
CREATE TYPE "OpsActionKind" AS ENUM ('DEACTIVATE_USER', 'EXPORT_USER_DATA', 'GC_SWEEP_SHORT', 'GC_SWEEP_MEDIUM', 'GC_SWEEP_ORPHAN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3),
ADD COLUMN "deactivation_reason" TEXT;

-- AlterTable
ALTER TABLE "wechat_pay_events" ALTER COLUMN "raw_body" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "variant_groups" DROP CONSTRAINT "variant_groups_entry_id_fkey";

-- CreateTable
CREATE TABLE "ops_action_logs" (
    "id" TEXT NOT NULL,
    "kind" "OpsActionKind" NOT NULL,
    "initiator_id" TEXT,
    "initiator_ref" TEXT NOT NULL,
    "target_user_id" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "ops_action_logs_kind_created_at_idx" ON "ops_action_logs"("kind", "created_at");

-- CreateIndex
CREATE INDEX "ops_action_logs_target_user_id_idx" ON "ops_action_logs"("target_user_id");

-- AddForeignKey
ALTER TABLE "variant_groups" ADD CONSTRAINT "variant_groups_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "error_book_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_action_logs" ADD CONSTRAINT "ops_action_logs_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_action_logs" ADD CONSTRAINT "ops_action_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
