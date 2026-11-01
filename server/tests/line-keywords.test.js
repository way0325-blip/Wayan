const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');const {resetDatabase}=require('./stagingSetup');
Object.assign(process.env,{JWT_SECRET:'keyword-test-secret',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'1234',LINE_CHANNEL_SECRET:'keyword-signature-test',LINE_CHANNEL_ACCESS_TOKEN:'dummy'});
const {pool,initDb}=require('../db');const realFetch=global.fetch;let server,base,token,ops,fleet,reply='',counter=0;
async function api(method,path,body,auth=token){const r=await realFetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
async function send(text,group='KEYWORD_GROUP',id='keyword-'+(++counter)){
  const body=JSON.stringify({events:[{type:'message',webhookEventId:id,replyToken:id,source:{type:'group',groupId:group,userId:'KEYWORD_USER'},message:{type:'text',text}}]});
  const r=await realFetch(base+'/api/line/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':crypto.createHmac('sha256','keyword-signature-test').update(body).digest('base64')},body});assert.equal(r.status,200);
}
test.before(async()=>{await resetDatabase();await initDb();global.fetch=async(url,options)=>{if(String(url).startsWith('https://api.line.me/')){reply=JSON.parse(options.body).messages[0].text;return {ok:true,status:200,json:async()=>({})};}throw Error('Unexpected external request');};server=require('../index').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
token=(await api('POST','/api/auth/login',{username:'admin',password:'1234'},null)).data.token;await api('POST','/api/users',{username:'keyword-ops',password:'pass1234',role:'dispatcher'});ops=(await api('POST','/api/auth/login',{username:'keyword-ops',password:'pass1234'},null)).data.token;
fleet=(await api('POST','/api/shopee/fleets',{name:'關鍵字測試車隊'})).data;await pool.query("INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES('KEYWORD_GROUP',$1,'test')",[fleet.id]);});
test.after(async()=>{global.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();});
test('six safe default replies require admin access to manage',async()=>{assert.equal((await api('GET','/api/fleet-ops/keywords',undefined,null)).status,401);assert.equal((await api('GET','/api/fleet-ops/keywords',undefined,ops)).status,403);assert.equal((await api('GET','/api/fleet-ops/keywords')).data.length,6);});
test('bound fleet receives guidance without registering a report or incident',async()=>{await send('報到');assert.match(reply,/尚未登記報到/);await send('異常');assert.match(reply,/尚未建立案件/);assert.equal((await pool.query('SELECT count(*)::int n FROM shopee_fleet_reports')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int n FROM fleet_incidents')).rows[0].n,0);});
test('custom replies support exact matching, updates, disable and transactional audit',async()=>{
  const b={keyword:'服務時間',reply:'測試窗口待確認',enabled:true};assert.equal((await api('PUT','/api/fleet-ops/keywords',b,ops)).status,403);assert.equal((await api('PUT','/api/fleet-ops/keywords',b)).status,200);await send('服務時間');assert.equal(reply,b.reply);await send('服務時間？');assert.notEqual(reply,b.reply);
  await api('PUT','/api/fleet-ops/keywords',{...b,enabled:false});await send('服務時間');assert.notEqual(reply,b.reply);assert.equal((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE entity='LINE關鍵字'")).rows[0].n,2);
});
test('reserved operational commands and invalid reply inputs are rejected',async()=>{for(const keyword of ['蝦皮報到','蝦皮任務','任務','完成'])assert.equal((await api('PUT','/api/fleet-ops/keywords',{keyword,reply:'不得蓋掉',enabled:true})).status,409);for(const b of [{keyword:'含 空白',reply:'a',enabled:true},{keyword:'測試',reply:'',enabled:true},{keyword:'測試',reply:'a',enabled:'true'}])assert.equal((await api('PUT','/api/fleet-ops/keywords',b)).status,400);await send('蝦皮任務');assert.match(reply,/今日蝦皮任務/);});
test('unbound and disabled fleets never receive custom group information',async()=>{await api('PUT','/api/fleet-ops/keywords',{keyword:'內部資訊',reply:'限定已綁定車隊',enabled:true});await send('內部資訊','UNBOUND');assert.doesNotMatch(reply,/限定已綁定車隊/);await pool.query("UPDATE partner_fleets SET status='停用' WHERE id=$1",[fleet.id]);await send('內部資訊');assert.match(reply,/停用/);});
test('failed audit rolls back keyword write',async()=>{await pool.query("CREATE FUNCTION keyword_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity='LINE關鍵字' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$; CREATE TRIGGER keyword_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION keyword_fail()");try{assert.equal((await api('PUT','/api/fleet-ops/keywords',{keyword:'回滾測試',reply:'不應保留',enabled:true})).status,500);assert.equal((await pool.query("SELECT 1 FROM line_keyword_replies WHERE keyword='回滾測試'")).rowCount,0);}finally{await pool.query('DROP TRIGGER keyword_fail ON audit_logs; DROP FUNCTION keyword_fail()');}});
test('activity feed authenticates, filters fleets, deduplicates and does not expose binding codes or raw payload',async()=>{
  assert.equal((await api('GET','/api/fleet-ops/activity',undefined,null)).status,401);
  assert.equal((await api('GET','/api/fleet-ops/activity?before=invalid')).status,400);
  await send('動態測試','KEYWORD_GROUP','feed-one');await send('動態測試','KEYWORD_GROUP','feed-one');
  const r=(await api('GET','/api/fleet-ops/activity?fleetId='+fleet.id)).data;
  assert.equal(r.items.filter(e=>e.event_id==='feed-one').length,1);assert.equal(r.items[0].fleet_name,fleet.name);assert.ok(!('payload' in r.items[0]));assert.ok(!('group_id' in r.items[0]));
  assert.deepEqual((await api('GET','/api/fleet-ops/activity?fleetId=OTHER')).data.items,[]);
  await send('車隊群組綁定 '+'a'.repeat(22));assert.ok(!(await api('GET','/api/fleet-ops/activity')).data.items.some(e=>e.content.includes('a'.repeat(22))));
});
test('fleet attribution stays with original fleet after unbinding and status lists every fleet',async()=>{
  await pool.query('DELETE FROM line_fleet_groups WHERE fleet_id=$1',[fleet.id]);
  assert.ok((await api('GET','/api/fleet-ops/activity?fleetId='+fleet.id)).data.items.length>0);
  const f=(await api('GET','/api/fleet-ops/activity-status')).data.find(f=>f.id===fleet.id);assert.equal(f.bound,false);
  await pool.query("INSERT INTO line_fleet_groups(group_id,fleet_id,bound_by) VALUES('KEYWORD_GROUP',$1,'test')",[fleet.id]);
});
test('unsend hides feed text and clears original inbox text; out-of-order unsend suppresses later message',async()=>{
  async function raw(e){const body=JSON.stringify({events:[e]});const r=await realFetch(base+'/api/line/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':crypto.createHmac('sha256','keyword-signature-test').update(body).digest('base64')},body});assert.equal(r.status,200);}
  const source={type:'group',groupId:'KEYWORD_GROUP',userId:'KEYWORD_USER'};
  await raw({type:'message',webhookEventId:'unsend-original',source,message:{type:'text',id:'MSG1',text:'應被移除的文字'}});
  await raw({type:'unsend',webhookEventId:'unsend-event',source,unsend:{messageId:'MSG1'}});
  const e=(await api('GET','/api/fleet-ops/activity')).data.items.find(e=>e.event_id==='unsend-original');assert.equal(e.hidden,true);assert.equal(e.content,'此訊息已收回');
  assert.doesNotMatch(JSON.stringify((await pool.query("SELECT payload FROM line_events WHERE event_id='unsend-original'")).rows),/應被移除/);
  await raw({type:'unsend',webhookEventId:'unsend-before',source,unsend:{messageId:'MSG2'}});
  await raw({type:'message',webhookEventId:'late-message',source,message:{type:'text',id:'MSG2',text:'不應出現的文字'}});
  assert.ok(!(await api('GET','/api/fleet-ops/activity')).data.items.some(e=>e.content.includes('不應出現')));
});
test('activity pagination preserves PostgreSQL microseconds without skipping same-millisecond events',async()=>{
  await pool.query(`INSERT INTO line_events(event_id,payload,status) SELECT 'page-'||n,'{}'::jsonb,'processed' FROM generate_series(1,55) n`);
  await pool.query(`INSERT INTO fleet_line_activity(event_id,fleet_id,group_id,event_type,content,sender_label,received_at)
    SELECT 'page-'||n,$1,'KEYWORD_GROUP','message','分頁測試','測試',TIMESTAMPTZ '2099-01-01 00:00:00+00'+n*INTERVAL '1 microsecond' FROM generate_series(1,55) n`,[fleet.id]);
  const page1=(await api('GET','/api/fleet-ops/activity')).data;assert.equal(page1.items.length,50);assert.ok(page1.nextCursor);
  const page2=(await api('GET','/api/fleet-ops/activity?before='+encodeURIComponent(page1.nextCursor))).data;
  const ids=[...page1.items,...page2.items].filter(i=>i.event_id.startsWith('page-')).map(i=>i.event_id);assert.equal(new Set(ids).size,55);assert.equal(ids.length,55);
});
