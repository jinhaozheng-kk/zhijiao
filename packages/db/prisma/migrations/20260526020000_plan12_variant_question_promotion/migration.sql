-- AlterTable
ALTER TABLE "variant_items" ADD COLUMN "question_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "variant_items_question_id_key" ON "variant_items"("question_id");

-- AddForeignKey
ALTER TABLE "variant_items" ADD CONSTRAINT "variant_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
