const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");

const router = express.Router();

router.use(requireAuth);

const createSchema = {
  name: { required: true, type: "string", maxLength: 50, label: "司機姓名" },
  phone: { required: true, type: "string", maxLength: 30, label: "手機" },
  license: { required: true, type: "date", label: "證照有效期限" },
};

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM drivers ORDER BY id");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", validateBody(createSchema), async (req, res, next) => {
  try {
    const { name, phone, license } = req.body;
    const id = "D" + String(Date.now()).slice(-5);

    const { rows } = await pool.query(
      "INSERT INTO drivers (id, name, phone, license, status) VALUES ($1, $2, $3, $4, '可派車') RETURNING *",
      [id, name, phone, license]
    );

    await logAction(req, "新增", "司機", id, name);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id",
  validateBody({
    name: { type: "string", maxLength: 50, label: "司機姓名" },
    phone: { type: "string", maxLength: 30, label: "手機" },
    license: { type: "date", label: "證照有效期限" },
    status: { enum: ["可派車", "執行中", "停派"], label: "狀態" },
  }),
  async (req, res, next) => {
    try {
      const existing = await pool.query("SELECT * FROM drivers WHERE id = $1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "找不到此司機" });

      const current = existing.rows[0];
      const { name = current.name, phone = current.phone, license = current.license, status = current.status } = req.body || {};

      const { rows } = await pool.query(
        "UPDATE drivers SET name = $1, phone = $2, license = $3, status = $4 WHERE id = $5 RETURNING *",
        [name, phone, license, status, req.params.id]
      );

      await logAction(req, "修改", "司機", req.params.id, name);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const inUse = await pool.query(
      "SELECT 1 FROM orders WHERE driver_id = $1 AND status IN ('已派車', '執行中')",
      [req.params.id]
    );
    if (inUse.rows.length) {
      return res.status(409).json({ error: "此司機仍有進行中的訂單,無法刪除" });
    }

    const result = await pool.query("DELETE FROM drivers WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "找不到此司機" });

    await logAction(req, "刪除", "司機", req.params.id, null);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
