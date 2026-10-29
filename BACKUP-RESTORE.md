# Backup, Restore & Disaster Recovery Guide
**Provider Credentialing & Payer Enrollment Management System**

This guide details the backup, integrity verification, and disaster recovery procedures for systems deployed via Dockge on TrueNAS SCALE.

---

## 1. Backup Scope & Components

A portable migration archive consists of the database table data and MinIO objects. The destination schema is created by the versioned Prisma migrations before restore. The encryption key is managed and transferred separately.

```
┌────────────────────────────────────────────────────────┐
│               Complete System Backup                   │
├─────────────────────────┬──────────────────────────────┤
│ 1. PostgreSQL Data       │ Table rows (SQL and JSON);  │
│    (Structured Data)    │ schema comes from migrations│
├─────────────────────────┼──────────────────────────────┤
│ 2. MinIO Object Storage │ Encrypted license PDFs,      │
│    (Unstructured Data)  │ credentials, org agreements  │
├─────────────────────────┼──────────────────────────────┤
│ 3. Encryption Key       │ transferred separately       │
│    (Security Secret)    │ required for encrypted data  │
└─────────────────────────┴──────────────────────────────┘
```

> [!CAUTION]
> **Encryption Key Warning:**
> Backups store encrypted data. If `ENCRYPTION_KEY` is lost, all encrypted SSNs, Tax IDs, and credential documents are **permanently unrecoverable**, even with a valid database and MinIO backup. Never store the encryption key inside the backup archive itself.

---

## 2. Coordinated Application Backup Service

The System Administration & Data Portability center uses `src/lib/system/system-admin-service.ts`. The complete ZIP is accessible from `/admin/system` and stored in the persistent `/app/backups` volume.

### How It Works:
1. **Database Data Export:** Captures structured table rows as JSON plus SQL data statements. It is not a schema dump; deploy the matching Prisma migrations on the destination first.
2. **MinIO Object Snapshot:** Downloads all objects across the configured credentials, enrollments, and general buckets.
3. **Cryptographic Manifest:** Generates `manifest.json` containing:
   - Database byte size and SHA-256 checksum.
   - Document count and per-file SHA-256 checksums.
   - Schema version and timestamp.
4. **Bundle Archive:** Packages the manifest, database data, and objects into a ZIP stored in the persistent `/app/backups/` volume. Login sessions and secrets are excluded.

### Creating a Coordinated Backup via Web UI:
1. Log in as an authorized administrator.
2. Navigate to **System Administration & Data Portability** (`/admin/system`).
3. Click **Export Complete Backup ZIP**.
4. Once completed, download the `.zip` archive to an offsite secure storage location.

Protect downloaded ZIP files as sensitive data in transit and at rest. Copy them off the TrueNAS host for disaster recovery; the named Docker volume is host-local.

---

## 3. Direct TrueNAS / Command-Line Backup Methods

For automated scheduling on TrueNAS SCALE, use standard Docker Compose commands:

### A. PostgreSQL Database Dump
```bash
docker compose exec -T postgres pg_dump -U credentialing_admin -d credentialing -Fc > /mnt/<your-pool>/backups/db_backup_$(date +%Y%m%d_%H%M%S).dump
```

### B. MinIO Document Storage Snapshot
```bash
# Using MinIO Client (mc) or archiving the data volume directly
docker compose exec -T minio tar -czf - /data > /mnt/<your-pool>/backups/minio_data_$(date +%Y%m%d_%H%M%S).tar.gz
```

---

## 4. Integrity Verification

Every backup created by the application includes cryptographic verification:

### Web UI Verification:
1. Navigate to **Administration -> Backup & Restore**.
2. Click **Verify** next to the backup entry.
3. The system checks ZIP structure, table data, document presence, and SHA-256 values against `manifest.json` before showing a restore preview.

---

## 5. Restoration Procedures

### Method 1: Web UI Protected Restore
1. Deploy the destination's matching Prisma schema with the controlled migration runner.
2. Navigate to **System Administration & Data Portability** (`/admin/system`).
3. Upload the ZIP or select a server-side archive, then validate it and review the preview.
4. Choose full restore or selective import and confirm the operation.
5. For a full restore, an explicit safety confirmation dialog appears:
   - Type the confirmation phrase: `RESTORE FULL SYSTEM` or `RESTORE_CONFIRM`.
   - Provide your administrator password or fresh MFA TOTP code for sensitive action re-authentication.
6. The system verifies a pre-restore recovery point before replacing business data. User accounts and immutable audit records are preserved; saved sessions are excluded and users sign in again.

### Method 2: Manual CLI Restore (Emergency Only)
> [!CAUTION]
> The following procedure drops and recreates the target database. It is not part of normal deployment or upgrade. Restoring a snapshot replaces current database contents; changes made after that snapshot timestamp will be lost. Confirm the backup and maintenance approval before proceeding.

If the web application is inaccessible, restore directly through the PostgreSQL container. Apply the matching Prisma migrations and restore the corresponding MinIO snapshot as well; this SQL-only method does not restore object storage:

```bash
# 1. Terminate client connections
docker compose exec postgres psql -U credentialing_admin -d postgres -c "
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'credentialing' AND pid <> pg_backend_pid();
"

# 2. Drop and recreate target database
docker compose exec postgres psql -U credentialing_admin -d postgres -c "DROP DATABASE credentialing;"
docker compose exec postgres psql -U credentialing_admin -d postgres -c "CREATE DATABASE credentialing OWNER credentialing_admin;"

# 3. Restore database dump
cat db_backup.dump | docker compose exec -T postgres pg_restore -U credentialing_admin -d credentialing

# 4. Re-apply permissions
docker compose exec postgres /docker-entrypoint-initdb.d/01-init-roles.sh
```

---

## 6. Recommended TrueNAS SCALE Backup Strategy

For production resilience, combine the application backup service with TrueNAS platform features:

1. **ZFS Periodic Snapshot Tasks:**
   - Schedule daily snapshots of the dataset holding the Dockge stack and Docker storage with a 30-day retention policy.
2. **TrueNAS Cloud Sync Tasks:**
   - Configure a TrueNAS Cloud Sync task to replicate encrypted backup archives to Backblaze B2, Wasabi, or AWS S3 with immutability (Object Lock) enabled.
