const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");
const { getSettings } = require("../settings");

const router = express.Router();

router.use(requireAuth);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TRUCKS = 200;
const MAX_IMPORT_ROWS = 500;

// ---------- 小工具 ----------

// 嚴格的整數檢查:空字串、布林、小數、超出範圍都回傳 null
function intInRange(value, min, max) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// 只接受真的存在的日期(2026-02-31 這種會被擋掉)
function validDate(s) {
  if (typeof s !== "string" || !DATE_PATTERN.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const clean = (v) => String(v ?? "").trim();

// LINE 連結只接受 https 的 line.me / *.line.me / lin.ee。
// 這個值會被放進網頁的超連結,所以必須擋掉 javascript:、http:、帶帳密、仿冒網域(line.me.evil.com)。
function lineLinkError(value) {
  if (!value) return null; // 空白 = 清除
  if (value.length > 300) return "LINE 連結不可超過 300 字";
  let url;
  try { url = new URL(value); } catch { return "LINE 連結格式不正確,請貼上完整網址(https://...)"; }
  const hostOk = url.hostname === "line.me" || url.hostname.endsWith(".line.me") || url.hostname === "lin.ee";
  if (url.protocol !== "https:" || !hostOk || url.username || url.password || url.port) {
    return "LINE 連結只接受 https 開頭的 LINE 官方網址(line.me 或 lin.ee)";
  }
  return null;
}

async function vehicleTypeError(type) {
  const { shopee_vehicle_types } = await getSettings();
  return shopee_vehicle_types.includes(type)
    ? null
    : `車型必須是:${shopee_vehicle_types.join("、")}`;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- 需求(路線)----------

const ROUTE_SUMMARY_SQL = `
  SELECT r.*,
    COALESCE(SUM(CASE WHEN a.status = '已確認' THEN a.confirmed_trucks END), 0)::int AS confirmed_trucks,
    COALESCE(SUM(CASE WHEN a.status = '待回覆' THEN a.requested_trucks END), 0)::int AS pending_trucks
  FROM shopee_routes r
  LEFT JOIN shopee_assignments a ON a.route_id = r.id
`;

function serializeRoute(row) {
  const shortage = Math.max(row.required_trucks - row.confirmed_trucks, 0);
  return {
    id: row.id,
    serviceDate: row.service_date,
    origin: row.origin,
    destination: row.destination,
    routeName: `${row.origin}→${row.destination}`,
    vehicleType: row.vehicle_type,
    requiredTrucks: row.required_trucks,
    confirmedTrucks: row.confirmed_trucks,
    pendingTrucks: row.pending_trucks,
    shortage,
    status: shortage === 0 ? "已補滿" : row.pending_trucks > 0 ? "待車隊回覆" : "待分派",
    note: row.note,
  };
}

async function getRouteSummary(db, id) {
  const { rows } = await db.query(`${ROUTE_SUMMARY_SQL} WHERE r.id = $1 GROUP BY r.id`, [id]);
  return rows[0] ? serializeRoute(rows[0]) : null;
}

// 驗證單筆需求資料,回傳 { value, problems }
async function normalizeRouteInput(raw, types) {
  const value = {
    serviceDate: clean(raw.serviceDate),
    origin: clean(raw.origin),
    destination: clean(raw.destination),
    vehicleType: clean(raw.vehicleType),
    requiredTrucks: intInRange(raw.requiredTrucks, 1, MAX_TRUCKS),
    note: clean(raw.note),
  };
  const problems = [];
  if (!validDate(value.serviceDate)) problems.push("日期格式需為 YYYY-MM-DD 且必須是存在的日期");
  if (!value.origin || value.origin.length > 50) problems.push("起點必填,且不可超過 50 字");
  if (!value.destination || value.destination.length > 50) problems.push("終點必填,且不可超過 50 字");
  if (!types.includes(value.vehicleType)) problems.push(`車型必須是:${types.join("、")}`);
  if (value.requiredTrucks === null) problems.push(`車數必須是 1 到 ${MAX_TRUCKS} 的整數`);
  if (value.note.length > 200) problems.push("備註不可超過 200 字");
  return { value, problems };
}

router.get("/routes", async (req, res, next) => {
  try {
    const date = req.query.date ? String(req.query.date) : null;
    if (date && !validDate(date)) return res.status(400).json({ error: "date 格式需為 YYYY-MM-DD" });

    const { rows } = await pool.query(
      `${ROUTE_SUMMARY_SQL}
       WHERE ($1::text IS NULL OR r.service_date = $1::text)
       GROUP BY r.id
       ORDER BY r.service_date, r.origin, r.destination, r.vehicle_type, r.id`,
      [date]
    );
    res.json(rows.map(serializeRoute));
  } catch (err) {
    next(err);
  }
});

router.post("/routes", async (req, res, next) => {
  try {
    const { shopee_vehicle_types } = await getSettings();
    const { value, problems } = await normalizeRouteInput(req.body || {}, shopee_vehicle_types);
    if (problems.length) return res.status(400).json({ error: "輸入驗證失敗", details: problems });

    const id = "S" + Date.now();
    await pool.query(
      `INSERT INTO shopee_routes (id, service_date, origin, destination, vehicle_type, required_trucks, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, value.serviceDate, value.origin, value.destination, value.vehicleType, value.requiredTrucks, value.note]
    );

    await logAction(req, "新增", "蝦皮需求", id, `${value.serviceDate} ${value.origin}→${value.destination} ${value.vehicleType}×${value.requiredTrucks}`);
    res.status(201).json(await getRouteSummary(pool, id));
  } catch (err) {
    next(err);
  }
});

// 批次匯入(CSV):整批先驗證,任何一列有錯就整批不寫入
router.post("/routes/import", async (req, res, next) => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "沒有可匯入的資料" });
    if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `一次最多匯入 ${MAX_IMPORT_ROWS} 筆` });

    const { shopee_vehicle_types } = await getSettings();
    const errors = [];
    const parsed = [];
    for (let i = 0; i < rows.length; i++) {
      const { value, problems } = await normalizeRouteInput(rows[i] || {}, shopee_vehicle_types);
      if (problems.length) errors.push({ row: i + 1, problems });
      parsed.push(value);
    }
    if (errors.length) {
      return res.status(400).json({ error: "匯入失敗,請修正下列資料後重試(本次未寫入任何資料)", details: errors });
    }

    const base = Date.now();
    await withTransaction(async (client) => {
      for (let i = 0; i < parsed.length; i++) {
        const v = parsed[i];
        await client.query(
          `INSERT INTO shopee_routes (id, service_date, origin, destination, vehicle_type, required_trucks, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`S${base}${String(i).padStart(3, "0")}`, v.serviceDate, v.origin, v.destination, v.vehicleType, v.requiredTrucks, v.note]
        );
      }
    });

    await logAction(req, "批次匯入", "蝦皮需求", null, `共 ${parsed.length} 筆`);
    res.status(201).json({ imported: parsed.length });
  } catch (err) {
    next(err);
  }
});

