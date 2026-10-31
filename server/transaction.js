async function transaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (err) { await db.query("ROLLBACK").catch(() => {}); throw err; }
  finally { db.release(); }
}
async function audit(db, actor, action, entity, id, detail) {
  await db.query(`INSERT INTO audit_logs(username,role,action,entity,entity_id,detail) VALUES($1,$2,$3,$4,$5,$6)`,
    [actor.username, actor.role, action, entity, id == null ? null : String(id), String(detail || '').slice(0,500)]);
}
module.exports = { transaction, audit };
