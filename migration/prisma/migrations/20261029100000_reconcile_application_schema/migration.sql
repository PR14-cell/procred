ALTER TABLE "documents"
    ADD COLUMN IF NOT EXISTS "issue_date" DATE,
    ADD COLUMN IF NOT EXISTS "provider_id" UUID,
    ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "status" VARCHAR(30) NOT NULL DEFAULT 'pending_review',
    ADD COLUMN IF NOT EXISTS "verification_notes" TEXT,
    ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "verified_by" UUID;

ALTER TABLE "notes"
    ADD COLUMN IF NOT EXISTS "provider_id" UUID,
    ADD COLUMN IF NOT EXISTS "updated_by" UUID;

ALTER TABLE "payer_enrollments"
    ADD COLUMN IF NOT EXISTS "enrollment_type" VARCHAR(20) NOT NULL DEFAULT 'individual',
    ADD COLUMN IF NOT EXISTS "missing_items" JSONB,
    ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "tasks"
    ADD COLUMN IF NOT EXISTS "completed_by" UUID,
    ADD COLUMN IF NOT EXISTS "completion_notes" TEXT,
    ADD COLUMN IF NOT EXISTS "provider_id" UUID,
    ADD COLUMN IF NOT EXISTS "task_type" VARCHAR(50) NOT NULL DEFAULT 'general';

ALTER TABLE "notification_preferences" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "organizations" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "provider_organizations" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "user_recovery_codes" ALTER COLUMN "id" DROP DEFAULT;

DROP INDEX IF EXISTS "organizations_npi_number_key";
CREATE UNIQUE INDEX "organizations_npi_number_key" ON "organizations"("npi_number");

CREATE INDEX IF NOT EXISTS "documents_provider_id_idx" ON "documents"("provider_id");
CREATE INDEX IF NOT EXISTS "documents_document_type_idx" ON "documents"("document_type");
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents"("status");
CREATE INDEX IF NOT EXISTS "notes_provider_id_idx" ON "notes"("provider_id");
CREATE INDEX IF NOT EXISTS "notes_created_by_idx" ON "notes"("created_by");
CREATE INDEX IF NOT EXISTS "notes_is_pinned_idx" ON "notes"("is_pinned");
CREATE INDEX IF NOT EXISTS "tasks_provider_id_idx" ON "tasks"("provider_id");
CREATE INDEX IF NOT EXISTS "tasks_task_type_idx" ON "tasks"("task_type");
CREATE INDEX IF NOT EXISTS "tasks_priority_idx" ON "tasks"("priority");
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_provider_id_fkey') THEN
        ALTER TABLE "documents" ADD CONSTRAINT "documents_provider_id_fkey"
            FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_verified_by_fkey') THEN
        ALTER TABLE "documents" ADD CONSTRAINT "documents_verified_by_fkey"
            FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_provider_id_fkey') THEN
        ALTER TABLE "notes" ADD CONSTRAINT "notes_provider_id_fkey"
            FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_updated_by_fkey') THEN
        ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_fkey"
            FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_provider_id_fkey') THEN
        ALTER TABLE "tasks" ADD CONSTRAINT "tasks_provider_id_fkey"
            FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_completed_by_fkey') THEN
        ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_fkey"
            FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "documents" TO credentialing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notes" TO credentialing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payer_enrollments" TO credentialing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tasks" TO credentialing_app;
