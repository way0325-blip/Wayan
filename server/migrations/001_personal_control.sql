-- Additive only: existing operational rows and columns are preserved.
CREATE TABLE line_driver_bindings (
  line_user_id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL UNIQUE REFERENCES drivers(id),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE line_binding_codes (
  code_hash TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL UNIQUE REFERENCES drivers(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE line_events (
  event_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  reply_text TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','failed','skipped')),
  error_code TEXT
);
CREATE INDEX line_events_status_idx ON line_events(status, received_at);
CREATE TABLE operational_incidents (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE REFERENCES line_events(event_id),
  order_id TEXT REFERENCES orders(id),
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  kind TEXT NOT NULL CHECK (kind IN ('車輛異常','事故')),
  detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT '待處理' CHECK (status IN ('待處理','已處理')),
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE TABLE order_reports (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES line_events(event_id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  kind TEXT NOT NULL CHECK (kind IN ('到站','完成')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION wayan_notify_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('wayan_changes', TG_TABLE_NAME);
  RETURN NULL;
END;
$$;
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['orders','drivers','vehicles','shopee_routes','shopee_assignments',
    'partner_fleets','attendance_records','operational_incidents','line_driver_bindings','line_events'] LOOP
    EXECUTE format('CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change()', table_name);
  END LOOP;
END;
$$;
