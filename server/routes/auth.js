const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { generateToken } = require("../auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "請輸入帳號與密碼" });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "帳號或密碼錯誤" });
  }

  const token = generateToken(user);
  res.json({ token, username: user.username });
});

module.exports = router;
