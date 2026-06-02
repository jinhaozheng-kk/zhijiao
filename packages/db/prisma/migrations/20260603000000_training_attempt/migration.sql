-- CreateEnum
CREATE TYPE "TrainingItemSource" AS ENUM ('ERROR_BOOK', 'VARIANT');
-- CreateTable
CREATE TABLE "training_attempts" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "student_user_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "source" "TrainingItemSource" NOT NULL,
    "grade_status" "AssignmentGradeStatus" NOT NULL,
    "kp_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_attempts_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "training_attempts_student_user_id_created_at_idx" ON "training_attempts"("student_user_id", "created_at");
