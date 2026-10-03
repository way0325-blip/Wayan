const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("admin"));

const MIN_PASSWORD = 6;

async function countActiveAdmins() {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND active = TRUE"
  );
  return rows[0].c;
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, username, role, active FROM users ORDER BY id"
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

      if (password.length < MIN_PASSWORD) {
        return res.status(400).json({ error: `密碼長度至少 ${MIN_PASSWORD} 碼` });
      }

      const existing = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
      if (existing.rows.length) {
        return res.status(409).json({ error: "帳號已存在" });
      }

      const hash = bcrypt.hashSync(password, 10);
      const { rows } = await pool.query(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, active",
        [username, hash, role]
      );

      await logAction(req, "新增", "使用者", rows[0].id, `帳號 ${username},角色 ${role}`);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// 修改角色、停用/啟用、重設密碼(可一次改多項)
router.patch(
  "/:id",
  validateBody({
    role: { enum: ["admin", "dispatcher"], label: "角色" },
    password: { type: "string", label: "密碼" },
  }),
  async (req, res, next) => {
    try {
      const targetId = Number(req.params.id);
      const { role, password, active } = req.body || {};

      if (active !== undefined && typeof active !== "boolean") {
        return res.status(400).json({ error: "active 必須是 true 或 false" });
      }
      if (role === undefined && password === undefined && active === undefined) {
        return res.status(400).json({ error: "沒有要修改的欄位" });
      }
      if (password !== undefined && password.length < MIN_PASSWORD) {
        return res.status(400).json({ error: `密碼長度至少 ${MIN_PASSWORD} 碼` });
      }

      const found = await pool.query("SELECT * FROM users WHERE id = $1", [targetId]);
      if (!found.rows.length) return res.status(404).json({ error: "找不到此使用者" });
      const target = found.rows[0];

      const newRole = role ?? target.role;
      const newActive = active ?? target.active;
      const losesAdmin = target.role === "admin" && target.active && (newRole !== "admin" || !newActive);

      if (targetId === req.user.sub && losesAdmin) {
        return res.status(400).json({ error: "不可停用自己或取消自己的管理員身分" });
      }
      if (losesAdmin && (await countActiveAdmins()) <= 1) {
        return res.status(400).json({ error: "至少需保留一位啟用中的管理員" });
      }

      const hash = password !== undefined ? bcrypt.hashSync(password, 10) : target.password_hash;
      const { rows } = await pool.query(
        `UPDATE users SET role = $1, active = $2, password_hash = $3 WHERE id = $4
         RETURNING id, username, role, active`,
        [newRole, newActive, hash, targetId]
      );

      const changes = [];
      if (role !== undefined && role !== target.role) changes.push(`角色 ${target.role} → ${role}`);
      if (active !== undefined && active !== target.active) changes.push(active ? "啟用帳號" : "停用帳號");
      if (password !== undefined) changes.push("重設密碼");
      await logAction(req, "修改", "使用者", targetId, `${target.username}:${changes.join("、") || "無變更"}`);

      res.json(rows[0]);
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

    const target = await pool.query("SELECT * FROM users WHERE id = $1", [targetId]);
    if (!target.rows.length) return res.status(404).json({ error: "找不到此使用者" });

    if (target.rows[0].role === "admin" && target.rows[0].active && (await countActiveAdmins()) <= 1) {
      return res.status(400).json({ error: "至少需保留一位啟用中的管理員" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [targetId]);
    await logAction(req, "刪除", "使用者", targetId, `帳號 ${target.rows[0].username}`);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
