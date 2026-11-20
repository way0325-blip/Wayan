CREATE TABLE line_demand_sources (
 group_id TEXT PRIMARY KEY REFERENCES line_group_registry(group_id),
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 updated_by TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE extra_transport_demands (
 id BIGSERIAL PRIMARY KEY,
 source_event_id TEXT NOT NULL REFERENCES line_events(event_id),
 source_group_id TEXT NOT NULL REFERENCES line_group_registry(group_id),
 source_index INTEGER NOT NULL,
 service_date TEXT NOT NULL,
 departure_time TEXT NOT NULL,
 task_name TEXT NOT NULL,
 business_scope TEXT NOT NULL CHECK(business_scope IN ('orange','black','pending')),
 required_trucks INTEGER NOT NULL CHECK(required_trucks BETWEEN 1 AND 100),
 driver_due_at TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT '待確認',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(source_event_id,source_index)
);
CREATE TABLE extra_transport_slots (
 id BIGSERIAL PRIMARY KEY,
 demand_id BIGINT NOT NULL REFERENCES extra_transport_demands(id),
 slot_no INTEGER NOT NULL,
 fleet_id TEXT REFERENCES partner_fleets(id),
 route_code TEXT NOT NULL DEFAULT '',
 driver_id TEXT REFERENCES drivers(id),
 driver_code TEXT NOT NULL DEFAULT '',
 accepted_at TIMESTAMPTZ,
 checked_in_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(demand_id,slot_no)
);
CREATE TABLE extra_transport_history (
 id BIGSERIAL PRIMARY KEY,
 slot_id BIGINT REFERENCES extra_transport_slots(id),
 demand_id BIGINT NOT NULL REFERENCES extra_transport_demands(id),
 action TEXT NOT NULL,
 actor TEXT NOT NULL,
 detail JSONB NOT NULL,
 at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON line_demand_sources FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON extra_transport_demands FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON extra_transport_slots FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON extra_transport_history FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
