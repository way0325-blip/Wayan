const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { validateBody } = require("../validation");
const { logAction } = require("../audit");
const {transaction,audit}=require("../transaction");
const { getSettings } = require("../settings");
const { isPastDate, isValidDateKey } = require("../dates");
const { serializeOrder, findOrder, completeOrder } = require("../orderService");
const { pushDispatchList } = require("../line");

const router = express.Router();

router.use(requireAuth);

const ORDER_STATUSES = ["待派車", "已派車", "執行中", "已完成"];
// 調派類型:CY = 貨櫃場 → 客戶端;船邊 = 碼頭 → 貨櫃場
const DISPATCH_TYPES = ["CY", "船邊"];
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MAX_IMPORT_ROWS = 500;

// 任務:填 20 / 40 / HQ 各幾車,一次建立多筆訂單(每台車一筆)
const MAX_TASK_TRUCKS = 200;
const TASK_SIZES = [
  { key: "qty20", size: "20 呎", label: "20" },
  { key: "qty40", size: "40 呎", label: "40" },
  { key: "qtyHQ", size: "40HQ", label: "HQ" },
];

const clean = (v) => String(v ?? "").trim();

// 船名／航次可以不填,只要有船掛;沒填船名時用「船掛 xxx」當作列表上的船名
function effectiveShip(ship, shipCall) {
  return clean(ship) || (clean(shipCall) ? `船掛 ${clean(shipCall)}` : "");
}

// 車數:空白視為 0;只接受 0 到 MAX_TASK_TRUCKS 的整數,其餘回傳 null
function truckCount(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_TASK_TRUCKS ? n : null;
}