router.patch("/routes/:id", async (req, res, next) => {
  try {
    const found = await pool.query("SELECT * FROM shopee_routes WHERE id = $1", [req.params.id]);
    if (!found.rows.length) return res.status(404).json({ error: "找不到此需求" });
    const current = found.rows[0];

    const { shopee_vehicle_types } = await getSettings();
    const merged = {
      serviceDate: req.body?.serviceDate ?? current.service_date,
      origin: req.body?.origin ?? current.origin,
      destination: req.body?.destination ?? current.destination,
      vehicleType: req.body?.vehicleType ?? current.vehicle_type,
      requiredTrucks: req.body?.requiredTrucks ?? current.required_trucks,
      note: req.body?.note ?? current.note,
    };
    const { value, problems } = await normalizeRouteInput(merged, shopee_vehicle_types);
    if (problems.length) return res.status(400).json({ error: "輸入驗證失敗", details: problems });

    // 已經發出車隊需求後,改日期/路線/車型會讓既有的分派失去意義,必須先清掉分派
    const identityChanged =
      value.serviceDate !== current.service_date ||
      value.origin !== current.origin ||
      value.destination !== current.destination ||
      value.vehicleType !== current.vehicle_type;
    if (identityChanged) {
      const has = await pool.query("SELECT 1 FROM shopee_assignments WHERE route_id = $1 LIMIT 1", [current.id]);
      if (has.rows.length) {
        return res.status(409).json({ error: "此需求已有車隊分派,不能修改日期、路線或車型;請先移除分派,或只修改車數與備註" });
      }
    }

    await pool.query(
      `UPDATE shopee_routes SET service_date = $1, origin = $2, destination = $3, vehicle_type = $4,
         required_trucks = $5, note = $6 WHERE id = $7`,
      [value.serviceDate, value.origin, value.destination, value.vehicleType, value.requiredTrucks, value.note, current.id]
    );

    await logAction(req, "修改", "蝦皮需求", current.id, `${value.origin}→${value.destination} ${value.vehicleType}×${value.requiredTrucks}`);
    res.json(await getRouteSummary(pool, current.id));
  } catch (err) {
    next(err);
  }
});

