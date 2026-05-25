-- CreateEnum
CREATE TYPE "KpAliasSource" AS ENUM ('SEED', 'CLI_MANUAL');

-- CreateEnum
CREATE TYPE "KpReconcileSource" AS ENUM ('ERROR_ANALYSIS', 'VARIANT_ITEM', 'TUTOR_ADHOC', 'BACKFILL');

-- CreateEnum
CREATE TYPE "KpReconcileSourceRefType" AS ENUM ('ERROR_BOOK_ENTRY', 'VARIANT_ITEM', 'QUESTION');

-- CreateEnum
CREATE TYPE "KpReconcileMatchVia" AS ENUM ('EXACT', 'ALIAS', 'LLM', 'MANUAL');

-- CreateEnum
CREATE TYPE "KpReconcileMatchStatus" AS ENUM ('UNMATCHED', 'PENDING_REVIEW', 'LINKED', 'REJECTED', 'DROPPED');

-- CreateEnum
CREATE TYPE "KpReconcileReviewReason" AS ENUM ('LLM_CONFIDENCE_BAND', 'VARIANT_TO_PARENT_NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "kp_aliases" (
    "id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "kp_id" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "source" "KpAliasSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "kp_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kp_reconcile_matches" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "kp_id" TEXT,
    "raw_hint" TEXT NOT NULL,
    "normalized_hint" TEXT NOT NULL,
    "source" "KpReconcileSource" NOT NULL,
    "source_ref_type" "KpReconcileSourceRefType" NOT NULL,
    "source_ref_id" TEXT NOT NULL,
    "match_via" "KpReconcileMatchVia",
    "confidence" DOUBLE PRECISION,
    "status" "KpReconcileMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "review_reason" "KpReconcileReviewReason",
    "model_call_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kp_reconcile_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kp_aliases_kp_id_idx" ON "kp_aliases"("kp_id");

-- CreateIndex
CREATE UNIQUE INDEX "kp_aliases_subject_id_normalized_alias_key" ON "kp_aliases"("subject_id", "normalized_alias");

-- CreateIndex
CREATE INDEX "kp_reconcile_matches_status_created_at_idx" ON "kp_reconcile_matches"("status", "created_at");

-- CreateIndex
CREATE INDEX "kp_reconcile_matches_question_id_idx" ON "kp_reconcile_matches"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "kp_reconcile_matches_source_ref_type_source_ref_id_normaliz_key" ON "kp_reconcile_matches"("source_ref_type", "source_ref_id", "normalized_hint");

-- AddForeignKey
ALTER TABLE "kp_aliases" ADD CONSTRAINT "kp_aliases_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kp_aliases" ADD CONSTRAINT "kp_aliases_kp_id_fkey" FOREIGN KEY ("kp_id") REFERENCES "knowledge_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kp_aliases" ADD CONSTRAINT "kp_aliases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kp_reconcile_matches" ADD CONSTRAINT "kp_reconcile_matches_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kp_reconcile_matches" ADD CONSTRAINT "kp_reconcile_matches_kp_id_fkey" FOREIGN KEY ("kp_id") REFERENCES "knowledge_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kp_reconcile_matches" ADD CONSTRAINT "kp_reconcile_matches_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kp_reconcile_matches" ADD CONSTRAINT "kp_reconcile_matches_model_call_id_fkey" FOREIGN KEY ("model_call_id") REFERENCES "model_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
