const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");

const router = express.Router();
router.use(requireAuth);

const EVENT_TYPES = ["遲到", "早退", "無故缺勤", "未依規定通報", "任務延誤", "漏送", "錯送", "貨損", "交通違規", "交通事故", "車輛管理", "其他"];
const REVIEW_STATUSES = ["待覆核", "已確認", "核准排除", "非司機因素"];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function latePoints(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) return 0;
  if (minutes <= 5) return 1;
  if (minutes <= 15) return 2;
  if (minutes <= 30) return 3;
  return 5;
}

router.get("/", async (req, res, next) => {
  try {
    const month = req.query.month;
    const period = req.query.period || "month";
    if (!MONTH_RE.test(month || "")) return res.status(400).json({ error: "month 格式需為 YYYY-MM" });
    if (!["month", "quarter", "year"].includes(period)) return res.status(400).json({ error: "period 必須是 month、quarter 或 year" });

    const [year, monthNumber] = month.split("-").map(Number);
    let startMonth = monthNumber;
    let endMonth;
    if (period === "quarter") {
      startMonth = Math.floor((monthNumber - 1) / 3) * 3 + 1;
      endMonth = startMonth + 3;
    } else if (period === "year") {
      startMonth = 1;
      endMonth = 13;
    } else {
      endMonth = startMonth + 1;
    }
    const startDate = `${year}-${String(startMonth).padStart(2, "0")}-01`;
    const endYear = year + (endMonth > 12 ? 1 : 0);
    const normalizedEndMonth = endMonth > 12 ? endMonth - 12 : endMonth;
    const endDate = `${endYear}-${String(normalizedEndMonth).padStart(2, "0")}-01`;

    const [summary, events] = await Promise.all([
      pool.query(
        `SELECT d.id AS driver_id, d.name,
          COUNT(e.id) FILTER (WHERE e.event_type = '遲到' AND e.review_status = '已確認')::int AS late_count,
          COALESCE(SUM(e.late_minutes) FILTER (WHERE e.event_type = '遲到' AND e.review_status = '已確認'), 0)::int AS late_minutes,
          COALESCE(SUM(e.points) FILTER (WHERE e.review_status = '已確認'), 0)::int AS confirmed_points,
          COUNT(e.id) FILTER (WHERE e.review_status = '待覆核')::int AS pending_count,
          COUNT(e.id) FILTER (WHERE e.review_status IN ('核准排除', '非司機因素'))::int AS excluded_count,
          COUNT(e.id)::int AS total_events
         FROM drivers d
         LEFT JOIN driver_performance_events e
           ON e.driver_id = d.id AND e.event_date >= $1::date AND e.event_date < $2::date
         GROUP BY d.id, d.name
         ORDER BY d.id`,
        [startDate, endDate]
      ),
      pool.query(
        `SELECT e.*, d.name AS driver_name
         FROM driver_performance_events e
         JOIN drivers d ON d.id = e.driver_id
         WHERE e.event_date >= $1::date AND e.event_date < $2::date
         ORDER BY e.event_date DESC, e.created_at DESC`,
        [startDate, endDate]
      ),
    ]);

    res.json({ month, period, startDate, endDate, summary: summary.rows, events: events.rows });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/events",
  validateBody({
    driverId: { required: true, type: "string", maxLength: 40, label: "司機" },
    eventType: { required: true, enum: EVENT_TYPES, label: "事件類型" },
    eventDate: { required: true, type: "date", label: "事件日期" },
    reason: { type: "string", maxLength: 300, label: "原因" },
    note: { type: "string", maxLength: 2000, label: "事件說明" },
  }),
  async (req, res, next) => {
    try {
      const { driverId, eventType, eventDate, reason = "", note = "" } = req.body;
      const scheduledTime = req.body.scheduledTime || null;
      const actualTime = req.body.actualTime || null;
      const excludedReason = req.body.excludedReason || "";

      const driver = await pool.query("SELECT id FROM drivers WHERE id = $1", [driverId]);
      if (!driver.rows.length) return res.status(404).json({ error: "找不到此司機" });

      const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      if ((scheduledTime && !timePattern.test(scheduledTime)) || (actualTime && !timePattern.test(actualTime))) {
        return res.status(400).json({ error: "時間格式請使用 HH:mm" });
      }

      let lateMinutes = 0;
      if (eventType === "遲到") {
        if (!scheduledTime || !actualTime) return res.status(400).json({ error: "遲到事件必須填寫預定時間及實際時間" });
        const toMinutes = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
        lateMinutes = Math.max(0, toMinutes(actualTime) - toMinutes(scheduledTime));
        if (lateMinutes <= 0) return res.status(400).json({ error: "實際時間未晚於預定時間，無法建立遲到紀錄" });
      }

      const points = eventType === "遲到" ? latePoints(lateMinutes) : (eventType === "無故缺勤" ? 8 : 0);
      const { rows } = await pool.query(
        `INSERT INTO driver_performance_events
          (driver_id, event_type, event_date, scheduled_time, actual_time, late_minutes, points,
           reason, note, excluded_reason, review_status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'待覆核',$11)
         RETURNING *`,
        [driverId, eventType, eventDate, scheduledTime, actualTime, lateMinutes, points, reason, note, excludedReason, req.user.username]
      );

      await pool.query(
        `INSERT INTO driver_performance_event_history
          (event_id, action, after_data, actor)
         VALUES ($1, '建立事件', $2::jsonb, $3)`,
        [rows[0].id, JSON.stringify(rows[0]), req.user.username]
      );
      await logAction(req, "新增", "司機績效事件", rows[0].id, `${driverId} ${eventType} ${eventDate}`);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.patch("/events/:id/review", requireRole("admin"), async (req, res, next) => {
  try {
    const { status, reviewNote = "" } = req.body || {};
    if (!REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ error: "覆核狀態不正確" });
    }
    if (status === "核准排除" && !String(reviewNote).trim()) {
      return res.status(400).json({ error: "核准排除時必須填寫原因" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM driver_performance_events WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (!found.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "找不到此事件" });
      }
      const before = found.rows[0];
      const updated = await client.query(
        `UPDATE driver_performance_events
         SET review_status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW()
         WHERE id = $4 RETURNING *`,
        [status, String(reviewNote).slice(0, 1000), req.user.username, req.params.id]
      );
      await client.query(
        `INSERT INTO driver_performance_event_history (event_id, action, before_data, after_data, actor)
         VALUES ($1, '主管覆核', $2::jsonb, $3::jsonb, $4)`,
        [req.params.id, JSON.stringify(before), JSON.stringify(updated.rows[0]), req.user.username]
      );
      await client.query("COMMIT");
      await logAction(req, "覆核", "司機績效事件", req.params.id, status);
      res.json(updated.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
