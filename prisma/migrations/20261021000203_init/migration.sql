-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'admin', 'credentialing_specialist', 'enrollment_specialist', 'viewer');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'viewer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret_encrypted" BYTEA,
    "mfa_backup_codes_encrypted" BYTEA,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_token" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "last_name" VARCHAR(100) NOT NULL,
    "suffix" VARCHAR(20),
    "date_of_birth" DATE,
    "ssn_encrypted" BYTEA,
    "gender" VARCHAR(20),
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "npi_number" VARCHAR(10),
    "npi_type" SMALLINT,
    "npi_enumeration_date" DATE,
    "primary_taxonomy" VARCHAR(20),
    "taxonomy_description" VARCHAR(255),
    "caqh_id" VARCHAR(20),
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "credentialing_status" VARCHAR(30) NOT NULL DEFAULT 'in_progress',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address1" VARCHAR(255) NOT NULL,
    "address2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "zip_code" VARCHAR(10) NOT NULL,
    "phone" VARCHAR(20),
    "fax" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_locations" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_specialties" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "taxonomy_code" VARCHAR(20) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_licenses" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "license_number" VARCHAR(50) NOT NULL,
    "license_type" VARCHAR(100),
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "issue_date" DATE,
    "expiration_date" DATE,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dea_registrations" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "dea_number" VARCHAR(20) NOT NULL,
    "schedule" VARCHAR(50),
    "state" VARCHAR(2),
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "issue_date" DATE,
    "expiration_date" DATE,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dea_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_certifications" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "board_name" VARCHAR(255) NOT NULL,
    "specialty" VARCHAR(255) NOT NULL,
    "certification_number" VARCHAR(50),
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "initial_cert_date" DATE,
    "expiration_date" DATE,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "malpractice_insurance" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "carrier_name" VARCHAR(255) NOT NULL,
    "policy_number" VARCHAR(100),
    "coverage_type" VARCHAR(50),
    "per_claim_amount" DECIMAL(12,2),
    "aggregate_amount" DECIMAL(12,2),
    "effective_date" DATE,
    "expiration_date" DATE,
    "retroactive_date" DATE,
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "malpractice_insurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caqh_profiles" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "caqh_id" VARCHAR(20) NOT NULL,
    "username" VARCHAR(100),
    "password_encrypted" BYTEA,
    "last_attestation_date" DATE,
    "next_attestation_date" DATE,
    "attestation_status" VARCHAR(30) NOT NULL DEFAULT 'current',
    "reauthorization_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caqh_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "short_name" VARCHAR(50),
    "payer_type" VARCHAR(50),
    "state" VARCHAR(2),
    "website" VARCHAR(500),
    "phone" VARCHAR(20),
    "enrollment_portal_url" VARCHAR(500),
    "required_document_types" TEXT[],
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_enrollments" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "location_id" UUID,
    "provider_payer_id" VARCHAR(50),
    "group_number" VARCHAR(50),
    "group_npi" VARCHAR(10),
    "application_type" VARCHAR(50) NOT NULL DEFAULT 'initial',
    "status" VARCHAR(30) NOT NULL DEFAULT 'not_started',
    "submitted_date" DATE,
    "effective_date" DATE,
    "termination_date" DATE,
    "follow_up_date" DATE,
    "last_follow_up_date" DATE,
    "revalidation_date" DATE,
    "revalidation_cycle_months" INTEGER,
    "tracking_number" VARCHAR(100),
    "assigned_to" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payer_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_status_history" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "previous_status" VARCHAR(30),
    "new_status" VARCHAR(30) NOT NULL,
    "changed_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_follow_ups" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "follow_up_date" DATE NOT NULL,
    "contact_method" VARCHAR(30),
    "contact_person" VARCHAR(255),
    "reference_number" VARCHAR(100),
    "outcome" VARCHAR(50),
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "document_type" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "current_version_id" UUID,
    "expiration_date" DATE,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "s3_bucket" VARCHAR(100) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "checksum_sha256" VARCHAR(64),
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "assigned_to" UUID,
    "created_by" UUID,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "due_date" DATE,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_history" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "method" VARCHAR(50) NOT NULL,
    "source" VARCHAR(255) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "verified_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiration_date" DATE,
    "notes" TEXT,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "user_email" VARCHAR(255),
    "action" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "changes" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_codes" (
    "code" VARCHAR(20) NOT NULL,
    "classification" VARCHAR(255) NOT NULL,
    "specialization" VARCHAR(255),
    "definition" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "taxonomy_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "credential_expiration_rules" (
    "id" UUID NOT NULL,
    "credential_type" VARCHAR(50) NOT NULL,
    "alert_days_before" INTEGER[] DEFAULT ARRAY[90, 60, 30, 14]::INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_expiration_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_token_key" ON "user_sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "providers_npi_number_key" ON "providers"("npi_number");

