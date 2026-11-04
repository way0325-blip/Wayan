import assert from 'node:assert/strict';
export async function verifySourceCatalog({JSDOM,VirtualConsole},base){
 assert.equal(base,'http://127.0.0.1:3081');const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=await JSDOM.fromURL(base,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.fetch=(u,o)=>fetch(new URL(u,base),o);w.TextDecoder=TextDecoder;w.AbortController=AbortController;}}),w=dom.window,d=w.document,el=id=>d.getElementById(id);
 const until=async fn=>{for(let i=0;i<180;i++){if(fn())return;await new Promise(r=>setTimeout(r,60));}throw Error('Source DOM timeout');};
 try{
  await until(()=>el('sourceSection-drivers'));el('loginUser').value='admin';el('loginPassword').value='1234';el('loginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!el('app').classList.contains('hidden'));
  const rows=[{sourceRow:3,cells:{2:'<img src=x onerror=alert(1)>',6:'2099/12/31',7:'0900000000',10:'DOM-SOURCE'}}],preview=await w.api('/api/source-catalog/drivers/preview',{method:'POST',body:JSON.stringify({rows})});
  await w.api('/api/source-catalog/drivers/import',{method:'POST',body:JSON.stringify({rows,digest:preview.preview.digest,expectedBatchId:preview.expectedBatchId})});
  d.querySelector('.nav-btn[data-page="drivers"]').click();el('sourceSection-drivers').open=true;await until(()=>el('sourceTable-drivers').textContent.includes('DOM-SOURCE'));assert.equal(el('sourceTable-drivers').querySelector('img'),null);assert.ok(el('sourceTable-drivers').textContent.includes('<img'));assert.ok(!d.querySelector('[data-source-pull="drivers"]').classList.contains('hidden'));
  const routes=[{sourceRow:2,cells:{1:'NB-DOM-SOURCE',6:'2',7:'測試二店',8:'桃園市大園區測試路2號'}},{sourceRow:3,cells:{6:'1',7:'測試一店',8:'桃園市觀音區測試路1號'}}];
  const rp=await w.api('/api/source-catalog/NB/preview',{method:'POST',body:JSON.stringify({rows:routes})});await w.api('/api/source-catalog/NB/import',{method:'POST',body:JSON.stringify({rows:routes,digest:rp.preview.digest,expectedBatchId:rp.expectedBatchId})});
  d.querySelector('.nav-btn[data-page="orders"]').click();el('sourceSection-orders').open=true;await until(()=>d.querySelector('[data-source-build="NB"]'));const btn=d.querySelector('[data-source-build="NB"]');assert.ok(!btn.classList.contains('hidden'));btn.click();await until(()=>el('sourceBuildForm'));assert.equal(el('sourceBuildTime').value,'');assert.equal(el('sourceBuildQuantity').value,'');assert.equal(el('sourceBuildPickup').options.length,4);
  el('sourceBuildDate').value='2027-01-04';el('sourceBuildTime').value='01:30';el('sourceBuildQuantity').value='1';el('sourceBuildPickup').value='DAYUAN_SITE';el('sourceBuildVerified').checked=true;el('sourceBuildForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!el('sourceBuildForm'));assert.match(el('sourceMessage-NB').textContent,/已建立/);
  const trips=await w.api('/api/store-delivery/trips?date=2027-01-04');assert.equal(trips.filter(t=>t.task_code==='20270104-NB-DOM-SOURCE').length,1);const trip=trips.find(t=>t.task_code==='20270104-NB-DOM-SOURCE');assert.equal(trip.driver_id,null);assert.equal(trip.fleet_id,null);const stops=await w.api('/api/store-delivery/trips/'+trip.id+'/stops');assert.equal(stops[0].store_name,'測試一店');assert.deepEqual(errors,[]);
  return ['司機來源名冊可登入查詢且保留原有頁面','來源文字HTML跳脫不執行','管理員路線建趟按鈕及三個橘箱取貨點','未臆造件數與實際出發時間','核對後建立一趟多站且資料庫順序一致','建立後不自動指派來源司機或車隊'];
 }finally{w.WayanControl?.stop();w.close();}
}
