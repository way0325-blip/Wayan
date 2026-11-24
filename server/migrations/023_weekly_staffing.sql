CREATE TABLE staffing_cycles (
 start_date TEXT PRIMARY KEY CHECK(start_date ~ '^\d{4}-\d{2}-\d{2}$' AND EXTRACT(ISODOW FROM start_date::date)=2),
 end_date TEXT NOT NULL CHECK(end_date=(start_date::date+6)::text),
 weekly_due_date TEXT NOT NULL CHECK(weekly_due_date=(start_date::date-1)::text),
 created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE staffing_demands (
 id BIGSERIAL PRIMARY KEY, cycle_start TEXT NOT NULL REFERENCES staffing_cycles(start_date),
 route_uid TEXT NOT NULL CHECK(route_uid ~ '^[a-f0-9]{64}$'), route_code TEXT NOT NULL,
 category TEXT NOT NULL, business_type TEXT NOT NULL, service_date TEXT NOT NULL,
 slot TEXT NOT NULL DEFAULT '原路線', departure_window TEXT NOT NULL DEFAULT '', stop_count INTEGER NOT NULL CHECK(stop_count>=0),
 fleet_name TEXT NOT NULL DEFAULT '', driver_code TEXT NOT NULL DEFAULT '', driver_name_snapshot TEXT NOT NULL DEFAULT '',
 driver_filled_at TIMESTAMPTZ, revision BIGINT NOT NULL DEFAULT 1, cancelled BOOLEAN NOT NULL DEFAULT FALSE,
 note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(cycle_start,route_uid,service_date,slot),
 CHECK(service_date>=cycle_start AND service_date<=(cycle_start::date+6)::text),
 CHECK(length(slot) BETWEEN 1 AND 40 AND length(driver_code)<=100 AND length(fleet_name)<=100)
);
CREATE INDEX staffing_cycle_date ON staffing_demands(cycle_start,service_date);
CREATE TABLE staffing_history (
 id BIGSERIAL PRIMARY KEY, demand_id BIGINT NOT NULL REFERENCES staffing_demands(id), actor TEXT NOT NULL,
 action TEXT NOT NULL, before_data JSONB, after_data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON staffing_cycles FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON staffing_demands FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON staffing_history FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
