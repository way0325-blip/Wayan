CREATE TABLE company_staff_source_snapshots (
 source_id TEXT PRIMARY KEY,fleet_name TEXT NOT NULL,sheet_id BIGINT,source_values JSONB NOT NULL DEFAULT '[]',
 digest TEXT NOT NULL DEFAULT '',last_success TIMESTAMPTZ,error_code TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE company_staff_source_history (
 id BIGSERIAL PRIMARY KEY,source_id TEXT NOT NULL REFERENCES company_staff_source_snapshots(source_id),
 actor TEXT NOT NULL,before_values JSONB NOT NULL,after_values JSONB NOT NULL,at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON company_staff_source_snapshots FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
