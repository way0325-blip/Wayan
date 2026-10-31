const express = require("express");
const crypto = require("node:crypto");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { logAction } = require("../audit");

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = [
  "賣家上收作業規範", "WH-NDD 日常作業規範", "NDD 日常作業規範",
  "門市作業規範", "門市場域規範", "理貨中心廠區工安規範",
  "理貨中心其他規範", "雙損與貨資", "客訴及服務態度",
];
const text = (v, max = 2000) => typeof v === "string" ? v.trim().slice(0, max) : "";
const fail = (res, message, status = 400) => res.status(status).json({ error: message });
const positiveId = (v) => /^\d+$/.test(String(v ?? "")) && Number(v) > 0 ? Number(v) : null;
const validDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

async function event(db, caseId, type, description, actor) {
  await db.query(
    "INSERT INTO shopee_violation_case_events(case_id,event_type,description,actor) VALUES($1,$2,$3,$4)",
    [caseId, type, description, actor]
  );
}
async function tx(fn) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const out = await fn(client); await client.query("COMMIT"); return out; }
  catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

router.get("/meta", (req, res) => res.json({ categories: CATEGORIES, role: req.user.role }));

// Rule versions and rule text are editable only by administrators.
router.get("/versions", requireRole("admin"), async (req, res, next) => {
  try { res.json((await pool.query("SELECT * FROM shopee_violation_rule_versions ORDER BY created_at DESC")).rows); }
  catch (e) { next(e); }
});
router.post("/versions", requireRole("admin"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = text(b.version_name, 100), source = text(b.source_document, 300);
    if (!name || !source || !validDate(b.effective_date)) return fail(res, "版本名稱、來源文件及有效生效日期必填");
    if (b.document_updated_at && !validDate(b.document_updated_at)) return fail(res, "文件更新日期格式錯誤");
    if (b.expiry_date && (!validDate(b.expiry_date) || b.expiry_date < b.effective_date)) return fail(res, "失效日期不得早於生效日期");
    const { rows } = await pool.query(
      "INSERT INTO shopee_violation_rule_versions(version_name,source_document,document_updated_at,effective_date,expiry_date,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [name, source, b.document_updated_at || null, b.effective_date, b.expiry_date || null, req.user.username]
    );
    await logAction(req, "建立違規規則版本", "蝦皮違規規則版本", rows[0].id, name);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
router.get("/rules", async (req, res, next) => {
  try {
    const admin = req.user.role === "admin";
    const { rows } = await pool.query(
      `SELECT r.*,v.version_name,v.effective_date,v.expiry_date,v.status AS version_status
       FROM shopee_violation_rules r JOIN shopee_violation_rule_versions v ON v.id=r.version_id
       WHERE ($1::boolean OR (r.verification_status='已核對' AND v.status='已核准'))
       ORDER BY v.created_at DESC,r.category,r.rule_code`, [admin]
    );
    res.json(rows);
  } catch (e) { next(e); }
});
router.post("/rules", requireRole("admin"), async (req, res, next) => {
  try {
    const b = req.body || {}, versionId = positiveId(b.version_id), code = text(b.rule_code, 60);
    const category = text(b.category, 100), ruleText = text(b.rule_text, 3000);
    const page = Number(b.source_page);
    if (!versionId || !code || !CATEGORIES.includes(category) || !ruleText || !Number.isInteger(page) || page < 1)
      return fail(res, "版本、規則代碼、有效分類、條款原文及來源頁碼必填");
    const { rows } = await pool.query(
      "INSERT INTO shopee_violation_rules(version_id,rule_code,category,rule_text,applicable_to,source_page,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [versionId, code, category, ruleText, text(b.applicable_to, 100) || "待確認", page, req.user.username]
    );
    await logAction(req, "新增違規條款", "蝦皮違規條款", rows[0].id, code);
    res.status(201).json(rows[0]);
  } catch (e) { if (e.code === "23505") return fail(res, "此版本已有相同規則代碼"); next(e); }
});
router.patch("/rules/:id/verify", requireRole("admin"), async (req, res, next) => {
  try {
    const status = req.body?.verification_status;
    if (!["待核對", "已核對"].includes(status)) return fail(res, "核對狀態不正確");
    const { rows } = await pool.query(
      "UPDATE shopee_violation_rules SET verification_status=$1,verified_by=$2,verified_at=CASE WHEN $1='已核對' THEN NOW() ELSE NULL END WHERE id=$3 RETURNING *",
      [status, req.user.username, req.params.id]
    );
    if (!rows.length) return fail(res, "找不到條款", 404);
    await logAction(req, "更新條款核對狀態", "蝦皮違規條款", req.params.id, status);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
router.post("/versions/:id/approve", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await tx(async (db) => {
      const v = await db.query("SELECT * FROM shopee_violation_rule_versions WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!v.rows.length) return { error: "找不到規則版本", status: 404 };
      const pending = await db.query("SELECT COUNT(*)::int AS n FROM shopee_violation_rules WHERE version_id=$1 AND verification_status<>'已核對'", [req.params.id]);
      if (pending.rows[0].n) return { error: "仍有未核對條款，不能核准", status: 409 };
      const updated = await db.query(
        "UPDATE shopee_violation_rule_versions SET status='已核准',approved_by=$1,approved_at=NOW() WHERE id=$2 AND status IN ('草稿','待覆核') RETURNING *",
        [req.user.username, req.params.id]
      );
      if (!updated.rows.length) return { error: "版本狀態不可核准", status: 409 };
      return { row: updated.rows[0] };
    });
    if (result.error) return fail(res, result.error, result.status);
    await logAction(req, "核准違規規則版本", "蝦皮違規規則版本", req.params.id, result.row.version_name);
    res.json(result.row);
  } catch (e) { next(e); }
});

// Cases can be created by authenticated dispatchers; rules must already be verified and approved.
router.get("/cases", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,r.rule_code,r.category,r.rule_text,v.version_name,
        f.name AS fleet_name,d.name AS driver_name,o.container AS order_container,
        sr.origin AS shopee_origin,sr.destination AS shopee_destination
       FROM shopee_violation_cases c
       JOIN shopee_violation_rules r ON r.id=c.rule_id
       JOIN shopee_violation_rule_versions v ON v.id=c.rule_version_id
       LEFT JOIN partner_fleets f ON f.id=c.fleet_id
       LEFT JOIN drivers d ON d.id=c.driver_id
       LEFT JOIN orders o ON o.id=c.order_id
       LEFT JOIN shopee_routes sr ON sr.id=c.shopee_route_id
       ORDER BY c.event_at DESC,c.id DESC LIMIT 500`
    );
    res.json(rows);
  } catch (e) { next(e); }
});
router.post("/cases", async (req, res, next) => {
  try {
    const b = req.body || {}, fleetId = text(b.fleet_id, 80) || null, driverId = text(b.driver_id, 80) || null;
    const orderId = text(b.order_id, 100) || null, routeId = text(b.shopee_route_id, 100) || null;
    const assignmentId = b.assignment_id ? positiveId(b.assignment_id) : null, ruleId = positiveId(b.rule_id);
    const description = text(b.description, 3000), eventAt = b.event_at;
    if ((!fleetId && !driverId) || !ruleId || !description || !eventAt || Number.isNaN(Date.parse(eventAt)))
      return fail(res, "車隊或司機至少填一項，並填寫有效事件時間、已核准條款及事件描述");
    if (orderId && (routeId || assignmentId)) return fail(res, "港口車趟與蝦皮需求關聯不可同時填寫");
    if (assignmentId && !routeId) return fail(res, "選擇蝦皮分派紀錄時必須同時指定蝦皮路線");
    const result = await tx(async (db) => {
      const rule = await db.query(
        "SELECT r.id,r.version_id FROM shopee_violation_rules r JOIN shopee_violation_rule_versions v ON v.id=r.version_id WHERE r.id=$1 AND r.verification_status='已核對' AND v.status='已核准' AND v.effective_date <= $2::date AND (v.expiry_date IS NULL OR v.expiry_date >= $2::date)",
        [ruleId, String(eventAt).slice(0, 10)]
      );
      if (!rule.rows.length) return { error: "只能使用事件日期有效、已核對且已核准的規則", status: 400 };
      if (fleetId && !(await db.query("SELECT 1 FROM partner_fleets WHERE id=$1", [fleetId])).rowCount) return { error: "找不到指定車隊", status: 400 };
      if (driverId && !(await db.query("SELECT 1 FROM drivers WHERE id=$1", [driverId])).rowCount) return { error: "找不到指定司機", status: 400 };
      if (orderId && !(await db.query("SELECT 1 FROM orders WHERE id=$1", [orderId])).rowCount) return { error: "找不到指定港口車趟", status: 400 };
      if (routeId && !(await db.query("SELECT 1 FROM shopee_routes WHERE id=$1", [routeId])).rowCount) return { error: "找不到指定蝦皮路線", status: 400 };
      if (assignmentId && !(await db.query("SELECT 1 FROM shopee_assignments WHERE id=$1 AND route_id=$2", [assignmentId, routeId])).rowCount) return { error: "蝦皮分派紀錄與路線不符", status: 400 };
      const caseNo = "SV" + new Date().toISOString().replace(/\D/g, "").slice(0, 14) + crypto.randomBytes(3).toString("hex").toUpperCase();
      const { rows } = await db.query(
        `INSERT INTO shopee_violation_cases
         (case_no,event_at,fleet_id,driver_id,order_id,shopee_route_id,assignment_id,rule_id,rule_version_id,description,evidence_note,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [caseNo,eventAt,fleetId,driverId,orderId,routeId,assignmentId,ruleId,rule.rows[0].version_id,description,text(b.evidence_note,2000),req.user.username]
      );
      await event(db, rows[0].id, "建立案件", description, req.user.username);
      return { row: rows[0] };
    });
    if (result.error) return fail(res, result.error, result.status);
    await logAction(req, "建立蝦皮違規案件", "蝦皮違規案件", result.row.id, result.row.case_no);
    res.status(201).json(result.row);
  } catch (e) { next(e); }
});
router.get("/cases/:id/events", async (req, res, next) => {
  try {
    const exists = await pool.query("SELECT 1 FROM shopee_violation_cases WHERE id=$1", [req.params.id]);
    if (!exists.rowCount) return fail(res, "找不到案件", 404);
    res.json((await pool.query("SELECT * FROM shopee_violation_case_events WHERE case_id=$1 ORDER BY created_at,id", [req.params.id])).rows);
  } catch (e) { next(e); }
});
router.post("/cases/:id/review", requireRole("admin"), async (req, res, next) => {
  try {
    const decision = req.body?.decision, reason = text(req.body?.reason, 2000);
    if (!["待確認","全責","部分責任","無責"].includes(decision) || !reason) return fail(res, "責任判定及覆核理由必填");
    const row = await tx(async (db) => {
      const current = await db.query("SELECT * FROM shopee_violation_cases WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!current.rows.length) return null;
      const { rows } = await db.query(
        "UPDATE shopee_violation_cases SET responsibility=$1,review_reason=$2,reviewed_by=$3,reviewed_at=NOW(),status='已覆核',updated_at=NOW() WHERE id=$4 RETURNING *",
        [decision,reason,req.user.username,req.params.id]
      );
      await event(db, req.params.id, "主管責任覆核", decision + "：" + reason, req.user.username);
      return rows[0];
    });
    if (!row) return fail(res, "找不到案件", 404);
    await logAction(req, "主管覆核蝦皮違規案件", "蝦皮違規案件", req.params.id, decision);
    res.json(row);
  } catch (e) { next(e); }
});

// Appeals are append-only submissions; only admins can decide them.
router.post("/cases/:id/appeals", async (req, res, next) => {
  try {
    const appeal = text(req.body?.appeal_text, 3000);
    if (!appeal) return fail(res, "申訴內容必填");
    const result = await tx(async (db) => {
      const c = await db.query("SELECT id FROM shopee_violation_cases WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!c.rowCount) return null;
      const a = await db.query("INSERT INTO shopee_violation_appeals(case_id,appeal_text,created_by) VALUES($1,$2,$3) RETURNING *", [req.params.id,appeal,req.user.username]);
      await db.query("UPDATE shopee_violation_cases SET status='申訴中',updated_at=NOW() WHERE id=$1", [req.params.id]);
      await event(db, req.params.id, "提出申訴", appeal, req.user.username);
      return a.rows[0];
    });
    if (!result) return fail(res, "找不到案件", 404);
    await logAction(req, "提出蝦皮違規申訴", "蝦皮違規案件", req.params.id, "新增申訴");
    res.status(201).json(result);
  } catch (e) { next(e); }
});
router.get("/cases/:id/appeals", async (req, res, next) => {
  try { res.json((await pool.query("SELECT * FROM shopee_violation_appeals WHERE case_id=$1 ORDER BY created_at,id", [req.params.id])).rows); }
  catch (e) { next(e); }
});
router.patch("/appeals/:id/decision", requireRole("admin"), async (req, res, next) => {
  try {
    const status = req.body?.status, reason = text(req.body?.decision_reason, 2000);
    if (!["成立","部分成立","不成立"].includes(status) || !reason) return fail(res, "申訴結果及判定理由必填");
    const row = await tx(async (db) => {
      const a = await db.query("SELECT * FROM shopee_violation_appeals WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!a.rowCount) return null;
      const u = await db.query("UPDATE shopee_violation_appeals SET status=$1,decision_reason=$2,reviewed_by=$3,reviewed_at=NOW() WHERE id=$4 RETURNING *", [status,reason,req.user.username,req.params.id]);
      const caseStatus = status === "不成立" ? "已覆核" : "已結案";
      await db.query("UPDATE shopee_violation_cases SET status=$1,updated_at=NOW() WHERE id=$2", [caseStatus,a.rows[0].case_id]);
      await event(db, a.rows[0].case_id, "申訴審查", status + "：" + reason, req.user.username);
      return u.rows[0];
    });
    if (!row) return fail(res, "找不到申訴", 404);
    await logAction(req, "審查蝦皮違規申訴", "蝦皮違規申訴", req.params.id, status);
    res.json(row);
  } catch (e) { next(e); }
});

// Fine records are manual records only. No payment, deduction or payroll action is triggered.
router.get("/cases/:id/fines", async (req, res, next) => {
  try { res.json((await pool.query("SELECT * FROM shopee_violation_fines WHERE case_id=$1 ORDER BY created_at,id", [req.params.id])).rows); }
  catch (e) { next(e); }
});
router.post("/cases/:id/fines", requireRole("admin"), async (req, res, next) => {
  try {
    const b = req.body || {}, payer = b.payer_type, payee = text(b.payee, 100) || "蝦皮";
    const amount = Number(b.amount), reference = text(b.source_reference, 200);
    if (!["我方","合作車隊"].includes(payer) || !Number.isFinite(amount) || amount < 0 || amount > 100000000 || !reference)
      return fail(res, "開罰對象、有效金額及來源單號必填");
    const result = await tx(async (db) => {
      const c = await db.query("SELECT responsibility,status FROM shopee_violation_cases WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!c.rowCount) return null;
      if (c.rows[0].status === "申訴中" || !["全責","部分責任"].includes(c.rows[0].responsibility))
        return { error: "案件須先完成責任覆核，且責任為全責或部分責任，才能登記罰款", status: 409 };
      const f = await db.query(
        "INSERT INTO shopee_violation_fines(case_id,payer_type,payee,amount,source_reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [req.params.id,payer,payee,amount,reference,text(b.note,1000),req.user.username]
      );
      await event(db, req.params.id, "登記罰款明細", payer + "／" + payee + "／" + amount + "元（待人工確認）", req.user.username);
      return { row: f.rows[0] };
    });
    if (!result) return fail(res, "找不到案件", 404);
    if (result.error) return fail(res, result.error, result.status);
    await logAction(req, "登記蝦皮違規罰款明細", "蝦皮違規罰款", result.row.id, "待人工確認");
    res.status(201).json(result.row);
  } catch (e) { next(e); }
});
router.patch("/fines/:id/confirm", requireRole("admin"), async (req, res, next) => {
  try {
    const status = req.body?.status, note = text(req.body?.note, 1000);
    if (!["已確認","有爭議","已撤銷","已結清"].includes(status)) return fail(res, "罰款狀態不正確");
    const row = await tx(async (db) => {
      const f = await db.query("SELECT * FROM shopee_violation_fines WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!f.rowCount) return null;
      const u = await db.query("UPDATE shopee_violation_fines SET status=$1,confirmed_by=$2,confirmed_at=NOW(),note=CASE WHEN $3='' THEN note ELSE $3 END WHERE id=$4 RETURNING *", [status,req.user.username,note,req.params.id]);
      await event(db, f.rows[0].case_id, "人工確認罰款", status + (note ? "：" + note : ""), req.user.username);
      return u.rows[0];
    });
    if (!row) return fail(res, "找不到罰款明細", 404);
    await logAction(req, "人工確認蝦皮罰款", "蝦皮違規罰款", req.params.id, status);
    res.json(row);
  } catch (e) { next(e); }
});

module.exports = router;
