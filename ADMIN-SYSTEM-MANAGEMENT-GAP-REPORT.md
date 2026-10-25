# Admin & System Management Enhancement — Gap Analysis & Implementation Plan

**Date:** 2026-10-23  
**Status:** Inspection Complete — Ready for Implementation  
**Target Environment:** Provider Credentialing & Payer Enrollment Management System (Docker / Production-Freeze Baseline)

---

## 1. Executive Summary

This report assesses the current system state against the three missing administrative capabilities requested:
1. **Backup & Restore Management**
2. **Admin & User Password Management**
3. **User Account & Profile Management**

All inspections were performed against the actual repository files, Prisma schema, Docker Compose stack, authentication modules, and test suites. No destructive operations, database resets, or duplicate systems will be introduced.

---

## 2. Gap Analysis by Domain

### 2.1 Backup & Restore
- **Existing Assets:**
  - `scripts/backup.ps1` and `scripts/backup.sh` exist and handle PostgreSQL `pg_dump` and MinIO data copy to `./backups`.
  - `scripts/restore.ps1` and `scripts/restore.sh` exist for manual CLI restoration.
  - Existing backup directory `./backups` contains historical artifacts (`postgres_20261021_054307.sql.gz`).
- **Gaps Identified:**
  - No admin API routes or UI exist for backup/restore.
  - No coordinated manifest (`metadata.json`) recording backup scope, timestamps, file sizes, SHA-256 checksums, and schema versions.
  - No automated integrity verification check before marking a backup as successful or restorable.
  - No secure download endpoint with RBAC authorization (`super_admin` / `admin`).
  - No safe restore workflow with preflight checks, explicit confirmation tokens, and automatic pre-restore safety recovery points.
  - Lack of audit logging for backup creation, download, verification, and restore attempts.

### 2.2 Password Management
- **Existing Assets:**
  - Password hashing with `bcryptjs` (salt rounds = 12).
  - MFA TOTP generation, validation, and backup codes via `otplib` and AES-256-GCM in `src/app/api/v1/auth/mfa/route.ts`.
  - JWT session token creation and verification in `src/lib/auth/jwt.ts`.
- **Gaps Identified:**
  - No self-service password change API (`/api/v1/profile/change-password`) or UI.
  - No current-password verification workflow for self-service changes.
  - No admin-initiated password reset API (`/api/v1/admin/users/[id]/reset-password`) or UI.
  - Session invalidation is incomplete: sessions are deleted from `user_sessions` on logout, but `requireAuth` relies solely on stateless JWT verification and does not check for session revocation or active account status on security-sensitive actions.
  - No rate limiting on password change or reset attempts.

### 2.3 User Account & Profile Management
- **Existing Assets:**
  - `User` model in `prisma/schema.prisma` with `id`, `email`, `firstName`, `lastName`, `role`, `isActive`, `mfaEnabled`, `lastLoginAt`.
  - `src/app/api/v1/admin/users/route.ts` provides unpaginated listing and basic creation.
  - `src/app/(dashboard)/admin/users/page.tsx` provides a basic table and user creation modal.
  - `users:manage` permission defined in `src/lib/auth/rbac.ts`.
- **Gaps Identified:**
  - No pagination or search/filtering on `GET /api/v1/admin/users`.
  - No user detail or editing endpoint (`PATCH /api/v1/admin/users/[id]`) for updating names, status (`isActive`), or roles.
  - No self-service profile page (`/profile` or `/admin/profile`) or endpoint (`PATCH /api/v1/profile`) to update personal profile information without privilege escalation.
  - No protection against deactivating or demoting the last active administrator.
  - No protection against self-promotion or unauthorized privilege escalation.
  - No UI controls for editing users, toggling active/inactive status, or triggering resets.

### 2.4 Navigation & UI
- **Existing Assets:**
  - Sidebar in `src/app/(dashboard)/layout.tsx` includes `Users & Roles` (`/admin/users`).
- **Gaps Identified:**
  - Missing sidebar entry for `Backup & Restore` (`/admin/backup`).
  - Missing entry or profile link for `My Profile / Account Security` (`/profile`).

---

## 3. Architecture & Implementation Plan

### Step 2: Backup & Restore Architecture
1. **Service Layer (`src/lib/backup/backup-service.ts`):**
   - Coordinated backup generation: creates timestamped folder in `./backups/` containing:
     - `database.sql` (PostgreSQL dump using `pg_dump` via child_process or Docker).
     - `documents/` (MinIO objects across `credentials`, `enrollments`, and `general` buckets via S3 client).
     - `manifest.json` (metadata: id, timestamp, postgresSize, documentCount, documentSize, sha256 checksums, status: `complete`, keysExcluded: true).
   - Integrity Verification: checks manifest checksums against actual files, validates SQL structure, and confirms document availability.
   - Backup Listing: reads metadata from `./backups/` directory manifests.
   - Secure Download: streams a `.tar.gz` or `.zip` archive to authorized administrators only.
   - Safe Restore Workflow:
     - Preflight check: verifies backup exists, validates integrity, confirms database connectivity.
     - Confirmation check: requires explicit confirmation payload (`confirmRestore: "RESTORE_CONFIRM"`).
     - Automatic pre-restore recovery point created before any data replacement.
     - Restores database and MinIO documents.
   - Audit Logging: logs `BACKUP_CREATED`, `BACKUP_VERIFIED`, `BACKUP_DOWNLOADED`, `RESTORE_PREFLIGHT`, `RESTORE_COMPLETED`.
