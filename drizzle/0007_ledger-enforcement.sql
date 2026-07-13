-- Ledger enforcement. FORWARD-ONLY: this migration is never rolled back, and
-- no future migration, script, or fixture may mutate existing attempts rows.
-- Append-only is enforced three ways: (1) the app role has INSERT and SELECT
-- only on attempts, (2) this trigger rejects UPDATE and DELETE for every role
-- including the owner, (3) the ledger-integrity test suite asserts both.

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'attempts is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS attempts_append_only ON "attempts";
--> statement-breakpoint

CREATE TRIGGER attempts_append_only
  BEFORE UPDATE OR DELETE ON "attempts"
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
--> statement-breakpoint

-- Restricted runtime role. The password here only ever applies to local/CI
-- databases; hosted environments manage the role's credentials in the
-- platform vault and this CREATE is a no-op because the role already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'attest_app') THEN
    CREATE ROLE attest_app LOGIN PASSWORD 'attest_app';
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO attest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO attest_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO attest_app;
--> statement-breakpoint

-- The ledger: INSERT and SELECT only. Never relaxed, including in staging.
REVOKE ALL ON "attempts" FROM attest_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "attempts" TO attest_app;
--> statement-breakpoint

-- Future tables created by the migration owner get standard grants; the
-- attempts-specific REVOKE above is unaffected.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO attest_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO attest_app;
--> statement-breakpoint

-- pg-boss keeps its own schema; it exists only after the worker first ran.
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.schemata WHERE schema_name = 'pgboss') THEN
    GRANT USAGE ON SCHEMA pgboss TO attest_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO attest_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO attest_app;
  END IF;
END $$;
