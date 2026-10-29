CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiration_alerts" BOOLEAN NOT NULL DEFAULT true,
    "revalidation_alerts" BOOLEAN NOT NULL DEFAULT true,
    "task_alerts" BOOLEAN NOT NULL DEFAULT true,
    "missing_doc_alerts" BOOLEAN NOT NULL DEFAULT true,
    "daily_digest" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_id_key"
    ON "notification_preferences"("user_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notification_preferences_user_id_fkey'
    ) THEN
        ALTER TABLE "notification_preferences"
            ADD CONSTRAINT "notification_preferences_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preferences" TO credentialing_app;