-- CreateEnum
CREATE TYPE "ClassroomMemberRole" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssignmentTierLevel" AS ENUM ('BASIC', 'CONSOLIDATION', 'CHALLENGE');

-- CreateEnum
CREATE TYPE "StudentAssignmentStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "AssignmentGradeStatus" AS ENUM ('UNGRADED', 'CORRECT', 'PARTIAL', 'WRONG');

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "grade_level" "GradeLevel",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_members" (
    "classroom_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ClassroomMemberRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classroom_members_pkey" PRIMARY KEY ("classroom_id","user_id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "classroom_id" TEXT NOT NULL,
    "teacher_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "generation_ledger_id" TEXT,
    "generation_call_id" TEXT,
    "published_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_tiers" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "level" "AssignmentTierLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "rationale_md" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_items" (
    "id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "question_id" TEXT,
    "position" INTEGER NOT NULL,
    "stem_md" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "options_json" JSONB,
    "answer_md" TEXT NOT NULL,
    "solution_md" TEXT NOT NULL,
    "rubric_md" TEXT,
    "kp_hints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_assignments" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "student_user_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "status" "StudentAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "suggested_tier" "AssignmentTierLevel",
    "tier_override_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "graded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_answers" (
    "id" TEXT NOT NULL,
    "student_assignment_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "answer_json" JSONB NOT NULL,
    "grade_status" "AssignmentGradeStatus" NOT NULL DEFAULT 'UNGRADED',
    "teacher_feedback_md" TEXT,
    "error_book_entry_id" TEXT,
    "graded_at" TIMESTAMP(3),

    CONSTRAINT "assignment_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_performance" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "student_user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "grade_status" "AssignmentGradeStatus" NOT NULL,
    "kp_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_performance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classroom_members_user_id_role_idx" ON "classroom_members"("user_id", "role");

-- CreateIndex
CREATE INDEX "assignments_teacher_user_id_status_created_at_idx" ON "assignments"("teacher_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "assignments_classroom_id_status_created_at_idx" ON "assignments"("classroom_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_tiers_assignment_id_level_key" ON "assignment_tiers"("assignment_id", "level");

-- CreateIndex
CREATE INDEX "assignment_items_question_id_idx" ON "assignment_items"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_items_tier_id_position_key" ON "assignment_items"("tier_id", "position");

-- CreateIndex
CREATE INDEX "student_assignments_student_user_id_status_created_at_idx" ON "student_assignments"("student_user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_assignments_assignment_id_student_user_id_key" ON "student_assignments"("assignment_id", "student_user_id");

-- CreateIndex
CREATE INDEX "assignment_answers_item_id_grade_status_idx" ON "assignment_answers"("item_id", "grade_status");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_answers_student_assignment_id_item_id_key" ON "assignment_answers"("student_assignment_id", "item_id");

-- CreateIndex
CREATE INDEX "assignment_performance_student_user_id_created_at_idx" ON "assignment_performance"("student_user_id", "created_at");

-- CreateIndex
CREATE INDEX "assignment_performance_assignment_id_idx" ON "assignment_performance"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_performance_assignment_id_student_user_id_item_i_key" ON "assignment_performance"("assignment_id", "student_user_id", "item_id");

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_tiers" ADD CONSTRAINT "assignment_tiers_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_items" ADD CONSTRAINT "assignment_items_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "assignment_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_items" ADD CONSTRAINT "assignment_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "assignment_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_assignments" ADD CONSTRAINT "student_assignments_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_student_assignment_id_fkey" FOREIGN KEY ("student_assignment_id") REFERENCES "student_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "assignment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_error_book_entry_id_fkey" FOREIGN KEY ("error_book_entry_id") REFERENCES "error_book_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
