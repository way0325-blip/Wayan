const { pool } = require("./db");

function serializeOrder(row) {
  return {
    id: row.id,
    ship: row.ship,
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
  const order = await findOrder(orderId);
  if (!order) return { error: "找不到此訂單" };
  if (order.status === "已完成") return { order, alreadyDone: true };

  const { rows } = await pool.query(
    "UPDATE orders SET status = '已完成' WHERE id = $1 RETURNING *",
    [order.id]
  );
  if (order.driver_id) await pool.query("UPDATE drivers SET status = '可派車' WHERE id = $1", [order.driver_id]);
  if (order.vehicle_id) await pool.query("UPDATE vehicles SET status = '可用' WHERE id = $1", [order.vehicle_id]);

  try {
    await pool.query(
      `INSERT INTO audit_logs (username, role, action, entity, entity_id, detail)
       VALUES ($1, $2, '完成', '訂單', $3, $4)`,
      [actor?.username || "-", actor?.role || "-", order.id, order.container]
    );
  } catch (e) { console.error("寫入操作紀錄失敗:", e.message); }

  return { order: rows[0] };
}

module.exports = { serializeOrder, findOrder, findActiveOrderByContainerFragment, completeOrder };
