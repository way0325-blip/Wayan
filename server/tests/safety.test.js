const test=require('node:test');
const assert=require('node:assert/strict');
const {assertStagingDatabase}=require('../stagingSafety');
const env={WAYAN_ENV:'staging',DATABASE_URL:'postgres://u:p@localhost/wayan-staging-db',TEST_DATABASE_URL:'postgres://u:p@localhost/wayan-staging-db',ALLOW_STAGING_TEST_RESET:'yes'};
test('production/missing/other database configuration is rejected before a connection',()=>{
  for(const overrides of [{WAYAN_ENV:'production'},{DATABASE_URL:'postgres://u:p@localhost/wayan_dispatch'},{DATABASE_URL:undefined},{DATABASE_URL:'https://localhost/wayan-staging-db'},{DATABASE_URL:env.DATABASE_URL+'?options=-csearch_path=other'}]) assert.throws(()=>assertStagingDatabase({...env,...overrides}));
  assert.equal(assertStagingDatabase(env).pathname,'/wayan-staging-db');
});
test('destructive tests require explicit local-only staging reset permission',()=>{
  for(const overrides of [{TEST_DATABASE_URL:'postgres://u:p@remote.example/wayan-staging-db'},{ALLOW_STAGING_TEST_RESET:'no'},{TEST_DATABASE_URL:'postgres://u:p@localhost/other'}]) assert.throws(()=>assertStagingDatabase({...env,...overrides},true));
  assert.equal(assertStagingDatabase(env,true).hostname,'localhost');
});
