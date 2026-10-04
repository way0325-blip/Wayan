const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");

const router = express.Router();

router.use(requireAuth);

const STAFF_TYPES = ["driver", "dispatcher"];
const STATUSES = ["出勤", "休假", "曠職"];
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

// 取某個月份的班表:回傳該類別的人員清單,以及當月所有已填寫的出勤紀錄
router.get("/", async (req, res, next) => {
  try {
    const staffType = req.query.type;
    const month = req.query.month;

    if (!STAFF_TYPES.includes(staffType)) {
      return res.status(400).json({ error: "type 必須是 driver 或 dispatcher" });
    }
    if (!MONTH_PATTERN.test(month || "")) {
      return res.status(400).json({ error: "month 格式需為 YYYY-MM" });
    }

    const staffQuery =
      staffType === "driver"
        ? "SELECT id, name, phone, status AS extra FROM drivers ORDER BY id"
        : "SELECT id, name, phone, active FROM dispatch_staff WHERE active = TRUE ORDER BY id";

    const [staff, records] = await Promise.all([
      pool.query(staffQuery),
      pool.query(
        "SELECT staff_id, date, status, note FROM attendance_records WHERE staff_type = $1 AND date LIKE $2",
        [staffType, month + "-%"]
      ),
    ]);

    res.json({ staff: staff.rows, records: records.rows });
  } catch (err) {
    next(err);
  }
});

// 設定(或清除)某一位人員、某一天的出勤狀態
router.put(
  "/",
  validateBody({
    staffType: { required: true, enum: STAFF_TYPES, label: "人員類別" },
    staffId: { required: true, type: "string", label: "人員編號" },
    date: { required: true, type: "date", label: "日期" },
  }),
  async (req, res, next) => {
    try {
      const { staffType, staffId, date, status } = req.body;
      const note = req.body.note || "";

      if (status !== undefined && status !== null && !STATUSES.includes(status)) {
        return res.status(400).json({ error: `status 必須是:${STATUSES.join("、")},或省略以清除紀錄` });
      }

      const table = staffType === "driver" ? "drivers" : "dispatch_staff";
      const exists = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [staffId]);
      if (!exists.rows.length) return res.status(404).json({ error: "找不到此人員" });

      if (!status) {
        await pool.query(
          "DELETE FROM attendance_records WHERE staff_type = $1 AND staff_id = $2 AND date = $3",
          [staffType, staffId, date]
        );
        await logAction(req, "清除", "出勤紀錄", staffId, date);
        return res.json({ staffType, staffId, date, status: null });
      }

      const { rows } = await pool.query(
        `INSERT INTO attendance_records (staff_type, staff_id, date, status, note, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (staff_type, staff_id, date)
         DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING *`,
        [staffType, staffId, date, status, note, req.user.username]
      );

      await logAction(req, "設定", "出勤紀錄", staffId, `${date} → ${status}`);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
