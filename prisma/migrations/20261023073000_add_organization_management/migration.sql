-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "dba_name" VARCHAR(255),
    "npi_number" VARCHAR(10),
    "tax_id_encrypted" BYTEA,
    "tax_id_last_four" VARCHAR(4),
    "organization_type" VARCHAR(50) NOT NULL DEFAULT 'medical_group',
    "address1" VARCHAR(255) NOT NULL,
    "address2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "zip_code" VARCHAR(10) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "website" VARCHAR(255),
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "employment_type" VARCHAR(50),
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_organizations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "payer_enrollments" ADD COLUMN "organization_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_npi_number_key" ON "organizations"("npi_number") WHERE "npi_number" IS NOT NULL;

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "provider_organizations_provider_id_idx" ON "provider_organizations"("provider_id");

-- CreateIndex
CREATE INDEX "provider_organizations_organization_id_idx" ON "provider_organizations"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_organizations_provider_id_organization_id_key" ON "provider_organizations"("provider_id", "organization_id");

-- CreateIndex
CREATE INDEX "payer_enrollments_organization_id_idx" ON "payer_enrollments"("organization_id");

-- AddForeignKey
ALTER TABLE "payer_enrollments" ADD CONSTRAINT "payer_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_organizations" ADD CONSTRAINT "provider_organizations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_organizations" ADD CONSTRAINT "provider_organizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant privileges to application user
GRANT SELECT, INSERT, UPDATE, DELETE ON "organizations" TO credentialing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "provider_organizations" TO credentialing_app;
