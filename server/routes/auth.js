const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { generateToken } = require("../auth");
const { validateBody } = require("../validation");

const router = express.Router();

router.post(
  "/login",
  validateBody({
    username: { required: true, type: "string", label: "帳號" },
    password: { required: true, type: "string", label: "密碼" },
  }),
  async (req, res, next) => {
    try {
      const { username, password } = req.body;

      const { rows } = await pool.query(
        "SELECT * FROM users WHERE username = $1",
        [username]
      );
      const user = rows[0];

      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: "帳號或密碼錯誤" });
      }

      const token = generateToken(user);
      res.json({ token, username: user.username, role: user.role });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
