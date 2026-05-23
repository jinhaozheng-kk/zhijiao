-- CreateEnum
CREATE TYPE "ErrorRootCause" AS ENUM ('CONCEPT_CONFUSION', 'READING_ERROR', 'FORMULA_MISUSE', 'CALCULATION_SLIP', 'TRANSFER_GAP', 'OTHER');

-- CreateEnum
CREATE TYPE "ErrorBookStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "VariantLevel" AS ENUM ('L1', 'L2', 'L3');

-- CreateTable
CREATE TABLE "error_book_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "status" "ErrorBookStatus" NOT NULL DEFAULT 'ACTIVE',
    "rootCause" "ErrorRootCause" NOT NULL,
    "root_cause_reasoning" TEXT NOT NULL,
    "actual_answer_md" TEXT,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "next_review_at" TIMESTAMP(3),
    "last_reviewed_at" TIMESTAMP(3),
    "diagnose_ledger_id" TEXT,
    "last_diagnose_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_book_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_groups" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credits_cost" INTEGER NOT NULL,
    "debit_ledger_id" TEXT NOT NULL,
    "model_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_items" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "level" "VariantLevel" NOT NULL,
    "position" INTEGER NOT NULL,
    "stem_md" TEXT NOT NULL,
    "solution_md" TEXT NOT NULL,
    "knowledge_point_hints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_book_entries_user_id_status_next_review_at_idx" ON "error_book_entries"("user_id", "status", "next_review_at");

-- CreateIndex
CREATE INDEX "error_book_entries_user_id_status_created_at_idx" ON "error_book_entries"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "error_book_entries_question_id_idx" ON "error_book_entries"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_groups_debit_ledger_id_key" ON "variant_groups"("debit_ledger_id");

-- CreateIndex
CREATE INDEX "variant_groups_entry_id_created_at_idx" ON "variant_groups"("entry_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "variant_groups_user_id_created_at_idx" ON "variant_groups"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "variant_items_group_id_position_idx" ON "variant_items"("group_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "variant_items_group_id_level_key" ON "variant_items"("group_id", "level");

-- AddForeignKey
ALTER TABLE "error_book_entries" ADD CONSTRAINT "error_book_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_book_entries" ADD CONSTRAINT "error_book_entries_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_groups" ADD CONSTRAINT "variant_groups_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "error_book_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_items" ADD CONSTRAINT "variant_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "variant_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Plan 4 spec §3.3: partial unique index allows DELETED entries to coexist with new ACTIVE/ARCHIVED entries.
-- Prisma 5 schema 不直接支持带 WHERE 的 partial unique，手动追加进 Prisma 迁移文件本身；
-- Prisma apply 时会把这一行也跑掉，checksum 与磁盘文件保持一致。
CREATE UNIQUE INDEX "error_book_entries_user_question_active_idx"
  ON "error_book_entries" ("user_id", "question_id")
  WHERE "status" IN ('ACTIVE', 'ARCHIVED');
