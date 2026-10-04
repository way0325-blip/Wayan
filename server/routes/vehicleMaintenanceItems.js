const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");

const router = express.Router();

router.use(requireAuth);

router.patch(
  "/:itemId",
  validateBody({
    itemName: { type: "string", maxLength: 50, label: "項目名稱" },
    dueDate: { type: "date", label: "到期日" },
    note: { type: "string", maxLength: 200, label: "備註" },
  }),
  async (req, res, next) => {
    try {
      const existing = await pool.query(
        "SELECT * FROM vehicle_maintenance_items WHERE id = $1",
        [req.params.itemId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: "找不到此維修項目" });
      const current = existing.rows[0];

      const {
        itemName = current.item_name,
        dueDate = current.due_date,
        note = current.note,
      } = req.body || {};

      const { rows } = await pool.query(
        "UPDATE vehicle_maintenance_items SET item_name = $1, due_date = $2, note = $3 WHERE id = $4 RETURNING *",
        [itemName, dueDate, note, req.params.itemId]
      );

      await logAction(req, "修改", "車輛維修項目", current.vehicle_id, `${itemName}(${dueDate})`);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:itemId", async (req, res, next) => {
  try {
    const existing = await pool.query(
      "SELECT * FROM vehicle_maintenance_items WHERE id = $1",
      [req.params.itemId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: "找不到此維修項目" });

    await pool.query("DELETE FROM vehicle_maintenance_items WHERE id = $1", [req.params.itemId]);
    await logAction(req, "刪除", "車輛維修項目", existing.rows[0].vehicle_id, existing.rows[0].item_name);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
