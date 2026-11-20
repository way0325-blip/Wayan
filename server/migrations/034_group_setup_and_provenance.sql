CREATE TABLE line_shared_group_codes (
 business_scope TEXT PRIMARY KEY CHECK(business_scope IN ('orange','black','all')),
 code_hash TEXT NOT NULL UNIQUE,
 fleet_ids JSONB NOT NULL,
 group_label TEXT NOT NULL,
 created_by TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE extra_transport_demands ADD COLUMN source_fleet_id TEXT REFERENCES partner_fleets(id);
ALTER TABLE penalty_message_drafts ADD COLUMN source_fleet_id TEXT REFERENCES partner_fleets(id);
