-- CreateEnum
CREATE TYPE "CoursewareStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "CoursewareSectionType" AS ENUM ('INTRO', 'EXPLANATION', 'EXAMPLE', 'PITFALL', 'EXERCISE');

-- CreateTable
CREATE TABLE "coursewares" (
    "id" TEXT NOT NULL,
    "teacher_user_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "grade_level" "GradeLevel",
    "status" "CoursewareStatus" NOT NULL DEFAULT 'DRAFT',
    "params_json" JSONB NOT NULL,
    "generation_ledger_id" TEXT,
    "generation_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coursewares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courseware_sections" (
    "id" TEXT NOT NULL,
    "courseware_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "CoursewareSectionType" NOT NULL,
    "title" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courseware_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coursewares_teacher_user_id_status_created_at_idx" ON "coursewares"("teacher_user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "courseware_sections_courseware_id_position_key" ON "courseware_sections"("courseware_id", "position");

-- AddForeignKey
ALTER TABLE "coursewares" ADD CONSTRAINT "coursewares_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coursewares" ADD CONSTRAINT "coursewares_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courseware_sections" ADD CONSTRAINT "courseware_sections_courseware_id_fkey" FOREIGN KEY ("courseware_id") REFERENCES "coursewares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

