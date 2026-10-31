const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {resetDatabase}=require('./stagingSetup');
Object.assign(process.env,{JWT_SECRET:'rules-live-tests',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'1234',LINE_CHANNEL_SECRET:'live-test-secret',LINE_CHANNEL_ACCESS_TOKEN:'fake-token'});
const {pool,initDb}=require('../db'),{todayInTaipei}=require('../dates');
let server,base,token,ops,a,b,id,id2,rule,reply='',seq=0;const realFetch=global.fetch,pushes=[];
async function api(method,path,body,auth=token){const r=await realFetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:r.status===204?null:await r.json()};}
async function line(text,group='A',eventId='live-'+(++seq),type='message'){
  const body=JSON.stringify({events:[{type,webhookEventId:eventId,replyToken:'reply-'+eventId,source:{type:'group',groupId:group,userId:'TEST_USER'},message:{type:'text',text}}]});
  return realFetch(base+'/api/line/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':crypto.createHmac('sha256','live-test-secret').update(body).digest('base64')},body});
}
const report=(total,auth=token,note='測試人工補登')=>api('POST',`/api/shopee-live/fleets/${a.id}/reports`,{serviceDate:todayInTaipei(),total,note},auth);
test.before(async()=>{
  await resetDatabase();await initDb();server=require('../index').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
  global.fetch=async(url,options)=>{if(String(url).startsWith('https://api.line.me/')){const body=JSON.parse(options.body);if(String(url).endsWith('/reply'))reply=body.messages[0].text;else pushes.push(body);return {ok:true,status:200,json:async()=>({}),headers:new Headers()};}if(String(url).startsWith('https:'))throw Error('Unexpected external request');return realFetch(url,options);};
  token=(await api('POST','/api/auth/login',{username:'admin',password:'1234'},null)).data.token;
  await api('POST','/api/users',{username:'live-dispatch',password:'pass1234',role:'dispatcher'});ops=(await api('POST','/api/auth/login',{username:'live-dispatch',password:'pass1234'},null)).data.token;
  a=(await api('POST','/api/shopee/fleets',{name:'總數甲隊',dailyCapacity:10})).data;b=(await api('POST','/api/shopee/fleets',{name:'總數乙隊',dailyCapacity:10})).data;
  await pool.query("INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES('A',$1,'test'),('B',$2,'test')",[a.id,b.id]);
  await pool.query("INSERT INTO shopee_routes(id,service_date,origin,destination,vehicle_type,required_trucks) VALUES('LIVE1',$1,'台北','桃園','11T',5),('LIVE2',$1,'桃園','台中','11T',2)",[todayInTaipei()]);
  id=(await pool.query("INSERT INTO shopee_assignments(route_id,fleet_id,requested_trucks) VALUES('LIVE1',$1,3) RETURNING id",[a.id])).rows[0].id;
  id2=(await pool.query("INSERT INTO shopee_assignments(route_id,fleet_id,requested_trucks,confirmed_trucks,status) VALUES('LIVE2',$1,2,2,'已確認') RETURNING id",[b.id])).rows[0].id;
});
test.after(async()=>{global.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
const ruleBody=()=>({ruleCode:'R-001',title:'測試條款',terms:'測試內容並非營運規則',source:'測試文件 v1 第1頁',points:0.1,proposedAmount:'123.45'});
test('new APIs authenticate, restrict admins, and do not seed private rules',async()=>{
  assert.equal((await api('GET','/api/penalty-rules',undefined,null)).status,401);assert.deepEqual((await api('GET','/api/penalty-rules')).data,[]);
  assert.equal((await api('POST','/api/penalty-rules',ruleBody(),ops)).status,403);assert.equal((await api('GET','/api/fleet-ops/groups',undefined,ops)).status,403);
});
test('rule validation rejects invalid money, points, dates and sources',async()=>{
  for(const extra of [{source:''},{proposedAmount:-1},{proposedAmount:true},{points:true},{points:0.001},{effectiveDate:'2026-02-30'}])assert.equal((await api('POST','/api/penalty-rules',{...ruleBody(),...extra})).status,400);
});
test('decimal points, unknown effective dates, immutable versions and review history persist',async()=>{
  const r=await api('POST','/api/penalty-rules',ruleBody());assert.equal(r.status,201);rule=r.data;assert.equal(Number(rule.points),0.1);assert.equal(rule.effective_date,null);
  assert.equal((await api('POST',`/api/penalty-rules/${rule.id}/review`,{status:'已核實',note:'測試覆核依據'})).status,200);
  assert.equal((await api('POST','/api/penalty-rules',ruleBody())).data.version,2);
  assert.equal((await api('POST',`/api/penalty-rules/${rule.id}/review`,{status:'已停用',note:'測試換版'})).status,200);
  assert.equal((await api('POST',`/api/penalty-rules/${rule.id}/review`,{status:'已核實',note:'不得重啟'})).status,409);
  assert.equal((await api('GET',`/api/penalty-rules/${rule.id}/history`)).data.length,3);
});
test('signed group discovery isolates fleets and supports Shopee acceptance',async()=>{
  await line('蝦皮任務','A');assert.match(reply,new RegExp('S0*'+id+' '));assert.doesNotMatch(reply,new RegExp('S0*'+id2+' '));
  await line(`蝦皮承接 S${id} 3`,'B');assert.match(reply,/找不到本車隊/);await line(`蝦皮承接 S${id} 3`);assert.match(reply,/已登記承接 3 趟/);
  const groups=(await api('GET','/api/fleet-ops/groups')).data;assert.equal(groups.find(g=>g.group_id==='A').bot_present,true);
});
test('fleet reports use cumulative totals rather than increments and deduplicate replay',async()=>{
  await line('蝦皮報到 1','A','total-one');await line('蝦皮報到 1','A','total-one');await line('蝦皮報到 1');assert.match(reply,/不會重複累加/);
  await line('蝦皮報到 2');assert.match(reply,/累計報到 2 車/);
  const rows=(await api('GET',`/api/shopee-live/fleets/${a.id}/reports`)).data;assert.equal(rows.length,2);assert.equal(rows[0].reported_total,2);
});
test('group members cannot lower totals or exceed confirmed capacity',async()=>{
  await line('蝦皮報到 1');assert.match(reply,/不可降低/);await line('蝦皮報到 4');assert.match(reply,/不可超過/);
  await line('蝦皮報到 1','B');assert.match(reply,/累計報到 1 車/);
});
test('summary compares each fleet cumulative total against its own confirmed trips',async()=>{
  const r=await api('GET','/api/shopee-live');assert.equal(r.data.required,7);const f=r.data.fleets.find(f=>f.fleet_id===a.id);assert.equal(f.reported,2);assert.equal(f.confirmed,3);assert.equal(f.source,'LINE');
  assert.equal((await api('GET','/api/shopee-live?date=2026-02-30')).status,400);
});
test('admin correction requires a reason and preserves all earlier totals',async()=>{
  assert.equal((await report(1,ops)).status,409);assert.equal((await report(1,token,'')).status,400);assert.equal((await report(1)).data.report.source,'管理員更正');
  assert.equal((await api('GET',`/api/shopee-live/fleets/${a.id}/reports`)).data.length,3);
});
test('simultaneous equal totals create one report; stale lower totals cannot overwrite',async()=>{
  const r=await Promise.all([report(3,ops),report(3,ops)]);assert.equal(r.filter(r=>r.data.duplicate).length,1);assert.equal((await report(2,ops)).status,409);
  assert.equal((await api('GET','/api/shopee-live')).data.fleets.find(f=>f.fleet_id===a.id).reported,3);
});
test('existing dispatch writes cannot reduce commitment below reported total or erase history',async()=>{
  assert.equal((await api('PATCH',`/api/shopee/assignments/${id}`,{confirmedTrucks:1})).status,409);
  assert.equal((await api('PATCH',`/api/shopee/assignments/${id}`,{reset:true})).status,409);
  assert.equal((await api('DELETE',`/api/shopee/assignments/${id}`)).status,409);assert.equal((await api('DELETE','/api/shopee/routes/LIVE1')).status,409);
});
test('report and audit are atomic when audit storage fails',async()=>{
  await pool.query("CREATE FUNCTION fail_report_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='蝦皮報到' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_report BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_report_audit()");
  try{assert.equal((await report(0)).status,500);assert.equal((await api('GET','/api/shopee-live')).data.fleets.find(f=>f.fleet_id===a.id).reported,3);}finally{await pool.query('DROP TRIGGER fail_report ON audit_logs; DROP FUNCTION fail_report_audit()');}
});
test('manual import validates every group before writing and never fabricates presence',async()=>{
  const groupId='C'+'1'.repeat(32);assert.equal((await api('POST','/api/fleet-ops/groups/import',{groups:[{name:'待驗證群',groupId},{name:'錯誤',groupId:'bad'}]})).status,400);
  assert.equal((await api('POST','/api/fleet-ops/groups/import',{groups:[{name:'待驗證群',groupId}]})).status,200);
  assert.equal((await api('POST',`/api/fleet-ops/fleets/${b.id}/group`,{groupId})).status,409);
  const g=(await api('GET','/api/fleet-ops/groups')).data.find(g=>g.group_id===groupId);assert.equal(g.bot_present,null);
});
test('fleet creation with group selection is atomic and verified group is reusable after unbind',async()=>{
  const groupId='C'+'1'.repeat(32);await line('hello',groupId);
  const r=await api('POST','/api/shopee/fleets',{name:'群組選擇測試隊',groupId});assert.equal(r.status,201);
  assert.equal((await api('POST','/api/shopee/fleets',{name:'不可重綁測試隊',groupId})).status,409);
  assert.equal((await pool.query("SELECT 1 FROM partner_fleets WHERE name='不可重綁測試隊'")).rowCount,0);
  await line('',groupId,'leave-event','leave');const g=(await api('GET','/api/fleet-ops/groups')).data.find(g=>g.group_id===groupId);assert.equal(g.bot_present,false);assert.equal(g.fleet_id,null);
});
test('Shopee notification uses bound group and immutable retry job',async()=>{
  assert.equal((await api('POST',`/api/shopee-live/${id}/notify`)).data.queued,true);assert.equal((await api('POST',`/api/shopee-live/${id}/notify`)).data.duplicate,true);
  const job=(await pool.query("SELECT * FROM fleet_delivery_jobs WHERE payload->>'type'='shopee'")).rows[0];await require('../fleetJobs').deliverLine(job);assert.equal(pushes.at(-1).to,'A');assert.match(pushes.at(-1).messages[0].text,/累計總車數/);
});
test('private catalog importer is idempotent, pending review, and never invents effective dates',async()=>{
  const catalog=[{ruleCode:'LOCAL-ONLY',title:'本機測試條款',terms:'測試用',source:'測試文件第1頁',points:0.1,proposedAmount:null}];
  const {importRuleDrafts}=require('../importRuleDrafts');assert.equal(await importRuleDrafts(pool,catalog),1);assert.equal(await importRuleDrafts(pool,catalog),0);
  const row=(await pool.query("SELECT * FROM penalty_rules WHERE rule_code='LOCAL-ONLY'")).rows[0];assert.equal(row.status,'草稿');assert.equal(row.effective_date,null);
});
test('report transactions emit database notifications used by authenticated SSE',async()=>{
  const {Client}=require('pg'),client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();await client.query('LISTEN wayan_changes');
  try{const notified=new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('No notification')),2000);client.once('notification',m=>{clearTimeout(t);resolve(m.payload);});});await report(0);assert.equal(await notified,'shopee_fleet_reports');}finally{await client.end();}
});
test('unverified rules never create fines, and case confirmation requires explicit admin points and money',async()=>{
  const body={...ruleBody(),ruleCode:'CASE-RULE',effectiveDate:todayInTaipei()};
  const r=(await api('POST','/api/penalty-rules',body)).data;
  const draft={ruleId:r.id,fleetId:a.id,occurredOn:todayInTaipei(),responsibility:'人工調查的測試事實'};
  assert.equal((await api('POST','/api/penalty-cases',draft)).status,409);
  await api('POST',`/api/penalty-rules/${r.id}/review`,{status:'已核實',note:'核對測試條款來源'});
  const c=(await api('POST','/api/penalty-cases',draft)).data;assert.equal(c.points,null);assert.equal(c.amount,null);
  assert.equal((await api('POST',`/api/penalty-cases/${c.id}/review`,{status:'已確認',points:0.1,amount:100,note:'測試'},ops)).status,403);
  assert.equal((await api('POST',`/api/penalty-cases/${c.id}/review`,{status:'已確認',note:'缺金額與點數'})).status,400);
  assert.equal((await api('POST',`/api/penalty-cases/${c.id}/review`,{status:'已確認',points:0.1,amount:100,note:'主管確認責任與金額'})).status,200);
  await api('POST',`/api/penalty-cases/${c.id}/appeal`,{note:'提出證據請求覆核'},ops);
  assert.equal((await api('POST',`/api/penalty-cases/${c.id}/review`,{status:'已撤銷',note:'主管採納申訴'})).data.amount,'0.00');
  assert.equal((await api('GET',`/api/penalty-cases/${c.id}/history`)).data.length,4);
  assert.equal((await pool.query("SELECT count(*)::int n FROM fleet_delivery_jobs WHERE job_key LIKE 'sheet:penaltyHistory:%'")).rows[0].n,4);
  const {rowValues}=require('../fleetSheets');const cells=await rowValues('penalties',c.id);assert.equal(cells[4],'已撤銷');assert.equal(cells[6],0);
  assert.equal((await rowValues('rules',r.id))[4],0.1);
});
