CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % operations are not permitted', TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON "audit_logs";
CREATE TRIGGER audit_no_update
    BEFORE UPDATE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

DROP TRIGGER IF EXISTS audit_no_delete ON "audit_logs";
CREATE TRIGGER audit_no_delete
    BEFORE DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM credentialing_app;
GRANT INSERT, SELECT ON TABLE "audit_logs" TO credentialing_app;