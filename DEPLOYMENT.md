# Production Deployment & Operational Guide

This document provides operational instructions for deploying and managing the **Provider Credentialing & Payer Enrollment Management System** in a containerized production environment.

---

## 1. Environment Configuration

Create a production `.env` file based on `.env.example`. Ensure strong, cryptographically generated secrets are configured:

```ini
# Database Passwords (Dual-Role Architecture)
DB_ADMIN_PASSWORD=strong_random_admin_password_here
DB_APP_PASSWORD=strong_random_app_password_here
POSTGRES_DB=credentialing

# Redis Cache & Queues (Correction C2)
REDIS_PASSWORD=strong_random_redis_password_here

# MinIO S3 Document Storage
MINIO_USER=minio_admin_user
MINIO_PASSWORD=strong_random_minio_password_here

# Encryption Key (32-byte / 64-hex-character AES-256-GCM key)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# JWT & Authentication
NEXTAUTH_SECRET=min_32_chars_random_secret_for_session_tokens
NEXTAUTH_URL=https://credentialing.yourdomain.com

# SMTP Email Configuration
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@yourdomain.com
SMTP_PASS=your_smtp_password
SMTP_FROM=notifications@yourdomain.com
```

---

## 2. Docker Compose Production Deployment

The system is deployed using `docker-compose.yml` with 6 services:

```
[ Internet ]
      │
      ▼
┌──────────────┐
│ Caddy Proxy  │ (Ports 80/443, Automatic HTTPS, TLS termination)
└──────┬───────┘
       │ internal network (frontend)
       ▼
┌──────────────┐      ┌─────────────────────────┐
│ Next.js App  ├─────►│ BullMQ Worker Container │
└──────┬───────┘      └────────────┬────────────┘
       │ internal network (backend)│
       ├───────────────────────────┼───────────────────────────┐
       ▼                           ▼                           ▼
┌──────────────┐            ┌──────────────┐            ┌──────────────┐
│ PostgreSQL 16│            │   Redis 7    │            │ MinIO Storage│
│ (Named Vol)  │            │ (Named Vol)  │            │ (Named Vol)  │
└──────────────┘            └──────────────┘            └──────────────┘
```

### Deployment Commands
```bash
# 1. Build and launch all production containers
docker compose up -d --build

# 2. Verify all containers reach (healthy) status
docker compose ps

# 3. Check health status of all backing services
curl -f http://127.0.0.1:3000/api/health
```

Expected healthcheck response:
```json
{
  "status": "ok",
  "services": {
    "postgres": "ok",
    "redis": "ok",
    "minio": "ok"
  }
}
```

---

## 3. Persistent Volumes

All persistent application data resides in named Docker volumes:
- `pgdata`: PostgreSQL database files and immutable audit logs.
- `redisdata`: Redis BullMQ queue state, metrics, and cache.
- `miniodata`: Document storage files and encrypted credentials.
- `caddy_data`: SSL/TLS certificates and ACME account keys.

> [!CAUTION]
> Never execute `docker compose down -v` or `docker volume prune` in production, as this removes persistent data volumes.

---

## 4. Operational Monitoring & Healthchecks

| Service | Health Check Mechanism | Interval | Retries |
|---|---|---|---|
| `app` | HTTP GET `/api/health` | 15s | 3 |
| `worker` | File mtime on `/tmp/worker-heartbeat` (< 30s) | 15s | 3 |
| `postgres` | `pg_isready -U credentialing_admin` | 10s | 5 |
| `redis` | `redis-cli -a $REDIS_PASSWORD ping` | 10s | 5 |
| `minio` | `minio --version` CLI check | 10s | 3 |
| `caddy` | `caddy version` CLI check | 30s | 3 |
