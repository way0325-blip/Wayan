const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {resetDatabase}=require('./stagingSetup');
process.env.JWT_SECRET='fleet-tests';process.env.ADMIN_USERNAME='admin';process.env.ADMIN_PASSWORD='1234';
process.env.LINE_CHANNEL_SECRET='fleet-line-test';process.env.LINE_CHANNEL_ACCESS_TOKEN='dummy';
const {pool,initDb}=require('../db');
const {runJobs}=require('../fleetJobs');
const {enqueueSheet,taskNumber}=require('../fleetOperations');
const {SHEETS}=require('../fleetSheetSchema');
let server,base,admin,ops,a,b,ta,tb,counter=0,incident;
const realFetch=global.fetch,cloudRows=new Map(),lineCalls=[],googleWrites=[];
const structuralRequests=[];
let shortTaskGrid=false;
let uncertainLine=false,wrongHeaders=false,failGoogleAfterWrite=false;
async function api(method,path,body,token=admin){
  const response=await realFetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:response.status===204?null:await response.json()};
}
function event(text,group='GROUP_A',id='fleet-event-'+(++counter)){return {type:'message',webhookEventId:id,replyToken:'reply-'+id,message:{type:'text',text},source:{type:'group',groupId:group,userId:'LINE_USER'}};}
async function send(e){const body=JSON.stringify({events:[e]});const r=await realFetch(base+'/api/line/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':crypto.createHmac('sha256','fleet-line-test').update(body).digest('base64')},body});return r.status;}
const lastReply=()=>lineCalls.filter(c=>c.kind==='reply').at(-1)?.body.messages[0].text||'';
async function newTask(fleet,extra={}){return api('POST','/api/fleet-ops/tasks',{requestId:crypto.randomUUID(),fleetId:fleet.id,title:'配送任務',serviceDate:'2026-11-10',origin:'台北',destination:'桃園',vehicleType:'11T',requestedTrucks:2,...extra});}
async function bind(fleet,group){const r=await api('POST','/api/fleet-ops/fleets/'+fleet.id+'/group-code');assert.equal(r.status,201);assert.equal(await send(event(r.data.command,group)),200);assert.match(lastReply(),/綁定完成/);}
function ok(data){return {ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data),headers:new Headers()};}
test.before(async()=>{
  await resetDatabase();await initDb();
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});process.env.WAYAN_GOOGLE_CLIENT_EMAIL='fleet-tests@example.invalid';process.env.WAYAN_GOOGLE_PRIVATE_KEY=pair.privateKey.export({format:'pem',type:'pkcs8'});
  global.fetch=async(url,options={})=>{
    const u=String(url);
    if(u.startsWith('https://api.line.me/')){
      const body=JSON.parse(options.body||'{}'),kind=u.endsWith('/message/reply')?'reply':'push';lineCalls.push({kind,body,key:options.headers?.['X-Line-Retry-Key']});
      if(kind==='push'&&uncertainLine){uncertainLine=false;throw new Error('simulated lost acknowledgement');}
      if(kind==='push'&&lineCalls.filter(c=>c.kind==='push'&&c.key===options.headers?.['X-Line-Retry-Key']).length>1)return {ok:false,status:409,headers:new Headers({'x-line-accepted-request-id':'already-accepted'})};
      return ok({});
    }
    if(u==='https://oauth2.googleapis.com/token')return ok({access_token:'fake-token',expires_in:3600});
    if(u.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')){
      const parsed=new URL(u),decoded=decodeURIComponent(parsed.pathname);
      if(parsed.searchParams.has('fields'))return ok({sheets:[{properties:{title:'營運總覽',sheetId:0,gridProperties:{rowCount:5001}}},...Object.values(SHEETS).map((s,i)=>({properties:{title:s.name,sheetId:i+1,gridProperties:{rowCount:shortTaskGrid&&s.name==='任務通知'?1:5001}}}))]});
      if(decoded.endsWith('/values:batchUpdate')){
        const body=JSON.parse(options.body);googleWrites.push(body);for(const item of body.data)cloudRows.set(item.range,item.values);
        if(failGoogleAfterWrite){failGoogleAfterWrite=false;throw new Error('simulated Google lost acknowledgement');}return ok({});
      }
      if(decoded.endsWith(':batchUpdate')){structuralRequests.push(JSON.parse(options.body));return ok({});}
      const range=decoded.split('/values/')[1];
      if(range?.endsWith('!A1:L1')){const name=range.split('!')[0].replaceAll("'",'');const spec=Object.values(SHEETS).find(s=>s.name===name);return ok({values:[wrongHeaders?['changed']:spec.headers]});}
      return ok({values:cloudRows.get(range)||[]});
    }
    if(/^https:/.test(u))throw new Error('Unexpected external request blocked in test');
    return realFetch(url,options);
  };
  server=require('../index').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
  admin=(await api('POST','/api/auth/login',{username:'admin',password:'1234'},null)).data.token;
  await api('POST','/api/users',{username:'fleet-ops',password:'pass1234',role:'dispatcher'});
  ops=(await api('POST','/api/auth/login',{username:'fleet-ops',password:'pass1234'},null)).data.token;
  a=(await api('POST','/api/shopee/fleets',{name:'甲車隊',dailyCapacity:10})).data;b=(await api('POST','/api/shopee/fleets',{name:'乙車隊',dailyCapacity:10})).data;
  await api('PUT','/api/fleet-ops/sheet-target',{spreadsheetId:'test_sheet_123456'});
});
test.after(async()=>{global.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
test('fleet APIs authenticate and restrict group codes, jobs and sheet settings to admin',async()=>{
  assert.equal((await api('GET','/api/fleet-ops/status',undefined,null)).status,401);
  assert.equal((await api('POST','/api/fleet-ops/fleets/'+a.id+'/group-code',{},ops)).status,403);
  assert.equal((await api('GET','/api/fleet-ops/jobs',undefined,ops)).status,403);
  assert.equal((await api('PUT','/api/fleet-ops/sheet-target',{spreadsheetId:'test_sheet_123456'},ops)).status,403);
});
test('fleet profile writes automatically enqueue cloud records',async()=>{
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM fleet_delivery_jobs WHERE job_key LIKE 'sheet:fleets:%'")).rows[0].n,2);
});
test('fleet group codes are hashed, replace older codes and expire',async()=>{
  const old=(await api('POST','/api/fleet-ops/fleets/'+a.id+'/group-code')).data.command;
  const current=(await api('POST','/api/fleet-ops/fleets/'+a.id+'/group-code')).data.command;
  await send(event(old));assert.match(lastReply(),/無效/);
  const row=(await pool.query('SELECT * FROM fleet_group_codes WHERE fleet_id=$1',[a.id])).rows[0];assert.notEqual(row.code_hash,current.split(' ')[1]);
  await pool.query("UPDATE fleet_group_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE fleet_id=$1",[a.id]);
  await send(event(current));assert.match(lastReply(),/過期/);
});
test('one Bot binds multiple groups to separate fleets without exposing binding codes',async()=>{
  await bind(a,'GROUP_A');await bind(b,'GROUP_B');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM line_fleet_groups')).rows[0].n,2);
  const raw=(await pool.query("SELECT payload::text AS p FROM line_events WHERE payload->'message'->>'text' LIKE '%群組綁定%'")).rows;
  assert.ok(raw.every(r=>r.p.includes('已隱藏')));
  assert.equal((await api('POST','/api/fleet-ops/fleets/'+a.id+'/group-code')).status,409);
});
test('task creation is idempotent and validates conflicting retries',async()=>{
  const requestId=crypto.randomUUID(),body={requestId,fleetId:a.id,title:'甲任務',serviceDate:'2026-11-10',origin:'甲起點',destination:'甲終點',vehicleType:'11T',requestedTrucks:2};
  const r=await api('POST','/api/fleet-ops/tasks',body);assert.equal(r.status,201);ta=r.data;
  const duplicate=await api('POST','/api/fleet-ops/tasks',body);assert.equal(duplicate.status,200);assert.equal(duplicate.data.id,ta.id);
  assert.equal((await api('POST','/api/fleet-ops/tasks',{...body,title:'不同內容'})).status,409);
  tb=(await newTask(b,{title:'乙任務',origin:'乙起點'})).data;
});
test('group task queries are fleet-scoped and unknown groups see no records',async()=>{
  await send(event('車隊任務'));assert.match(lastReply(),/甲任務|甲起點/);assert.doesNotMatch(lastReply(),/乙起點/);
  await send(event('車隊任務','GROUP_B'));assert.match(lastReply(),/乙起點/);assert.doesNotMatch(lastReply(),/甲起點/);
  await send(event('車隊任務','UNKNOWN'));assert.doesNotMatch(lastReply(),/甲起點|乙起點/);
});
test('cross-fleet acceptance and incident reports are rejected',async()=>{
  await send(event('承接 '+ta.number+' 1','GROUP_B'));assert.match(lastReply(),/本車隊/);
  await send(event('異常 '+ta.number+' 測試','GROUP_B'));assert.match(lastReply(),/本車隊/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM fleet_incidents')).rows[0].n,0);
});
test('notifications enqueue once and use the same LINE retry key after an uncertain response',async()=>{
  assert.equal((await api('POST','/api/fleet-ops/tasks/'+ta.id+'/notify')).status,202);
  assert.equal((await api('POST','/api/fleet-ops/tasks/'+ta.id+'/notify')).data.duplicate,true);
  uncertainLine=true;
  await runJobs({limit:20});
  const lineJob=(await pool.query("SELECT * FROM fleet_delivery_jobs WHERE kind='line'")).rows[0];assert.equal(lineJob.status,'failed');
  await pool.query('UPDATE fleet_delivery_jobs SET next_attempt_at=NOW() WHERE id=$1',[lineJob.id]);await runJobs({limit:20});
  assert.equal((await pool.query('SELECT status FROM fleet_delivery_jobs WHERE id=$1',[lineJob.id])).rows[0].status,'sent');
  const pushes=lineCalls.filter(c=>c.kind==='push');assert.equal(pushes.length,2);assert.equal(pushes[0].key,pushes[1].key);assert.equal(pushes[0].body.to,'GROUP_A');
});
test('acceptance rejects excess truck counts and duplicate redelivery only applies once',async()=>{
  await send(event('承接 '+ta.number+' 3'));assert.match(lastReply(),/1～2/);
  const e=event('承接 '+ta.number+' 2');assert.deepEqual(await Promise.all([send(e),send(e)]),[200,200]);
  assert.equal((await pool.query('SELECT status FROM fleet_work_orders WHERE id=$1',[ta.id])).rows[0].status,'已確認');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='承接' AND entity_id=$1",[ta.id])).rows[0].n,1);
});
test('fleet incident creates a case, history and cloud jobs atomically',async()=>{
  const e=event('貨損 '+ta.number+' =IMPORTDATA("malicious")');await send(e);await send(e);
  const list=(await api('GET','/api/fleet-ops/incidents')).data.items;assert.equal(list.length,1);incident=list[0];
  assert.match(incident.number,/^I/);assert.equal(incident.description,'=IMPORTDATA("malicious")');
  const detail=(await api('GET','/api/fleet-ops/incidents/'+incident.id)).data;assert.equal(detail.history.length,1);
  assert.match(lastReply(),/案件編號/);
});
test('case processing requires sequential review and administrator closure',async()=>{
  const path='/api/fleet-ops/incidents/'+incident.id;
  assert.equal((await api('PATCH',path,{status:'已結案',note:'跳關',resolution:'結果'})).status,409);
  assert.equal((await api('PATCH',path,{status:'處理中',note:'已聯絡車隊'},ops)).status,200);
  assert.equal((await api('PATCH',path,{status:'待確認',note:'完成調查',resolution:'已補送貨品'},ops)).status,200);
  assert.equal((await api('PATCH',path,{status:'已結案',note:'確認完成',resolution:'已補送貨品'},ops)).status,403);
  assert.equal((await api('PATCH',path,{status:'已結案',note:'確認完成',resolution:'已補送貨品'})).status,200);
  const detail=(await api('GET',path)).data;assert.equal(detail.history.length,4);assert.equal(detail.incident.status,'已結案');
});
test('cloud writes preserve record keys and treat user text as RAW rather than formulas',async()=>{
  await runJobs({limit:30});
  const writes=googleWrites.flatMap(w=>w.data).filter(x=>x.range.startsWith("'異常案件'!A"));assert.ok(writes.length>=1);
  assert.equal(writes.at(-1).values[0][0],incident.number);assert.equal(writes.at(-1).values[0][8],'=IMPORTDATA("malicious")');
  assert.ok(googleWrites.every(w=>w.valueInputOption==='RAW'));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM fleet_sheet_rows WHERE sheet_key='incidents' AND entity_id=$1",[incident.id])).rows[0].n,1);
});
test('newer changes during a running cloud write remain pending for delivery',async()=>{
  await pool.query("UPDATE fleet_delivery_jobs SET status='sent'");await enqueueSheet(pool,'tasks',ta.id);
  const id=(await pool.query("SELECT id FROM fleet_delivery_jobs WHERE job_key=$1",['sheet:tasks:'+ta.id])).rows[0].id;
  await runJobs({limit:1,deliverSheet:async()=>{await enqueueSheet(pool,'tasks',ta.id);}});
  assert.equal((await pool.query('SELECT status FROM fleet_delivery_jobs WHERE id=$1',[id])).rows[0].status,'pending');
});
test('uncertain Google acknowledgement retries to the same row without duplicate cases',async()=>{
  await pool.query("UPDATE fleet_delivery_jobs SET status='sent'");await enqueueSheet(pool,'incidents',incident.id);failGoogleAfterWrite=true;
  await runJobs({limit:1});const job=(await pool.query("SELECT * FROM fleet_delivery_jobs WHERE job_key=$1",['sheet:incidents:'+incident.id])).rows[0];assert.equal(job.status,'failed');
  const target=googleWrites.at(-1).data[0].range;
  await pool.query('UPDATE fleet_delivery_jobs SET next_attempt_at=NOW() WHERE id=$1',[job.id]);await runJobs({limit:1});
  assert.equal(googleWrites.at(-1).data[0].range,target);assert.equal((await pool.query('SELECT status FROM fleet_delivery_jobs WHERE id=$1',[job.id])).rows[0].status,'sent');
});
test('modified cloud headers stop sync before overwriting user data',async()=>{
  await pool.query("UPDATE fleet_delivery_jobs SET status='sent'");await enqueueSheet(pool,'tasks',ta.id);wrongHeaders=true;const before=googleWrites.length;
  try{await runJobs({limit:1});}finally{wrongHeaders=false;}
  assert.equal(googleWrites.length,before);assert.equal((await pool.query("SELECT error_code FROM fleet_delivery_jobs WHERE job_key=$1",['sheet:tasks:'+ta.id])).rows[0].error_code,'SHEET_HEADERS_CHANGED');
});
test('missing backend Google credentials are visible as blocked and never treated as sent',async()=>{
  await pool.query("UPDATE fleet_delivery_jobs SET status='sent'");await enqueueSheet(pool,'tasks',tb.id);const key=process.env.WAYAN_GOOGLE_PRIVATE_KEY;process.env.WAYAN_GOOGLE_PRIVATE_KEY='';
  try{await runJobs({limit:1});}finally{process.env.WAYAN_GOOGLE_PRIVATE_KEY=key;}
  const job=(await pool.query('SELECT status,attempts,error_code FROM fleet_delivery_jobs WHERE job_key=$1',['sheet:tasks:'+tb.id])).rows[0];assert.equal(job.status,'blocked');assert.equal(job.attempts,0);assert.equal(job.error_code,'GOOGLE_NOT_CONFIGURED');
});
test('manual fleet tasks and legacy shopee allocations share daily capacity',async()=>{
  const f=(await api('POST','/api/shopee/fleets',{name:'共同容量車隊',dailyCapacity:1})).data;
  assert.equal((await newTask(f,{requestedTrucks:1,serviceDate:'2026-11-12'})).status,201);
  assert.equal((await newTask(f,{requestedTrucks:1,serviceDate:'2026-11-12'})).status,409);
  await api('POST','/api/shopee/fleets/'+f.id+'/routes',{origin:'甲',destination:'乙',vehicleType:'11T',maxTrucks:1});
  const route=(await api('POST','/api/shopee/routes',{serviceDate:'2026-11-12',origin:'甲',destination:'乙',vehicleType:'11T',requiredTrucks:1})).data;
  assert.equal((await api('PUT','/api/shopee/routes/'+route.id+'/assignments',{assignments:[{fleetId:f.id,requestedTrucks:1}]})).status,409);
});
test('disabled fleets cannot query or mutate group tasks and retain their history',async()=>{
  await api('PATCH','/api/shopee/fleets/'+a.id,{status:'停用'});await send(event('車隊任務'));assert.match(lastReply(),/已停用/);
  assert.equal((await api('DELETE','/api/shopee/fleets/'+a.id)).status,409);await api('PATCH','/api/shopee/fleets/'+a.id,{status:'啟用'});
});
test('group unbinding immediately removes access to that fleet',async()=>{
  assert.equal((await api('DELETE','/api/fleet-ops/fleets/'+b.id+'/group')).status,204);await send(event('車隊任務','GROUP_B'));assert.doesNotMatch(lastReply(),/乙起點/);
});
test('arrival and completion advance only accepted tasks, and completion does not repeat',async()=>{
  await send(event('到站 '+ta.number));assert.match(lastReply(),/執行中/);
  await send(event('完成 '+ta.number));assert.match(lastReply(),/已完成/);
  await send(event('完成 '+ta.number));assert.match(lastReply(),/不會重複/);
  assert.equal((await pool.query('SELECT status FROM fleet_work_orders WHERE id=$1',[ta.id])).rows[0].status,'已完成');
});
test('case write failure rolls back incident and history; redelivery can safely retry',async()=>{
  const before=(await pool.query('SELECT count(*)::int AS n FROM fleet_incidents')).rows[0].n;
  await pool.query(`CREATE FUNCTION reject_case_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$;
    CREATE TRIGGER test_case_fail BEFORE INSERT ON fleet_incident_history FOR EACH ROW EXECUTE FUNCTION reject_case_history()`);
  const e=event('事故 '+ta.number+' 回報測試');
  try{assert.equal(await send(e),503);assert.equal((await pool.query('SELECT count(*)::int AS n FROM fleet_incidents')).rows[0].n,before);}finally{await pool.query('DROP TRIGGER test_case_fail ON fleet_incident_history; DROP FUNCTION reject_case_history()');}
  assert.equal(await send(e),200);assert.equal((await pool.query('SELECT count(*)::int AS n FROM fleet_incidents')).rows[0].n,before+1);
});
test('full resync requeues records without creating duplicate job keys',async()=>{
  const before=(await pool.query('SELECT count(*)::int AS n FROM fleet_delivery_jobs')).rows[0].n;
  assert.equal((await api('POST','/api/fleet-ops/sheet-resync')).status,202);
  assert.equal((await api('POST','/api/fleet-ops/sheet-resync')).status,202);
  const rows=(await pool.query('SELECT job_key,count(*)::int AS n FROM fleet_delivery_jobs GROUP BY job_key')).rows;
  assert.ok(rows.every(r=>r.n===1));assert.ok(rows.length>=before);
});
test('invalid write responses roll back all writes in the shared transactional router',async()=>{
  const before=(await pool.query('SELECT count(*)::int AS n FROM fleet_work_orders')).rows[0].n;
  const bad=await newTask(a,{requestedTrucks:999});assert.equal(bad.status,400);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM fleet_work_orders')).rows[0].n,before);
});
test('cloud row growth extends formatting and summary formulas without writing user input as formulas',async()=>{
  await pool.query("UPDATE fleet_delivery_jobs SET status='sent'");await enqueueSheet(pool,'tasks',ta.id);shortTaskGrid=true;
  try{await runJobs({limit:1});}finally{shortTaskGrid=false;}
  const requests=structuralRequests.at(-1).requests;
  assert.ok(requests.some(r=>r.appendDimension));assert.ok(requests.some(r=>r.copyPaste?.pasteType==='PASTE_FORMAT'));
  const formulas=requests.find(r=>r.updateCells).updateCells.rows;
  assert.ok(formulas.some(r=>r.values[0].userEnteredValue.formulaValue.includes('1001')));
});
