CREATE TABLE daily_task_allocations (
 service_date DATE NOT NULL, source_key TEXT NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'),
 source_id TEXT NOT NULL, route_code TEXT NOT NULL, fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
 source_snapshot JSONB NOT NULL, assigned_by TEXT NOT NULL, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(service_date,source_key)
);
CREATE INDEX daily_task_allocations_fleet_date ON daily_task_allocations(fleet_id,service_date);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON daily_task_allocations FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TABLE daily_task_allocation_history (
 id BIGSERIAL PRIMARY KEY,service_date DATE NOT NULL,source_key TEXT NOT NULL,actor TEXT NOT NULL,
 before_data JSONB,after_data JSONB NOT NULL,at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
