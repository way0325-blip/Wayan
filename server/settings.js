const { pool } = require("./db");

const JSON_KEYS = ["locations", "container_sizes", "carriers"];

async function getSettings() {
  const { rows } = await pool.query("SELECT key, value FROM settings");
  const result = {
    system_name: "港區星際運輸調度中心",
    announcement: "",
    locations: [],
    container_sizes: ["20 呎", "40 呎", "45 呎"],
    carriers: [],
  };
  for (const { key, value } of rows) {
    if (JSON_KEYS.includes(key)) {
      try { result[key] = JSON.parse(value); } catch { /* 保留預設值 */ }
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function saveSetting(key, value) {
  const stored = JSON_KEYS.includes(key) ? JSON.stringify(value) : String(value);
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, stored]
  );
}

module.exports = { getSettings, saveSetting };
