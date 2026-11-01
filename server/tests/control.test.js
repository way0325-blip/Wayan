const test=require('node:test');
const assert=require('node:assert/strict');
const {resetDatabase}=require('./stagingSetup');
process.env.JWT_SECRET='test-secret';process.env.ADMIN_USERNAME='admin';process.env.ADMIN_PASSWORD='1234';
const {pool,initDb}=require('../db');
const {migrate}=require('../migrations');
const {todayInTaipei}=require('../dates');
let server,base,token;
async function api(method,path,body,auth=token) {
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:r.status===204?null:await r.json()};
}
test.before(async()=>{
  await resetDatabase();
  await initDb();await pool.query("UPDATE drivers SET license='2099-12-31'; UPDATE vehicles SET maintenance='2099-12-31'");
  const app=require('../index');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
  token=(await api('POST','/api/auth/login',{username:'admin',password:'1234'},null)).data.token;
});
test.after(async()=>{server?.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
test('incremental migration can run twice without losing operational data',async()=>{
  const before=(await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
  await migrate(pool);await migrate(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,before);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,6);
});
test('summary requires authentication and validates calendar dates',async()=>{
  assert.equal((await api('GET','/api/control/summary',undefined,null)).status,401);
  assert.equal((await api('GET','/api/control/summary?date=2026-02-31')).status,400);
  assert.equal((await api('GET','/api/missing')).status,404);
});
test('today means the Taiwan service day; route demand is not multiplied by assignments',async()=>{
  const day=todayInTaipei();
  await pool.query("INSERT INTO orders(id,ship,container,from_location,to_location,time,size,status) VALUES('TODAY','ship','C','A','B',$1,'20 呎','待派車')",[day+'T09:00']);
  await pool.query("INSERT INTO shopee_routes(id,service_date,origin,destination,vehicle_type,required_trucks) VALUES('R1',$1,'A','B','11T',5)",[day]);
  await pool.query("INSERT INTO partner_fleets(id,name) VALUES('F1','fleet1'),('F2','fleet2')");
  await pool.query("INSERT INTO shopee_assignments(route_id,fleet_id,requested_trucks,confirmed_trucks,status) VALUES('R1','F1',2,2,'已確認'),('R1','F2',2,0,'待回覆')");
  const s=(await api('GET','/api/control/summary')).data;
  assert.equal(s.port.total,1);assert.equal(s.port.pending,1);assert.equal(Number(s.shopee.required),5);
  assert.equal(Number(s.shopee.confirmed),2);assert.equal(Number(s.shopee.pending),2);assert.equal(Number(s.shopee.shortage),3);
  assert.equal(s.pendingViolations,0);
});
test('simultaneous dispatches cannot reserve one driver and vehicle twice',async()=>{
  const payload={ship:'ship',container:'NEW',from:'A',to:'B',time:todayInTaipei()+'T10:00',size:'20 呎',dispatchType:'CY',carrier:'陽明'};
  const a=(await api('POST','/api/orders',payload)).data,b=(await api('POST','/api/orders',{...payload,container:'NEW2'})).data;
  const results=await Promise.all([a,b].map(o=>api('PATCH','/api/orders/'+o.id+'/dispatch',{driverId:'D002',vehicleId:'V002'})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE driver_id='D002' AND status IN ('已派車','執行中')")).rows[0].n,1);
});
test('dispatch rolls back resource updates when audit write fails',async()=>{
  await pool.query("INSERT INTO drivers(id,name,phone,license) VALUES('D-ROLL','test','0900','2099-12-31'); INSERT INTO vehicles(id,plate,type,maintenance) VALUES('V-ROLL','ROLL','曳引車','2099-12-31')");
  await pool.query(`CREATE FUNCTION test_dispatch_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='派車' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_dispatch_fail()`);
  try {
    assert.equal((await api('PATCH','/api/orders/TODAY/dispatch',{driverId:'D-ROLL',vehicleId:'V-ROLL'})).status,500);
    assert.equal((await pool.query("SELECT status FROM orders WHERE id='TODAY'")).rows[0].status,'待派車');
    assert.equal((await pool.query("SELECT status FROM drivers WHERE id='D-ROLL'")).rows[0].status,'可派車');
    assert.equal((await pool.query("SELECT status FROM vehicles WHERE id='V-ROLL'")).rows[0].status,'可用');
  } finally {await pool.query('DROP TRIGGER test_fail ON audit_logs; DROP FUNCTION test_dispatch_fail()');}
});
test('leave and expired inspection prevent dispatch',async()=>{
  await pool.query("INSERT INTO attendance_records(staff_type,staff_id,date,status) VALUES('driver','D-ROLL',$1,'休假')",[todayInTaipei()]);
  assert.equal((await api('PATCH','/api/orders/TODAY/dispatch',{driverId:'D-ROLL',vehicleId:'V-ROLL'})).status,409);
  await pool.query("DELETE FROM attendance_records WHERE staff_id='D-ROLL'; UPDATE vehicles SET inspection_date='2000-01-01' WHERE id='V-ROLL'");
  assert.equal((await api('PATCH','/api/orders/TODAY/dispatch',{driverId:'D-ROLL',vehicleId:'V-ROLL'})).status,409);
});
test('SSE authenticates and invalidates on committed PostgreSQL changes',async()=>{
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),6000);
  try {
    const unauth=await fetch(base+'/api/control/events');assert.equal(unauth.status,401);
    const res=await fetch(base+'/api/control/events',{headers:{Authorization:'Bearer '+token},signal:ac.signal});assert.equal(res.status,200);
    const reader=res.body.getReader();let buffer='';
    while(!buffer.includes('event: ready')) buffer+=new TextDecoder().decode((await reader.read()).value);
    await pool.query("UPDATE vehicles SET plate=plate WHERE id='V001'");buffer='';
    while(!buffer.includes('event: refresh')) buffer+=new TextDecoder().decode((await reader.read()).value);
    assert.match(buffer,/event: refresh/);await reader.cancel();
  } finally {clearTimeout(timer);ac.abort();}
});
