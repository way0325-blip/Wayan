const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");
const { getSettings } = require("../settings");
const { serializeOrder, findOrder, completeOrder } = require("../orderService");
const { pushDispatchList } = require("../line");

const router = express.Router();

router.use(requireAuth);

const ORDER_STATUSES = ["待派車", "已派車", "執行中", "已完成"];
// 調派類型:CY = 貨櫃場 → 客戶端;船邊 = 碼頭 → 貨櫃場
const DISPATCH_TYPES = ["CY", "船邊"];
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MAX_IMPORT_ROWS = 500;

async function checkSize(size) {
  const { container_sizes } = await getSettings();
  return container_sizes.includes(size)
    ? null
    : `貨櫃尺寸必須是:${container_sizes.join("、")}`;
}

async function checkCarrier(carrier) {
  const { carriers } = await getSettings();
  return carriers.includes(carrier) ? null : `船公司必須是:${carriers.join("、")}`;
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
    size: { required: true, type: "string", label: "貨櫃尺寸" },
    dispatchType: { required: true, enum: DISPATCH_TYPES, label: "調派類型" },
    carrier: { required: true, type: "string", maxLength: 30, label: "船公司" },
  }),
  async (req, res, next) => {
    try {
      const { ship, container, from, to, time, size, dispatchType, carrier } = req.body;

      const problems = [await checkSize(size), await checkCarrier(carrier)].filter(Boolean);
      if (problems.length) return res.status(400).json({ error: "輸入驗證失敗", details: problems });

      const id = "O" + Date.now();
      const { rows } = await pool.query(
        `INSERT INTO orders (id, ship, container, from_location, to_location, time, size, status, driver_id, vehicle_id, dispatch_type, carrier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '待派車', NULL, NULL, $8, $9) RETURNING *`,
        [id, ship, container, from, to, time, size, dispatchType, carrier]
      );

      await logAction(req, "新增", "訂單", id, `${dispatchType}|${carrier}|${container} ${from}→${to}`);
      res.status(201).json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

// 批次匯入:整批先驗證,有任何一列錯誤就整批不寫入,並回傳每一列的錯誤
router.post("/import", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: "沒有可匯入的資料" });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ error: `一次最多匯入 ${MAX_IMPORT_ROWS} 筆` });
    }

    const { container_sizes, carriers } = await getSettings();
    const errors = [];
    const clean = rows.map((r, i) => {
      const item = {
        ship: String(r.ship ?? "").trim(),
        container: String(r.container ?? "").trim(),
        from: String(r.from ?? "").trim(),
        to: String(r.to ?? "").trim(),
        time: String(r.time ?? "").trim().replace(" ", "T"),
        size: String(r.size ?? "").trim(),
        dispatchType: String(r.dispatchType ?? "").trim().toUpperCase() === "CY" ? "CY" : String(r.dispatchType ?? "").trim(),
        carrier: String(r.carrier ?? "").trim(),
      };
      const problems = [];
      if (!item.ship || item.ship.length > 100) problems.push("船名／航次必填且不可超過 100 字");
      if (!item.container || item.container.length > 30) problems.push("貨櫃編號必填且不可超過 30 字");
      if (!item.from || item.from.length > 100) problems.push("起點必填");
      if (!item.to || item.to.length > 100) problems.push("終點必填");
      if (!TIME_PATTERN.test(item.time) || Number.isNaN(new Date(item.time).getTime())) {
        problems.push("作業時間格式需為 YYYY-MM-DD HH:MM");
      }
      if (!container_sizes.includes(item.size)) problems.push(`尺寸必須是:${container_sizes.join("、")}`);
      if (!DISPATCH_TYPES.includes(item.dispatchType)) problems.push(`調派類型必須是:${DISPATCH_TYPES.join("、")}`);
      if (!carriers.includes(item.carrier)) problems.push(`船公司必須是:${carriers.join("、")}`);
      if (problems.length) errors.push({ row: i + 1, problems });
      return item;
    });

    if (errors.length) {
      return res.status(400).json({ error: "匯入失敗,請修正下列資料後重試(本次未寫入任何資料)", details: errors });
    }

    await client.query("BEGIN");
    const base = Date.now();
    for (let i = 0; i < clean.length; i++) {
      const o = clean[i];
      await client.query(
        `INSERT INTO orders (id, ship, container, from_location, to_location, time, size, status, dispatch_type, carrier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '待派車', $8, $9)`,
        [`O${base}${String(i).padStart(3, "0")}`, o.ship, o.container, o.from, o.to, o.time, o.size, o.dispatchType, o.carrier]
      );
    }
    await client.query("COMMIT");

    await logAction(req, "批次匯入", "訂單", null, `共 ${clean.length} 筆`);
    res.status(201).json({ imported: clean.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// 編輯訂單基本資料(不含派車、不含狀態變更)——僅限尚未派車的訂單
router.patch(
  "/:id",
  validateBody({
    ship: { type: "string", maxLength: 100, label: "船名／航次" },
    container: { type: "string", maxLength: 30, label: "貨櫃編號" },
    from: { type: "string", maxLength: 100, label: "起點" },
    to: { type: "string", maxLength: 100, label: "終點" },
    time: { type: "date", label: "作業時間" },
    size: { type: "string", label: "貨櫃尺寸" },
    dispatchType: { enum: DISPATCH_TYPES, label: "調派類型" },
    carrier: { type: "string", maxLength: 30, label: "船公司" },
  }),
  async (req, res, next) => {
    try {
      const order = await findOrder(req.params.id);
      if (!order) return res.status(404).json({ error: "找不到此訂單" });
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
        dispatchType = order.dispatch_type,
        carrier = order.carrier,
      } = req.body || {};

      const problems = [];
      if (size !== order.size) problems.push(await checkSize(size));
      if (carrier !== order.carrier) problems.push(await checkCarrier(carrier));
      const failed = problems.filter(Boolean);
      if (failed.length) return res.status(400).json({ error: "輸入驗證失敗", details: failed });

      const { rows } = await pool.query(
        `UPDATE orders SET ship = $1, container = $2, from_location = $3, to_location = $4, time = $5, size = $6,
           dispatch_type = $7, carrier = $8
         WHERE id = $9 RETURNING *`,
        [ship, container, fromLocation, toLocation, time, size, dispatchType, carrier, req.params.id]
      );

      await logAction(req, "修改", "訂單", order.id, `${container} ${fromLocation}→${toLocation}`);
      res.json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

// 派車前的合法性檢查。keep 用於改派:沿用原本的司機/車輛時,不再要求其為閒置狀態
async function validateDispatch(order, driver, vehicle, keep = {}) {
  const errors = [];
  const now = new Date();

  if (!driver) errors.push("尚未選擇司機");
  if (!vehicle) errors.push("尚未選擇車輛");
  if (driver && !keep.driver && driver.status !== "可派車") {
    errors.push(`司機目前狀態為「${driver.status}」`);
  }
  if (vehicle && !keep.vehicle && vehicle.status !== "可用") {
    errors.push(`車輛目前狀態為「${vehicle.status}」`);
  }
  if (driver && new Date(driver.license) < now) errors.push("司機證照已逾期");
  if (vehicle && new Date(vehicle.maintenance) < now) errors.push("車輛保養已逾期,禁止派車");

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

async function loadResources(driverId, vehicleId) {
  const d = await pool.query("SELECT * FROM drivers WHERE id = $1", [driverId]);
  const v = await pool.query("SELECT * FROM vehicles WHERE id = $1", [vehicleId]);
  return { driver: d.rows[0] || null, vehicle: v.rows[0] || null };
}

const dispatchSchema = {
  driverId: { required: true, type: "string", label: "司機" },
  vehicleId: { required: true, type: "string", label: "車輛" },
};

router.patch("/:id/dispatch", validateBody(dispatchSchema), async (req, res, next) => {
  try {
    const order = await findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "找不到此訂單" });
    if (order.status !== "待派車") {
      return res.status(409).json({ error: "只有「待派車」的訂單可以派車;已派車請使用「改派」" });
    }

    const { driver, vehicle } = await loadResources(req.body.driverId, req.body.vehicleId);
    const errors = await validateDispatch(order, driver, vehicle);
    if (errors.length) return res.status(409).json({ error: "派車失敗", details: errors });

    const { rows } = await pool.query(
      "UPDATE orders SET status = '已派車', driver_id = $1, vehicle_id = $2 WHERE id = $3 RETURNING *",
      [driver.id, vehicle.id, order.id]
    );
    await pool.query("UPDATE drivers SET status = '執行中' WHERE id = $1", [driver.id]);
    await pool.query("UPDATE vehicles SET status = '執行中' WHERE id = $1", [vehicle.id]);

    await logAction(req, "派車", "訂單", order.id, `司機 ${driver.name}、車輛 ${vehicle.plate}`);
    res.json(serializeOrder(rows[0]));
  } catch (err) {
    next(err);
  }
});

// 改派:已派車/執行中的訂單更換司機或車輛,舊的釋放、新的佔用
router.patch("/:id/reassign", validateBody(dispatchSchema), async (req, res, next) => {
  try {
    const order = await findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "找不到此訂單" });
    if (!["已派車", "執行中"].includes(order.status)) {
      return res.status(409).json({ error: "只有「已派車/執行中」的訂單可以改派" });
    }

    const { driver, vehicle } = await loadResources(req.body.driverId, req.body.vehicleId);
    const keep = {
      driver: driver && driver.id === order.driver_id,
      vehicle: vehicle && vehicle.id === order.vehicle_id,
    };
    if (keep.driver && keep.vehicle) {
      return res.status(400).json({ error: "司機與車輛都沒有變更" });
    }

    const errors = await validateDispatch(order, driver, vehicle, keep);
    if (errors.length) return res.status(409).json({ error: "改派失敗", details: errors });

    if (!keep.driver && order.driver_id) {
      await pool.query("UPDATE drivers SET status = '可派車' WHERE id = $1", [order.driver_id]);
    }
    if (!keep.vehicle && order.vehicle_id) {
      await pool.query("UPDATE vehicles SET status = '可用' WHERE id = $1", [order.vehicle_id]);
    }
    await pool.query("UPDATE drivers SET status = '執行中' WHERE id = $1", [driver.id]);
    await pool.query("UPDATE vehicles SET status = '執行中' WHERE id = $1", [vehicle.id]);

    const { rows } = await pool.query(
      "UPDATE orders SET driver_id = $1, vehicle_id = $2 WHERE id = $3 RETURNING *",
      [driver.id, vehicle.id, order.id]
    );
    await logAction(req, "改派", "訂單", order.id, `改為司機 ${driver.name}、車輛 ${vehicle.plate}`);
    res.json(serializeOrder(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/complete", async (req, res, next) => {
  try {
    const { order, error } = await completeOrder(req.params.id, req.user);
    if (error) return res.status(404).json({ error });
    res.json(serializeOrder(order));
  } catch (err) {
    next(err);
  }
});

// 把選定的訂單整理成明細文字,推送到後台設定好的 LINE 群組(不用手動複製貼上)
router.post("/push-line", async (req, res, next) => {
  try {
    const ids = req.body?.orderIds;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "請至少選擇一筆訂單" });
    }
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE id = ANY($1::text[]) ORDER BY time",
      [ids]
    );
    if (!rows.length) return res.status(404).json({ error: "找不到指定的訂單" });

    const [driversRes, vehiclesRes] = await Promise.all([
      pool.query("SELECT * FROM drivers"),
      pool.query("SELECT * FROM vehicles"),
    ]);

    const result = await pushDispatchList(rows.map(serializeOrder), driversRes.rows, vehiclesRes.rows);
    if (result.error) return res.status(400).json({ error: result.error });

    await logAction(req, "推送LINE", "訂單", null, `${rows.length} 筆 → ${result.sentTo.join("、")}`);
    res.json({ sent: rows.length, groups: result.sentTo });
  } catch (err) {
    next(err);
  }
});

