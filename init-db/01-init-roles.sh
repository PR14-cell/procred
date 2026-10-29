#!/bin/sh
# ==============================================================================
# Dual-Role PostgreSQL Initialization Script
# Executed automatically by PostgreSQL container on initial database creation
# ==============================================================================
set -e

: "${DB_APP_PASSWORD:?DB_APP_PASSWORD must be configured before initializing PostgreSQL}"
case "$DB_APP_PASSWORD" in
    *[!a-fA-F0-9]*) echo "DB_APP_PASSWORD must be 64 hexadecimal characters" >&2; exit 1 ;;
esac
if [ "${#DB_APP_PASSWORD}" -ne 64 ]; then
    echo "DB_APP_PASSWORD must be 64 hexadecimal characters" >&2
    exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- 1. Create or update application runtime role with limited privileges
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'credentialing_app') THEN
            CREATE ROLE credentialing_app WITH LOGIN PASSWORD '$DB_APP_PASSWORD';
        ELSE
            ALTER ROLE credentialing_app WITH PASSWORD '$DB_APP_PASSWORD';
        END IF;
    END
    \$\$;

    -- 2. Grant connection and schema usage
    GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO credentialing_app;
    GRANT USAGE ON SCHEMA public TO credentialing_app;

    -- 3. Set default privileges for tables created in future migrations by credentialing_admin
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO credentialing_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO credentialing_app;

    -- 4. Grant privileges on all existing tables
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO credentialing_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO credentialing_app;

    -- 5. Immutability Protection: Deny UPDATE, DELETE, TRUNCATE on audit_logs from app role
    DO \$\$
    BEGIN
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
            REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM credentialing_app;
            GRANT INSERT, SELECT ON audit_logs TO credentialing_app;
        END IF;
    END
    \$\$;
EOSQL
