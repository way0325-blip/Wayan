// 所有「今天 / 還剩幾天 / 星期幾」都以台灣時間(Asia/Taipei)為準,不依賴伺服器所在時區。
// Render 的伺服器是 UTC,若直接用 new Date().toISOString() 或 getDate(),
// 台灣凌晨 0 點到 8 點之間算出來的「今天」會是前一天。
// 日期一律用 "YYYY-MM-DD" 字串表示,避免時區換算。

const TIME_ZONE = "Asia/Taipei";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayInTaipei(now = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// 把各種日期字串整理成 YYYY-MM-DD;無法判讀就回傳 null
function toDateKey(value) {
  if (typeof value !== "string") return null;
  const head = value.trim().slice(0, 10);
  if (parseKey(head)) return head;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : todayInTaipei(t);
}

function addDays(key, n) {
  const [y, m, d] = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  const [fy, fm, fd] = parseKey(fromKey);
  const [ty, tm, td] = parseKey(toKey);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// 距離到期日還有幾天(今天到期 = 0,昨天到期 = -1);日期無法判讀回傳 null
function daysUntil(dateStr, now = new Date()) {
  const key = toDateKey(dateStr);
  return key ? daysBetween(todayInTaipei(now), key) : null;
}

// 到期日「之後」才算逾期:到期日當天仍然有效
function isPastDate(dateStr, now = new Date()) {
  const d = daysUntil(dateStr, now);
  return d !== null && d < 0;
}

function weekdayOf(key) {
  const [y, m, d] = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = 日
}

module.exports = { TIME_ZONE, todayInTaipei, toDateKey, addDays, daysBetween, daysUntil, isPastDate, weekdayOf };
