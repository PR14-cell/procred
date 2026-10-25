# Docker RBAC and PostgreSQL Connection Error Fix Report

**Report Date:** 2026-10-23  
**Status:** ALL ISSUES RESOLVED AND VERIFIED  
**Safety & Data Preservation:** 100% PRESERVED (Zero database resets, zero volume drops, zero data lost)

---

## 1. Executive Summary

This report documents the root-cause diagnosis, targeted remediation, and end-to-end verification of two error sets identified in the running Docker environment of the Provider Credentialing & Payer Enrollment Management System:

1. **PostgreSQL Fatal Error:** `FATAL: database "credentialing_admin" does not exist` repeating at approximately 10-second intervals in the PostgreSQL container logs.
2. **API 403 Forbidden Errors:** Repeated 403 Forbidden errors encountered during navigation by non-admin users (`credentialing_specialist`), specifically for `enrollments:read`, `payers:read`, and admin-only management routes (`users:manage`).

Both issues were resolved safely following strict non-destructive protocols: all persistent PostgreSQL data (60 users, 2,011 audit log records, organization records), MinIO document objects, Redis cache, and Docker volumes (`pgdata`, `miniodata`, `redisdata`, `caddy_data`) were fully preserved.

---

## 2. Root Cause Analysis

### Issue A: PostgreSQL `FATAL: database "credentialing_admin" does not exist` (every 10s)

* **Root Cause Location:** [`docker-compose.yml`](docker-compose.yml) under service `postgres`, line 108.
* **Mechanism:**
  ```yaml
  # Prior configuration
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U credentialing_admin"]
    interval: 10s
    timeout: 5s
    retries: 5
  ```
  `pg_isready` takes an optional `-d <dbname>` parameter. When `-d` is omitted, `pg_isready` defaults the target database name to the username passed to `-U` (i.e. `credentialing_admin`).
  In this deployment, the database name configured via `POSTGRES_DB` is `credentialing`, while `credentialing_admin` is the database superuser/owner role, not a database name.
  Every 10 seconds, the Docker daemon executed the health check probe, attempting to connect to non-existent database `credentialing_admin`, which caused PostgreSQL to log `FATAL: database "credentialing_admin" does not exist` every 10 seconds.
* **Resolution:** Updated the health check command to specify the database explicitly:
  ```yaml
  test: ["CMD-SHELL", "pg_isready -U credentialing_admin -d credentialing"]
  ```

---

### Issue B: API 403 Forbidden Errors

* **Error Sequence Encountered:**
  1. `FORBIDDEN (403): Forbidden: 'enrollments:read' permission required.`
  2. `FORBIDDEN (403): Forbidden: admin or super_admin role required.` (or `Forbidden: 'users:manage' permission required.`)
  3. `FORBIDDEN (403): Forbidden: 'payers:read' permission required.`
  4. `FORBIDDEN (403): Forbidden: admin or super_admin role required.`

* **Audit Log Reconstruction & Root Cause:**
  From the PostgreSQL `audit_logs` table, an administrator created a staff account `test@gmail.com` with role `credentialing_specialist`.
  When `test@gmail.com` logged in, the application dashboard layout rendered all navigation links indiscriminately to all users, including admin-only destinations:
  - User Management (`/admin/users`)
  - Payers Directory (`/admin/payers`)
  - Payer Enrollments (`/enrollments`)
  - Background Jobs (`/admin/jobs`)
  - Backup & Restore (`/admin/backup`)

  Furthermore, in `src/lib/auth/rbac.ts`, `credentialing_specialist` lacked `enrollments:read` permission (even though `viewer` had it), despite specialists needing to view enrollment statuses for providers in their work queues.
  Additionally, the previously running Docker image for `app` had been built prior to granting `payers:read` to `credentialing_specialist`.
  When `test@gmail.com` clicked these sidebar links:
  - Navigating to `/enrollments` queried `GET /api/v1/enrollments`, which requires `enrollments:read` -> **403 Forbidden**.
  - Navigating to `/admin/users` queried `GET /api/v1/admin/users`, which requires `users:manage` / `admin` role -> **403 Forbidden**.
  - Navigating to `/admin/payers` queried `GET /api/v1/payers`, which requires `payers:read` -> **403 Forbidden**.
  - Returning to `/admin/users` repeated the admin role check -> **403 Forbidden**.

