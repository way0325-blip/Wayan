const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.use(requireAuth);

router.get("/", (req, res) => {
  const drivers = db.prepare("SELECT * FROM drivers ORDER BY id").all();
  res.json(drivers);
});

router.post("/", (req, res) => {
  const { name, phone, license } = req.body || {};

  if (!name || !phone || !license) {
    return res.status(400).json({ error: "姓名、手機、證照期限為必填" });
  }

  const id = "D" + String(Date.now()).slice(-5);

  db.prepare(
    "INSERT INTO drivers (id, name, phone, license, status) VALUES (?, ?, ?, ?, '可派車')"
  ).run(id, name, phone, license);

  const driver = db.prepare("SELECT * FROM drivers WHERE id = ?").get(id);
  res.status(201).json(driver);
});

module.exports = router;
