const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.use(requireAuth);

router.get("/", (req, res) => {
  const vehicles = db.prepare("SELECT * FROM vehicles ORDER BY id").all();
  res.json(vehicles);
});

router.post("/", (req, res) => {
  const { plate, type, maintenance } = req.body || {};

  if (!plate || !type || !maintenance) {
    return res.status(400).json({ error: "車牌、車型、下次保養日期為必填" });
  }

  const id = "V" + String(Date.now()).slice(-5);

  db.prepare(
    "INSERT INTO vehicles (id, plate, type, maintenance, status) VALUES (?, ?, ?, ?, '可用')"
  ).run(id, plate, type, maintenance);

  const vehicle = db.prepare("SELECT * FROM vehicles WHERE id = ?").get(id);
  res.status(201).json(vehicle);
});

module.exports = router;