2. **API Routes:**
   - `GET /api/v1/admin/backup` — list backups (admin/super_admin).
   - `POST /api/v1/admin/backup` — trigger new coordinated backup.
   - `POST /api/v1/admin/backup/[id]/verify` — verify backup integrity.
   - `GET /api/v1/admin/backup/[id]/download` — download backup archive.
   - `POST /api/v1/admin/backup/[id]/restore` — execute preflight and restore.
3. **UI Page (`src/app/(dashboard)/admin/backup/page.tsx`):**
   - Displays backup list with timestamps, size, document count, and verification status.
   - "Create Backup" button with progress spinner.
   - "Verify Integrity" and "Download" actions.
   - "Restore" modal requiring explicit confirmation typing, warning of overwrite, and showing preflight status.

### Step 3: Password Management Architecture
1. **Self-Service Password Change (`POST /api/v1/profile/change-password`):**
   - Requires current password verification via `bcrypt.compare`.
   - Validates new password against password policy (min 8 chars, mixed case/digit).
   - Hashes with `bcrypt` (12 rounds).
   - Deletes all existing sessions in `user_sessions` for the user (session invalidation) except the current one if renewed.
   - Rate limiting via `CacheService`.
   - Audit log: `PASSWORD_CHANGED`.
2. **Admin-Initiated Password Reset (`POST /api/v1/admin/users/[id]/reset-password`):**
   - Requires `users:manage` permission.
   - Generates a secure temporary password or updates password.
   - Invalidates all sessions for the target user in `user_sessions`.
   - Never exposes plaintext in audit logs or server logs.
   - Audit log: `USER_PASSWORD_RESET`.
3. **Session Revocation Guard (`src/lib/auth/server-auth.ts`):**
   - Enhance `requireAuth` to verify that the user exists and `isActive === true`.
   - If session is revoked in `user_sessions`, reject with 401.

### Step 4: User & Profile Management Architecture
1. **User Management API Enhancements:**
   - `GET /api/v1/admin/users`: Add query parameters `search`, `role`, `status`, `page`, `limit`.
   - `GET /api/v1/admin/users/[id]`: Retrieve single user detail with session and audit counts.
   - `PATCH /api/v1/admin/users/[id]`:
     - Update `firstName`, `lastName`, `role`, `isActive`.
     - **Last Administrator Protection:** If target user is `super_admin` or `admin`, and update sets `isActive: false` or demotes role, verify count of remaining active admins > 1. Reject with 400/403 if it would remove the last administrator.
     - **Privilege Escalation Protection:** Non-super_admin cannot promote anyone to `super_admin`. Users cannot edit their own role.
     - Audit logs: `USER_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`.
2. **Self-Service Profile API (`/api/v1/profile`):**
   - `GET /api/v1/profile`: Returns own user details (excluding secrets/hashes).
   - `PATCH /api/v1/profile`: Updates own `firstName`, `lastName`. Role cannot be modified.
3. **UI Pages:**
   - Update `src/app/(dashboard)/admin/users/page.tsx`: Add search bar, role/status filter, pagination, edit modal, deactivate/reactivate toggle, reset password button.
   - Create `src/app/(dashboard)/profile/page.tsx`: Self-service profile editing, password change form, MFA status display.

### Step 5: Navigation & Layout Updates
- Update `src/app/(dashboard)/layout.tsx`:
  - Add `Backup & Restore` (`/admin/backup`, icon `💾`)
  - Update `Users & Roles` to `User Management` (`/admin/users`, icon `👥`)
  - Add `My Profile` (`/profile`, icon `👤`)
- Clean header profile menu / link.

### Step 6: Testing & Verification Strategy
- Create dedicated comprehensive test suite `__tests__/admin-system-management.test.ts` covering:
  - Backup creation, manifest structure, integrity validation, download authorization, restore preflight, recovery-point creation, and audit logging.
  - Password change with current-password verification, invalid current password rejection, policy checks, session invalidation, and rate limiting.
  - Admin-initiated password reset, role checks, and session invalidation.
  - User listing with pagination/search, editing, role assignment, deactivation, reactivations.
  - Last-active-administrator protection against deactivation or demotion.
  - Prevention of self-promotion and unauthorized role escalation.
  - Self-service profile updates (verifying role immutability).
  - Preservation of organization TIN encryption and existing records.
- Run complete regression suite (304+ tests), TypeScript compilation, ESLint, production build, and Docker health checks.
- Generate `ADMIN-SYSTEM-MANAGEMENT-ACCEPTANCE-REPORT.md`.

---

## 4. Safety & Non-Negotiables Confirmation

- **Database Preservation:** Zero destructive migrations; zero table drops; zero data deletions.
- **Secrets Management:** Encryption keys (`ENCRYPTION_KEY`, `NEXTAUTH_SECRET`) and database passwords remain untouched and separate from backups.
- **RBAC Continuity:** All changes build strictly upon existing `UserRole` enum and `src/lib/auth/rbac.ts`.
