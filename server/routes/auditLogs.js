const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("admin"));

router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const params = [];
    let where = "";

    if (req.query.entity) {
      params.push(String(req.query.entity));
      where = `WHERE entity = $${params.length}`;
    }
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT id, at, username, role, action, entity, entity_id, detail
       FROM audit_logs ${where} ORDER BY id DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