// 管理員強制修改狀態(例如誤按完成、需要退回重派)
router.patch(
  "/:id/status",
  requireRole("admin"),
  validateBody({ status: { required: true, enum: ORDER_STATUSES, label: "狀態" } }),
  async (req, res, next) => {
    try {
      const order = await findOrder(req.params.id);
      if (!order) return res.status(404).json({ error: "找不到此訂單" });

      const next_ = req.body.status;
      if (next_ === order.status) return res.json(serializeOrder(order));

      let rows;
      if (next_ === "已派車" || next_ === "執行中") {
        if (!order.driver_id || !order.vehicle_id) {
          return res.status(409).json({ error: "此訂單沒有指派司機與車輛,請先用「派車」" });
        }
        ({ rows } = await pool.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING *", [next_, order.id]));
        await pool.query("UPDATE drivers SET status = '執行中' WHERE id = $1", [order.driver_id]);
        await pool.query("UPDATE vehicles SET status = '執行中' WHERE id = $1", [order.vehicle_id]);
      } else {
        if (order.driver_id) await pool.query("UPDATE drivers SET status = '可派車' WHERE id = $1", [order.driver_id]);
        if (order.vehicle_id) await pool.query("UPDATE vehicles SET status = '可用' WHERE id = $1", [order.vehicle_id]);
        // 退回「待派車」時一併清除派遣資訊,才能重新派車;「已完成」則保留紀錄
        const clear = next_ === "待派車";
        ({ rows } = await pool.query(
          `UPDATE orders SET status = $1,
             driver_id = CASE WHEN $3 THEN NULL ELSE driver_id END,
             vehicle_id = CASE WHEN $3 THEN NULL ELSE vehicle_id END
           WHERE id = $2 RETURNING *`,
          [next_, order.id, clear]
        ));
      }

      await logAction(req, "強制改狀態", "訂單", order.id, `${order.status} → ${next_}`);
      res.json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const order = await findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "找不到此訂單" });

    if (["已派車", "執行中"].includes(order.status)) {
      if (order.driver_id) await pool.query("UPDATE drivers SET status = '可派車' WHERE id = $1", [order.driver_id]);
      if (order.vehicle_id) await pool.query("UPDATE vehicles SET status = '可用' WHERE id = $1", [order.vehicle_id]);
    }

    await pool.query("DELETE FROM orders WHERE id = $1", [order.id]);
    await logAction(req, "刪除", "訂單", order.id, order.container);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/export/csv", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY id");
    const header = ["訂單編號", "船公司", "調派類型", "船名航次", "貨櫃編號", "起點", "終點", "作業時間", "尺寸", "狀態"];
    const csvRows = rows.map((o) => [
      o.id, o.carrier, o.dispatch_type, o.ship, o.container, o.from_location, o.to_location, o.time, o.size, o.status,
    ]);

    // 以 = + - @ 開頭的儲存格會被 Excel 當成公式執行,匯出時加前綴避免 CSV 注入
    const cell = (v) => {
      let t = String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return `"${t.replaceAll('"', '""')}"`;
    };
    const csv = [header, ...csvRows].map((row) => row.map(cell).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="orders.csv"');
    res.send("\ufeff" + csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
