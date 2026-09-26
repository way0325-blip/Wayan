const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.use(requireAuth);

function serializeOrder(row) {
  return {
    id: row.id,
    ship: row.ship,
    container: row.container,
    from: row.from_location,
    to: row.to_location,
    time: row.time,
    size: row.size,
    status: row.status,
    driverId: row.driver_id,
    vehicleId: row.vehicle_id,
  };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY id").all();
  res.json(rows.map(serializeOrder));
});

router.post("/", (req, res) => {
  const { ship, container, from, to, time, size } = req.body || {};

  if (!ship || !container || !from || !to || !time || !size) {
    return res.status(400).json({ error: "所有欄位皆為必填" });
  }

  const id = "O" + Date.now();

  db.prepare(`
    INSERT INTO orders (id, ship, container, from_location, to_location, time, size, status, driver_id, vehicle_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, '待派車', NULL, NULL)
  `).run(id, ship, container, from, to, time, size);

  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  res.status(201).json(serializeOrder(row));
});

// 派車前的合法性檢查:司機/車輛狀態、證照與保養逾期、同一時段是否已被指派
function validateDispatch(order, driver, vehicle) {
  const errors = [];
  const now = new Date();

  if (!driver) errors.push("尚未選擇司機");
  if (!vehicle) errors.push("尚未選擇車輛");
  if (driver && driver.status !== "可派車") {
    errors.push(`司機目前狀態為「${driver.status}」`);
  }
  if (vehicle && vehicle.status !== "可用") {
    errors.push(`車輛目前狀態為「${vehicle.status}」`);
  }
  if (driver && new Date(driver.license) < now) {
    errors.push("司機證照已逾期");
  }
  if (vehicle && new Date(vehicle.maintenance) < now) {
    errors.push("車輛保養已逾期,禁止派車");
  }

  if (driver) {
    const clash = db
      .prepare(`
        SELECT 1 FROM orders
        WHERE id != ? AND driver_id = ? AND status IN ('已派車', '執行中') AND time = ?
      `)
      .get(order.id, driver.id, order.time);
    if (clash) errors.push("司機同一時段已有其他任務");
  }

  if (vehicle) {
    const clash = db
      .prepare(`
        SELECT 1 FROM orders
        WHERE id != ? AND vehicle_id = ? AND status IN ('已派車', '執行中') AND time = ?
      `)
      .get(order.id, vehicle.id, order.time);
    if (clash) errors.push("車輛同一時段已有其他任務");
  }

  return errors;
}

router.patch("/:id/dispatch", (req, res) => {
  const { driverId, vehicleId } = req.body || {};

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "找不到此訂單" });

  const driver = driverId
    ? db.prepare("SELECT * FROM drivers WHERE id = ?").get(driverId)
    : null;
  const vehicle = vehicleId
    ? db.prepare("SELECT * FROM vehicles WHERE id = ?").get(vehicleId)
    : null;

  const errors = validateDispatch(order, driver, vehicle);
  if (errors.length) {
    return res.status(409).json({ error: "派車失敗", details: errors });
  }

  db.prepare(
    "UPDATE orders SET status = '已派車', driver_id = ?, vehicle_id = ? WHERE id = ?"
  ).run(driver.id, vehicle.id, order.id);

  db.prepare("UPDATE drivers SET status = '執行中' WHERE id = ?").run(driver.id);
  db.prepare("UPDATE vehicles SET status = '執行中' WHERE id = ?").run(vehicle.id);

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
  res.json(serializeOrder(updated));
});

router.patch("/:id/complete", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "找不到此訂單" });

  db.prepare("UPDATE orders SET status = '已完成' WHERE id = ?").run(order.id);

  if (order.driver_id) {
    db.prepare("UPDATE drivers SET status = '可派車' WHERE id = ?").run(order.driver_id);
  }
  if (order.vehicle_id) {
    db.prepare("UPDATE vehicles SET status = '可用' WHERE id = ?").run(order.vehicle_id);
  }

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
  res.json(serializeOrder(updated));
});

router.get("/export/csv", (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY id").all();
  const header = ["訂單編號", "船名航次", "貨櫃編號", "起點", "終點", "作業時間", "尺寸", "狀態"];

  const csvRows = rows.map((o) => [
    o.id, o.ship, o.container, o.from_location, o.to_location, o.time, o.size, o.status,
  ]);

  const csv = [header, ...csvRows]
    .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="港區運輸訂單.csv"');
  res.send("\ufeff" + csv);
});

module.exports = router;