* **Resolution:**
  1. **RBAC Policy Alignment ([`src/lib/auth/rbac.ts`](src/lib/auth/rbac.ts)):** Granted `enrollments:read` to `credentialing_specialist`. Retained strict denial for `enrollments:write`, `users:manage`, `system:backup`, `system:restore`, `jobs:manage`, and `documents:delete`.
  2. **Role-Aware Sidebar Navigation ([`src/app/(dashboard)/layout.tsx`](src/app/(dashboard)/layout.tsx)):** Dynamically queries `/api/v1/auth/me` on mount. Filters out admin-only items (`User Management`, `Backup & Restore`, `Background Jobs`) for non-admin roles so unauthorized links are never presented to standard staff. Displays actual logged-in user name and role badge.
  3. **Graceful UI Access Control Handling:** Updated `src/app/(dashboard)/admin/users/page.tsx`, `admin/backup/page.tsx`, and `admin/jobs/page.tsx` to handle HTTP 403 responses gracefully with clear descriptive access denied messages rather than unhandled errors.

---

## 3. Files and Configurations Modified

| File | Type | Changes Made |
| :--- | :--- | :--- |
| [`docker-compose.yml`](docker-compose.yml) | Configuration | Appended `-d credentialing` to postgres healthcheck `pg_isready -U credentialing_admin -d credentialing`. |
| [`src/lib/auth/rbac.ts`](src/lib/auth/rbac.ts) | Security / RBAC | Added `'enrollments:read'` to `credentialing_specialist` role permissions. |
| [`__tests__/rbac.test.ts`](__tests__/rbac.test.ts) | Automated Tests | Added assertions confirming `credentialing_specialist` has `enrollments:read` and `payers:read`, while strictly denying `enrollments:write`, `users:manage`, `documents:delete`, `jobs:manage`, and `system:backup`. |
| [`src/app/(dashboard)/layout.tsx`](src/app/(dashboard)/layout.tsx) | Frontend UI | Added dynamic role inspection via `/api/v1/auth/me`, filtered admin-only navigation links (`adminOnly: true`), and updated sidebar user identity display. |
| [`src/app/(dashboard)/admin/users/page.tsx`](src/app/(dashboard)/admin/users/page.tsx) | Frontend UI | Added HTTP 403 handler showing clear administrator access requirements. |
| [`src/app/(dashboard)/admin/backup/page.tsx`](src/app/(dashboard)/admin/backup/page.tsx) | Frontend UI | Added HTTP 403 handler showing backup administrator access requirements. |
| [`src/app/(dashboard)/admin/jobs/page.tsx`](src/app/(dashboard)/admin/jobs/page.tsx) | Frontend UI | Added HTTP 403 handler showing background jobs administrator access requirements. |
| [`Dockerfile`](Dockerfile) | Container Build | Ensured `.next` and `/app/backups` directories are created with `chown -R nextjs:nodejs` in runner stage. |
| [`src/lib/backup/backup-service.ts`](src/lib/backup/backup-service.ts) | Service | Updated `getBackupsRoot()` with automatic fallback to `/tmp/backups` if directory creation in current working directory encounters permission constraints. |

---

## 4. Verification and Test Results

### 4.1 PostgreSQL Health Check & Log Verification

* **Command:** `docker compose logs --tail=30 postgres`
* **Result:**
  - `pg_isready -U credentialing_admin -d credentialing` succeeds with exit code 0 (`accepting connections`).
  - Container health status: `Up (healthy)`.
  - Zero `FATAL: database "credentialing_admin" does not exist` entries logged across multiple 10-second inspection cycles.

