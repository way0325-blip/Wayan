CREATE TABLE delivery_warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO delivery_warehouses(id,name) VALUES('DAYUAN','大園倉'),('YANGMEI','楊梅倉'),('GUANYIN','觀音倉');
CREATE TABLE delivery_stores (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE delivery_orders (
  id BIGSERIAL PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL REFERENCES delivery_warehouses(id),
  store_id BIGINT NOT NULL REFERENCES delivery_stores(id),
  service_date TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待安排' CHECK(status IN ('待安排','已安排','配送中','已送達','已取消')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX delivery_orders_day ON delivery_orders(service_date,status);
CREATE TABLE delivery_trips (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  warehouse_id TEXT NOT NULL REFERENCES delivery_warehouses(id),
  service_date TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  warehouse_address TEXT NOT NULL DEFAULT '',
  fleet_id TEXT REFERENCES partner_fleets(id),
  assignment_id INTEGER REFERENCES shopee_assignments(id),
  driver_id TEXT REFERENCES drivers(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  status TEXT NOT NULL DEFAULT '待派車' CHECK(status IN ('待派車','已派車','配送中','已完成','已取消')),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE delivery_trip_stops (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES delivery_trips(id),
  order_id BIGINT NOT NULL REFERENCES delivery_orders(id),
  stop_no INTEGER NOT NULL CHECK(stop_no BETWEEN 1 AND 200),
  released_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  store_code TEXT NOT NULL,
  store_name TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  UNIQUE(trip_id,stop_no) DEFERRABLE INITIALLY IMMEDIATE,UNIQUE(trip_id,order_id)
);
CREATE UNIQUE INDEX delivery_order_one_active_trip ON delivery_trip_stops(order_id) WHERE released_at IS NULL;
CREATE INDEX delivery_trips_day ON delivery_trips(service_date,status);
DO $$ DECLARE n TEXT; BEGIN
  FOREACH n IN ARRAY ARRAY['delivery_stores','delivery_orders','delivery_trips','delivery_trip_stops','delivery_warehouses'] LOOP
    EXECUTE format('CREATE TRIGGER wayan_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION wayan_notify_change()',n);
  END LOOP;
END $$;
UPDATE line_keyword_replies SET reply=reply||E'\n門店配送車趟查詢：門店車趟',updated_at=NOW()
  WHERE keyword IN ('說明','指令') AND updated_by='系統預設' AND reply NOT LIKE '%門店車趟%';
