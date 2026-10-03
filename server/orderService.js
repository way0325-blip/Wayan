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

// 完成訂單的核心邏輯,供後台 API 與 LINE 回報共用。
// 交易 + row lock 可避免 LINE 重送或多人同時完成同一筆訂單。
async function completeOrder(orderId, actor) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: lockedRows } = await client.query(
      "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    const order = lockedRows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return { error: "找不到此訂單" };
    }

    if (order.status === "已完成") {
      await client.query("ROLLBACK");
      return { order, alreadyDone: true };
    }

    if (!["已派車", "執行中"].includes(order.status)) {
      await client.query("ROLLBACK");
      return { error: `目前狀態為「${order.status}」,不能回報完成` };
    }

    const { rows } = await client.query(
      "UPDATE orders SET status = '已完成' WHERE id = $1 RETURNING *",
      [order.id]
    );

    if (order.driver_id) {
      await client.query(
        `UPDATE drivers SET status = '可派車'
         WHERE id = $1 AND NOT EXISTS (
           SELECT 1 FROM orders
           WHERE driver_id = $1 AND status IN ('已派車', '執行中')
         )`,
        [order.driver_id]
      );
    }

    if (order.vehicle_id) {
      await client.query(
        `UPDATE vehicles SET status = '可用'
         WHERE id = $1 AND NOT EXISTS (
           SELECT 1 FROM orders
           WHERE vehicle_id = $1 AND status IN ('已派車', '執行中')
         )`,
        [order.vehicle_id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (username, role, action, entity, entity_id, detail)
       VALUES ($1, $2, '完成', '訂單', $3, $4)`,
      [actor?.username || "-", actor?.role || "-", order.id, order.container]
    );

    await client.query("COMMIT");
    return { order: rows[0] };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { serializeOrder, findOrder, findActiveOrderByContainerFragment, completeOrder };