router.delete("/routes/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM shopee_routes WHERE id = $1 RETURNING origin, destination", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "找不到此需求" });
    await logAction(req, "刪除", "蝦皮需求", req.params.id, `${result.rows[0].origin}→${result.rows[0].destination}`);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------- 候選車隊與分派 ----------

const CANDIDATE_SQL = `
  SELECT f.id, f.name, f.contact_name, f.phone, f.line_link, f.daily_capacity, fr.max_trucks,
         a.id AS assignment_id, a.requested_trucks, a.confirmed_trucks, a.status AS assignment_status
  FROM shopee_routes r
  JOIN fleet_routes fr ON fr.origin = r.origin AND fr.destination = r.destination
                      AND fr.vehicle_type = r.vehicle_type AND fr.active = TRUE
  JOIN partner_fleets f ON f.id = fr.fleet_id AND f.status = '啟用'
  LEFT JOIN shopee_assignments a ON a.route_id = r.id AND a.fleet_id = f.id
`;

// 某車隊在某天已經被要求(或已確認)的車數;已拒絕的不算,已確認的以確認車數為準
async function fleetUsedTrucks(db, fleetId, date, excludeRouteId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN a.status = '已確認' THEN a.confirmed_trucks ELSE a.requested_trucks END), 0)::int AS used
     FROM shopee_assignments a JOIN shopee_routes r ON r.id = a.route_id
     WHERE a.fleet_id = $1 AND r.service_date = $2 AND a.status <> '已拒絕' AND a.route_id <> $3`,
    [fleetId, date, excludeRouteId]
  );
  return rows[0].used;
}

function serializeCandidate(row, usedElsewhere) {
  return {
    fleetId: row.id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    lineLink: row.line_link,
    maxTrucks: row.max_trucks,
    dailyCapacity: row.daily_capacity,
    usedOnOtherRoutes: usedElsewhere,
    availableTrucks:
      row.daily_capacity > 0 ? Math.max(Math.min(row.max_trucks, row.daily_capacity - usedElsewhere), 0) : row.max_trucks,
    assignmentId: row.assignment_id,
    requestedTrucks: row.requested_trucks || 0,
    confirmedTrucks: row.confirmed_trucks || 0,
    assignmentStatus: row.assignment_status || null,
  };
}

router.get("/routes/:id/candidates", async (req, res, next) => {
  try {
    const route = await pool.query("SELECT * FROM shopee_routes WHERE id = $1", [req.params.id]);
    if (!route.rows.length) return res.status(404).json({ error: "找不到此需求" });

    const { rows } = await pool.query(`${CANDIDATE_SQL} WHERE r.id = $1 ORDER BY f.name`, [req.params.id]);
    const candidates = [];
    for (const row of rows) {
      const used = await fleetUsedTrucks(pool, row.id, route.rows[0].service_date, req.params.id);
      candidates.push(serializeCandidate(row, used));
    }
    res.json({ route: await getRouteSummary(pool, req.params.id), candidates });
  } catch (err) {
    next(err);
  }
});

// 「發送需求」:設定各車隊被要求的車數(整批驗證,有錯就整批不寫入)
router.put("/routes/:id/assignments", async (req, res, next) => {
  try {
    const route = (await pool.query("SELECT * FROM shopee_routes WHERE id = $1", [req.params.id])).rows[0];
    if (!route) return res.status(404).json({ error: "找不到此需求" });

    const items = req.body?.assignments;
    if (!Array.isArray(items) || !items.length || items.length > 50) {
      return res.status(400).json({ error: "assignments 必須是 1 到 50 筆的清單" });
    }

    const invalid = []; // 請求本身格式不對 → 400
    const problems = []; // 業務規則不允許(不是候選車隊、超過上限…)→ 409
    const seen = new Set();
    const plan = [];

    for (const item of items) {
      const fleetId = clean(item?.fleetId);
      const n = intInRange(item?.requestedTrucks, 1, MAX_TRUCKS);
      if (!fleetId || n === null) { invalid.push("每一筆都需要 fleetId 與 1 以上的整數車數"); continue; }
      if (seen.has(fleetId)) { invalid.push(`車隊 ${fleetId} 重複出現`); continue; }
      seen.add(fleetId);

      const { rows } = await pool.query(
        `SELECT f.name, f.daily_capacity, fr.max_trucks
         FROM fleet_routes fr JOIN partner_fleets f ON f.id = fr.fleet_id
         WHERE fr.fleet_id = $1 AND fr.origin = $2 AND fr.destination = $3 AND fr.vehicle_type = $4
           AND fr.active = TRUE AND f.status = '啟用'`,
        [fleetId, route.origin, route.destination, route.vehicle_type]
      );
      if (!rows.length) { problems.push(`車隊 ${fleetId} 沒有承接此路線/車型的設定,或已停用`); continue; }
      const cap = rows[0];
      if (n > cap.max_trucks) { problems.push(`${cap.name} 這條路線最多 ${cap.max_trucks} 車,不能要求 ${n} 車`); continue; }
      if (cap.daily_capacity > 0) {
        const used = await fleetUsedTrucks(pool, fleetId, route.service_date, route.id);
        if (used + n > cap.daily_capacity) {
          problems.push(`${cap.name} 當天上限 ${cap.daily_capacity} 車,其他路線已用 ${used} 車,不能再要求 ${n} 車`);
          continue;
        }
      }
      plan.push({ fleetId, n, name: cap.name });
    }

    if (invalid.length) return res.status(400).json({ error: "輸入驗證失敗,本次未寫入任何資料", details: invalid });
    if (problems.length) return res.status(409).json({ error: "分派失敗,本次未寫入任何資料", details: problems });

    await withTransaction(async (client) => {
      for (const p of plan) {
        // 要求車數沒變就保留車隊的回覆;車數變了,車隊需要重新確認
        await client.query(
          `INSERT INTO shopee_assignments (route_id, fleet_id, requested_trucks, status)
           VALUES ($1, $2, $3, '待回覆')
           ON CONFLICT (route_id, fleet_id) DO UPDATE SET
             requested_trucks = EXCLUDED.requested_trucks,
             confirmed_trucks = CASE WHEN shopee_assignments.requested_trucks = EXCLUDED.requested_trucks
                                     THEN shopee_assignments.confirmed_trucks ELSE 0 END,
             status = CASE WHEN shopee_assignments.requested_trucks = EXCLUDED.requested_trucks
                           THEN shopee_assignments.status ELSE '待回覆' END,
             updated_at = NOW()`,
          [route.id, p.fleetId, p.n]
        );
      }
    });

    await logAction(req, "發送需求", "蝦皮承接", route.id, plan.map((p) => `${p.name}×${p.n}`).join("、"));
    res.json({ route: await getRouteSummary(pool, route.id) });
  } catch (err) {
    next(err);
  }
});

// 登記車隊回覆:承接幾車(0 = 拒絕),或重設為待回覆
router.patch("/assignments/:id", async (req, res, next) => {
  try {
    const found = await pool.query(
      `SELECT a.*, f.name AS fleet_name FROM shopee_assignments a JOIN partner_fleets f ON f.id = a.fleet_id WHERE a.id = $1`,
      [req.params.id]
    );
    if (!found.rows.length) return res.status(404).json({ error: "找不到此分派" });
    const a = found.rows[0];

    if (req.body?.reset === true) {
      await pool.query(
        "UPDATE shopee_assignments SET confirmed_trucks = 0, status = '待回覆', updated_at = NOW() WHERE id = $1",
        [a.id]
      );
      await logAction(req, "重設回覆", "蝦皮承接", a.route_id, a.fleet_name);
    } else {
      const n = intInRange(req.body?.confirmedTrucks, 0, a.requested_trucks);
      if (n === null) {
        return res.status(400).json({ error: `承接車數必須是 0 到 ${a.requested_trucks} 的整數(0 代表拒絕)` });
      }
      await pool.query(
        "UPDATE shopee_assignments SET confirmed_trucks = $1, status = $2, updated_at = NOW() WHERE id = $3",
        [n, n > 0 ? "已確認" : "已拒絕", a.id]
      );
      await logAction(req, n > 0 ? "確認承接" : "拒絕承接", "蝦皮承接", a.route_id, `${a.fleet_name} ${n}/${a.requested_trucks} 車`);
    }
    res.json({ route: await getRouteSummary(pool, a.route_id) });
  } catch (err) {
    next(err);
  }
});

router.delete("/assignments/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM shopee_assignments WHERE id = $1
       RETURNING route_id, fleet_id, requested_trucks`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "找不到此分派" });
    const a = result.rows[0];
    await logAction(req, "移除分派", "蝦皮承接", a.route_id, `${a.fleet_id} ${a.requested_trucks} 車`);
    res.json({ route: await getRouteSummary(pool, a.route_id) });
  } catch (err) {
    next(err);
  }
});

