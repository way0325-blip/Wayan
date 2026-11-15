CREATE TABLE IF NOT EXISTS delivery_fleet_changes (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT NOT NULL REFERENCES delivery_trips(id),
 previous_fleet_id TEXT REFERENCES partner_fleets(id),
 next_fleet_id TEXT REFERENCES partner_fleets(id),
 source_fleet_name TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL,
 actor TEXT NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS delivery_fleet_changes_trip ON delivery_fleet_changes(trip_id,id);
