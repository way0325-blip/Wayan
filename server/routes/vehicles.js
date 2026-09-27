const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");

const router = express.Router();

router.use(requireAuth);

const createSchema = {
  plate: { required: true, type: "string", maxLength: 20, label: "車牌號碼" },
  type: { required: true, type: "string", maxLength: 30, label: "車型" },
  maintenance: { required: true, type: "date", label: "下次保養日期" },
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
    const { plate, type, maintenance } = req.body;
    const id = "V" + String(Date.now()).slice(-5);

    const { rows } = await pool.query(
      "INSERT INTO vehicles (id, plate, type, maintenance, status) VALUES ($1, $2, $3, $4, '可用') RETURNING *",
      [id, plate, type, maintenance]
    );

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
    status: { enum: ["可用", "執行中", "停派"], label: "狀態" },
  }),
  async (req, res, next) => {
    try {
      const existing = await pool.query("SELECT * FROM vehicles WHERE id = $1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "找不到此車輛" });

      const current = existing.rows[0];
      const { plate = current.plate, type = current.type, maintenance = current.maintenance, status = current.status } = req.body || {};

      const { rows } = await pool.query(
        "UPDATE vehicles SET plate = $1, type = $2, maintenance = $3, status = $4 WHERE id = $5 RETURNING *",
        [plate, type, maintenance, status, req.params.id]
      );

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

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
