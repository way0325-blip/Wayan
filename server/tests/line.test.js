const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {resetDatabase}=require('./stagingSetup');
process.env.JWT_SECRET='test-secret';process.env.ADMIN_USERNAME='admin';process.env.ADMIN_PASSWORD='1234';
process.env.LINE_CHANNEL_SECRET='line-test-secret';process.env.LINE_CHANNEL_ACCESS_TOKEN='dummy-token';process.env.CRON_SECRET='cron-test-secret';
const {pool,initDb}=require('../db');
const line=require('../line');
const {codeHash}=require('../lineWorkflow');
let server,base,admin,ops,counter=0,failReply=false;
const calls=[];
const realFetch=global.fetch;
async function api(method,path,body,who=admin) {
  const res=await realFetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+who}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:res.status===204?null:await res.json()};
}
function event(text,user='U1',id='evt-'+(++counter)) {return {webhookEventId:id,type:'message',message:{type:'text',text},source:{type:'user',userId:user},replyToken:'rt-'+id};}
async function send(events,signature) {
  const body=JSON.stringify({events});
  const res=await realFetch(base+'/api/line/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':signature||crypto.createHmac('sha256',process.env.LINE_CHANNEL_SECRET).update(body).digest('base64')},body});
  return res.status;
}
const last=()=>calls.at(-1)?.messages?.[0]?.text||'';
async function bind(driver,user) {
  const r=await api('POST','/api/line/admin/binding-codes',{driverId:driver});assert.equal(r.status,201);
  assert.equal(await send([event('綁定 '+r.data.code,user)]),200);assert.match(last(),/綁定成功/);
  return r.data.code;
}
test.before(async()=>{
  await resetDatabase();
  await initDb();
  await pool.query("UPDATE drivers SET license='2099-12-31'; UPDATE vehicles SET maintenance='2099-12-31'");
  global.fetch=async(url,opts)=>{
    if(String(url).startsWith('https://api.line.me/')) {
      const body=opts?.body?JSON.parse(opts.body):{};calls.push(body);
      if(failReply && String(url).endsWith('/message/reply')) return {ok:false,status:503,text:async()=>''};
      return {ok:true,text:async()=>'',json:async()=>({displayName:'測試司機'})};
    }
    return realFetch(url,opts);
  };
  const app=require('../index');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
  admin=(await api('POST','/api/auth/login',{username:'admin',password:'1234'},null)).data.token;
  await api('POST','/api/users',{username:'ops',password:'testpass',role:'dispatcher'});
  ops=(await api('POST','/api/auth/login',{username:'ops',password:'testpass'},null)).data.token;
});
test.after(async()=>{global.fetch=realFetch;server?.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
test('raw signature is required before any event is stored',async()=>{
  const before=(await pool.query('SELECT count(*)::int AS n FROM line_events')).rows[0].n;
  assert.equal(await send([event('統計')],'invalid'),401);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM line_events')).rows[0].n,before);
  assert.equal(await send([]),200);
});
test('unbound users cannot read any dispatch details',async()=>{
  await send([event('我的任務')]);assert.match(last(),/尚未綁定/);assert.doesNotMatch(last(),/EMCU|YMLU|高雄港/);
});
test('binding and event management are administrator-only',async()=>{
  assert.equal((await api('GET','/api/line/admin/status',undefined,null)).status,401);
  assert.equal((await api('POST','/api/line/admin/binding-codes',{driverId:'D001'},ops)).status,403);
  assert.equal((await api('GET','/api/line/admin/status',undefined,ops)).status,403);
});
test('binding codes are hashed, expire, and supersede old codes',async()=>{
  const first=(await api('POST','/api/line/admin/binding-codes',{driverId:'D001'})).data.code;
  const second=(await api('POST','/api/line/admin/binding-codes',{driverId:'D001'})).data.code;
  assert.notEqual(first,second);
  await send([event('綁定 '+first)]);assert.match(last(),/無效或已過期/);
  const stored=(await pool.query("SELECT * FROM line_binding_codes WHERE driver_id='D001'")).rows[0];
  assert.equal(stored.code_hash,codeHash(second));assert.notEqual(stored.code_hash,second);
  await pool.query("UPDATE line_binding_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE driver_id='D001'");
  await send([event('綁定 '+second)]);assert.match(last(),/無效或已過期/);
});
test('one-time binding works and raw code is redacted from processed inbox',async()=>{
  const code=await bind('D001','U1');
  await send([event('綁定 '+code,'U2')]);assert.match(last(),/無效或已過期/);
  const rows=(await pool.query("SELECT payload::text AS p FROM line_events WHERE payload->'message'->>'text' LIKE '%綁定%'")).rows;
  assert.ok(rows.every(r=>!r.p.includes(code)));
});
test('queries expose only the bound driver tasks; groups get no operational details',async()=>{
  await send([event('我的任務')]);assert.match(last(),/O20260925001/);assert.doesNotMatch(last(),/O20260925002|O20260925003/);assert.match(last(),/高雄港→台中倉庫/);
  const group=event('我的任務');group.source={type:'group',groupId:'G1',userId:'U1'};
  await send([group]);assert.match(last(),/請私訊/);assert.doesNotMatch(last(),/O2026|EMCU/);
});
test('statistics and completed list use Taipei date and remain driver-scoped',async()=>{
  await bind('D002','U2');
  await pool.query("INSERT INTO orders(id,ship,container,from_location,to_location,time,size,status,driver_id) VALUES('O-TZ','TZ','TZCONT001','A','B','2026-10-09T09:00','20 呎','已完成','D002')");
  test.mock.timers.enable({apis:['Date'],now:new Date('2026-10-08T17:30:00Z')});
  try {await send([event('統計','U2')]);assert.match(last(),/2026-10-09/);await send([event('已完成','U2')]);assert.match(last(),/TZCONT001/);} finally {test.mock.timers.reset();}
});
test('another driver cannot complete or report incidents on someone else task',async()=>{
  await send([event('完成 O20260925001','U2')]);assert.match(last(),/本人任務/);
  await send([event('事故 O20260925001 測試','U2')]);assert.match(last(),/本人任務/);
  assert.equal((await pool.query("SELECT status FROM orders WHERE id='O20260925001'")).rows[0].status,'已派車');
});
test('concurrent redelivery records arrival and audit exactly once',async()=>{
  const arrival=event('到站 O20260925001');const before=calls.length;
  assert.deepEqual(await Promise.all([send([arrival]),send([arrival])]),[200,200]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_reports WHERE event_id=$1',[arrival.webhookEventId])).rows[0].n,1);
  assert.equal((await pool.query('SELECT attempts FROM line_events WHERE event_id=$1',[arrival.webhookEventId])).rows[0].attempts,1);
  assert.equal(calls.length-before,1);
  assert.equal((await pool.query("SELECT status FROM orders WHERE id='O20260925001'")).rows[0].status,'執行中');
});
test('vehicle incidents notify the control inbox, stop the vehicle and preserve history',async()=>{
  const report=event('異常 O20260925001 輪胎破損');await send([report]);assert.match(last(),/車輛已停派/);
  assert.equal((await pool.query("SELECT status FROM vehicles WHERE id='V001'")).rows[0].status,'停派');
  const list=await api('GET','/api/control/incidents');assert.ok(list.data.some(i=>i.detail==='輪胎破損'));
  assert.equal((await api('PATCH','/api/control/incidents/'+list.data[0].id+'/resolve',{resolution:'已安排維修'},ops)).status,403);
  assert.equal((await api('PATCH','/api/control/incidents/'+list.data[0].id+'/resolve',{resolution:'已安排維修'})).status,200);
  assert.equal((await pool.query("SELECT status FROM vehicles WHERE id='V001'")).rows[0].status,'停派');
});
test('completion never reactivates a stopped vehicle and is idempotent',async()=>{
  await send([event('完成 O20260925001')]);assert.match(last(),/標記為完成/);
  await send([event('完成 O20260925001')]);assert.match(last(),/不會重複/);
  assert.equal((await pool.query("SELECT status FROM vehicles WHERE id='V001'")).rows[0].status,'停派');
  assert.equal((await api('DELETE','/api/orders/O20260925001')).status,409);
});
test('completion and reports roll back when transactional audit fails; admin retry succeeds',async()=>{
  await pool.query("UPDATE orders SET status='已派車',driver_id='D002',vehicle_id='V002' WHERE id='O20260925002'");
  await pool.query(`CREATE FUNCTION test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='到站' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_audit_fail()`);
  const e=event('到站 O20260925002','U2');
  try {
    assert.equal(await send([e]),503);
    assert.equal((await pool.query("SELECT status FROM orders WHERE id='O20260925002'")).rows[0].status,'已派車');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_reports WHERE event_id=$1',[e.webhookEventId])).rows[0].n,0);
    assert.equal((await pool.query('SELECT status FROM line_events WHERE event_id=$1',[e.webhookEventId])).rows[0].status,'failed');
  } finally {await pool.query('DROP TRIGGER test_fail ON audit_logs; DROP FUNCTION test_audit_fail()');}
  assert.equal((await api('POST','/api/line/admin/events/'+e.webhookEventId+'/retry',{})).status,200);
  assert.equal((await pool.query('SELECT attempts FROM line_events WHERE event_id=$1',[e.webhookEventId])).rows[0].attempts,2);
});
test('reply failures are visible without replaying committed business updates',async()=>{
  const e=event('完成 O20260925002','U2');failReply=true;
  try {assert.equal(await send([e]),200);} finally {failReply=false;}
  const row=(await pool.query('SELECT status,delivery_status FROM line_events WHERE event_id=$1',[e.webhookEventId])).rows[0];
  assert.equal(row.status,'processed');assert.equal(row.delivery_status,'failed');
  const before=calls.length;await send([e]);assert.equal(calls.length,before);
  assert.equal((await api('POST','/api/line/admin/events/'+e.webhookEventId+'/retry',{})).status,409);
  const summary=(await api('GET','/api/control/summary')).data;assert.ok(summary.failed_events>=1);
});
test('revocation removes task access immediately',async()=>{
  assert.equal((await api('DELETE','/api/line/admin/bindings/D001')).status,204);
  await send([event('我的任務')]);assert.match(last(),/尚未綁定/);
});
test('legacy dispatch push and scheduled reports remain available to authorised operators',async()=>{
  const orders=(await api('GET','/api/orders')).data;
  assert.equal((await api('POST','/api/orders/push-line',{orderIds:[orders[0].id]})).status,400);
  await api('PUT','/api/settings',{lineGroupIds:['Gtest']});
  assert.equal((await api('POST','/api/orders/push-line',{orderIds:[orders[0].id]})).status,200);
  assert.ok(calls.some(c=>c.to==='Gtest'));
  assert.equal((await api('POST','/api/line/cron/daily',{})).status,401);
  for(const period of ['daily','weekly']) {
    const r=await realFetch(base+'/api/line/cron/'+period,{method:'POST',headers:{'Content-Type':'application/json','x-cron-secret':'cron-test-secret'}});assert.equal(r.status,200);
  }
});
test('help reveals commands without operational data',async()=>{
  await send([event('說明','Uunknown')]);assert.match(last(),/可用指令/);assert.doesNotMatch(last(),/EMCU/);
});
