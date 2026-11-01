const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');const {resetDatabase}=require('./stagingSetup');
Object.assign(process.env,{JWT_SECRET:'delivery-tests',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'1234',LINE_CHANNEL_SECRET:'delivery-test-secret',LINE_CHANNEL_ACCESS_TOKEN:'dummy'});
const {pool,initDb}=require('../db');let server,base,token,ops,fleet,trip,orderIds=[],driver,vehicle,seq=0;const day='2026-11-12';
async function api(method,path,body,auth=token){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:r.status===204?null:await r.json()};}
const store=(code,city,district,extra={})=>({code,name:code+'測試門店',city,district,address:city+district+'測試地址（非真實門店）',source:'測試資料',verified:true,active:true,...extra});
async function order(code,extra={}){const reference='TEST-'+(++seq);return api('POST','/api/store-delivery/orders/import',{rows:[{reference,warehouseId:'DAYUAN',storeCode:code,serviceDate:day,quantity:3,note:'測試',...extra}]});}
async function ids(){return (await api('GET','/api/store-delivery/orders?date='+day)).data.filter(o=>o.status==='待安排').map(o=>o.id);}
test.before(async()=>{await resetDatabase();await initDb();server=require('../index').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;token=(await api('POST','/api/auth/login',{username:'admin',password:'1234'},null)).data.token;await api('POST','/api/users',{username:'delivery-ops',password:'pass1234',role:'dispatcher'});ops=(await api('POST','/api/auth/login',{username:'delivery-ops',password:'pass1234'},null)).data.token;fleet=(await api('POST','/api/shopee/fleets',{name:'門店測試車隊',dailyCapacity:3})).data;driver=(await api('POST','/api/drivers',{name:'門店測試司機',phone:'0900000000',license:'2099-12-31'})).data;vehicle=(await api('POST','/api/vehicles',{plate:'TEST-9999',type:'11T',maintenance:'2099-12-31',inspectionDate:'2099-12-31'})).data;});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
test('delivery APIs authenticate and seed only three named warehouses with no invented addresses or stores',async()=>{
  assert.equal((await api('GET','/api/store-delivery/config',undefined,null)).status,401);const c=(await api('GET','/api/store-delivery/config')).data;assert.equal(c.warehouses.length,3);assert.ok(c.warehouses.every(w=>w.address===''));assert.ok(c.regions['新竹市'].includes('東區'));assert.ok(c.regions['桃園市'].includes('觀音區'));assert.equal(c.regions['宜蘭縣'],undefined);assert.equal(Object.values(c.regions).flat().length,77);assert.deepEqual((await api('GET','/api/store-delivery/stores')).data,[]);
});
test('warehouse address and verified store updates require admin',async()=>{
  assert.equal((await api('PATCH','/api/store-delivery/warehouses/DAYUAN',{address:'測試取貨地址'},ops)).status,403);
  assert.equal((await api('PATCH','/api/store-delivery/warehouses/DAYUAN',{address:'測試取貨地址'})).status,200);
  assert.equal((await api('POST','/api/store-delivery/stores/import',{rows:[store('A','新竹市','東區')]},ops)).status,403);
  assert.equal((await api('POST','/api/store-delivery/stores/import',{rows:[store('A','新竹市','東區'),store('B','桃園市','觀音區')]})).data.imported,2);
});
test('invalid or duplicate store batches roll back without partial writes',async()=>{
  assert.equal((await api('POST','/api/store-delivery/stores/import',{rows:[store('C','桃園市','大園區'),store('D','宜蘭縣','宜蘭市')]})).status,400);
  assert.equal((await api('POST','/api/store-delivery/stores/import',{rows:[store('C','桃園市','大園區'),store('C','桃園市','大園區')]})).status,400);
  assert.equal((await api('GET','/api/store-delivery/stores')).data.length,2);
});
test('orders require verified stores and valid warehouse, quantity, date and unique reference',async()=>{
  await api('POST','/api/store-delivery/stores/import',{rows:[store('C','新竹市','北區',{verified:false})]});
  assert.equal((await order('C')).status,409);assert.equal((await order('A',{serviceDate:'2026-02-30'})).status,400);assert.equal((await order('A',{quantity:true})).status,400);assert.equal((await order('A',{warehouseId:'FAKE'})).status,400);
  const payload={reference:'ROLLBACK-ORDER',warehouseId:'DAYUAN',storeCode:'A',serviceDate:day,quantity:1};assert.equal((await api('POST','/api/store-delivery/orders/import',{rows:[payload,{...payload,reference:'BAD',storeCode:'FAKE'}]})).status,409);assert.equal((await api('GET','/api/store-delivery/orders?date='+day)).data.length,0);
  assert.equal((await order('A')).status,201);assert.equal((await order('B')).status,201);orderIds=await ids();
});
test('multiple cross-district orders become one idempotent trip with snapshots',async()=>{
  const requestId=crypto.randomUUID(),body={requestId,orderIds,departureTime:'08:00',fleetId:fleet.id};const r=await api('POST','/api/store-delivery/trips',body);assert.equal(r.status,201);trip=r.data;
  assert.equal((await api('POST','/api/store-delivery/trips',body)).data.duplicate,true);assert.equal((await api('POST','/api/store-delivery/trips',{...body,departureTime:'09:00'})).status,409);
  const stops=(await api('GET',`/api/store-delivery/trips/${trip.id}/stops`)).data;assert.equal(stops.length,2);assert.equal(new Set(stops.map(s=>s.city+s.district)).size,2);assert.equal((await api('GET','/api/store-delivery/orders?date='+day)).data.filter(o=>o.status==='已安排').length,2);
  await api('POST','/api/store-delivery/stores/import',{rows:[store('A','新竹市','東區',{address:'更改後的新地址'})]});assert.ok((await api('GET',`/api/store-delivery/trips/${trip.id}/stops`)).data.some(s=>s.address.includes('測試地址')));
  await api('PATCH','/api/store-delivery/warehouses/DAYUAN',{address:'倉庫更新地址'});assert.equal((await api('GET','/api/store-delivery/trips?date='+day)).data[0].warehouse_address,'測試取貨地址');
});
test('order cannot be assigned twice; duplicate and mismatched warehouse lists are rejected',async()=>{
  assert.equal((await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds,departureTime:'08:00'})).status,409);
  assert.equal((await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:[orderIds[0],orderIds[0]],departureTime:'08:00'})).status,400);
  await order('A');await order('B',{warehouseId:'GUANYIN'});assert.equal((await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:await ids(),departureTime:'08:00'})).status,409);
});
test('stop reordering retains the exact original order set',async()=>{
  const reversed=orderIds.slice().reverse();assert.equal((await api('PUT',`/api/store-delivery/trips/${trip.id}/sequence`,{orderIds:reversed})).status,200);assert.deepEqual((await api('GET',`/api/store-delivery/trips/${trip.id}/stops`)).data.map(s=>s.order_id),reversed);
  assert.equal((await api('PUT',`/api/store-delivery/trips/${trip.id}/sequence`,{orderIds:[orderIds[0]]})).status,400);
});
test('dispatch checks resources, and incomplete trips cannot complete',async()=>{
  await pool.query("UPDATE drivers SET license='2020-01-01' WHERE id=$1",[driver.id]);assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/dispatch`,{driverId:driver.id,vehicleId:vehicle.id})).status,409);await pool.query("UPDATE drivers SET license='2099-12-31' WHERE id=$1",[driver.id]);
  assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/dispatch`,{driverId:driver.id,vehicleId:vehicle.id})).status,200);assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/complete`)).status,409);assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/start`)).status,200);assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/complete`)).status,409);
});
test('every stop must be delivered and duplicate delivery does not write twice',async()=>{
  const stops=(await api('GET',`/api/store-delivery/trips/${trip.id}/stops`)).data;
  for(const s of stops)assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/stops/${s.id}/deliver`)).status,200);
  assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/stops/${stops[0].id}/deliver`)).data.duplicate,true);
  assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/complete`)).status,200);assert.equal((await api('POST',`/api/store-delivery/trips/${trip.id}/complete`)).data.duplicate,true);
  assert.equal((await pool.query('SELECT status FROM drivers WHERE id=$1',[driver.id])).rows[0].status,'可派車');assert.equal((await pool.query('SELECT status FROM vehicles WHERE id=$1',[vehicle.id])).rows[0].status,'可用');
});
test('cancelling a planned trip releases orders for a new trip while retaining stop history',async()=>{
  const pending=(await api('GET','/api/store-delivery/orders?date='+day)).data.find(o=>o.status==='待安排'&&o.warehouse_id==='DAYUAN');const t=(await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:[pending.id],departureTime:'12:00'})).data;
  assert.equal((await api('POST',`/api/store-delivery/trips/${t.id}/cancel`,{note:''})).status,400);assert.equal((await api('POST',`/api/store-delivery/trips/${t.id}/cancel`,{note:'測試重排'})).status,200);assert.ok((await api('GET',`/api/store-delivery/trips/${t.id}/stops`)).data[0].released_at);
  assert.equal((await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:[pending.id],departureTime:'13:00'})).status,201);
});
test('shared daily fleet capacity includes delivery trips',async()=>{const {usedCapacity}=require('../fleetOperations');assert.equal(Number(await usedCapacity(pool,fleet.id,day)),1);await api('PATCH','/api/shopee/fleets/'+fleet.id,{dailyCapacity:1});const remaining=(await api('GET','/api/store-delivery/orders?date='+day)).data.find(o=>o.status==='待安排');assert.equal((await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:[remaining.id],departureTime:'14:00',fleetId:fleet.id})).status,409);});
test('LINE delivery notices require bound group, deduplicate, and stale versions cannot send',async()=>{
  const pending=(await api('GET','/api/store-delivery/orders?date='+day)).data.find(o=>o.status==='待安排');await api('PATCH','/api/shopee/fleets/'+fleet.id,{dailyCapacity:10});const t=(await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:[pending.id],departureTime:'15:00',fleetId:fleet.id})).data;
  assert.equal((await api('POST',`/api/store-delivery/trips/${t.id}/notify`)).status,409);await pool.query("INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES('DELIVERY_GROUP',$1,'test')",[fleet.id]);assert.equal((await api('POST',`/api/store-delivery/trips/${t.id}/notify`)).data.queued,true);assert.equal((await api('POST',`/api/store-delivery/trips/${t.id}/notify`)).data.duplicate,true);
  const text=await require('../deliveryLine').list(pool,{id:fleet.id,name:fleet.name});assert.match(text,/D0*\d+/);
  const job=(await pool.query("SELECT * FROM fleet_delivery_jobs WHERE payload->>'type'='delivery' LIMIT 1")).rows[0];
  const realFetch=global.fetch,oldSecret=process.env.LINE_CHANNEL_SECRET,oldToken=process.env.LINE_CHANNEL_ACCESS_TOKEN;let sent;
  process.env.LINE_CHANNEL_SECRET='delivery-test-secret';process.env.LINE_CHANNEL_ACCESS_TOKEN='dummy';
  global.fetch=async(url,opts)=>{if(String(url).startsWith('https://api.line.me/')){sent=JSON.parse(opts.body);return {ok:true,status:200,json:async()=>({})};}return realFetch(url,opts);};
  try{await require('../fleetJobs').deliverLine(job);assert.equal(sent.to,'DELIVERY_GROUP');assert.match(sent.messages[0].text,/蝦皮店到店 D/);await api('PUT',`/api/store-delivery/trips/${t.id}/sequence`,{orderIds:[pending.id]});await assert.rejects(()=>require('../fleetJobs').deliverLine(job),{code:'TASK_OR_GROUP_CHANGED'});}finally{global.fetch=realFetch;process.env.LINE_CHANNEL_SECRET=oldSecret;process.env.LINE_CHANNEL_ACCESS_TOKEN=oldToken;}
});
test('simultaneous dispatches cannot reserve the same driver and vehicle, including legacy port dispatch',async()=>{
  const ids=[];for(let i=0;i<2;i++){const ref='CONCURRENT-'+i;await order('A',{reference:ref});const o=(await api('GET','/api/store-delivery/orders?date='+day)).data.find(o=>o.reference===ref);ids.push((await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:[o.id],departureTime:'18:00'})).data.id);}
  const results=await Promise.all(ids.map(t=>api('POST',`/api/store-delivery/trips/${t}/dispatch`,{driverId:driver.id,vehicleId:vehicle.id})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const active=ids[results.findIndex(r=>r.status===200)];await pool.query("UPDATE drivers SET status='可派車' WHERE id=$1",[driver.id]);await pool.query("UPDATE vehicles SET status='可用' WHERE id=$1",[vehicle.id]);
  const legacy=(await pool.query("SELECT id FROM orders WHERE status='待派車' LIMIT 1")).rows[0];if(legacy)assert.equal((await api('PATCH','/api/orders/'+legacy.id+'/dispatch',{driverId:driver.id,vehicleId:vehicle.id})).status,409);
  assert.equal((await api('POST',`/api/store-delivery/trips/${active}/cancel`,{note:'測試取消'})).status,200);
});
test('failed audit rolls back order import atomically',async()=>{await pool.query("CREATE FUNCTION fail_delivery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='蝦皮門店訂單' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_delivery BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_delivery_audit()");try{assert.equal((await order('A',{reference:'AUDIT-FAIL'})).status,500);assert.equal((await pool.query("SELECT 1 FROM delivery_orders WHERE reference='AUDIT-FAIL'")).rowCount,0);}finally{await pool.query('DROP TRIGGER fail_delivery ON audit_logs; DROP FUNCTION fail_delivery_audit()');}});
test('linked confirmed demand is not double-counted and cannot be overfilled or erased',async()=>{
  const date='2026-12-01';await api('PATCH','/api/shopee/fleets/'+fleet.id,{dailyCapacity:2});
  await pool.query("INSERT INTO shopee_routes(id,service_date,origin,destination,vehicle_type,required_trucks) VALUES('LINKED-DEMAND',$1,'大園倉','跨區門店','11T',2)",[date]);
  const a=(await pool.query("INSERT INTO shopee_assignments(route_id,fleet_id,requested_trucks,confirmed_trucks,status) VALUES('LINKED-DEMAND',$1,2,2,'已確認') RETURNING id",[fleet.id])).rows[0];
  for(let i=0;i<3;i++){const ref='LINK-'+i;await order('A',{reference:ref,serviceDate:date});const o=(await api('GET','/api/store-delivery/orders?date='+date)).data.find(o=>o.reference===ref);const r=await api('POST','/api/store-delivery/trips',{requestId:crypto.randomUUID(),orderIds:[o.id],departureTime:'08:00',fleetId:fleet.id,assignmentId:a.id});assert.equal(r.status,i<2?201:409);}
  assert.equal(Number(await require('../fleetOperations').usedCapacity(pool,fleet.id,date)),2);
  assert.equal((await api('PATCH','/api/shopee/assignments/'+a.id,{confirmedTrucks:1})).status,409);
  assert.equal((await api('DELETE','/api/shopee/assignments/'+a.id)).status,409);assert.equal((await api('DELETE','/api/shopee/routes/LINKED-DEMAND')).status,409);
});
test('store imports accept a valid bounded batch above the legacy 100KB body limit',async()=>{
  const rows=Array.from({length:150},(_,i)=>store('BULK-'+i,'桃園市','觀音區',{source:'測試來源'.repeat(100)}));assert.ok(Buffer.byteLength(JSON.stringify({rows}))>100*1024);
  const r=await api('POST','/api/store-delivery/stores/import',{rows});assert.equal(r.status,201);assert.equal(r.data.imported,150);
});

