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
  `);
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
        (id, ship, container, from_location, to_location, time, size, status, driver_id, vehicle_id)
      VALUES
        ('O20260925001', 'EVER ACE / 012W', 'EMCU1234567', '高雄港', '台中倉庫', '2026-09-25T09:00', '40 呎', '已派車', 'D001', 'V001'),
        ('O20260925002', 'YANG MING / 088E', 'YMLU7654321', '高雄港', '台南倉庫', '2026-09-25T10:30', '20 呎', '待派車', NULL, NULL),
        ('O20260925003', 'OOCL / 221N', 'OOLU9988776', '高雄港', '屏東物流中心', '2026-09-25T13:00', '40 呎', '已完成', 'D002', 'V002')
      ON CONFLICT (id) DO NOTHING
    `);
  }
}

async function initDb() {
  await initSchema();
  await seedIfEmpty();
}

module.exports = { pool, initDb };
