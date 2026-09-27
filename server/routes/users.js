const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("admin"));

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, username, role FROM users ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  validateBody({
    username: { required: true, type: "string", maxLength: 50, label: "帳號" },
    password: { required: true, type: "string", label: "密碼" },
    role: { required: true, enum: ["admin", "dispatcher"], label: "角色" },
  }),
  async (req, res, next) => {
    try {
      const { username, password, role } = req.body;

      if (password.length < 4) {
        return res.status(400).json({ error: "密碼長度至少 4 碼" });
      }

      const existing = await pool.query(
        "SELECT 1 FROM users WHERE username = $1",
        [username]
      );
      if (existing.rows.length) {
        return res.status(409).json({ error: "帳號已存在" });
      }

      const hash = bcrypt.hashSync(password, 10);
      const { rows } = await pool.query(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role",
        [username, hash, role]
      );

      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/:id", async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);

    if (targetId === req.user.sub) {
      return res.status(400).json({ error: "不可刪除自己目前登入的帳號" });
    }

    const { rows: admins } = await pool.query(
      "SELECT id FROM users WHERE role = 'admin'"
    );
    const target = await pool.query("SELECT * FROM users WHERE id = $1", [targetId]);

    if (!target.rows.length) {
      return res.status(404).json({ error: "找不到此使用者" });
    }

    if (target.rows[0].role === "admin" && admins.length <= 1) {
      return res.status(400).json({ error: "至少需保留一位管理員帳號" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [targetId]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
