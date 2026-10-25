# Provider Credentialing & Payer Enrollment Management System

An enterprise-grade, web-based healthcare provider credentialing and payer enrollment tracking system built with **Next.js 14 (App Router)**, **TypeScript**, **PostgreSQL 16**, **Prisma ORM**, **MinIO (S3-compatible object storage)**, **Redis 7 & BullMQ**, and **Caddy (Automatic HTTPS)**.

---

## 1. System Overview & Capabilities

The system automates and streamlines complex healthcare administration workflows:

- **Provider Lifecycle Management**: Comprehensive demographics, 10-digit NPI validation, AES-256-GCM encrypted SSN storage, multi-specialty taxonomy code assignments, and physical practice location tracking.
- **Multi-Credential Tracking**: Active monitoring of State Medical Licenses, DEA Registrations, Board Certifications, and Malpractice Insurance with configurable expiration alert windows (90, 60, 30, and 14 days) and 120-day CAQH re-attestation cycles.
- **Payer Enrollment Operations**: Tracking of individual and group enrollments, structured follow-up logs, status history state transitions, and revalidation dates.
- **Document Management & Storage**: S3-compatible document vault (MinIO) with pre-signed upload/download URLs, SHA-256 integrity verification, immutable audit logging, and automated orphan cleanup.
- **Operational Workflow Engine**: Assignable staff tasks with priority queuing, due date tracking, overdue alerts, and polymorphic entity notes.
- **Analytics & Executive Dashboards**: Real-time KPI summaries, credential expiration timelines, enrollment conversion rates, workload distribution charts, and CSV data export.
- **Background Automation & Notifications**: 5 dedicated BullMQ queues powered by Redis, automated expiration scanners, daily morning digests, in-app notification center with live unread badge, and user email preference controls.
- **Bulk Operations (Phase 9)**: High-speed CSV provider onboarding with validation preview and batch enrollment matrix creation across providers and payers.
- **Security & Compliance Hardening**: Strict dual-role PostgreSQL architecture (`credentialing_admin` vs `credentialing_app`), database triggers blocking audit log tampering, Content Security Policy (CSP) headers, and strict synthetic/fictional test data safeguards.

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 14.2 (App Router) | Server components, dynamic API routes, optimized static pages |
| **Language** | TypeScript 5.4 | Strict type-safety across schemas, models, and API boundaries |
| **Database** | PostgreSQL 16 (Alpine) | Relational persistence, JSONB, foreign keys, triggers |
| **ORM** | Prisma 5.22 | Type-safe query generation and migration management |
| **Object Storage** | MinIO (S3 API) | Encrypted, self-hosted document storage with presigned URLs |
| **Queue / Cache** | Redis 7 + BullMQ | Distributed task queues, delayed jobs, and high-speed cache |
| **Reverse Proxy** | Caddy 2 (Alpine) | Reverse proxy with automated TLS termination and security headers |
| **Testing** | Vitest 1.6 | Comprehensive unit, integration, and security regression test suites |

---

## 3. Architecture & Security Foundation

### Dual-Role PostgreSQL Architecture (Correction C1)
1. `credentialing_admin`: Administrative role with full DDL/DML permissions used exclusively for database migrations and initial schema setup.
2. `credentialing_app`: Application runtime role with strictly limited privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
3. **Immutable Audit Logs**: The `audit_logs` table has a `BEFORE UPDATE OR DELETE` PostgreSQL trigger that raises an uncatchable exception, and `TRUNCATE`, `UPDATE`, `DELETE` are revoked from the application role.

### Cryptographic Security & Privacy
- **SSN & Sensitive Demographics**: Encrypted at rest using AES-256-GCM via `src/lib/encryption/aes.ts`.
- **Session Tokens**: Cryptographically signed JWTs using `jose` with HS-256, HTTP-only secure cookie enforcement, and role-based access control (RBAC).
- **HTTP Security Headers**: Strict Content-Security-Policy (CSP), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security`.

---

## 4. Getting Started & Development

### Prerequisites
- Node.js 20+ and npm
- Docker and Docker Compose
- Git

### Local Setup
1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd "provider credentialing"
   ```

2. Copy environment file:
   ```bash
   cp .env.example .env
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start Docker backing services (PostgreSQL, Redis, MinIO):
   ```bash
   docker compose up -d postgres redis minio
   ```

5. Run database migrations and seed baseline taxonomies:
   ```bash
   npx prisma db push
   npm run db:seed
   ```

6. Start local development server:
   ```bash
   npm run dev
   ```
   Access the web application at `http://localhost:3000`.

---

## 5. Verification & Testing

### Test Suite Execution
```bash
# Run all unit and integration tests (200+ tests)
npx vitest run --fileParallelism=false

# Run TypeScript type check
npx tsc --noEmit

# Run Next.js linter
npm run lint

# Build production bundle
npm run build
```

---

## 6. Disaster Recovery & Backups

Cross-platform backup and restoration scripts are located in `scripts/`:
- **Linux/macOS**: `scripts/backup.sh` and `scripts/restore.sh`
- **Windows / PowerShell**: `scripts/backup.ps1` and `scripts/restore.ps1`

### Creating a Backup
```powershell
.\scripts\backup.ps1 -BackupDir "./backups"
```

### Restoring from Backup
```powershell
.\scripts\restore.ps1 -PgBackupPath "./backups/postgres_YYYYMMDD_HHMMSS.sql"
```
