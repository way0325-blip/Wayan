// This development branch is deliberately unable to open a production database.
// Verified My Workspace resource; the Render display name contains hyphens,
// while its immutable PostgreSQL database name contains underscores.
const RENDER_STAGING_DATABASE=Object.freeze({
  resourceId:'dpg-dbiq06cs728c738089lg-a',databaseName:'wayan_staging_db',
});
function assertStagingDatabase(env = process.env, destructive = false) {
  let url;
  try { url = new URL(destructive ? env.TEST_DATABASE_URL : env.DATABASE_URL); }
  catch { throw new Error("必須明確設定獨立的 wayan-staging-db 連線"); }
  const renderProfile=Boolean(env.STAGING_RENDER_POSTGRES_ID);
  const freeProfile=env.WAYAN_FREE_PREVIEW==='yes';
  const freeDatabase=env.WAYAN_FREE_DB_NAME||'wayan_free_preview';
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const allowedName=!freeProfile&&!renderProfile&&decodeURIComponent(url.pathname)==='/wayan-staging-db';
  const allowedFree=freeProfile&&!destructive&&!renderProfile&&
    ['wayan_free_preview','wayan_free_restore'].includes(freeDatabase)&&
    decodeURIComponent(url.pathname)==='/'+freeDatabase&&
    (loopback&&!env.WAYAN_FREE_DB_HOST||
      url.hostname===env.WAYAN_FREE_DB_HOST&&/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname)&&
      (!url.port||url.port==='5432')&&url.searchParams.get('sslmode')==='verify-full'&&
      [...url.searchParams.keys()].length===1);
  const allowedRender=!freeProfile&&!destructive&&renderProfile&&env.STAGING_RENDER_POSTGRES_ID===RENDER_STAGING_DATABASE.resourceId&&
    url.hostname===RENDER_STAGING_DATABASE.resourceId&&(!url.port||url.port==='5432')&&
    decodeURIComponent(url.pathname)==='/'+RENDER_STAGING_DATABASE.databaseName;
  // pg-connection-string accepts query parameters that can override the host.
  const override=[...url.searchParams.keys()].some(k=>/^(options|host|hostaddr|port|user|password|database|dbname|db|service)$/i.test(k));
  if (env.WAYAN_ENV !== "staging" || !["postgres:", "postgresql:"].includes(url.protocol) ||
      !(allowedName||allowedRender||allowedFree) || override) {
    throw new Error("安全限制：請使用與部署環境相符的獨立測試資料庫");
  }
  if (destructive && (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || env.ALLOW_STAGING_TEST_RESET !== "yes")) {
    throw new Error("測試清除僅允許明確授權的本機 wayan-staging-db");
  }
  return url;
}
module.exports = { assertStagingDatabase,RENDER_STAGING_DATABASE };
