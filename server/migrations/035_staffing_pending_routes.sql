-- Keep source route demand even when its operational master is not available.
-- NULL means unknown; never invent a zero-stop route.
ALTER TABLE staffing_demands ALTER COLUMN stop_count DROP NOT NULL;
