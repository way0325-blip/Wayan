CREATE TABLE staffing_source_links (
 demand_id BIGINT PRIMARY KEY REFERENCES staffing_demands(id), source_key TEXT NOT NULL UNIQUE,
 last_revision BIGINT NOT NULL, source_driver TEXT NOT NULL, source_fleet TEXT NOT NULL,
 source_position JSONB NOT NULL, synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE staffing_sync_state (
 cycle_start TEXT PRIMARY KEY, report JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
