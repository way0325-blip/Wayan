const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "缺少 DATABASE_URL 環境變數。請複製 .env.example 為 .env 並設定 PostgreSQL 連線字串。"
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'dispatcher' CHECK (role IN ('admin', 'dispatcher'))
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      license TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '可派車'
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      plate TEXT NOT NULL,
      type TEXT NOT NULL,
      maintenance TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '可用'
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      ship TEXT NOT NULL,
      container TEXT NOT NULL,
      from_location TEXT NOT NULL,
      to_location TEXT NOT NULL,
      time TEXT NOT NULL,
      size TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '待派車',
      driver_id TEXT REFERENCES drivers(id),
      vehicle_id TEXT REFERENCES vehicles(id)
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatch_type TEXT NOT NULL DEFAULT 'CY';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier TEXT NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_call TEXT NOT NULL DEFAULT '';
    ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS inspection_date TEXT;

    CREATE TABLE IF NOT EXISTS vehicle_maintenance_items (
      id SERIAL PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      due_date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dispatch_staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    -- 蝦皮店到店:車隊需求管理(與港口 orders 完全獨立)
    CREATE TABLE IF NOT EXISTS shopee_routes (
      id TEXT PRIMARY KEY,
      service_date TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      required_trucks INTEGER NOT NULL CHECK (required_trucks >= 1),
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS partner_fleets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      daily_capacity INTEGER NOT NULL DEFAULT 0 CHECK (daily_capacity >= 0),
      status TEXT NOT NULL DEFAULT '啟用' CHECK (status IN ('啟用', '停用')),
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fleet_routes (
      id SERIAL PRIMARY KEY,
      fleet_id TEXT NOT NULL REFERENCES partner_fleets(id) ON DELETE CASCADE,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      max_trucks INTEGER NOT NULL DEFAULT 1 CHECK (max_trucks >= 1),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (fleet_id, origin, destination, vehicle_type)
    );

    CREATE TABLE IF NOT EXISTS shopee_assignments (
      id SERIAL PRIMARY KEY,
      route_id TEXT NOT NULL REFERENCES shopee_routes(id) ON DELETE CASCADE,
      fleet_id TEXT NOT NULL REFERENCES partner_fleets(id),
      requested_trucks INTEGER NOT NULL CHECK (requested_trucks >= 1),
      confirmed_trucks INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_trucks >= 0),
      status TEXT NOT NULL DEFAULT '待回覆' CHECK (status IN ('待回覆', '已確認', '已拒絕')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (route_id, fleet_id)
    );

    ALTER TABLE partner_fleets ADD COLUMN IF NOT EXISTS line_link TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS attendance_records (
      id SERIAL PRIMARY KEY,
      staff_type TEXT NOT NULL CHECK (staff_type IN ('driver', 'dispatcher')),
      staff_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('出勤', '休假', '曠職')),
      note TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (staff_type, staff_id, date)
    );

    -- 自有司機績效事件：原始事件不可刪除，覆核歷程獨立保存。
    CREATE TABLE IF NOT EXISTS driver_performance_events (
      id BIGSERIAL PRIMARY KEY,
      driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
      event_type TEXT NOT NULL,
      event_date DATE NOT NULL,
      scheduled_time TIME,
      actual_time TIME,
      late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      reason TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      excluded_reason TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT '待覆核'
        CHECK (review_status IN ('待覆核', '已確認', '核准排除', '非司機因素')),
      review_note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_driver_perf_events_driver_date
      ON driver_performance_events (driver_id, event_date DESC);
    CREATE INDEX IF NOT EXISTS idx_driver_perf_events_date_status
      ON driver_performance_events (event_date, review_status);

    CREATE TABLE IF NOT EXISTS driver_performance_event_history (
      id BIGSERIAL PRIMARY KEY,
      event_id BIGINT NOT NULL REFERENCES driver_performance_events(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      before_data JSONB,
      after_data JSONB,
      actor TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS line_daily_index (
      source_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      order_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source_id, seq)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT
    );
  `);
}

async function seedSettings() {
  const defaults = {
    system_name: "港區星際運輸調度中心",
    announcement: "",
    locations: JSON.stringify(["高雄港", "台中港", "基隆港", "台北港", "台中倉庫", "台南倉庫", "屏東物流中心"]),
    container_sizes: JSON.stringify(["20 呎", "40 呎", "40HQ", "45 呎"]),
    carriers: JSON.stringify(["夏輝", "陽明", "天鵝湖"]),
    line_group_ids: JSON.stringify([]),
    shopee_vehicle_types: JSON.stringify(["3.5T", "11T", "17T"]),
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [key, value]
    );
  }
}

async function seedIfEmpty() {
  const { rows: userRows } = await pool.query("SELECT COUNT(*)::int AS c FROM users");

  if (userRows[0].c === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "1234";
    const hash = bcrypt.hashSync(password, 10);

    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')",
      [username, hash]
    );
  }

  const { rows: driverRows } = await pool.query("SELECT COUNT(*)::int AS c FROM drivers");

  if (driverRows[0].c === 0) {
    await pool.query(`
      INSERT INTO drivers (id, name, phone, license, status) VALUES
        ('D001', '陳志明', '0912-345-678', '2027-08-30', '可派車'),
        ('D002', '林建宏', '0922-456-789', '2026-12-20', '可派車'),
        ('D003', '王大偉', '0933-888-111', '2025-01-10', '停派')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  const { rows: vehicleRows } = await pool.query("SELECT COUNT(*)::int AS c FROM vehicles");

  if (vehicleRows[0].c === 0) {
    await pool.query(`
      INSERT INTO vehicles (id, plate, type, maintenance, status) VALUES
        ('V001', 'ABC-1234', '曳引車', '2027-05-20', '可用'),
        ('V002', 'DEF-5678', '曳引車', '2026-11-18', '可用'),
        ('V003', 'GHI-9012', '曳引車', '2025-01-01', '停派')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  const { rows: orderRows } = await pool.query("SELECT COUNT(*)::int AS c FROM orders");

  if (orderRows[0].c === 0) {
    await pool.query(`
      INSERT INTO orders
        (id, ship, container, from_location, to_location, time, size, status, driver_id, vehicle_id, dispatch_type, carrier)
      VALUES
        ('O20260925001', 'EVER ACE / 012W', 'EMCU1234567', '高雄港', '台中倉庫', '2026-09-25T09:00', '40 呎', '已派車', 'D001', 'V001', 'CY', '夏輝'),
        ('O20260925002', 'YANG MING / 088E', 'YMLU7654321', '高雄港', '台南倉庫', '2026-09-25T10:30', '20 呎', '待派車', NULL, NULL, '船邊', '陽明'),
        ('O20260925003', 'OOCL / 221N', 'OOLU9988776', '高雄港', '屏東物流中心', '2026-09-25T13:00', '40 呎', '已完成', 'D002', 'V002', 'CY', '天鵝湖')
      ON CONFLICT (id) DO NOTHING
    `);
  }
}

// 一次性遷移:既有資料庫的貨櫃尺寸清單沒有 HQ 時補上「40HQ」。
// 用 settings 裡的標記記住已經做過,之後管理員若自己把它拿掉,不會在重啟時被加回來。
async function ensureHqContainerSize() {
  const done = await pool.query("SELECT 1 FROM settings WHERE key = 'migration_hq_size'");
  if (done.rows.length) return;
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'container_sizes'");
  let sizes = [];
  try { sizes = JSON.parse(rows[0]?.value || "[]"); } catch { sizes = []; }
  if (rows.length && !sizes.some((s) => /hq/i.test(s))) {
    sizes.push("40HQ");
    await pool.query("UPDATE settings SET value = $1 WHERE key = 'container_sizes'", [JSON.stringify(sizes)]);
  }
  await pool.query("INSERT INTO settings (key, value) VALUES ('migration_hq_size', '1') ON CONFLICT (key) DO NOTHING");
}

async function initDb() {
  await initSchema();
  await seedSettings();
  await ensureHqContainerSize();
  await seedIfEmpty();
}

module.exports = { pool, initDb };
