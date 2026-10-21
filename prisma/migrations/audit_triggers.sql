-- prisma/migrations/audit_triggers.sql
-- C1: Audit log immutability triggers and privileges

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % operations are not permitted', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON audit_logs;
CREATE TRIGGER audit_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

DROP TRIGGER IF EXISTS audit_no_delete ON audit_logs;
CREATE TRIGGER audit_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- Ensure credentialing_app role exists and set privileges
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'credentialing_app') THEN
        CREATE ROLE credentialing_app WITH LOGIN PASSWORD 'app_secret_pass';
    END IF;
END
$$;

GRANT CONNECT ON DATABASE credentialing TO credentialing_app;
GRANT USAGE ON SCHEMA public TO credentialing_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO credentialing_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO credentialing_app;

-- C1 requirement: revoke UPDATE, DELETE, TRUNCATE on audit_logs from credentialing_app
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM credentialing_app;
GRANT INSERT, SELECT ON audit_logs TO credentialing_app;