// 自動分派:把「還沒被要求」的缺口,依各車隊可承接上限由大到小補滿,結果仍是「待回覆」
router.post("/routes/:id/auto-assign", async (req, res, next) => {
  try {
    const route = (await pool.query("SELECT * FROM shopee_routes WHERE id = $1", [req.params.id])).rows[0];
    if (!route) return res.status(404).json({ error: "找不到此需求" });

    const summary = await getRouteSummary(pool, route.id);
    let need = summary.requiredTrucks - summary.confirmedTrucks - summary.pendingTrucks;
    if (need <= 0) {
      return res.json({ created: [], uncovered: 0, route: summary, message: "已確認與待回覆的車數已經足夠,不需再分派" });
    }

    const { rows } = await pool.query(
      `${CANDIDATE_SQL} WHERE r.id = $1 AND a.id IS NULL ORDER BY fr.max_trucks DESC, f.name`,
      [route.id]
    );

    const created = [];
    await withTransaction(async (client) => {
      for (const c of rows) {
        if (need <= 0) break;
        let take = Math.min(c.max_trucks, need);
        if (c.daily_capacity > 0) {
          const used = await fleetUsedTrucks(client, c.id, route.service_date, route.id);
          take = Math.min(take, c.daily_capacity - used);
        }
        if (take <= 0) continue;
        await client.query(
          "INSERT INTO shopee_assignments (route_id, fleet_id, requested_trucks, status) VALUES ($1, $2, $3, '待回覆')",
          [route.id, c.id, take]
        );
        created.push({ fleetId: c.id, name: c.name, requestedTrucks: take });
        need -= take;
      }
    });

    if (created.length) {
      await logAction(req, "自動分派", "蝦皮承接", route.id, created.map((c) => `${c.name}×${c.requestedTrucks}`).join("、"));
    }
    res.json({ created, uncovered: need, route: await getRouteSummary(pool, route.id) });
  } catch (err) {
    next(err);
  }
});

