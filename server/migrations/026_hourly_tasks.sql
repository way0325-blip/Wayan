CREATE TABLE hourly_task_snapshots (
 id TEXT PRIMARY KEY,cycle_start TEXT NOT NULL,fleet_name TEXT NOT NULL,source_id TEXT NOT NULL,
 source_tab TEXT NOT NULL DEFAULT '',source_sheet_id BIGINT,records JSONB NOT NULL DEFAULT '[]',digest TEXT NOT NULL DEFAULT '',
 last_success TIMESTAMPTZ,error_code TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(cycle_start,fleet_name)
);
CREATE TABLE hourly_task_history (
 id BIGSERIAL PRIMARY KEY,snapshot_id TEXT NOT NULL REFERENCES hourly_task_snapshots(id),
 actor TEXT NOT NULL,before_records JSONB NOT NULL,after_records JSONB NOT NULL,at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON hourly_task_snapshots FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
