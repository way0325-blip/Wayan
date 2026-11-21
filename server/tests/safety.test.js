const test=require('node:test');
const assert=require('node:assert/strict');
const {assertStagingDatabase}=require('../stagingSafety');
const env={WAYAN_ENV:'staging',DATABASE_URL:'postgres://u:p@localhost/wayan-staging-db',TEST_DATABASE_URL:'postgres://u:p@localhost/wayan-staging-db',ALLOW_STAGING_TEST_RESET:'yes'};

test('isolated preview only accepts its dedicated database and never allows test reset',()=>{
  const local={...env,WAYAN_FREE_PREVIEW:'yes',DATABASE_URL:'postgres://u:p@localhost/wayan_free_preview'};
  const host='ep-preview.ap-southeast-1.aws.neon.tech';
  const cloud={...local,WAYAN_FREE_DB_HOST:host,DATABASE_URL:`postgres://u:p@${host}/wayan_free_preview?sslmode=verify-full`};
  assert.equal(assertStagingDatabase(local).hostname,'localhost');
  assert.equal(assertStagingDatabase(cloud).hostname,host);
  assert.throws(()=>assertStagingDatabase(local,true));
  for(const overrides of [
    {WAYAN_FREE_DB_HOST:'ep-other.ap-southeast-1.aws.neon.tech'},
    {STAGING_RENDER_POSTGRES_ID:'dpg-dbiq06cs728c738089lg-a'},
    {DATABASE_URL:env.DATABASE_URL},
    {DATABASE_URL:cloud.DATABASE_URL.replace('verify-full','require')},
    {DATABASE_URL:cloud.DATABASE_URL+'&host=localhost'},
    {DATABASE_URL:cloud.DATABASE_URL+'&sslmode=disable'},
  ]) assert.throws(()=>assertStagingDatabase({...cloud,...overrides}));
});
test('production/missing/other database configuration is rejected before a connection',()=>{
  for(const overrides of [{WAYAN_ENV:'production'},{DATABASE_URL:'postgres://u:p@localhost/wayan_dispatch'},{DATABASE_URL:undefined},{DATABASE_URL:'https://localhost/wayan-staging-db'},{DATABASE_URL:env.DATABASE_URL+'?options=-csearch_path=other'}]) assert.throws(()=>assertStagingDatabase({...env,...overrides}));
  assert.equal(assertStagingDatabase(env).pathname,'/wayan-staging-db');
});
test('destructive tests require explicit local-only staging reset permission',()=>{
  for(const overrides of [{TEST_DATABASE_URL:'postgres://u:p@remote.example/wayan-staging-db'},{ALLOW_STAGING_TEST_RESET:'no'},{TEST_DATABASE_URL:'postgres://u:p@localhost/other'}]) assert.throws(()=>assertStagingDatabase({...env,...overrides},true));
  assert.equal(assertStagingDatabase(env,true).hostname,'localhost');
});
test('verified Render staging profile allows only its pinned internal host and immutable database name',()=>{
  const {RENDER_STAGING_DATABASE:p}=require('../stagingSafety');const remote={...env,STAGING_RENDER_POSTGRES_ID:p.resourceId,DATABASE_URL:`postgres://synthetic:synthetic@${p.resourceId}/wayan_staging_db`};
  assert.equal(assertStagingDatabase(remote).hostname,p.resourceId);
  for(const overrides of [{STAGING_RENDER_POSTGRES_ID:''},{STAGING_RENDER_POSTGRES_ID:'dpg-other-a'},{WAYAN_ENV:'production'},{DATABASE_URL:'postgres://u:p@dpg-dasr1cu0tbcc738ljmjg-a/wayan_staging_db'},{DATABASE_URL:`postgres://u:p@${p.resourceId}/wayan_dispatch_db`},{DATABASE_URL:`postgres://u:p@${p.resourceId}.attacker.invalid/wayan_staging_db`},{DATABASE_URL:`postgres://u:p@${p.resourceId}:1234/wayan_staging_db`}])assert.throws(()=>assertStagingDatabase({...remote,...overrides}));
});
test('connection query parameters cannot override staging host or credentials',()=>{
  for(const suffix of ['host=production.invalid','port=1234','user=other','password=other','options=-csearch_path=other','hostaddr=127.0.0.1'])assert.throws(()=>assertStagingDatabase({...env,DATABASE_URL:env.DATABASE_URL+'?'+suffix}));
});
test('Render profile can never authorize a destructive test reset',()=>{
 const {RENDER_STAGING_DATABASE:p}=require('../stagingSafety');assert.throws(()=>assertStagingDatabase({...env,STAGING_RENDER_POSTGRES_ID:p.resourceId,TEST_DATABASE_URL:`postgres://u:p@${p.resourceId}/wayan_staging_db`},true));
});
