const express = require("express");
const { pool } = require("../db");
const { pushDispatchList, pushMessage, isConfigured } = require("../line");
const { getSettings } = require("../settings");
const { serializeOrder } = require("../orderService");
const { todayInTaipei, addDays } = require("../dates");

const router = express.Router();

function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: "伺服器未設定 CRON_SECRET" });
  if (req.headers["x-cron-secret"] !== secret) return res.status(401).json({ error: "未授權" });
  next();
}

router.use(requireCronSecret);

async function currentResources() {
  const [d, v] = await Promise.all([pool.query("SELECT * FROM drivers"), pool.query("SELECT * FROM vehicles")]);
  return { drivers: d.rows, vehicles: v.rows };
}

// 每日報表:待派車清單(附編號,方便司機直接回「N號完成」)+ 今日統計
router.post("/daily", async (req, res, next) => {
  try {
    if (!isConfigured()) return res.status(400).json({ error: "尚未設定 LINE 頻道" });

    const today = todayInTaipei();
    const { rows } = await pool.query("SELECT * FROM orders WHERE status IN ('待派車','已派車','執行中') ORDER BY time");
    const { rows: allToday } = await pool.query("SELECT status FROM orders WHERE time LIKE $1", [today + "%"]);
    const { drivers, vehicles } = await currentResources();

    const stats = `今日訂單 ${allToday.length}　待派車 ${allToday.filter(o => o.status === "待派車").length}　已完成 ${allToday.filter(o => o.status === "已完成").length}`;

    const result = await pushDispatchList(rows.map(serializeOrder), drivers, vehicles, {
      title: "每日調派報表",
      footer: stats,
    });
    if (result.error) return res.status(400).json({ error: result.error });

    res.json({ sent: rows.length, groups: result.sentTo });
  } catch (err) {
    next(err);
  }
});

// 每週報表:過去 7 天新增/完成統計,加上目前仍待派車清單
router.post("/weekly", async (req, res, next) => {
  try {
    if (!isConfigured()) return res.status(400).json({ error: "尚未設定 LINE 頻道" });

    const since = addDays(todayInTaipei(), -7);
    const { rows: recent } = await pool.query("SELECT status, dispatch_type, carrier FROM orders WHERE time >= $1", [since]);
    const { rows: pending } = await pool.query("SELECT * FROM orders WHERE status = '待派車' ORDER BY time");
    const { drivers, vehicles } = await currentResources();

    const byCarrier = {};
    recent.forEach((o) => { byCarrier[o.carrier || "未指定"] = (byCarrier[o.carrier || "未指定"] || 0) + 1; });
    const carrierLines = Object.entries(byCarrier).map(([c, n]) => `　${c}:${n} 筆`).join("\n");

    const footer = [
      `【本週統計】(近 7 天,共 ${recent.length} 筆)`,
      `已完成:${recent.filter((o) => o.status === "已完成").length}`,
      `船邊:${recent.filter((o) => o.dispatch_type === "船邊").length}　CY:${recent.filter((o) => o.dispatch_type === "CY").length}`,
      carrierLines,
    ].filter(Boolean).join("\n");

    const result = await pushDispatchList(pending.map(serializeOrder), drivers, vehicles, {
      title: "每週報表・目前待派車",
      footer,
    });
    if (result.error) return res.status(400).json({ error: result.error });

    res.json({ sent: pending.length, groups: result.sentTo });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