async function checkSize(size) {
  const { container_sizes } = await getSettings();
  return container_sizes.includes(size)
    ? null
    : `貨櫃尺寸必須是:${container_sizes.join("、")}`;
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY id");
    res.json(rows.map(serializeOrder));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  validateBody({
    ship: { type: "string", maxLength: 100, label: "船名／航次" },
    shipCall: { type: "string", maxLength: 30, label: "船掛" },
    container: { required: true, type: "string", maxLength: 30, label: "貨櫃編號" },
    from: { required: true, type: "string", maxLength: 100, label: "起點" },
    to: { required: true, type: "string", maxLength: 100, label: "終點" },
    time: { required: true, type: "date", label: "作業時間" },
    size: { required: true, type: "string", label: "貨櫃尺寸" },
    dispatchType: { required: true, enum: DISPATCH_TYPES, label: "調派類型" },
    carrier: { required: true, type: "string", maxLength: 30, label: "船商" },
  }),
  async (req, res, next) => {
    try {
      const { container, from, to, time, size, dispatchType } = req.body;
      const carrier = clean(req.body.carrier);
      const shipCall = clean(req.body.shipCall);
      const ship = effectiveShip(req.body.ship, shipCall);

      const problems = [];
      if (!ship) problems.push("請填船名／航次或船掛");
      if (!carrier) problems.push("船商必填");
      const sizeError = await checkSize(size);
      if (sizeError) problems.push(sizeError);
      if (problems.length) return res.status(400).json({ error: "輸入驗證失敗", details: problems });

      const id = "O" + Date.now();
      const { rows } = await pool.query(
        `INSERT INTO orders (id, ship, ship_call, container, from_location, to_location, time, size, status, driver_id, vehicle_id, dispatch_type, carrier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '待派車', NULL, NULL, $9, $10) RETURNING *`,
        [id, ship, shipCall, container, from, to, time, size, dispatchType, carrier]
      );

      await logAction(req, "新增", "訂單", id, `${dispatchType}|${carrier}|${container} ${from}→${to}`);
      res.status(201).json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

// 依車數建立任務:20 / 40 / HQ 各幾車,一次建立「每台車一筆」的訂單(貨櫃編號之後再補)。
// 全部成功或全部不建立。
router.post(
  "/task",
  validateBody({
    ship: { type: "string", maxLength: 100, label: "船名／航次" },
    shipCall: { type: "string", maxLength: 30, label: "船掛" },
    carrier: { required: true, type: "string", maxLength: 30, label: "船商" },
    from: { required: true, type: "string", maxLength: 100, label: "起點" },
    to: { required: true, type: "string", maxLength: 100, label: "終點" },
    time: { required: true, type: "string", label: "作業時間" },
    dispatchType: { required: true, enum: DISPATCH_TYPES, label: "調派類型" },
  }),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const carrier = clean(req.body.carrier);
      const shipCall = clean(req.body.shipCall);
      const ship = effectiveShip(req.body.ship, shipCall);
      const from = clean(req.body.from);
      const to = clean(req.body.to);
      const time = clean(req.body.time).replace(" ", "T");

      const problems = [];
      if (!ship) problems.push("請填船名／航次或船掛");
      if (!carrier) problems.push("船商必填");
      if (!from || !to) problems.push("起點與終點必填");
      if (!TIME_PATTERN.test(time) || Number.isNaN(new Date(time).getTime())) {
        problems.push("作業時間格式需為 YYYY-MM-DDTHH:MM");
      }

      const counts = TASK_SIZES.map((t) => ({ ...t, n: truckCount(req.body[t.key]) }));
      if (counts.some((c) => c.n === null)) {
        problems.push(`車數必須是 0 到 ${MAX_TASK_TRUCKS} 的整數(20 / 40 / HQ)`);
      } else {
        const total = counts.reduce((sum, c) => sum + c.n, 0);
        if (total < 1) problems.push("請至少填一種尺寸的車數");
        if (total > MAX_TASK_TRUCKS) problems.push(`一次最多建立 ${MAX_TASK_TRUCKS} 台車,目前是 ${total}`);
      }
      if (problems.length) return res.status(400).json({ error: "輸入驗證失敗", details: problems });

      const base = Date.now();
      const created = [];
      await client.query("BEGIN");
      let i = 0;
      for (const c of counts) {
        for (let k = 0; k < c.n; k++, i++) {
          const { rows } = await client.query(
            `INSERT INTO orders (id, ship, ship_call, container, from_location, to_location, time, size, status, dispatch_type, carrier)
             VALUES ($1, $2, $3, '', $4, $5, $6, $7, '待派車', $8, $9) RETURNING *`,
            [`O${base}${String(i).padStart(3, "0")}`, ship, shipCall, from, to, time, c.size, req.body.dispatchType, carrier]
          );
          created.push(rows[0]);
        }
      }
      await client.query("COMMIT");

      const summary = Object.fromEntries(counts.map((c) => [c.label, c.n]));
      await logAction(req, "建立任務", "訂單", null,
        `船掛 ${shipCall || "-"}|${carrier}|20×${summary["20"]} 40×${summary["40"]} HQ×${summary.HQ}|${from}→${to}`);
      res.status(201).json({
        created: created.length,
        counts: { ...summary, total: created.length },
        orders: created.map(serializeOrder),
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  }
);

// 總數車數統計:依 船掛 / 船商 / 船名 分組,統計 20 / 40 / HQ 各幾車與派車進度。
// 日期是「作業時間」的日期部分;不帶 date 就是全部日期。
router.get("/task-summary", async (req, res, next) => {
  try {
    const date = req.query.date ? String(req.query.date) : null;
    if (date && !isValidDateKey(date)) return res.status(400).json({ error: "date 格式需為 YYYY-MM-DD" });

    // HQ 優先判斷,避免「40HQ」同時被算進 40
    const { rows } = await pool.query(
      `SELECT ship_call, carrier, ship,
         COUNT(*) FILTER (WHERE size ~* 'hq')::int AS n_hq,
         COUNT(*) FILTER (WHERE size ~ '^20' AND size !~* 'hq')::int AS n_20,
         COUNT(*) FILTER (WHERE size ~ '^40' AND size !~* 'hq')::int AS n_40,
         COUNT(*) FILTER (WHERE size !~* 'hq' AND size !~ '^20' AND size !~ '^40')::int AS n_other,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = '待派車')::int AS pending,
         COUNT(*) FILTER (WHERE status IN ('已派車', '執行中'))::int AS dispatched,
         COUNT(*) FILTER (WHERE status = '已完成')::int AS completed
       FROM orders
       WHERE ($1::text IS NULL OR left(time, 10) = $1::text)
       GROUP BY ship_call, carrier, ship
       ORDER BY (ship_call = ''), ship_call, ship, carrier`,
      [date]
    );

    const groups = rows.map((r) => ({
      shipCall: r.ship_call, carrier: r.carrier, ship: r.ship,
      n20: r.n_20, n40: r.n_40, nHQ: r.n_hq, other: r.n_other,
      total: r.total, pending: r.pending, dispatched: r.dispatched, completed: r.completed,
    }));
    const sum = (key) => groups.reduce((n, g) => n + g[key], 0);
    res.json({
      date,
      groups,
      totals: {
        n20: sum("n20"), n40: sum("n40"), nHQ: sum("nHQ"), other: sum("other"),
        total: sum("total"), pending: sum("pending"), dispatched: sum("dispatched"), completed: sum("completed"),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 批次匯入:整批先驗證,有任何一列錯誤就整批不寫入,並回傳每一列的錯誤
router.post("/import", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: "沒有可匯入的資料" });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ error: `一次最多匯入 ${MAX_IMPORT_ROWS} 筆` });
    }

    const { container_sizes } = await getSettings();
    const errors = [];
    const parsed = rows.map((r, i) => {
      const shipCall = clean(r.shipCall);
      const item = {
        shipCall,
        ship: effectiveShip(r.ship, shipCall),
        container: clean(r.container),
        from: clean(r.from),
        to: clean(r.to),
        time: clean(r.time).replace(" ", "T"),
        size: clean(r.size),
        dispatchType: clean(r.dispatchType).toUpperCase() === "CY" ? "CY" : clean(r.dispatchType),
        carrier: clean(r.carrier),
      };
      const problems = [];
      if (!item.ship || item.ship.length > 100) problems.push("船名／航次與船掛至少要填一項,船名不可超過 100 字");
      if (item.shipCall.length > 30) problems.push("船掛不可超過 30 字");
      if (!item.container || item.container.length > 30) problems.push("貨櫃編號必填且不可超過 30 字");
      if (!item.from || item.from.length > 100) problems.push("起點必填");
      if (!item.to || item.to.length > 100) problems.push("終點必填");
      if (!TIME_PATTERN.test(item.time) || Number.isNaN(new Date(item.time).getTime())) {
        problems.push("作業時間格式需為 YYYY-MM-DD HH:MM");
      }
      if (!container_sizes.includes(item.size)) problems.push(`尺寸必須是:${container_sizes.join("、")}`);
      if (!DISPATCH_TYPES.includes(item.dispatchType)) problems.push(`調派類型必須是:${DISPATCH_TYPES.join("、")}`);
      if (!item.carrier || item.carrier.length > 30) problems.push("船商必填且不可超過 30 字");
      if (problems.length) errors.push({ row: i + 1, problems });
      return item;
    });

    if (errors.length) {
      return res.status(400).json({ error: "匯入失敗,請修正下列資料後重試(本次未寫入任何資料)", details: errors });
    }

    await client.query("BEGIN");
    const base = Date.now();
    for (let i = 0; i < parsed.length; i++) {
      const o = parsed[i];
      await client.query(
        `INSERT INTO orders (id, ship, ship_call, container, from_location, to_location, time, size, status, dispatch_type, carrier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '待派車', $9, $10)`,
        [`O${base}${String(i).padStart(3, "0")}`, o.ship, o.shipCall, o.container, o.from, o.to, o.time, o.size, o.dispatchType, o.carrier]
      );
    }
    await client.query("COMMIT");

    await logAction(req, "批次匯入", "訂單", null, `共 ${parsed.length} 筆`);
    res.status(201).json({ imported: parsed.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// 編輯訂單基本資料(不含派車、不含狀態變更)——僅限尚未派車的訂單
router.patch(
  "/:id",
  validateBody({
    ship: { type: "string", maxLength: 100, label: "船名／航次" },
    shipCall: { type: "string", maxLength: 30, label: "船掛" },
    container: { type: "string", maxLength: 30, label: "貨櫃編號" },
    from: { type: "string", maxLength: 100, label: "起點" },
    to: { type: "string", maxLength: 100, label: "終點" },
    time: { type: "date", label: "作業時間" },
    size: { type: "string", label: "貨櫃尺寸" },
    dispatchType: { enum: DISPATCH_TYPES, label: "調派類型" },
    carrier: { type: "string", maxLength: 30, label: "船商" },
  }),
  async (req, res, next) => {
    try {
      const order = await findOrder(req.params.id);
      if (!order) return res.status(404).json({ error: "找不到此訂單" });
      if (order.status !== "待派車") {
        return res.status(409).json({ error: "只有「待派車」狀態的訂單可以編輯基本資料" });
      }

      const body = req.body || {};
      const shipCall = body.shipCall !== undefined ? clean(body.shipCall) : order.ship_call;
      const ship = effectiveShip(body.ship !== undefined ? body.ship : order.ship, shipCall);
      const carrier = body.carrier !== undefined ? clean(body.carrier) : order.carrier;
      const container = body.container !== undefined ? clean(body.container) : order.container;
      const fromLocation = body.from ?? order.from_location;
      const toLocation = body.to ?? order.to_location;
      const time = body.time ?? order.time;
      const size = body.size ?? order.size;
      const dispatchType = body.dispatchType ?? order.dispatch_type;

      const problems = [];
      if (!ship) problems.push("請填船名／航次或船掛");
      if (!carrier) problems.push("船商不可為空");
      if (size !== order.size) {
        const sizeError = await checkSize(size);
        if (sizeError) problems.push(sizeError);
      }
      if (problems.length) return res.status(400).json({ error: "輸入驗證失敗", details: problems });

      const { rows } = await pool.query(
        `UPDATE orders SET ship = $1, ship_call = $2, container = $3, from_location = $4, to_location = $5, time = $6, size = $7,
           dispatch_type = $8, carrier = $9
         WHERE id = $10 RETURNING *`,
        [ship, shipCall, container, fromLocation, toLocation, time, size, dispatchType, carrier, req.params.id]
      );

      await logAction(req, "修改", "訂單", order.id, `${container || "(待補櫃號)"} ${fromLocation}→${toLocation}`);
      res.json(serializeOrder(rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

// 派車前的合法性檢查。keep 用於改派:沿用原本的司機/車輛時,不再要求其為閒置狀態
async function validateDispatch(order, driver, vehicle, keep = {}, db = pool) {
  const errors = [];

  if (!driver) errors.push("尚未選擇司機");
  if (!vehicle) errors.push("尚未選擇車輛");
  if (driver && !keep.driver && driver.status !== "可派車") {
    errors.push(`司機目前狀態為「${driver.status}」`);
  }
  if (vehicle && !keep.vehicle && vehicle.status !== "可用") {
    errors.push(`車輛目前狀態為「${vehicle.status}」`);
  }
  if (driver && isPastDate(driver.license)) errors.push("司機證照已逾期");
  if (vehicle && isPastDate(vehicle.maintenance)) errors.push("車輛保養已逾期,禁止派車");

  if (vehicle && vehicle.inspection_date && isPastDate(vehicle.inspection_date)) errors.push('車輛驗車已逾期');
  if (driver) {
    const leave=await db.query("SELECT 1 FROM attendance_records WHERE staff_type='driver' AND staff_id=$1 AND date=$2 AND status IN ('休假','曠職')",[driver.id,order.time.slice(0,10)]);
    if(leave.rowCount) errors.push('司機當日休假或曠職，禁止派車');
    const clash = await db.query(
      `SELECT 1 FROM orders
       WHERE id != $1 AND driver_id = $2 AND status IN ('已派車', '執行中') AND time = $3`,
      [order.id, driver.id, order.time]
    );
    if (clash.rows.length) errors.push("司機同一時段已有其他任務");
  }
  if (vehicle) {
    const clash = await db.query(
      `SELECT 1 FROM orders
       WHERE id != $1 AND vehicle_id = $2 AND status IN ('已派車', '執行中') AND time = $3`,
      [order.id, vehicle.id, order.time]
    );
    if (clash.rows.length) errors.push("車輛同一時段已有其他任務");
  }
  return errors;
}

async function loadResources(driverId, vehicleId, db = pool) {
  const d = await db.query("SELECT * FROM drivers WHERE id = $1", [driverId]);
  const v = await db.query("SELECT * FROM vehicles WHERE id = $1", [vehicleId]);
  return { driver: d.rows[0] || null, vehicle: v.rows[0] || null };
}

const dispatchSchema = {
  driverId: { required: true, type: "string", label: "司機" },
  vehicleId: { required: true, type: "string", label: "車輛" },
};

async function dispatchOperation(req, res, next, reassign) {
  try {
    const result=await transaction(pool,async db=>{
      await db.query('SELECT pg_advisory_xact_lock(870032)');
      const order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(!order) return {status:404,error:'找不到此訂單'};
      if(reassign ? !['已派車','執行中'].includes(order.status) : order.status!=='待派車') return {status:409,error:reassign?'只有已派車或執行中的訂單可以改派':'只有待派車的訂單可以派車'};
      const {driver,vehicle}=await loadResources(req.body.driverId,req.body.vehicleId,db);
      const keep={driver:reassign && driver?.id===order.driver_id,vehicle:reassign && vehicle?.id===order.vehicle_id};
      if(reassign && keep.driver && keep.vehicle) return {status:400,error:'司機與車輛都沒有變更'};
      const errors=await validateDispatch(order,driver,vehicle,keep,db);
      if(errors.length) return {status:409,error:'派車失敗',details:errors};
      const row=(await db.query("UPDATE orders SET status=CASE WHEN status='待派車' THEN '已派車' ELSE status END,driver_id=$1,vehicle_id=$2 WHERE id=$3 RETURNING *",[driver.id,vehicle.id,order.id])).rows[0];
      if(reassign) {
        await db.query("UPDATE drivers SET status='可派車' WHERE id=$1 AND id<>$2 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM orders WHERE driver_id=$1 AND status IN ('已派車','執行中'))",[order.driver_id,driver.id]);
        await db.query("UPDATE vehicles SET status='可用' WHERE id=$1 AND id<>$2 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM orders WHERE vehicle_id=$1 AND status IN ('已派車','執行中'))",[order.vehicle_id,vehicle.id]);
      }
      await db.query("UPDATE drivers SET status='執行中' WHERE id=$1",[driver.id]);
      await db.query("UPDATE vehicles SET status='執行中' WHERE id=$1",[vehicle.id]);
      await audit(db,req.user,reassign?'改派':'派車','訂單',order.id,'司機 '+driver.name+'、車輛 '+vehicle.plate);
      return {data:serializeOrder(row)};
    });
    if(result.error) return res.status(result.status).json({error:result.error,details:result.details});
    res.json(result.data);
  } catch(err) {next(err);}
}
router.patch('/:id/dispatch',validateBody(dispatchSchema),(req,res,next)=>dispatchOperation(req,res,next,false));
router.patch('/:id/reassign',validateBody(dispatchSchema),(req,res,next)=>dispatchOperation(req,res,next,true));
router.patch('/:id/complete',async(req,res,next)=>{
  try {
    const {order,error,status}=await completeOrder(req.params.id,req.user);
    if(error) return res.status(status||404).json({error});
    res.json(serializeOrder(order));
  } catch(err) {next(err);}
});

// 把選定的訂單整理成明細文字,推送到後台設定好的 LINE 群組(不用手動複製貼上)
router.post("/push-line", async (req, res, next) => {
  try {
    const ids = req.body?.orderIds;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "請至少選擇一筆訂單" });
    }
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE id = ANY($1::text[]) ORDER BY time",
      [ids]
    );
    if (!rows.length) return res.status(404).json({ error: "找不到指定的訂單" });

    const [driversRes, vehiclesRes] = await Promise.all([
      pool.query("SELECT * FROM drivers"),
      pool.query("SELECT * FROM vehicles"),
    ]);

    const result = await pushDispatchList(rows.map(serializeOrder), driversRes.rows, vehiclesRes.rows);
    if (result.error) return res.status(400).json({ error: result.error });

    await logAction(req, "推送LINE", "訂單", null, `${rows.length} 筆 → ${result.sentTo.join("、")}`);
    res.json({ sent: rows.length, groups: result.sentTo });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status',requireRole('admin'),validateBody({status:{required:true,enum:ORDER_STATUSES,label:'狀態'}}),async(req,res,next)=>{
  try {
    const result=await transaction(pool,async db=>{
      await db.query('SELECT pg_advisory_xact_lock(870032)');
      const order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(!order) return {error:'找不到此訂單',status:404};
      const target=req.body.status;
      if(target===order.status) return {data:serializeOrder(order)};
      const wasActive=['已派車','執行中'].includes(order.status);
      if(['已派車','執行中'].includes(target)) {
        const {driver,vehicle}=await loadResources(order.driver_id,order.vehicle_id,db);
        const errors=await validateDispatch(order,driver,vehicle,{driver:wasActive,vehicle:wasActive},db);
        if(errors.length) return {error:'狀態修改失敗',status:409,details:errors};
        await db.query("UPDATE drivers SET status='執行中' WHERE id=$1",[order.driver_id]);
        await db.query("UPDATE vehicles SET status='執行中' WHERE id=$1",[order.vehicle_id]);
      }
      const row=(await db.query('UPDATE orders SET status=$1,driver_id=CASE WHEN $3 THEN NULL ELSE driver_id END,vehicle_id=CASE WHEN $3 THEN NULL ELSE vehicle_id END WHERE id=$2 RETURNING *',[target,order.id,target==='待派車'])).rows[0];
      if(!['已派車','執行中'].includes(target)) {
        await db.query("UPDATE drivers SET status='可派車' WHERE id=$1 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM orders WHERE driver_id=$1 AND status IN ('已派車','執行中'))",[order.driver_id]);
        await db.query("UPDATE vehicles SET status='可用' WHERE id=$1 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM orders WHERE vehicle_id=$1 AND status IN ('已派車','執行中'))",[order.vehicle_id]);
      }
      await audit(db,req.user,'強制改狀態','訂單',order.id,order.status+' → '+target);
      return {data:serializeOrder(row)};
    });
    if(result.error) return res.status(result.status).json({error:result.error,details:result.details});
    res.json(result.data);
  } catch(err) {next(err);}
});
router.delete('/:id',requireRole('admin'),async(req,res,next)=>{
  try {
    const result=await transaction(pool,async db=>{
      await db.query('SELECT pg_advisory_xact_lock(870032)');
      const order=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(!order) return {error:'找不到此訂單',status:404};
      const used=await db.query('SELECT 1 FROM order_reports WHERE order_id=$1 UNION ALL SELECT 1 FROM operational_incidents WHERE order_id=$1',[order.id]);
      if(used.rowCount) return {error:'已有回報或事故歷程，禁止刪除',status:409};
      await db.query('DELETE FROM orders WHERE id=$1',[order.id]);
      await db.query("UPDATE drivers SET status='可派車' WHERE id=$1 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM orders WHERE driver_id=$1 AND status IN ('已派車','執行中'))",[order.driver_id]);
      await db.query("UPDATE vehicles SET status='可用' WHERE id=$1 AND status='執行中' AND NOT EXISTS(SELECT 1 FROM orders WHERE vehicle_id=$1 AND status IN ('已派車','執行中'))",[order.vehicle_id]);
      await audit(db,req.user,'刪除','訂單',order.id,order.container);
      return {};
    });
    if(result.error) return res.status(result.status).json({error:result.error});
    res.status(204).end();
  } catch(err) {next(err);}
});

router.get("/export/csv", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY id");
    const header = ["訂單編號", "船商", "調派類型", "船掛", "船名航次", "貨櫃編號", "起點", "終點", "作業時間", "尺寸", "狀態"];
    const csvRows = rows.map((o) => [
      o.id, o.carrier, o.dispatch_type, o.ship_call, o.ship, o.container, o.from_location, o.to_location, o.time, o.size, o.status,
    ]);

    // 以 = + - @ 開頭的儲存格會被 Excel 當成公式執行,匯出時加前綴避免 CSV 注入
    const cell = (v) => {
      let t = String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return `"${t.replaceAll('"', '""')}"`;
    };
    const csv = [header, ...csvRows].map((row) => row.map(cell).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="orders.csv"');
    res.send("\ufeff" + csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
