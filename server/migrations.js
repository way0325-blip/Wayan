const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function migrate(pool) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(870031)");
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    for (const name of fs.readdirSync(path.join(__dirname, "migrations")).filter(n => n.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(__dirname, "migrations", name), "utf8").replace(/\r\n/g,'\n');
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const previous = (await db.query("SELECT checksum FROM schema_migrations WHERE name=$1", [name])).rows[0];
      if (previous && previous.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
      if (previous) continue;
      await db.query(sql);
      await db.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, checksum]);
    }
    await db.query("COMMIT");
  } catch (err) { await db.query("ROLLBACK"); throw err; }
  finally { db.release(); }
}
module.exports = { migrate };
