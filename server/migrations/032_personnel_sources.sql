CREATE TABLE personnel_source_snapshots (
 kind TEXT PRIMARY KEY,
 records JSONB NOT NULL DEFAULT '[]',
 issues JSONB NOT NULL DEFAULT '[]',
 source_version TEXT NOT NULL DEFAULT '',
 last_success TIMESTAMPTZ,
 error_code TEXT NOT NULL DEFAULT '',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON personnel_source_snapshots FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
