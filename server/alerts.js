const { pool } = require("./db");

const WARN_DAYS = 30; // 到期前幾天開始提醒

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  if (Number.isNaN(due.getTime())) return null;
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function toAlert({ type, label, dueDate, refId, refLabel }) {
  const days = daysUntil(dueDate);
  if (days === null || days > WARN_DAYS) return null;
  return {
    type,
    label,
    dueDate,
    refId,
    refLabel,
    daysUntil: days,
    severity: days < 0 ? "overdue" : "upcoming",
    message:
      days < 0
        ? `${label}已逾期 ${Math.abs(days)} 天`
        : days === 0
        ? `${label}今天到期`
        : `${label}還有 ${days} 天到期`,
  };
}

// 彙整所有「即將到期 / 已逾期」的提醒:司機證照、車輛保養、車輛驗車、車輛各項維修更換項目。
// 提前 30 天開始出現,逾期會持續出現直到資料被更新。
async function computeAlerts() {
  const [drivers, vehicles, items] = await Promise.all([
    pool.query("SELECT * FROM drivers"),
    pool.query("SELECT * FROM vehicles"),
    pool.query("SELECT m.*, v.plate FROM vehicle_maintenance_items m JOIN vehicles v ON v.id = m.vehicle_id"),
  ]);

  const alerts = [];

  for (const d of drivers.rows) {
    const a = toAlert({
      type: "driver_license",
      label: `司機「${d.name}」證照`,
      dueDate: d.license,
      refId: d.id,
      refLabel: d.name,
    });
    if (a) alerts.push(a);
  }

  for (const v of vehicles.rows) {
    const m = toAlert({
      type: "vehicle_maintenance",
      label: `車輛「${v.plate}」保養`,
      dueDate: v.maintenance,
      refId: v.id,
      refLabel: v.plate,
    });
    if (m) alerts.push(m);

    if (v.inspection_date) {
      const insp = toAlert({
        type: "vehicle_inspection",
        label: `車輛「${v.plate}」驗車`,
        dueDate: v.inspection_date,
        refId: v.id,
        refLabel: v.plate,
      });
      if (insp) alerts.push(insp);
    }
  }

  for (const it of items.rows) {
    const a = toAlert({
      type: "vehicle_item",
      label: `車輛「${it.plate}」${it.item_name}`,
      dueDate: it.due_date,
      refId: it.vehicle_id,
      refLabel: it.plate,
    });
    if (a) alerts.push({ ...a, itemId: it.id });
  }

  alerts.sort((a, b) => a.daysUntil - b.daysUntil);
  return alerts;
}

module.exports = { computeAlerts, daysUntil, WARN_DAYS };
