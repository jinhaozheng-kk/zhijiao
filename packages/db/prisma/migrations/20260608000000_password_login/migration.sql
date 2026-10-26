ALTER TABLE "users"
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "password_set_at" TIMESTAMP(3);