-- CreateIndex
CREATE UNIQUE INDEX "provider_locations_provider_id_location_id_key" ON "provider_locations"("provider_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_specialties_provider_id_taxonomy_code_key" ON "provider_specialties"("provider_id", "taxonomy_code");

-- CreateIndex
CREATE INDEX "state_licenses_expiration_date_idx" ON "state_licenses"("expiration_date");

-- CreateIndex
CREATE INDEX "state_licenses_provider_id_idx" ON "state_licenses"("provider_id");

-- CreateIndex
CREATE INDEX "dea_registrations_expiration_date_idx" ON "dea_registrations"("expiration_date");

-- CreateIndex
CREATE INDEX "malpractice_insurance_expiration_date_idx" ON "malpractice_insurance"("expiration_date");

-- CreateIndex
CREATE UNIQUE INDEX "caqh_profiles_provider_id_key" ON "caqh_profiles"("provider_id");

-- CreateIndex
CREATE INDEX "caqh_profiles_next_attestation_date_idx" ON "caqh_profiles"("next_attestation_date");

-- CreateIndex
CREATE INDEX "payer_enrollments_provider_id_idx" ON "payer_enrollments"("provider_id");

-- CreateIndex
CREATE INDEX "payer_enrollments_payer_id_idx" ON "payer_enrollments"("payer_id");

-- CreateIndex
CREATE INDEX "payer_enrollments_status_idx" ON "payer_enrollments"("status");

-- CreateIndex
CREATE INDEX "payer_enrollments_revalidation_date_idx" ON "payer_enrollments"("revalidation_date");

-- CreateIndex
CREATE INDEX "payer_enrollments_effective_date_idx" ON "payer_enrollments"("effective_date");

-- CreateIndex
CREATE INDEX "payer_enrollments_follow_up_date_idx" ON "payer_enrollments"("follow_up_date");

-- CreateIndex
CREATE INDEX "enrollment_status_history_enrollment_id_created_at_idx" ON "enrollment_status_history"("enrollment_id", "created_at");

-- CreateIndex
CREATE INDEX "enrollment_follow_ups_enrollment_id_created_at_idx" ON "enrollment_follow_ups"("enrollment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_current_version_id_key" ON "documents"("current_version_id");

-- CreateIndex
CREATE INDEX "documents_entity_type_entity_id_idx" ON "documents"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "documents_expiration_date_idx" ON "documents"("expiration_date");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "tasks_assigned_to_status_idx" ON "tasks"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "tasks_due_date_status_idx" ON "tasks"("due_date", "status");

-- CreateIndex
CREATE INDEX "notes_entity_type_entity_id_idx" ON "notes"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "verification_history_entity_type_entity_id_idx" ON "verification_history"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "verification_history_provider_id_idx" ON "verification_history"("provider_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credential_expiration_rules_credential_type_key" ON "credential_expiration_rules"("credential_type");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_specialties" ADD CONSTRAINT "provider_specialties_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_specialties" ADD CONSTRAINT "provider_specialties_taxonomy_code_fkey" FOREIGN KEY ("taxonomy_code") REFERENCES "taxonomy_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_licenses" ADD CONSTRAINT "state_licenses_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "state_licenses" ADD CONSTRAINT "state_licenses_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dea_registrations" ADD CONSTRAINT "dea_registrations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dea_registrations" ADD CONSTRAINT "dea_registrations_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_certifications" ADD CONSTRAINT "board_certifications_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_certifications" ADD CONSTRAINT "board_certifications_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "malpractice_insurance" ADD CONSTRAINT "malpractice_insurance_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "malpractice_insurance" ADD CONSTRAINT "malpractice_insurance_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caqh_profiles" ADD CONSTRAINT "caqh_profiles_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_status_history" ADD CONSTRAINT "enrollment_status_history_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_status_history" ADD CONSTRAINT "enrollment_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_follow_ups" ADD CONSTRAINT "enrollment_follow_ups_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "payer_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_follow_ups" ADD CONSTRAINT "enrollment_follow_ups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_history" ADD CONSTRAINT "verification_history_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_history" ADD CONSTRAINT "verification_history_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
