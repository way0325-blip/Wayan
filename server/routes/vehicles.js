const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");

const router = express.Router();

router.use(requireAuth);

const createSchema = {
  plate: { required: true, type: "string", maxLength: 20, label: "車牌號碼" },
  type: { required: true, type: "string", maxLength: 30, label: "車型" },
  maintenance: { required: true, type: "date", label: "下次保養日期" },
  inspectionDate: { type: "date", label: "驗車到期日" },
};

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM vehicles ORDER BY id");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", validateBody(createSchema), async (req, res, next) => {
  try {
    const { plate, type, maintenance, inspectionDate } = req.body;
    const id = "V" + String(Date.now()).slice(-5);

    const { rows } = await pool.query(
      "INSERT INTO vehicles (id, plate, type, maintenance, inspection_date, status) VALUES ($1, $2, $3, $4, $5, '可用') RETURNING *",
      [id, plate, type, maintenance, inspectionDate || null]
    );

    await logAction(req, "新增", "車輛", id, plate);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id",
  validateBody({
    plate: { type: "string", maxLength: 20, label: "車牌號碼" },
    type: { type: "string", maxLength: 30, label: "車型" },
    maintenance: { type: "date", label: "下次保養日期" },
    inspectionDate: { type: "date", label: "驗車到期日" },
    status: { enum: ["可用", "執行中", "停派"], label: "狀態" },
  }),
  async (req, res, next) => {
    try {
      const existing = await pool.query("SELECT * FROM vehicles WHERE id = $1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "找不到此車輛" });

      const current = existing.rows[0];
      const {
        plate = current.plate,
        type = current.type,
        maintenance = current.maintenance,
        inspectionDate = current.inspection_date,
        status = current.status,
      } = req.body || {};

      const { rows } = await pool.query(
        "UPDATE vehicles SET plate = $1, type = $2, maintenance = $3, inspection_date = $4, status = $5 WHERE id = $6 RETURNING *",
        [plate, type, maintenance, inspectionDate || null, status, req.params.id]
      );

      await logAction(req, "修改", "車輛", req.params.id, plate);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const inUse = await pool.query(
      "SELECT 1 FROM orders WHERE vehicle_id = $1 AND status IN ('已派車', '執行中')",
      [req.params.id]
    );
    if (inUse.rows.length) {
      return res.status(409).json({ error: "此車輛仍有進行中的訂單,無法刪除" });
    }

    const result = await pool.query("DELETE FROM vehicles WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "找不到此車輛" });

    await logAction(req, "刪除", "車輛", req.params.id, null);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- 各項維修更換紀錄(機油、輪胎、煞車來令片...不限名稱,自由新增) ----

router.get("/:id/maintenance-items", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM vehicle_maintenance_items WHERE vehicle_id = $1 ORDER BY due_date",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/maintenance-items",
  validateBody({
    itemName: { required: true, type: "string", maxLength: 50, label: "項目名稱" },
    dueDate: { required: true, type: "date", label: "到期日" },
    note: { type: "string", maxLength: 200, label: "備註" },
  }),
  async (req, res, next) => {
    try {
      const vehicle = await pool.query("SELECT 1 FROM vehicles WHERE id = $1", [req.params.id]);
      if (!vehicle.rows.length) return res.status(404).json({ error: "找不到此車輛" });

      const { itemName, dueDate, note = "" } = req.body;
      const { rows } = await pool.query(
        "INSERT INTO vehicle_maintenance_items (vehicle_id, item_name, due_date, note) VALUES ($1, $2, $3, $4) RETURNING *",
        [req.params.id, itemName, dueDate, note]
      );

      await logAction(req, "新增", "車輛維修項目", req.params.id, `${itemName}(${dueDate})`);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
