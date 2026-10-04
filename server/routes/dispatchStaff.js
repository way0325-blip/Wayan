const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM dispatch_staff ORDER BY id");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  validateBody({
    name: { required: true, type: "string", maxLength: 50, label: "姓名" },
    phone: { type: "string", maxLength: 30, label: "電話" },
  }),
  async (req, res, next) => {
    try {
      const { name, phone = "" } = req.body;
      const id = "S" + String(Date.now()).slice(-5);

      const { rows } = await pool.query(
        "INSERT INTO dispatch_staff (id, name, phone, active) VALUES ($1, $2, $3, TRUE) RETURNING *",
        [id, name, phone]
      );

      await logAction(req, "新增", "調度人員", id, name);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:id",
  validateBody({
    name: { type: "string", maxLength: 50, label: "姓名" },
    phone: { type: "string", maxLength: 30, label: "電話" },
    // active 是 boolean,刻意不放進這裡驗證(validateBody 是字串導向的規則,false 會被誤判成格式錯誤),
    // 下面直接手動讀取 req.body.active。
  }),
  async (req, res, next) => {
    try {
      const existing = await pool.query("SELECT * FROM dispatch_staff WHERE id = $1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "找不到此調度人員" });
      const current = existing.rows[0];

      const { name = current.name, phone = current.phone } = req.body || {};
      const active = req.body?.active !== undefined ? Boolean(req.body.active) : current.active;

      const { rows } = await pool.query(
        "UPDATE dispatch_staff SET name = $1, phone = $2, active = $3 WHERE id = $4 RETURNING *",
        [name, phone, active, req.params.id]
      );

      await logAction(req, "修改", "調度人員", req.params.id, name);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM dispatch_staff WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "找不到此調度人員" });

    await logAction(req, "刪除", "調度人員", req.params.id, null);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
