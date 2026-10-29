-- Migration: 20261025040000_mandatory_mfa_and_account_security
-- Additive, non-destructive migration introducing explicit MFA state, account lockout, and hashed recovery codes

-- 1. AlterTable users (add MFA state and brute-force lockout tracking)
ALTER TABLE "users" 
ADD COLUMN IF NOT EXISTS "mfa_enrolled_at" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "mfa_pending_secret_encrypted" BYTEA,
ADD COLUMN IF NOT EXISTS "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "last_totp_timestamp" BIGINT;

-- 2. CreateTable user_recovery_codes (stores single-use hashed recovery codes)
CREATE TABLE IF NOT EXISTS "user_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- 3. CreateIndex for fast user lookup
CREATE INDEX IF NOT EXISTS "user_recovery_codes_user_id_idx" ON "user_recovery_codes"("user_id");

-- 4. Foreign Key with safe idempotent constraint creation
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_recovery_codes_user_id_fkey') THEN
        ALTER TABLE "user_recovery_codes" 
        ADD CONSTRAINT "user_recovery_codes_user_id_fkey" 
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 5. CreateTable system_settings (for sealing bootstrap status and administrative policies)
CREATE TABLE IF NOT EXISTS "system_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- 6. Grant runtime permissions to credentialing_app role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user_recovery_codes" TO credentialing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "system_settings" TO credentialing_app;
