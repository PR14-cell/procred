#!/usr/bin/env bash
# scripts/restore.sh - Database and document restore script
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <path-to-postgres-backup.sql.gz> [path-to-minio-backup]"
    exit 1
fi

PG_BACKUP="$1"
MINIO_BACKUP="${2:-}"

if [ ! -f "${PG_BACKUP}" ]; then
    echo "Error: PostgreSQL backup file '${PG_BACKUP}' not found."
    exit 1
fi

echo "[$(date)] Starting restore from ${PG_BACKUP}..."

# 1. Restore PostgreSQL database
echo "[$(date)] Restoring PostgreSQL database..."
gunzip -c "${PG_BACKUP}" | docker compose exec -T postgres psql -U credentialing_admin -d credentialing

# 2. Restore MinIO documents if provided
if [ -n "${MINIO_BACKUP}" ] && [ -d "${MINIO_BACKUP}" ]; then
    echo "[$(date)] Restoring documents from ${MINIO_BACKUP}..."
    docker compose cp "${MINIO_BACKUP}/." minio:/data/
fi

echo "[$(date)] Restore completed successfully."
