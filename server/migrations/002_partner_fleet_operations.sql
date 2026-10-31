CREATE TABLE line_fleet_groups (
  group_id TEXT PRIMARY KEY,
  fleet_id TEXT NOT NULL UNIQUE REFERENCES partner_fleets(id),
  bound_by TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE fleet_group_codes (
  code_hash TEXT PRIMARY KEY,
  fleet_id TEXT NOT NULL UNIQUE REFERENCES partner_fleets(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE fleet_work_orders (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  service_date TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  requested_trucks INTEGER NOT NULL CHECK(requested_trucks BETWEEN 1 AND 200),
  confirmed_trucks INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_trucks>=0 AND confirmed_trucks<=requested_trucks),
  status TEXT NOT NULL DEFAULT '待回覆' CHECK(status IN ('待回覆','已確認','已拒絕','執行中','已完成','已取消')),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX fleet_work_day_idx ON fleet_work_orders(fleet_id,service_date);
CREATE TABLE fleet_incidents (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES fleet_work_orders(id),
  fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
  line_event_id TEXT UNIQUE REFERENCES line_events(event_id),
  kind TEXT NOT NULL CHECK(kind IN ('延誤','車輛異常','貨損','事故','其他')),
  severity TEXT NOT NULL DEFAULT '一般' CHECK(severity IN ('一般','緊急')),
  status TEXT NOT NULL DEFAULT '待處理' CHECK(status IN ('待處理','處理中','待確認','已結案')),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 1000),
  reported_by TEXT NOT NULL,
  handler TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX fleet_incident_status_idx ON fleet_incidents(status,created_at);
CREATE TABLE fleet_incident_history (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES fleet_incidents(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE fleet_sheet_rows (
  sheet_key TEXT NOT NULL CHECK(sheet_key IN ('fleets','tasks','incidents','history')),
  entity_id TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK(row_number>=2),
  PRIMARY KEY(sheet_key,entity_id),
  UNIQUE(sheet_key,row_number)
);
CREATE TABLE fleet_delivery_jobs (
  id UUID PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('line','sheet')),
  payload JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  claimed_revision INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','blocked','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  first_send_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX fleet_jobs_pending_idx ON fleet_delivery_jobs(status,next_attempt_at);
CREATE FUNCTION fleet_profile_sync_job() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload)
    VALUES(gen_random_uuid(),'sheet:fleets:'||NEW.id,'sheet',jsonb_build_object('key','fleets','id',NEW.id))
    ON CONFLICT(job_key) DO UPDATE SET revision=fleet_delivery_jobs.revision+1,
      status=CASE WHEN fleet_delivery_jobs.status='processing' THEN 'processing' ELSE 'pending' END,
      attempts=CASE WHEN fleet_delivery_jobs.status='processing' THEN fleet_delivery_jobs.attempts ELSE 0 END,
      next_attempt_at=NOW(),error_code=NULL,updated_at=NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_profile_sync AFTER INSERT OR UPDATE ON partner_fleets FOR EACH ROW EXECUTE FUNCTION fleet_profile_sync_job();
DO $$ DECLARE n TEXT; BEGIN
  FOREACH n IN ARRAY ARRAY['line_fleet_groups','fleet_work_orders','fleet_incidents','fleet_delivery_jobs'] LOOP
    EXECUTE format('CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change()',n);
  END LOOP;
END $$;
