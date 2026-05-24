-- AlterTable
ALTER TABLE "questions" ADD COLUMN "created_by_user_id" TEXT;
ALTER TABLE "questions" ADD COLUMN "normalized_stem_hash" TEXT;

-- AddForeignKey
-- Plan 8 spec §2.3: onDelete: SetNull (不是 Restrict) — 用户注销时归属可抹；
-- 与 ErrorBookEntry.questionId @Restrict (审计主链路) 业务含义不同。
ALTER TABLE "questions"
  ADD CONSTRAINT "questions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Plan 8 spec §2.4: partial unique idx for USER_ADHOC dedup.
-- WHERE 子句显式 IS NOT NULL 守门 —— 防脏数据 / 注销后行进入索引语义混乱。
-- Prisma 5 schema 不支持 partial unique，手动追加进 Prisma 迁移文件本身；
-- Prisma apply 时会把这一行也跑掉，checksum 与磁盘文件保持一致。
CREATE UNIQUE INDEX "questions_user_adhoc_dedup_idx"
  ON "questions" ("created_by_user_id", "normalized_stem_hash")
  WHERE "source" = 'USER_ADHOC'
    AND "created_by_user_id" IS NOT NULL
    AND "normalized_stem_hash" IS NOT NULL;
