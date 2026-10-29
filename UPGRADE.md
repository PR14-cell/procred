# Upgrade Procedures

This procedure applies versioned GHCR images in Dockge or Docker Compose without deleting persistent volumes.

## Before Upgrading

1. Verify an off-host database and MinIO backup, and preserve the existing `ENCRYPTION_KEY`.
2. Confirm the new app and migration tags exist in `ghcr.io/pr14-cell`.
3. Check migration compatibility with the current database. Changing `APP_VERSION` does not reverse database migrations.

## Deploy

Set one tag in the stack `.env`:

```dotenv
APP_VERSION=1.0.3
```

Then redeploy from this project root:

```bash
docker compose pull
docker compose up -d
```

The app and worker wait for PostgreSQL, Redis, MinIO, and successful completion of the one-shot migration service. The migration image runs `prisma migrate deploy`; it does not reset or push the schema.

## Verify

```bash
docker compose ps
docker compose logs --tail=50 migration app worker
```

Confirm `/api/health` is healthy and smoke-test login, provider/enrollment pages, document access, and background jobs. The named volumes `pgdata`, `redisdata`, `miniodata`, and `backups_data` are unchanged by image upgrades. Never run `docker compose down -v` or remove these volumes.