CREATE TABLE attendance_sync_state (
 staff_type TEXT NOT NULL CHECK(staff_type IN ('driver','dispatcher')),
 staff_id TEXT NOT NULL,date TEXT NOT NULL,status TEXT,note TEXT NOT NULL DEFAULT '',
 version UUID NOT NULL DEFAULT gen_random_uuid(),updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(staff_type,staff_id,date)
);
INSERT INTO attendance_sync_state(staff_type,staff_id,date,status,note) SELECT staff_type,staff_id,date,status,note FROM attendance_records;
CREATE TABLE attendance_sheet_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),request_key TEXT NOT NULL UNIQUE,record_key TEXT NOT NULL,
 submission BIGINT NOT NULL,input_hash TEXT NOT NULL,raw_input JSONB NOT NULL,patch JSONB NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('applied','conflict','rejected')),message TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),resolved_by TEXT
);
CREATE INDEX attendance_sheet_pending ON attendance_sheet_requests(status,created_at DESC);
CREATE FUNCTION wayan_attendance_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
 INSERT INTO attendance_sync_state(staff_type,staff_id,date,status,note) VALUES(r.staff_type,r.staff_id,r.date,CASE WHEN TG_OP='DELETE' THEN NULL ELSE r.status END,CASE WHEN TG_OP='DELETE' THEN '' ELSE r.note END)
 ON CONFLICT(staff_type,staff_id,date) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,version=gen_random_uuid(),updated_at=clock_timestamp();
 INSERT INTO fleet_delivery_jobs(id,job_key,kind,payload) VALUES(gen_random_uuid(),'sheet:attendance:current','sheet','{"key":"attendance","id":"current"}')
 ON CONFLICT(job_key) DO UPDATE SET revision=fleet_delivery_jobs.revision+1,status=CASE WHEN fleet_delivery_jobs.status='processing' THEN 'processing' ELSE 'pending' END,attempts=CASE WHEN fleet_delivery_jobs.status='processing' THEN fleet_delivery_jobs.attempts ELSE 0 END,next_attempt_at=NOW(),error_code=NULL,updated_at=NOW();
 RETURN NULL;
END $$;
CREATE TRIGGER attendance_sync AFTER INSERT OR UPDATE OR DELETE ON attendance_records FOR EACH ROW EXECUTE FUNCTION wayan_attendance_sync();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON attendance_sync_state FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON attendance_sheet_requests FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change();
