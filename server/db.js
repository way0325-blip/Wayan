const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");

const DB_PATH = process.env.DB_PATH || "./data/dispatch.db";

// 確保資料庫所在目錄存在
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
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
    driver_id TEXT,
    vehicle_id TEXT,
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  );
`);

function seedIfEmpty() {
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;

  if (userCount === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "1234";
    const hash = bcrypt.hashSync(password, 10);

    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
      username,
      hash
    );
  }

  const driverCount = db.prepare("SELECT COUNT(*) AS c FROM drivers").get().c;

  if (driverCount === 0) {
    const insertDriver = db.prepare(
      "INSERT INTO drivers (id, name, phone, license, status) VALUES (?, ?, ?, ?, ?)"
    );

    insertDriver.run("D001", "陳志明", "0912-345-678", "2027-08-30", "可派車");
    insertDriver.run("D002", "林建宏", "0922-456-789", "2026-12-20", "可派車");
    insertDriver.run("D003", "王大偉", "0933-888-111", "2025-01-10", "停派");
  }

  const vehicleCount = db.prepare("SELECT COUNT(*) AS c FROM vehicles").get().c;

  if (vehicleCount === 0) {
    const insertVehicle = db.prepare(
      "INSERT INTO vehicles (id, plate, type, maintenance, status) VALUES (?, ?, ?, ?, ?)"
    );

    insertVehicle.run("V001", "ABC-1234", "曳引車", "2027-05-20", "可用");
    insertVehicle.run("V002", "DEF-5678", "曳引車", "2026-11-18", "可用");
    insertVehicle.run("V003", "GHI-9012", "曳引車", "2025-01-01", "停派");
  }

  const orderCount = db.prepare("SELECT COUNT(*) AS c FROM orders").get().c;

  if (orderCount === 0) {
    const insertOrder = db.prepare(`
      INSERT INTO orders
        (id, ship, container, from_location, to_location, time, size, status, driver_id, vehicle_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertOrder.run(
      "O20260925001", "EVER ACE / 012W", "EMCU1234567",
      "高雄港", "台中倉庫", "2026-09-25T09:00", "40 呎",
      "已派車", "D001", "V001"
    );

    insertOrder.run(
      "O20260925002", "YANG MING / 088E", "YMLU7654321",
      "高雄港", "台南倉庫", "2026-09-25T10:30", "20 呎",
      "待派車", null, null
    );

    insertOrder.run(
      "O20260925003", "OOCL / 221N", "OOLU9988776",
      "高雄港", "屏東物流中心", "2026-09-25T13:00", "40 呎",
      "已完成", "D002", "V002"
    );
  }
}

seedIfEmpty();

module.exports = db;
