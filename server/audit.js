const { pool } = require("./db");

// 寫入操作紀錄。紀錄失敗不應影響主要操作,因此只記錄錯誤、不往外丟。
async function logAction(req, action, entity, entityId, detail) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (username, role, action, entity, entity_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user?.username || "-",
        req.user?.role || "-",
        action,
        entity,
        entityId === undefined || entityId === null ? null : String(entityId),
        detail ? String(detail).slice(0, 500) : null,
      ]
    );
  } catch (err) {
    console.error("寫入操作紀錄失敗:", err.message);
  }
}

module.exports = { logAction };
