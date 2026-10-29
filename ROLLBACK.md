# Rollback Procedures & Contingency Guide
**Provider Credentialing & Payer Enrollment Management System**

# Rollback Procedures

> Rolling back an image tag does not reverse database schema migrations. Only use image-only rollback when the prior release is compatible with the current schema.

## Image-Only Rollback

Set `APP_VERSION` in `.env` to the last compatible release, then recreate the app, worker, and migration containers:

```dotenv
APP_VERSION=1.0.2
```

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Verify `/api/health` and inspect `docker compose logs --tail=50 migration app worker`. The migration runner uses the selected version's migration image and may apply migrations; review compatibility before redeploying.

## Database Restore

For breaking or failed migrations, stop here and follow the approved restore procedure in `BACKUP-RESTORE.md`. Restoring a database can discard writes made after the backup, so use a verified pre-upgrade backup and an approved maintenance window. Do not remove Docker volumes as part of an image rollback.

