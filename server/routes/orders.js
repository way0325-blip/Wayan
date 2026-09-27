const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");

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

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY id");
    res.json(rows.map(serializeOrder));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  validateBody({
    ship: { required: true, type: "string", maxLength: 100, label: "船名／航次" },
    container: { required: true, type: "string", maxLength: 30, label: "貨櫃編號" },
    from: { required: true, type: "string", maxLength: 100, label: "起點" },
    to: { required: true, type: "string", maxLength: 100, label: "終點" },
    time: { required: true, type: "date", label: "作業時間" },
    size: { required: true, enum: ["20 呎", "40 呎", "45 呎"], label: "貨櫃尺寸" },
  }),
  async (req, res, next) => {
    try {
      const { ship, container, from, to, time, size } = req.body;
      const id = "O" + Date.now();

      const { rows } = await pool.query(
        `INSERT INTO orders (id, ship, container, from_location, to_location, time, size, status, driver_id, vehicle_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '待派車', NULL, NULL) RETURNING *`,
        [id, ship, container, from, to, time, size]
      );

      res.status(201).json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

// 編輯訂單基本資料(不含派車、不含狀態變更)——僅限尚未派車的訂單,避免和已進行的派車衝突
router.patch(
  "/:id",
  validateBody({
    ship: { type: "string", maxLength: 100, label: "船名／航次" },
    container: { type: "string", maxLength: 30, label: "貨櫃編號" },
    from: { type: "string", maxLength: 100, label: "起點" },
    to: { type: "string", maxLength: 100, label: "終點" },
    time: { type: "date", label: "作業時間" },
    size: { enum: ["20 呎", "40 呎", "45 呎"], label: "貨櫃尺寸" },
  }),
  async (req, res, next) => {
    try {
      const existing = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "找不到此訂單" });

      const order = existing.rows[0];
      if (order.status !== "待派車") {
        return res.status(409).json({ error: "只有「待派車」狀態的訂單可以編輯基本資料" });
      }

      const {
        ship = order.ship,
        container = order.container,
        from: fromLocation = order.from_location,
        to: toLocation = order.to_location,
        time = order.time,
        size = order.size,
      } = req.body || {};

      const { rows } = await pool.query(
        `UPDATE orders SET ship = $1, container = $2, from_location = $3, to_location = $4, time = $5, size = $6
         WHERE id = $7 RETURNING *`,
        [ship, container, fromLocation, toLocation, time, size, req.params.id]
      );

      res.json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

// 派車前的合法性檢查:司機/車輛狀態、證照與保養逾期、同一時段是否已被指派
async function validateDispatch(order, driver, vehicle) {
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
    const clash = await pool.query(
      `SELECT 1 FROM orders
       WHERE id != $1 AND driver_id = $2 AND status IN ('已派車', '執行中') AND time = $3`,
      [order.id, driver.id, order.time]
    );
    if (clash.rows.length) errors.push("司機同一時段已有其他任務");
  }

  if (vehicle) {
    const clash = await pool.query(
      `SELECT 1 FROM orders
       WHERE id != $1 AND vehicle_id = $2 AND status IN ('已派車', '執行中') AND time = $3`,
      [order.id, vehicle.id, order.time]
    );
    if (clash.rows.length) errors.push("車輛同一時段已有其他任務");
  }

  return errors;
}

router.patch(
  "/:id/dispatch",
  validateBody({
    driverId: { required: true, type: "string", label: "司機" },
    vehicleId: { required: true, type: "string", label: "車輛" },
  }),
  async (req, res, next) => {
    try {
      const { driverId, vehicleId } = req.body;

      const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
      if (!orderResult.rows.length) return res.status(404).json({ error: "找不到此訂單" });
      const order = orderResult.rows[0];

      const driverResult = await pool.query("SELECT * FROM drivers WHERE id = $1", [driverId]);
      const vehicleResult = await pool.query("SELECT * FROM vehicles WHERE id = $1", [vehicleId]);
      const driver = driverResult.rows[0] || null;
      const vehicle = vehicleResult.rows[0] || null;

      const errors = await validateDispatch(order, driver, vehicle);
      if (errors.length) {
        return res.status(409).json({ error: "派車失敗", details: errors });
      }

      const { rows } = await pool.query(
        "UPDATE orders SET status = '已派車', driver_id = $1, vehicle_id = $2 WHERE id = $3 RETURNING *",
        [driver.id, vehicle.id, order.id]
      );
      await pool.query("UPDATE drivers SET status = '執行中' WHERE id = $1", [driver.id]);
      await pool.query("UPDATE vehicles SET status = '執行中' WHERE id = $1", [vehicle.id]);

      res.json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

router.patch("/:id/complete", async (req, res, next) => {
  try {
    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (!orderResult.rows.length) return res.status(404).json({ error: "找不到此訂單" });
    const order = orderResult.rows[0];

    const { rows } = await pool.query(
      "UPDATE orders SET status = '已完成' WHERE id = $1 RETURNING *",
      [order.id]
    );

    if (order.driver_id) {
      await pool.query("UPDATE drivers SET status = '可派車' WHERE id = $1", [order.driver_id]);
    }
    if (order.vehicle_id) {
      await pool.query("UPDATE vehicles SET status = '可用' WHERE id = $1", [order.vehicle_id]);
    }

    res.json(serializeOrder(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (!orderResult.rows.length) return res.status(404).json({ error: "找不到此訂單" });
    const order = orderResult.rows[0];

    if (order.driver_id) {
      await pool.query("UPDATE drivers SET status = '可派車' WHERE id = $1", [order.driver_id]);
    }
    if (order.vehicle_id) {
      await pool.query("UPDATE vehicles SET status = '可用' WHERE id = $1", [order.vehicle_id]);
    }

    await pool.query("DELETE FROM orders WHERE id = $1", [order.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/export/csv", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY id");
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
  } catch (err) {
    next(err);
  }
});

module.exports = router;