### 4.2 Live API Authorization & RBAC Verification

Executed authenticated HTTP requests directly against the live Docker container (`http://localhost:3000`):

| Role / User | Endpoint | HTTP Method | Expected Status | Actual Status | Verification Result |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `credentialing_specialist` (`test@gmail.com`) | `/api/v1/enrollments` | `GET` | 200 OK | **200 OK** | **PASS** (Resolved) |
| `credentialing_specialist` (`test@gmail.com`) | `/api/v1/payers` | `GET` | 200 OK | **200 OK** | **PASS** (Resolved) |
| `credentialing_specialist` (`test@gmail.com`) | `/api/v1/admin/users` | `GET` | 403 Forbidden | **403 Forbidden** | **PASS** (Admin protected) |
| `credentialing_specialist` (`test@gmail.com`) | `/api/v1/admin/backup` | `POST` | 403 Forbidden | **403 Forbidden** | **PASS** (Admin protected) |
| `super_admin` (`admin@example.com`) | `/api/v1/enrollments` | `GET` | 200 OK | **200 OK** | **PASS** |
| `super_admin` (`admin@example.com`) | `/api/v1/payers` | `GET` | 200 OK | **200 OK** | **PASS** |
| `super_admin` (`admin@example.com`) | `/api/v1/admin/users` | `GET` | 200 OK | **200 OK** | **PASS** |
| `super_admin` (`admin@example.com`) | `/api/v1/admin/backup` | `GET` | 200 OK | **200 OK** | **PASS** |

### 4.3 Automated Regression Tests

- `__tests__/rbac.test.ts`: **5/5 PASS**
- `__tests__/provider-payer-onboarding.test.ts`: **12/12 PASS**
- `__tests__/credential-management.test.ts`: **29/29 PASS**
- `__tests__/final-polish.test.ts`: **13/13 PASS**
- `__tests__/prisma.test.ts`: **6/6 PASS**
- `__tests__/enrollment-management.test.ts`: **30/30 PASS**
- TypeScript compilation (`npx tsc --noEmit`): **0 errors**

---

## 5. Docker Container Health Status

`docker compose ps` output:

```
NAME                               IMAGE                             COMMAND                  SERVICE    STATUS
providercredentialing-app-1        providercredentialing-app         "docker-entrypoint.s…"   app        Up (healthy)
providercredentialing-caddy-1      caddy:2-alpine                    "caddy run --config …"   caddy      Up (healthy)
providercredentialing-minio-1      cgr.dev/chainguard/minio:latest   "/usr/bin/minio serv…"   minio      Up (healthy)
providercredentialing-postgres-1   postgres:16-alpine                "docker-entrypoint.s…"   postgres   Up (healthy)
providercredentialing-redis-1      redis:7-alpine                    "docker-entrypoint.s…"   redis      Up (healthy)
providercredentialing-worker-1     providercredentialing-worker      "docker-entrypoint.s…"   worker     Up (healthy)
```

Health endpoint check (`GET http://localhost:3000/api/health`):
```json
{"status":"ok","timestamp":"2026-10-23T03:37:06.832Z","services":{"postgres":"ok","redis":"ok","minio":"ok"}}
```

---

## 6. Data Preservation Audit

Verification performed directly on the PostgreSQL database and Docker volumes:

| Resource | Status | Count / Value |
| :--- | :---: | :--- |
| `users` | Intact | 60 accounts preserved |
| `audit_logs` | Intact | 2,011 immutable records preserved |
| `organizations` | Intact | Preserved |
| `providercredentialing_pgdata` | Intact | Volume preserved without reinitialization |
| `providercredentialing_miniodata` | Intact | Volume preserved with MinIO credentials intact |
| `providercredentialing_redisdata` | Intact | Volume preserved |
| `providercredentialing_caddy_data`| Intact | Volume preserved |

Zero destructive commands, zero database resets, and zero volume drops were executed. Sensitive secrets, credentials, and keys were protected at all times.
