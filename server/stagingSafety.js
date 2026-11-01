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
  const allowedName=!renderProfile&&decodeURIComponent(url.pathname)==='/wayan-staging-db';
  const allowedRender=!destructive&&renderProfile&&env.STAGING_RENDER_POSTGRES_ID===RENDER_STAGING_DATABASE.resourceId&&
    url.hostname===RENDER_STAGING_DATABASE.resourceId&&(!url.port||url.port==='5432')&&
    decodeURIComponent(url.pathname)==='/'+RENDER_STAGING_DATABASE.databaseName;
  // pg-connection-string accepts query parameters that can override the host.
  const override=[...url.searchParams.keys()].some(k=>/^(options|host|hostaddr|port|user|password|database|dbname|db|service)$/i.test(k));
  if (env.WAYAN_ENV !== "staging" || !["postgres:", "postgresql:"].includes(url.protocol) ||
      !(allowedName||allowedRender) || override) {
    throw new Error("安全限制：本分支只允許 WAYAN_ENV=staging 與 wayan-staging-db");
  }
  if (destructive && (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || env.ALLOW_STAGING_TEST_RESET !== "yes")) {
    throw new Error("測試清除僅允許明確授權的本機 wayan-staging-db");
  }
  return url;
}
module.exports = { assertStagingDatabase,RENDER_STAGING_DATABASE };
