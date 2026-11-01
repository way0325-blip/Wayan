const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {resetDatabase}=require('./stagingSetup');
Object.assign(process.env,{JWT_SECRET:'intake-test',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'1234',LINE_CHANNEL_SECRET:'intake-signature-test',LINE_CHANNEL_ACCESS_TOKEN:'test-only',WAYAN_FLEET_SHEET_ID:'TEST_SHEET_INCIDENTS',WAYAN_GOOGLE_CLIENT_EMAIL:'synthetic@example.invalid',WAYAN_GOOGLE_PRIVATE_KEY:crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'})});
const {pool,initDb}=require('../db'),{SHEETS}=require('../fleetSheetSchema');
const realFetch=global.fetch;let server,base,seq=0,reply='',replyCount=0,denyWrite=false,failReply=false;const cells=new Map(),writes=[];
async function send(text,{user='USER_A',group='INTAKE_GROUP',id='intake-'+(++seq),privateMessage=false,signature}={}){
 const body=JSON.stringify({events:[{webhookEventId:id,type:'message',replyToken:'reply-'+id,timestamp:Date.now(),source:privateMessage?{type:'user',userId:user}:{type:'group',groupId:group,userId:user},message:{id:'msg-'+id,type:'text',text}}]});
 const r=await realFetch(base+'/api/line/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':signature||crypto.createHmac('sha256','intake-signature-test').update(body).digest('base64')},body});return {status:r.status,id,reply};
}
const count=async()=>Number((await pool.query('SELECT count(*) n FROM fleet_incidents')).rows[0].n);
test.before(async()=>{
 await resetDatabase();await initDb();await pool.query("INSERT INTO partner_fleets(id,name) VALUES('INTAKE_A','測試甲車隊'),('INTAKE_B','測試乙車隊')");await pool.query("INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES('INTAKE_GROUP','INTAKE_A','test'),('OTHER_GROUP','INTAKE_B','test')");
 global.fetch=async(url,options={})=>{
  const u=String(url),ok=value=>({ok:true,status:200,json:async()=>value});
  if(u.startsWith('https://api.line.me/')){if(failReply)return {ok:false,status:500};reply=JSON.parse(options.body).messages[0].text;replyCount++;return ok({});}
  if(u==='https://oauth2.googleapis.com/token')return ok({access_token:'synthetic-google-token',expires_in:3600});
  if(u.startsWith('https://sheets.googleapis.com/')){
   if(u.includes('?fields='))return ok({sheets:Object.values(SHEETS).map((s,i)=>({properties:{title:s.name,sheetId:i+1,gridProperties:{rowCount:5001,columnCount:12}}}))});
   if(u.includes('/values:batchUpdate')){if(denyWrite)return {ok:false,status:403};const b=JSON.parse(options.body);writes.push(b);for(const row of b.data)cells.set(row.range,row.values);return ok({});}
   if(u.includes('/values/')){const range=decodeURIComponent(u.split('/values/')[1]);if(range.endsWith('!A1:L1')){const spec=Object.values(SHEETS).find(s=>range.startsWith("'"+s.name+"'!"));return ok({values:[spec.headers]});}return ok({values:cells.get(range)||[]});}
  }
  throw Error('Unexpected external request');
 };
 server=require('../index').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{global.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
test('invalid signatures, unbound groups and private messages cannot create fleet reports',async()=>{
 assert.equal((await send('異常回報',{signature:'invalid'})).status,401);
 assert.match((await send('異常回報',{group:'UNBOUND'})).reply,/尚未綁定/);
 assert.match((await send('異常回報',{privateMessage:true})).reply,/車隊LINE群組/);assert.equal(await count(),0);
});
test('report keyword replies with instructions and stores one scoped session; redelivery sends no duplicate reply',async()=>{
 const before=replyCount,r=await send('異常回報');assert.equal(r.status,200);assert.match(r.reply,/10分鐘/);assert.equal(await count(),0);await send('異常回報',{id:r.id});assert.equal(replyCount,before+1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM line_incident_sessions')).rows[0].n,1);
});
test('sessions belong to each group and person and allow business commands without creating incidents',async()=>{
 await send('這是其他人的聊天',{user:'USER_B'});await send('這是其他群組的聊天',{group:'OTHER_GROUP'});await send('門店車趟');assert.equal(await count(),0);assert.equal((await pool.query('SELECT count(*)::int n FROM line_incident_sessions')).rows[0].n,1);
});
test('follow-up text creates incident, audit, history and sheet jobs before confirming receipt; replay is idempotent',async()=>{
 const r=await send('延誤 大園倉等候裝貨超過30分鐘');assert.equal(r.status,200);assert.match(r.reply,/異常已受理/);assert.match(r.reply,/尚未確認雲端寫入完成/);await send('延誤 大園倉等候裝貨超過30分鐘',{id:r.id});assert.equal(await count(),1);
 const i=(await pool.query('SELECT * FROM fleet_incidents')).rows[0];assert.equal(i.report_scope,'車隊');assert.equal(i.task_id,null);assert.equal(i.delivery_trip_id,null);assert.equal(i.kind,'延誤');assert.equal(i.fleet_id,'INTAKE_A');assert.equal(i.description,'大園倉等候裝貨超過30分鐘');
 assert.equal((await pool.query('SELECT count(*)::int n FROM fleet_incident_history WHERE incident_id=$1',[i.id])).rows[0].n,1);assert.ok((await pool.query("SELECT 1 FROM audit_logs WHERE entity='車隊異常' AND entity_id=$1",[String(i.id)])).rowCount);
 assert.ok((await pool.query('SELECT 1 FROM fleet_delivery_jobs WHERE job_key=$1',['sheet:incidents:'+i.id])).rowCount);
});
test('real Sheets adapter sends RAW content to the incident and history tabs; status query reflects successful delivery',async()=>{
 await require('../fleetJobs').runJobs({limit:30});assert.ok(writes.some(b=>b.valueInputOption==='RAW'&&b.data.some(r=>r.range.startsWith("'異常案件'!")&&r.values[0][8]==='大園倉等候裝貨超過30分鐘')));assert.ok(writes.some(b=>b.data.some(r=>r.range.startsWith("'異常處理歷程'!"))));
 const i=(await pool.query('SELECT id FROM fleet_incidents LIMIT 1')).rows[0];assert.match((await send('異常進度 I'+i.id)).reply,/已同步Google Sheets/);assert.match((await send('異常進度 I'+i.id,{group:'OTHER_GROUP'})).reply,/找不到/);
});
test('one-shot report preserves formula-like text as RAW; failed cloud writes never claim success and can retry',async()=>{
 denyWrite=true;const r=await send('異常回報 =IMPORTXML("example")');assert.match(r.reply,/已受理/);const i=(await pool.query('SELECT * FROM fleet_incidents ORDER BY id DESC LIMIT 1')).rows[0];await require('../fleetJobs').runJobs({limit:20});assert.match((await send('異常進度 I'+i.id)).reply,/同步失敗/);
 denyWrite=false;await pool.query("UPDATE fleet_delivery_jobs SET next_attempt_at=NOW() WHERE status='failed'");await require('../fleetJobs').runJobs({limit:20});assert.match((await send('異常進度 I'+i.id)).reply,/已同步Google Sheets/);assert.ok(writes.some(b=>b.valueInputOption==='RAW'&&b.data.some(r=>r.values[0][8]==='=IMPORTXML("example")')));
});
test('cancel, expired sessions, overlong descriptions and empty category do not create reports',async()=>{
 const before=await count();await send('異常回報');await send('取消回報');await send('一般聊天');assert.equal(await count(),before);
 await send('異常回報');await pool.query("UPDATE line_incident_sessions SET expires_at=NOW()-INTERVAL '1 second'");assert.match((await send('其他 逾時內容')).reply,/逾10分鐘/);assert.equal(await count(),before);
 assert.match((await send('異常回報 '+ '字'.repeat(1001))).reply,/1～1000/);assert.match((await send('異常回報 延誤')).reply,/補上說明/);assert.equal(await count(),before);
});
test('audit failure rolls back report and keeps session available for safe webhook redelivery',async()=>{
 await send('異常回報');const before=await count();await pool.query("CREATE FUNCTION fail_intake_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='車隊異常' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_intake BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_intake_audit()");
 const r=await send('事故 測試事故說明');assert.equal(r.status,503);assert.equal(await count(),before);assert.equal((await pool.query('SELECT count(*)::int n FROM line_incident_sessions')).rows[0].n,1);await pool.query('DROP TRIGGER fail_intake ON audit_logs;DROP FUNCTION fail_intake_audit()');assert.equal((await send('事故 測試事故說明',{id:r.id})).status,200);assert.equal(await count(),before+1);
});
test('reply failure is recorded without replaying business effects',async()=>{
 const before=await count();failReply=true;const r=await send('異常回報 貨損 測試紙箱破損');failReply=false;assert.equal(r.status,200);assert.equal((await pool.query('SELECT delivery_status FROM line_events WHERE event_id=$1',[r.id])).rows[0].delivery_status,'failed');await send('異常回報 貨損 測試紙箱破損',{id:r.id});assert.equal(await count(),before+1);
});
test('missing Google credentials report pending setup and general reports retain database constraints',async()=>{
 const key=process.env.WAYAN_GOOGLE_PRIVATE_KEY;process.env.WAYAN_GOOGLE_PRIVATE_KEY='';await require('../fleetJobs').runJobs({limit:30});const i=(await pool.query('SELECT id FROM fleet_incidents ORDER BY id DESC LIMIT 1')).rows[0];assert.match((await send('異常進度 I'+i.id)).reply,/等待管理員/);process.env.WAYAN_GOOGLE_PRIVATE_KEY=key;
 await assert.rejects(()=>pool.query("INSERT INTO fleet_incidents(fleet_id,kind,description,reported_by) VALUES('INTAKE_A','其他','缺少任務的舊型記錄','test')"),{code:'23514'});
});
test('new incidents take priority over older bulk spreadsheet catalog jobs',async()=>{
 await pool.query("UPDATE fleet_delivery_jobs SET status='sent'");const {enqueueSheet}=require('../fleetOperations');await enqueueSheet(pool,'fleets','INTAKE_A');const i=(await pool.query('SELECT id FROM fleet_incidents LIMIT 1')).rows[0];await enqueueSheet(pool,'incidents',i.id);let selected;
 await require('../fleetJobs').runJobs({limit:1,deliverSheet:async p=>{selected=p.key;}});assert.equal(selected,'incidents');
});
