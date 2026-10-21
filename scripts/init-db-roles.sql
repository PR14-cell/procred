-- init-db-roles.sql
-- Executed on container initialization (Docker entrypoint)

-- 1. Create the credentialing_app application runtime role if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'credentialing_app') THEN
        CREATE ROLE credentialing_app WITH LOGIN PASSWORD 'app_secret_pass';
    END IF;
END
$$;

-- 2. Grant connection rights to credentialing database
GRANT CONNECT ON DATABASE credentialing TO credentialing_app;

-- 3. Grant schema usage
GRANT USAGE ON SCHEMA public TO credentialing_app;

-- 4. Set default privileges for tables created in the future by credentialing_admin
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO credentialing_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO credentialing_app;

-- 5. Existing tables (if any)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO credentialing_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO credentialing_app;

-- 6. C1 Requirement: Revoke mutation privileges on audit_logs table from credentialing_app
-- Note: When audit_logs table is created by migrations, it will have UPDATE, DELETE, TRUNCATE revoked.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM credentialing_app;
        GRANT INSERT, SELECT ON audit_logs TO credentialing_app;
    END IF;
END
$$;
