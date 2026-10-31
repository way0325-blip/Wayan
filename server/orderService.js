const { pool } = require("./db");
const { transaction, audit } = require('./transaction');

function serializeOrder(row) {
  return {
    id: row.id,
    ship: row.ship,
    shipCall: row.ship_call,
    container: row.container,
    from: row.from_location,
    to: row.to_location,
    time: row.time,
    size: row.size,
    dispatchType: row.dispatch_type,
    carrier: row.carrier,
    status: row.status,
    driverId: row.driver_id,
    vehicleId: row.vehicle_id,
  };
}

async function findOrder(id) {
  const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
  return rows[0] || null;
}

// 依貨櫃編號比對(不分大小寫,允許只打後面幾碼),用於 LINE 回報。
// 只在「已派車 / 執行中」裡面找,避免誤觸已完成或還沒派車的訂單。
async function findActiveOrderByContainerFragment(fragment) {
  const f = fragment.trim().toUpperCase();
  if (!f) return { order: null, matches: [] };

  const { rows } = await pool.query(
    `SELECT * FROM orders WHERE status IN ('已派車', '執行中')
     AND UPPER(container) LIKE '%' || $1 || '%' ORDER BY time`,
    [f]
  );
  if (rows.length === 1) return { order: rows[0], matches: rows };
  return { order: null, matches: rows };
}

// 完成訂單的核心邏輯,供後台 API 與 LINE 回報共用。actor 只用於寫入操作紀錄。
async function completeOrder(orderId, actor) {
  return transaction(pool, async db => {
  await db.query('SELECT pg_advisory_xact_lock(870032)');
  const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if (!order) return { error: "找不到此訂單" };
  if (order.status === "已完成") return { order, alreadyDone: true };
  if (!['已派車','執行中'].includes(order.status)) return {error:'只有已派車或執行中任務可以完成',status:409};

  const { rows } = await db.query(
    "UPDATE orders SET status = '已完成' WHERE id = $1 RETURNING *",
    [order.id]
  );
  if (order.driver_id) await db.query(`UPDATE drivers SET status='可派車' WHERE id=$1 AND status='執行中'
    AND NOT EXISTS(SELECT 1 FROM orders WHERE driver_id=$1 AND status IN ('已派車','執行中'))`,[order.driver_id]);
  if (order.vehicle_id) await db.query(`UPDATE vehicles SET status='可用' WHERE id=$1 AND status='執行中'
    AND NOT EXISTS(SELECT 1 FROM orders WHERE vehicle_id=$1 AND status IN ('已派車','執行中'))`,[order.vehicle_id]);
  await audit(db,{username:actor?.username||'-',role:actor?.role||'-'},'完成','訂單',order.id,order.container);

  return { order: rows[0] };
  });
}

module.exports = { serializeOrder, findOrder, findActiveOrderByContainerFragment, completeOrder };
