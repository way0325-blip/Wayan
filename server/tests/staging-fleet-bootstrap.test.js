const test=require('node:test'),assert=require('node:assert/strict');
const {resetDatabase}=require('./stagingSetup');
process.env.JWT_SECRET='bootstrap-tests';process.env.ADMIN_PASSWORD='test-only-password';
const {pool,initDb}=require('../db'),{setupStagingFleet}=require('../stagingFleetBootstrap'),{codeHash,handleFleetGroupEvent}=require('../fleetOperations'),{transaction}=require('../transaction');
const code='abcdefghijklmnopqrstuv';const options=(name='設定測試車隊',extra={})=>({...process.env,STAGING_SETUP_FLEET_NAME:name,STAGING_SETUP_GROUP_CODE:code,STAGING_SETUP_CODE_EXPIRES_AT:new Date(Date.now()+8*60000).toISOString(),...extra});let fleetId;
test.before(async()=>{await resetDatabase();await initDb();});test.after(()=>pool.end());
test('disabled setup makes no database calls and production or invalid input fails before connecting',async()=>{
 const unreachable={connect:()=>{throw Error('Must not connect');}};assert.deepEqual(await setupStagingFleet(unreachable,{}),{status:'disabled'});
 for(const env of [options('A',{WAYAN_ENV:'production'}),options('A',{STAGING_SETUP_GROUP_CODE:'bad'}),options('A',{STAGING_SETUP_CODE_EXPIRES_AT:'bad'}),options('A',{STAGING_SETUP_CODE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString()})])await assert.rejects(()=>setupStagingFleet(unreachable,env));
 assert.deepEqual(await setupStagingFleet(unreachable,options('A',{STAGING_SETUP_CODE_EXPIRES_AT:new Date(Date.now()-1000).toISOString()})),{status:'expired'});
});
test('setup creates one fleet, stores only a code hash, audits and enqueues the fleet sheet row',async()=>{
 const r=await setupStagingFleet(pool,options());assert.equal(r.status,'ready');fleetId=r.fleetId;const c=(await pool.query('SELECT * FROM fleet_group_codes WHERE fleet_id=$1',[fleetId])).rows[0];assert.equal(c.code_hash,codeHash(code));assert.ok((await pool.query('SELECT 1 FROM fleet_delivery_jobs WHERE job_key=$1',['sheet:fleets:'+fleetId])).rowCount);assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE detail LIKE '%'||$1||'%'",[code])).rowCount,0);
});
test('restarts do not extend expiry or replace an existing active binding code',async()=>{
 const before=(await pool.query('SELECT expires_at FROM fleet_group_codes WHERE fleet_id=$1',[fleetId])).rows[0].expires_at.toISOString();assert.equal((await setupStagingFleet(pool,options())).status,'ready');assert.equal((await pool.query('SELECT expires_at FROM fleet_group_codes WHERE fleet_id=$1',[fleetId])).rows[0].expires_at.toISOString(),before);
 assert.equal((await setupStagingFleet(pool,options('設定測試車隊',{STAGING_SETUP_GROUP_CODE:'zyxwvutsrqponmlkjihgfe'}))).status,'another-code-active');assert.equal((await pool.query('SELECT code_hash FROM fleet_group_codes WHERE fleet_id=$1',[fleetId])).rows[0].code_hash,codeHash(code));
});
test('generated code works with the existing one-time LINE binding flow and never replaces a bound group',async()=>{
 const reply=await transaction(pool,db=>handleFleetGroupEvent(db,{source:{type:'group',groupId:'BOOTSTRAP_TEST_GROUP',userId:'BOOTSTRAP_USER'},message:{type:'text',text:'車隊群組綁定 '+code}},'bootstrap-binding'));
 assert.match(reply,/綁定完成/);assert.equal((await pool.query('SELECT 1 FROM fleet_group_codes WHERE fleet_id=$1',[fleetId])).rowCount,0);assert.equal((await setupStagingFleet(pool,options())).status,'already-bound');assert.equal((await pool.query('SELECT group_id FROM line_fleet_groups WHERE fleet_id=$1',[fleetId])).rows[0].group_id,'BOOTSTRAP_TEST_GROUP');
});
test('audit failure rolls back newly created fleets and duplicate fleet names are not guessed',async()=>{
 await pool.query("CREATE FUNCTION fail_setup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.username='測試環境一次性設定' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_setup BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_setup_audit()");try{await assert.rejects(()=>setupStagingFleet(pool,options('應回滾車隊')));assert.equal((await pool.query("SELECT 1 FROM partner_fleets WHERE name='應回滾車隊'")).rowCount,0);}finally{await pool.query('DROP TRIGGER fail_setup ON audit_logs;DROP FUNCTION fail_setup_audit()');}
 await pool.query("INSERT INTO partner_fleets(id,name) VALUES('DUP_A','重名車隊'),('DUP_B','重名車隊')");assert.equal((await setupStagingFleet(pool,options('重名車隊'))).status,'ambiguous-fleet');
});