test('custom task codes and LINE copy text show demand, names and safe input validation',async()=>{
 const date=require('../dates').todayInTaipei();await order('A',{reference:'CHECKIN-ORDER',serviceDate:date});const o=(await api('GET','/api/store-delivery/orders?date='+date)).data.find(o=>o.reference==='CHECKIN-ORDER');
 const body={requestId:crypto.randomUUID(),orderIds:[o.id],departureTime:'08:00',taskCode:'MY-30',taskName:'跨區測試路線',requiredCheckins:30};
 assert.equal((await api('POST','/api/store-delivery/trips',{...body,requiredCheckins:0})).status,400);
 const r=await api('POST','/api/store-delivery/trips',body);assert.equal(r.status,201);assert.equal(r.data.task_code,'MY-30');
 await pool.query('UPDATE delivery_trips SET fleet_id=$2 WHERE id=$1',[r.data.id,fleet.id]);
 const text=(await api('GET',`/api/store-delivery/trips/${r.data.id}/line-text`)).data.text;assert.match(text,/MY-30 跨區測試路線/);assert.match(text,/需求 30／已報到 0／尚缺 30/);assert.match(text,/車趟報到 MY-30/);
 assert.equal((await api('GET',`/api/store-delivery/trips/${r.data.id}/line-text`,undefined,null)).status,401);
});
test('signed LINE check-ins enforce fleet, unique person, replay protection, capacity and realtime counts',async()=>{
 const t=(await pool.query("SELECT * FROM delivery_trips WHERE task_code='MY-30'")).rows[0];
 const group='C'+'c'.repeat(32);await pool.query('DELETE FROM line_fleet_groups WHERE fleet_id=$1',[fleet.id]);await pool.query('INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES($1,$2,$3)',[group,fleet.id,'test']);
 async function send(user,text,eventId=crypto.randomUUID()) {const payload=JSON.stringify({events:[{type:'message',webhookEventId:eventId,timestamp:Date.now(),source:{type:'group',groupId:group,userId:user},message:{id:eventId,type:'text',text}}]});const r=await fetch(base+'/api/line/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':crypto.createHmac('sha256','delivery-test-secret').update(payload).digest('base64')},body:payload});assert.equal(r.status,200);return (await pool.query('SELECT reply_text FROM line_events WHERE event_id=$1',[eventId])).rows[0].reply_text;}
 const event=crypto.randomUUID();assert.match(await send('U-test-1','車趟報到 MY-30',event),/尚缺 29/);await send('U-test-1','車趟報到 MY-30',event);assert.match(await send('U-test-1','車趟報到 MY-30'),/未重複計數/);
 assert.equal(await require('../deliveryCheckins').counts(pool,t.id),1);assert.match(await send('U-test-1','車趟狀態 MY-30'),/尚缺 29/);
 assert.match(await send('U-test-2','車趟報到 OTHER'),/找不到/);
 await pool.query('UPDATE delivery_trips SET required_checkins=2 WHERE id=$1',[t.id]);
 await Promise.all([send('U-test-2','車趟報到 MY-30'),send('U-test-3','車趟報到 MY-30')]);assert.equal(await require('../deliveryCheckins').counts(pool,t.id),2);
 const reply=await send('U-test-1','車趟異常 MY-30 延誤 測試道路壅塞');assert.match(reply,/異常 I/);
 const i=(await pool.query('SELECT * FROM fleet_incidents WHERE delivery_trip_id=$1',[t.id])).rows[0];assert.ok(i);assert.equal(i.task_id,null);
 assert.equal((await api('GET','/api/fleet-ops/incidents/'+i.id)).status,200);
 const values=await require('../fleetSheets').rowValues('incidents',i.id);assert.equal(values[3],'MY-30');
 assert.ok((await pool.query("SELECT 1 FROM fleet_delivery_jobs WHERE job_key=$1",['sheet:incidents:'+i.id])).rowCount);
 const d=(await api('GET','/api/store-delivery/trips?date='+t.service_date)).data.find(x=>String(x.id)===String(t.id));assert.equal(d.checked_in,2);
});

