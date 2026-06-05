-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "CognitiveLevel" AS ENUM ('REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE');

-- CreateEnum
CREATE TYPE "PaperStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "PaperItemSource" AS ENUM ('BANK', 'AI_GENERATED');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "cognitive_level" "CognitiveLevel";

-- CreateTable
CREATE TABLE "papers" (
    "id" TEXT NOT NULL,
    "teacher_user_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PaperStatus" NOT NULL DEFAULT 'DRAFT',
    "params_json" JSONB NOT NULL,
    "generation_ledger_id" TEXT,
    "generation_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_items" (
    "id" TEXT NOT NULL,
    "paper_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "question_id" TEXT,
    "source" "PaperItemSource" NOT NULL,
    "stem_md" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "options_json" JSONB,
    "answer_md" TEXT NOT NULL,
    "solution_md" TEXT NOT NULL,
    "rubric_md" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "cognitive_level" "CognitiveLevel" NOT NULL,
    "kp_hints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "papers_teacher_user_id_status_created_at_idx" ON "papers"("teacher_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "paper_items_question_id_idx" ON "paper_items"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_items_paper_id_position_key" ON "paper_items"("paper_id", "position");

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_items" ADD CONSTRAINT "paper_items_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_items" ADD CONSTRAINT "paper_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
