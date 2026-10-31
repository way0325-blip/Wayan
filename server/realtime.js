const { Client } = require('pg');
const subscribers = new Set();
let client, retryTimer;
let connecting = false;
async function connect() {
  if (connecting || client || !subscribers.size) return;
  connecting = true;
  const next = new Client({ connectionString: process.env.DATABASE_URL });
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    if (client === next) client = null;
    next.end().catch(() => {});
    for (const fn of subscribers) fn('offline');
    if (subscribers.size && !retryTimer) {
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 2000);
      retryTimer.unref();
    }
  };
  next.on('error', fail);
  next.on('end', fail);
  next.on('notification', () => { for (const fn of subscribers) fn('refresh'); });
  try {
    await next.connect();
    await next.query('LISTEN wayan_changes');
    if (!subscribers.size) { await next.end(); return; }
    client = next;
    for (const fn of subscribers) fn('ready');
  } catch { fail(); }
  finally { connecting = false; }
}
function subscribe(fn) {
  subscribers.add(fn);
  if (client) fn('ready');
  else connect();
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size) {
      clearTimeout(retryTimer); retryTimer = null;
      const old = client; client = null;
      old?.end().catch(() => {});
    }
  };
}
module.exports = { subscribe };