test('incident-linked penalties require verified rules, reject fleet mismatch and duplicate cases, and queue Sheets',async()=>{
 const i=(await pool.query('SELECT * FROM fleet_incidents WHERE delivery_trip_id IS NOT NULL LIMIT 1')).rows[0];const date=require('../dates').todayInTaipei();
 const rule=(await pool.query("INSERT INTO penalty_rules(rule_code,version,title,terms,source,created_by,effective_date) VALUES('TEST-INCIDENT',1,'測試條款','測試條件','測試來源','test',$1) RETURNING *",[date])).rows[0];
 const body={fleetId:fleet.id,ruleId:rule.id,incidentId:i.id,occurredOn:date,responsibility:'僅測試人工責任覆核'};
 assert.equal((await api('POST','/api/penalty-cases',body)).status,409);
 await pool.query("UPDATE penalty_rules SET status='已核實',verified_by='test',verified_at=NOW() WHERE id=$1",[rule.id]);
 assert.equal((await api('POST','/api/penalty-cases',{...body,fleetId:'unknown'})).status,400);
 const r=await api('POST','/api/penalty-cases',body);assert.equal(r.status,201);assert.equal(String(r.data.incident_id),String(i.id));assert.equal(r.data.amount,null);assert.equal(r.data.points,null);
 assert.equal((await api('POST','/api/penalty-cases',body)).status,409);
 const values=await require('../fleetSheets').rowValues('penalties',r.data.id);assert.match(values[7],/異常 I/);assert.ok((await pool.query('SELECT 1 FROM fleet_delivery_jobs WHERE job_key=$1',['sheet:penalties:'+r.data.id])).rowCount);
});

test('LINE task formatter keeps commands when large routes need shortening',()=>{const c=require('../deliveryCheckins');const t={id:1,task_code:'TEST',task_name:'測試',service_date:day,departure_time:'08:00',warehouse_name:'測試倉',warehouse_address:'測試地址',status:'待派車',required_checkins:30};const stops=Array.from({length:200},(_,i)=>({stop_no:i+1,store_code:'S'+i,store_name:'測試店',city:'桃園市',district:'觀音區',address:'測試'.repeat(100)}));const text=c.format(t,stops,1,4200);assert.ok(text.length<=4200);assert.match(text,/車趟報到 TEST/);assert.match(text,/車趟異常 TEST/);assert.match(text,/尚缺 29/);});
