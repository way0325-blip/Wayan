CREATE TABLE delivery_trip_sequence_history (
 id BIGSERIAL PRIMARY KEY,
 trip_id BIGINT NOT NULL REFERENCES delivery_trips(id),
 before_order_ids JSONB NOT NULL CHECK(jsonb_typeof(before_order_ids)='array'),
 after_order_ids JSONB NOT NULL CHECK(jsonb_typeof(after_order_ids)='array'),
 actor TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX delivery_trip_sequence_history_trip ON delivery_trip_sequence_history(trip_id,id);
