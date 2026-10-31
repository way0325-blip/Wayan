CREATE TABLE penalty_rules (
  id BIGSERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL CHECK(length(rule_code) BETWEEN 1 AND 40),
  version INTEGER NOT NULL CHECK(version>0),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  terms TEXT NOT NULL CHECK(length(terms) BETWEEN 1 AND 4000),
  source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 1000),
  points NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK(points BETWEEN 0 AND 10000),
  proposed_amount NUMERIC(12,2) CHECK(proposed_amount>=0),
  effective_date TEXT,
  status TEXT NOT NULL DEFAULT '草稿' CHECK(status IN ('草稿','已核實','已停用')),
  created_by TEXT NOT NULL,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  verification_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rule_code,version)
);
CREATE TABLE penalty_rule_history (
  id BIGSERIAL PRIMARY KEY,
  rule_id BIGINT NOT NULL REFERENCES penalty_rules(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE penalty_cases (
  id BIGSERIAL PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
  rule_id BIGINT NOT NULL REFERENCES penalty_rules(id),
  occurred_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待覆核' CHECK(status IN ('待覆核','已確認','申訴中','已撤銷')),
  points NUMERIC(7,2),
  amount NUMERIC(12,2),
  responsibility TEXT NOT NULL,
  appeal TEXT NOT NULL DEFAULT '',
  reviewer TEXT,
  decision TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(points IS NULL OR points BETWEEN 0 AND 10000),
  CHECK(amount IS NULL OR amount>=0)
);
CREATE TABLE penalty_case_history (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES penalty_cases(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE shopee_fleet_reports (
  id BIGSERIAL PRIMARY KEY,
  fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
  service_date TEXT NOT NULL,
  reported_total INTEGER NOT NULL CHECK(reported_total BETWEEN 0 AND 200000),
  source TEXT NOT NULL CHECK(source IN ('LINE','調度補登','管理員更正')),
  reported_by TEXT NOT NULL,
  line_event_id TEXT UNIQUE REFERENCES line_events(event_id),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX shopee_report_fleet_day ON shopee_fleet_reports(fleet_id,service_date,id DESC);
CREATE TABLE line_group_registry (
  group_id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  bot_present BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  last_event_type TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO line_group_registry(group_id,created_by) SELECT group_id,'既有綁定' FROM line_fleet_groups;
ALTER TABLE fleet_sheet_rows DROP CONSTRAINT fleet_sheet_rows_sheet_key_check;
ALTER TABLE fleet_sheet_rows ADD CONSTRAINT fleet_sheet_rows_sheet_key_check CHECK(sheet_key IN ('fleets','tasks','incidents','history','rules','penalties','penaltyHistory'));
CREATE FUNCTION penalty_sync_job() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE k TEXT; BEGIN
  k:=CASE TG_TABLE_NAME WHEN 'penalty_rules' THEN 'rules' WHEN 'penalty_cases' THEN 'penalties' ELSE 'penaltyHistory' END;
  INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload) VALUES(gen_random_uuid(),'sheet:'||k||':'||NEW.id,'sheet',jsonb_build_object('key',k,'id',NEW.id::text))
    ON CONFLICT(job_key) DO UPDATE SET revision=fleet_delivery_jobs.revision+1,status=CASE WHEN fleet_delivery_jobs.status='processing' THEN 'processing' ELSE 'pending' END,
    attempts=CASE WHEN fleet_delivery_jobs.status='processing' THEN fleet_delivery_jobs.attempts ELSE 0 END,next_attempt_at=NOW(),error_code=NULL,updated_at=NOW();
  RETURN NEW;
END $$;
CREATE TRIGGER penalty_rule_sync AFTER INSERT OR UPDATE ON penalty_rules FOR EACH ROW EXECUTE FUNCTION penalty_sync_job();
CREATE TRIGGER penalty_case_sync AFTER INSERT OR UPDATE ON penalty_cases FOR EACH ROW EXECUTE FUNCTION penalty_sync_job();
CREATE TRIGGER penalty_history_sync AFTER INSERT ON penalty_case_history FOR EACH ROW EXECUTE FUNCTION penalty_sync_job();
DO $$ DECLARE n TEXT; BEGIN
  FOREACH n IN ARRAY ARRAY['penalty_rules','penalty_cases','shopee_fleet_reports','line_group_registry'] LOOP
    EXECUTE format('CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change()',n);
  END LOOP;
END $$;
