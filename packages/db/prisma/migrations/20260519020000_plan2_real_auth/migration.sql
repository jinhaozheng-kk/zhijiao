-- Plan 2: Real Auth schema migration
-- Introduces: Persona enum, AuthProvider enum, SessionRevokeReason enum, OtpPurpose enum
-- Reshapes: Role enum (STUDENT/TEACHER/PARENT moved to Persona)
-- Adds tables: auth_identities, sessions, otp_requests
-- Removes: users.phone, users.wechat_openid, users.wechat_unionid, users.email
-- Data migration: copies phone values to auth_identities BEFORE DROP COLUMN

-- Step 1: Create new enums
CREATE TYPE "Persona" AS ENUM ('STUDENT', 'TEACHER', 'PARENT');
CREATE TYPE "AuthProvider" AS ENUM ('PHONE', 'WECHAT_H5', 'WECHAT_OPEN', 'WECHAT_MINIAPP');
CREATE TYPE "SessionRevokeReason" AS ENUM ('ROTATED', 'USER_LOGOUT', 'REUSE_DETECTED', 'ADMIN_REVOKED', 'EXPIRED');
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'BIND_PHONE');

-- Step 2: Truncate user_roles before reshaping Role enum.
-- Plan 1 seed inserted rows with STUDENT/TEACHER/PARENT which cannot cast to the
-- new OPS/ADMIN-only Role enum. Task 2 (seed rewrite) will repopulate OPS/ADMIN rows.
TRUNCATE TABLE "user_roles";

-- Step 3: Reshape Role enum (drop STUDENT/TEACHER/PARENT, keep OPS/ADMIN only).
-- Prisma already wraps each migration file in a single transaction; do NOT add
-- a nested BEGIN/COMMIT here (would commit the outer txn prematurely on Postgres).
CREATE TYPE "Role_new" AS ENUM ('OPS', 'ADMIN');
ALTER TABLE "user_roles" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";

-- Step 4: Add new columns to users (persona/grade_level/is_minor) before creating
-- auth_identities so the table is ready for the FK relationship
ALTER TABLE "users"
  ADD COLUMN "persona"      "Persona"    NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN "grade_level"  "GradeLevel",
  ADD COLUMN "is_minor"     BOOLEAN      NOT NULL DEFAULT true;

-- Step 5: Create auth_identities table (must exist BEFORE the data migration INSERT)
CREATE TABLE "auth_identities" (
    "id"               TEXT NOT NULL,
    "user_id"          TEXT NOT NULL,
    "provider"         "AuthProvider" NOT NULL,
    "provider_scope"   TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "union_id"         TEXT,
    "metadata"         JSONB,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at"     TIMESTAMP(3),

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_identities_provider_union_id_idx"
    ON "auth_identities"("provider", "union_id");

CREATE INDEX "auth_identities_user_id_idx"
    ON "auth_identities"("user_id");

CREATE UNIQUE INDEX "auth_identities_provider_provider_scope_provider_user_id_key"
    ON "auth_identities"("provider", "provider_scope", "provider_user_id");

-- Step 6: DATA MIGRATION — copy Plan 1 seed phone numbers into auth_identities
-- BEFORE dropping the phone column from users.
-- Uses 'aid_' prefix + md5 fragment for a stable-looking deterministic-ish CUID substitute.
INSERT INTO auth_identities (id, user_id, provider, provider_scope, provider_user_id, created_at)
SELECT
    'aid_' || substr(md5(random()::text || u.id), 1, 24),
    u.id,
    'PHONE',
    'GLOBAL',
    u.phone,
    u.created_at
FROM users u
WHERE u.phone IS NOT NULL;

-- Step 7: Drop old unique indexes on columns we are about to remove
DROP INDEX "users_email_key";
DROP INDEX "users_phone_key";
DROP INDEX "users_wechat_openid_key";

-- Step 8: Remove the old identity columns from users
ALTER TABLE "users"
  DROP COLUMN "email",
  DROP COLUMN "phone",
  DROP COLUMN "wechat_openid",
  DROP COLUMN "wechat_unionid";

-- Step 9: Create sessions table
CREATE TABLE "sessions" (
    "id"                 TEXT NOT NULL,
    "user_id"            TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_label"       TEXT,
    "ip_created"         TEXT,
    "user_agent"         TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"         TIMESTAMP(3) NOT NULL,
    "revoked_at"         TIMESTAMP(3),
    "revoked_reason"     "SessionRevokeReason",

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sessions_refresh_token_hash_key"
    ON "sessions"("refresh_token_hash");

CREATE INDEX "sessions_user_id_revoked_at_idx"
    ON "sessions"("user_id", "revoked_at");

CREATE INDEX "sessions_expires_at_idx"
    ON "sessions"("expires_at");

-- Step 10: Create otp_requests table
CREATE TABLE "otp_requests" (
    "id"          TEXT NOT NULL,
    "phone"       TEXT NOT NULL,
    "purpose"     "OtpPurpose" NOT NULL,
    "code_hash"   TEXT NOT NULL,
    "attempts"    INTEGER NOT NULL DEFAULT 0,
    "ip_created"  TEXT,
    "user_agent"  TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "expired_at"  TIMESTAMP(3),

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "otp_requests_phone_created_at_idx"
    ON "otp_requests"("phone", "created_at");

CREATE INDEX "otp_requests_expires_at_idx"
    ON "otp_requests"("expires_at");

-- Step 11: Add foreign key constraints
ALTER TABLE "auth_identities"
    ADD CONSTRAINT "auth_identities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