// ---------- 夥伴車隊 ----------

function serializeFleet(row, routes) {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    lineLink: row.line_link,
    dailyCapacity: row.daily_capacity,
    status: row.status,
    note: row.note,
    routes: routes.map((r) => ({
      id: r.id,
      origin: r.origin,
      destination: r.destination,
      vehicleType: r.vehicle_type,
      maxTrucks: r.max_trucks,
      active: r.active,
    })),
  };
}

router.get("/fleets", async (req, res, next) => {
  try {
    const [fleets, routes] = await Promise.all([
      pool.query("SELECT * FROM partner_fleets ORDER BY id"),
      pool.query("SELECT * FROM fleet_routes ORDER BY origin, destination, vehicle_type"),
    ]);
    res.json(fleets.rows.map((f) => serializeFleet(f, routes.rows.filter((r) => r.fleet_id === f.id))));
  } catch (err) {
    next(err);
  }
});

// 某車隊被要求的所有任務(供「任務訊息」勾選);可用 ?date= 只看某一天
router.get("/fleets/:id/tasks", async (req, res, next) => {
  try {
    const date = req.query.date ? String(req.query.date) : null;
    if (date && !validDate(date)) return res.status(400).json({ error: "date 格式需為 YYYY-MM-DD" });

    const fleet = await pool.query("SELECT id, name, line_link FROM partner_fleets WHERE id = $1", [req.params.id]);
    if (!fleet.rows.length) return res.status(404).json({ error: "找不到此車隊" });

    const { rows } = await pool.query(
      `SELECT a.id, a.route_id, r.service_date, r.origin, r.destination, r.vehicle_type,
              a.requested_trucks, a.confirmed_trucks, a.status
       FROM shopee_assignments a JOIN shopee_routes r ON r.id = a.route_id
       WHERE a.fleet_id = $1 AND ($2::text IS NULL OR r.service_date = $2::text)
       ORDER BY r.service_date, r.origin, r.destination, r.vehicle_type, a.id`,
      [req.params.id, date]
    );
    res.json({
      fleet: { id: fleet.rows[0].id, name: fleet.rows[0].name, lineLink: fleet.rows[0].line_link },
      tasks: rows.map((t) => ({
        assignmentId: t.id,
        routeId: t.route_id,
        serviceDate: t.service_date,
        origin: t.origin,
        destination: t.destination,
        vehicleType: t.vehicle_type,
        requestedTrucks: t.requested_trucks,
        confirmedTrucks: t.confirmed_trucks,
        status: t.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const fleetSchema = {
  name: { required: true, type: "string", maxLength: 50, label: "車隊名稱" },
  contactName: { type: "string", maxLength: 50, label: "聯絡人" },
  phone: { type: "string", maxLength: 30, label: "電話" },
  lineLink: { type: "string", maxLength: 300, label: "LINE 連結" },
  note: { type: "string", maxLength: 200, label: "備註" },
};

router.post("/fleets", validateBody(fleetSchema), async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const capacity = req.body.dailyCapacity === undefined ? 0 : intInRange(req.body.dailyCapacity, 0, 1000);
    if (capacity === null) return res.status(400).json({ error: "單日車數上限必須是 0 到 1000 的整數(0 代表不限)" });

    const lineLink = clean(req.body.lineLink);
    const linkErr = lineLinkError(lineLink);
    if (linkErr) return res.status(400).json({ error: linkErr });

    const dup = await pool.query("SELECT 1 FROM partner_fleets WHERE LOWER(name) = LOWER($1)", [name]);
    if (dup.rows.length) return res.status(409).json({ error: "已有同名的車隊" });

    const id = "F" + String(Date.now()).slice(-8);
    const { rows } = await pool.query(
      `INSERT INTO partner_fleets (id, name, contact_name, phone, line_link, daily_capacity, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, name, clean(req.body.contactName), clean(req.body.phone), lineLink, capacity, clean(req.body.note)]
    );
    await logAction(req, "新增", "蝦皮車隊", id, name);
    res.status(201).json(serializeFleet(rows[0], []));
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/fleets/:id",
  validateBody({ ...fleetSchema, name: { type: "string", maxLength: 50, label: "車隊名稱" }, status: { enum: ["啟用", "停用"], label: "狀態" } }),
  async (req, res, next) => {
    try {
      const found = await pool.query("SELECT * FROM partner_fleets WHERE id = $1", [req.params.id]);
      if (!found.rows.length) return res.status(404).json({ error: "找不到此車隊" });
      const cur = found.rows[0];

      const name = req.body.name !== undefined ? clean(req.body.name) : cur.name;
      if (!name) return res.status(400).json({ error: "車隊名稱不可為空" });
      const capacity = req.body.dailyCapacity === undefined ? cur.daily_capacity : intInRange(req.body.dailyCapacity, 0, 1000);
      if (capacity === null) return res.status(400).json({ error: "單日車數上限必須是 0 到 1000 的整數(0 代表不限)" });

      const lineLink = req.body.lineLink !== undefined ? clean(req.body.lineLink) : cur.line_link;
      if (req.body.lineLink !== undefined) {
        const linkErr = lineLinkError(lineLink);
        if (linkErr) return res.status(400).json({ error: linkErr });
      }

      const dup = await pool.query("SELECT 1 FROM partner_fleets WHERE LOWER(name) = LOWER($1) AND id <> $2", [name, cur.id]);
      if (dup.rows.length) return res.status(409).json({ error: "已有同名的車隊" });

      const { rows } = await pool.query(
        `UPDATE partner_fleets SET name = $1, contact_name = $2, phone = $3, line_link = $4, daily_capacity = $5, status = $6, note = $7
         WHERE id = $8 RETURNING *`,
        [
          name,
          req.body.contactName !== undefined ? clean(req.body.contactName) : cur.contact_name,
          req.body.phone !== undefined ? clean(req.body.phone) : cur.phone,
          lineLink,
          capacity,
          req.body.status ?? cur.status,
          req.body.note !== undefined ? clean(req.body.note) : cur.note,
          cur.id,
        ]
      );
      const routes = await pool.query("SELECT * FROM fleet_routes WHERE fleet_id = $1 ORDER BY origin, destination", [cur.id]);
      await logAction(req, "修改", "蝦皮車隊", cur.id, name);
      res.json(serializeFleet(rows[0], routes.rows));
    } catch (err) {
      next(err);
    }
  }
);

router.delete("/fleets/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const used = await pool.query("SELECT 1 FROM shopee_assignments WHERE fleet_id = $1 LIMIT 1", [req.params.id]);
    if (used.rows.length) {
      return res.status(409).json({ error: "此車隊已有承接紀錄,不能刪除,請改為「停用」" });
    }
    const result = await pool.query("DELETE FROM partner_fleets WHERE id = $1 RETURNING name", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "找不到此車隊" });
    await logAction(req, "刪除", "蝦皮車隊", req.params.id, result.rows[0].name);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------- 車隊可承接路線 ----------

router.post("/fleets/:id/routes", async (req, res, next) => {
  try {
    const fleet = await pool.query("SELECT name FROM partner_fleets WHERE id = $1", [req.params.id]);
    if (!fleet.rows.length) return res.status(404).json({ error: "找不到此車隊" });

    const origin = clean(req.body?.origin);
    const destination = clean(req.body?.destination);
    const vehicleType = clean(req.body?.vehicleType);
    const maxTrucks = intInRange(req.body?.maxTrucks, 1, MAX_TRUCKS);

    const problems = [];
    if (!origin || origin.length > 50) problems.push("起點必填,且不可超過 50 字");
    if (!destination || destination.length > 50) problems.push("終點必填,且不可超過 50 字");
    const typeErr = await vehicleTypeError(vehicleType);
    if (typeErr) problems.push(typeErr);
    if (maxTrucks === null) problems.push(`可承接車數必須是 1 到 ${MAX_TRUCKS} 的整數`);
    if (problems.length) return res.status(400).json({ error: "輸入驗證失敗", details: problems });

    try {
      const { rows } = await pool.query(
        `INSERT INTO fleet_routes (fleet_id, origin, destination, vehicle_type, max_trucks)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.params.id, origin, destination, vehicleType, maxTrucks]
      );
      await logAction(req, "新增", "蝦皮車隊路線", req.params.id, `${fleet.rows[0].name} ${origin}→${destination} ${vehicleType}×${maxTrucks}`);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "這個車隊已經有相同的路線與車型" });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.patch("/fleet-routes/:rid", async (req, res, next) => {
  try {
    const found = await pool.query("SELECT * FROM fleet_routes WHERE id = $1", [req.params.rid]);
    if (!found.rows.length) return res.status(404).json({ error: "找不到此路線設定" });
    const cur = found.rows[0];

    let maxTrucks = cur.max_trucks;
    if (req.body?.maxTrucks !== undefined) {
      maxTrucks = intInRange(req.body.maxTrucks, 1, MAX_TRUCKS);
      if (maxTrucks === null) return res.status(400).json({ error: `可承接車數必須是 1 到 ${MAX_TRUCKS} 的整數` });
    }
    if (req.body?.active !== undefined && typeof req.body.active !== "boolean") {
      return res.status(400).json({ error: "active 必須是 true 或 false" });
    }
    const active = req.body?.active ?? cur.active;

    const { rows } = await pool.query(
      "UPDATE fleet_routes SET max_trucks = $1, active = $2 WHERE id = $3 RETURNING *",
      [maxTrucks, active, cur.id]
    );
    await logAction(req, "修改", "蝦皮車隊路線", cur.fleet_id, `${cur.origin}→${cur.destination} ${cur.vehicle_type} 上限${maxTrucks}${active ? "" : "(停用)"}`);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/fleet-routes/:rid", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM fleet_routes WHERE id = $1 RETURNING *", [req.params.rid]);
    if (!result.rowCount) return res.status(404).json({ error: "找不到此路線設定" });
    const r = result.rows[0];
    await logAction(req, "刪除", "蝦皮車隊路線", r.fleet_id, `${r.origin}→${r.destination} ${r.vehicle_type}`);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
