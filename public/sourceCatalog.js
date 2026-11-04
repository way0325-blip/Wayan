(() => {
 const el=id=>document.getElementById(id),esc=v=>escapeHTML(String(v??'')),states=new Map();
 const labels={drivers:'雲端司機名冊',parking:'園區停車場清冊',vehicles:'S-SOC 車輛名冊',cars:'汽車造冊名單',NB:'店配路線（N）',FN:'隔日到貨路線（F）',WB:'黑箱隔日到貨路線（W）'};
 const fields={drivers:[['externalDriverId','司機編號'],['name','姓名'],['phone','手機'],['vehicleType','車型'],['licenseType','駕照類型'],['license','證照期限'],['warehouse','倉別'],['sourceStatus','來源狀態']],parking:[['supplier','供應商'],['plate','車牌'],['vehicleType','車型'],['use','車輛用途'],['externalDriverId','車主司機編號']],vehicles:[['plate','車牌'],['vehicleType','車型'],['driverName','來源司機姓名'],['externalDriverId','來源司機編號']],cars:[['plate','車牌'],['vehicleType','車型'],['phone','聯絡電話'],['registeredOn','登錄日期'],['submitted','提交狀態']]};
 const message=(kind,value)=>{el('sourceMessage-'+kind).textContent=value;};
 const isRoute=kind=>['NB','FN','WB'].includes(kind);
 async function routeOptions(kind,state,generation){
  if(!isRoute(kind)||state.optionsBatch===state.data.batchId)return;
  const result=await api('/api/source-catalog/'+kind+'/options');if(generation!==state.generation)return;
  state.optionsBatch=result.batchId;state.options=result.routes;
  el('sourceRouteChoice-'+kind).innerHTML='<option value="">請選擇路線編號（每條路線為一趟）</option>'+result.routes.map(r=>`<option value="${esc(r.routeCode)}">${esc(r.routeCode)}｜${r.stopCount}站｜${esc(r.vehicleType||'車型待確認')}｜${esc(r.firstStop)} → ${esc(r.lastStop)}${r.blocked?'｜待核對':''}</option>`).join('');
  if(result.routes.some(r=>r.routeCode===state.choice))el('sourceRouteChoice-'+kind).value=state.choice;
 }
 const hub=document.createElement('section');hub.className='panel';hub.id='sourceCatalogHub';hub.innerHTML='<h2>Google 名冊與路線資料</h2><p id="sourceHubStatus" class="hint" role="status">登入後自動載入已同步資料。</p><div class="workspace-metrics">'+[['drivers','司機名冊','drivers'],['parking','園區停車名冊','vehicles'],['vehicles','車輛名冊','vehicles'],['routes','蝦皮路線範本','orders']].map(([key,label,page])=>`<button class="workspace-metric" data-source-page="${page}" type="button"><span>${label}</span><strong id="sourceHub-${key}">—</strong><small>查看已同步資料 ↗</small></button>`).join('')+'</div>';
 el('workspaceLive').insertAdjacentElement('afterend',hub);
 function updateHub(){
  const total=k=>states.get(k)?.catalogTotal,values={drivers:total('drivers'),parking:total('parking')};
  for(const [key,kinds]of [['vehicles',['vehicles','cars']],['routes',['NB','FN','WB']]])values[key]=kinds.every(k=>Number.isInteger(total(k)))?kinds.reduce((sum,k)=>sum+total(k),0):undefined;
  for(const [key,value]of Object.entries(values))el('sourceHub-'+key).textContent=Number.isInteger(value)?value.toLocaleString('zh-TW'):'—';
  const failed=[...states.values()].some(s=>s.error),ready=[...states.values()].every(s=>Number.isInteger(s.catalogTotal)&&!s.loading);
  el('sourceHubStatus').textContent=failed?'部分資料讀取失敗，請進入對應名冊查看錯誤並重試。':ready?'已載入雲端同步名冊與路線範本。點選下方項目直接查看；來源紀錄須核對後才能安排派車。':'正在載入已同步資料…';
 }
 async function load(kind,page=1){const state=states.get(kind),generation=++state.generation,query=el('sourceSearch-'+kind).value;state.loading=true;message(kind,'讀取名冊…');try{const data=await api('/api/source-catalog/'+kind+'?page='+page+'&q='+encodeURIComponent(query));if(generation!==state.generation)return;state.data=data;state.error=false;if(!query.trim())state.catalogTotal=data.total;await routeOptions(kind,state,generation);if(generation!==state.generation)return;render(kind,data);state.loading=false;updateHub();message(kind,data.batchId?'已同步 '+(state.catalogTotal??data.total)+' 筆 · 更新於 '+new Date(data.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未更新來源資料，請由管理員先預覽匯入。');return data;}catch(e){if(generation===state.generation){state.error=true;state.loading=false;message(kind,e.message);updateHub();}}}
 function render(kind,data){
  const route=isRoute(kind),columns=route?[['routeCode','路線編號'],['vehicleType','車型'],['timeWindow','來源出車時段'],['dock','碼頭'],['sourceDriverId','來源司機編號']]:fields[kind];
  el('sourceCount-'+kind).textContent=`搜尋結果 ${data.total} 筆 · 全名冊待核對 ${data.blocked||0} 筆`;
  el('sourceTable-'+kind).innerHTML=data.records.length?'<table><thead><tr>'+(route?'<th>選擇</th>':'')+columns.map(([,label])=>'<th>'+esc(label)+'</th>').join('')+'<th>檢核／車趟組合</th></tr></thead><tbody>'+data.records.map((r,index)=>'<tr>'+(route?`<td><input type="radio" name="sourceRoute-${kind}" data-source-pick="${kind}" value="${esc(r.routeCode)}" aria-label="選取路線 ${esc(r.routeCode)}" ${states.get(kind).choice===r.routeCode?'checked':''}></td>`:'')+columns.map(([key])=>'<td>'+esc(r[key]||'—')+'</td>').join('')+'<td>'+esc(r.problems.length?r.problems.join('；'):'來源格式通過，仍須人工核對')+(route?`<details><summary>${r.stops.length} 站停靠順序</summary><ol>${r.stops.map(s=>'<li>'+esc(s.name)+'<br>'+esc(s.address)+'</li>').join('')}</ol></details><button class="action small admin-only hidden" data-source-build="${kind}" data-index="${index}" ${r.problems.length?'disabled':''}>使用此路線組合車趟</button>`:'')+'</td></tr>').join('')+'</tbody></table>':'<p class="empty">沒有符合的來源紀錄。</p>';
  el('sourcePage-'+kind).textContent=`第 ${data.page||1} 頁／${Math.max(1,Math.ceil(data.total/50))} 頁`;
  el('sourcePrev-'+kind).disabled=(data.page||1)<=1;el('sourceNext-'+kind).disabled=(data.page||1)*50>=data.total;
  // Dynamically rendered admin controls follow the same role as existing administration controls.
  const adminVisible=getRole()==='admin';
  if(adminVisible)el('sourceTable-'+kind).querySelectorAll('.admin-only').forEach(n=>n.classList.remove('hidden'));
 }
 function preview(kind,result,rows){const state=states.get(kind);state.pending={...result,rows};const p=result.preview;message(kind,`預覽 ${p.count} 筆，待核對 ${p.blocked} 筆，其他問題 ${p.issues.length} 項。新增 ${result.changes?.added||0}、異動 ${result.changes?.changed||0}、來源未出現 ${result.changes?.absent||0}（舊版本保留）。尚未儲存。`);el('sourceCommit-'+kind).classList.remove('hidden');el('sourcePreview-'+kind).innerHTML='<details open><summary>本次更新預覽（前10筆）</summary><ul>'+p.records.slice(0,10).map(r=>'<li>'+esc(r.routeCode||r.externalDriverId||r.plate||r.key)+' · '+esc(r.name||r.vehicleType||'')+' · '+esc(r.problems.join('；')||'格式通過')+'</li>').join('')+'</ul><p>有問題的來源資料會保留標示，不會自動成為可派車資源。</p></details>';}
 for(const [page,kinds]of [['drivers',['drivers']],['vehicles',['parking','vehicles','cars']],['orders',['NB','FN','WB']]]){
  const wrap=document.createElement('details');wrap.open=true;wrap.className='panel';wrap.id='sourceSection-'+page;wrap.innerHTML=`<summary>${page==='orders'?'已同步蝦皮路線範本 → 當日車趟':page==='drivers'?'已同步司機名冊':'已同步車輛與園區停車名冊'}</summary><p class="hint">保留原始試算表。依來源編號／車牌核對，不以姓名自動合併，不複製帳號、密碼或證件號碼。更新不會刪除既有派車資源。</p>`;
  for(const kind of kinds){states.set(kind,{generation:0});wrap.insertAdjacentHTML('beforeend',`<section class="panel"><h3>${labels[kind]}</h3><div class="control-toolbar"><input id="sourceSearch-${kind}" aria-label="搜尋${labels[kind]}" placeholder="編號、車牌、姓名或路線"><button class="action secondary" data-source-load="${kind}">搜尋／更新畫面</button><button class="action secondary admin-only hidden" data-source-pull="${kind}">從 Google 預覽更新</button><label class="admin-only hidden">匯入私人快照 <input type="file" id="sourceFile-${kind}" accept=".json"></label><button class="action admin-only hidden" id="sourceCommit-${kind}">確認儲存本次來源版本</button></div><p class="hint" id="sourceCount-${kind}"></p><p role="status" id="sourceMessage-${kind}">展開後按「搜尋／更新畫面」載入。</p><div id="sourcePreview-${kind}"></div><div class="table-wrap" id="sourceTable-${kind}"></div><div class="control-toolbar"><button class="action secondary small" id="sourcePrev-${kind}">上一頁</button><span id="sourcePage-${kind}"></span><button class="action secondary small" id="sourceNext-${kind}">下一頁</button></div></section>`);
  }
  el(page).prepend(wrap);
  for(const kind of kinds)if(isRoute(kind)){
   el('sourceTable-'+kind).insertAdjacentHTML('beforebegin',`<div class="control-toolbar"><label for="sourceRouteChoice-${kind}">車趟組合路線編號</label><select id="sourceRouteChoice-${kind}" aria-label="${labels[kind]}路線編號清單"><option value="">正在載入路線清單…</option></select><button class="action admin-only hidden" id="sourceUseRoute-${kind}" type="button">使用選取路線</button></div><p class="hint">每條路線包含完整門店停靠組合，選取後可調整本次車趟順序；原始路線範本保留。</p>`);
   el('sourceRouteChoice-'+kind).addEventListener('change',async event=>{states.get(kind).choice=event.target.value;el('sourceSearch-'+kind).value=event.target.value;await load(kind);});
   el('sourceUseRoute-'+kind).addEventListener('click',async event=>{event.target.disabled=true;try{const code=el('sourceRouteChoice-'+kind).value;if(!code)throw Error('請先選擇路線編號');el('sourceSearch-'+kind).value=code;const data=await load(kind),index=data?.records.findIndex(r=>r.routeCode===code);if(index===undefined||index<0)throw Error('所選路線已變更，請重新載入');await build(kind,index);}catch(e){message(kind,e.message);}finally{event.target.disabled=false;}});
  }
  if(getToken()&&getRole()==='admin')wrap.querySelectorAll('.admin-only').forEach(n=>n.classList.remove('hidden'));
  wrap.addEventListener('toggle',()=>{if(wrap.open&&getToken())for(const kind of kinds)if(!states.get(kind).data)load(kind);});
 }
 for(const kind of Object.keys(labels)){
  el('sourceCommit-'+kind).disabled=true;
  el('sourceCommit-'+kind).addEventListener('click',async event=>{const state=states.get(kind),pending=state.pending;if(!pending)return;event.target.disabled=true;try{const result=await api('/api/source-catalog/'+kind+'/import',{method:'POST',body:JSON.stringify({rows:pending.rows,digest:pending.preview.digest,expectedBatchId:pending.expectedBatchId})});state.pending=null;el('sourcePreview-'+kind).textContent='';el('sourceSearch-'+kind).value='';await load(kind);message(kind,`已更新來源批次 ${result.batchId}（${result.count} 筆）。自有派車資源保持人工核對。`);}catch(e){message(kind,e.message);event.target.disabled=false;}});
  el('sourceFile-'+kind).addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file||file.size>3*1024*1024)throw Error('請選擇3MB以內的私人快照JSON');const json=JSON.parse(await file.text());if(json.spreadsheetId!=='12nj_N2zUrNHnYi0krf1kgorfqtJpz6y6MrMvAJ0WXSc')throw Error('來源試算表不符');const rows=json.datasets?.find(d=>d.kind===kind)?.rows;if(!rows)throw Error('快照沒有這個分頁');const result=await api('/api/source-catalog/'+kind+'/preview',{method:'POST',body:JSON.stringify({rows})});preview(kind,result,rows);el('sourceCommit-'+kind).disabled=false;}catch(e){message(kind,e.message);}});
  el('sourcePrev-'+kind).addEventListener('click',()=>load(kind,Math.max(1,(states.get(kind).data?.page||1)-1)));
  el('sourceNext-'+kind).addEventListener('click',()=>load(kind,(states.get(kind).data?.page||1)+1));
 }
 document.addEventListener('click',async event=>{
  const pick=event.target.closest('[data-source-pick]');if(pick){const kind=pick.dataset.sourcePick;states.get(kind).choice=pick.value;el('sourceRouteChoice-'+kind).value=pick.value;return;}
  const jump=event.target.closest('[data-source-page]');if(jump){const page=jump.dataset.sourcePage;document.querySelector(`.nav-btn[data-page="${page}"]`)?.click();const section=el('sourceSection-'+page);section.open=true;section.scrollIntoView?.({block:'start',behavior:'smooth'});return;}
  const nav=event.target.closest('.nav-btn[data-page]');if(nav&&getToken()){const page=nav.dataset.page,kinds={drivers:['drivers'],vehicles:['parking','vehicles','cars'],orders:['NB','FN','WB']}[page];if(kinds)for(const kind of kinds)load(kind);}
  const button=event.target.closest('[data-source-load],[data-source-pull],[data-source-build]');if(!button)return;
  const kind=button.dataset.sourceLoad||button.dataset.sourcePull||button.dataset.sourceBuild;
  if(button.dataset.sourceLoad){load(kind);return;}
  button.disabled=true;
  try{if(button.dataset.sourcePull){const result=await api('/api/source-catalog/'+kind+'/pull',{method:'POST',body:'{}'});preview(kind,result,result.rows);el('sourceCommit-'+kind).disabled=false;}
   else await build(kind,Number(button.dataset.index));
  }catch(e){message(kind,e.message);}finally{button.disabled=false;}
 });
 async function build(kind,index){
  const data=states.get(kind).data,route=data?.records[index];if(!route)throw Error('路線已變更，請重新載入');if(route.problems.length)throw Error('所選路線仍有待核對問題，請先核對完整停靠站及配送範圍。');
  let ordered=route.stops.slice();
  const config=await api('/api/store-delivery/config');
  el('sourceBuildModal')?.remove();
  document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="sourceBuildModal"><div class="modal-box"><div class="modal-head"><h3>建立 ${esc(route.routeCode)} 當日車趟</h3><button class="close" id="sourceBuildClose">×</button></div><form id="sourceBuildForm"><p>整條路線 ${route.stops.length} 站，依 G 欄順序建立1趟／需求1車；建立後再人工派車。來源司機不會自動指派。</p><div class="field"><label>作業日期</label><input type="date" id="sourceBuildDate" required value="${esc(el('deliveryDate')?.value||'')}"></div><div class="field"><label>實際取貨點</label><select id="sourceBuildPickup" required><option value="">請選擇</option>${config.pickupPoints.filter(p=>p.box_type===route.boxType).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label>實際出發時間（來源時段 ${esc(route.timeWindow||'未提供')}）</label><input type="time" id="sourceBuildTime" required></div><div class="field"><label>每站件數（本表未提供，請先確認；各站不同請使用訂單CSV）</label><input type="number" id="sourceBuildQuantity" required min="1" max="100000"></div><label><input type="checkbox" id="sourceBuildVerified" required> 我已核對全部停靠站名稱、地址、順序及件數</label><p role="alert" id="sourceBuildError"></p><button class="primary">確認建立待派車趟</button></form></div></div>`);
  el('sourceBuildClose').addEventListener('click',()=>el('sourceBuildModal').remove());
  el('sourceBuildError').insertAdjacentHTML('beforebegin','<h3>本次車趟停靠順序</h3><p class="hint">可上下移動站點；只影響本次車趟，不修改Google來源範本。</p><div id="sourceBuildStops" class="table-wrap"></div><button class="action secondary" type="button" id="sourceResetOrder">恢復來源順序</button>');
  const draw=()=>{el('sourceBuildStops').innerHTML='<table><thead><tr><th>本次順序</th><th>門店／地址</th><th>調整</th></tr></thead><tbody>'+ordered.map((s,i)=>`<tr><td>${i+1}<br><small>原站序 ${s.sequence}</small></td><td>${esc(s.name)}<br>${esc(s.address)}</td><td><button class="action secondary small" type="button" data-source-up="${i}" ${i===0?'disabled':''}>上移</button><button class="action secondary small" type="button" data-source-down="${i}" ${i===ordered.length-1?'disabled':''}>下移</button></td></tr>`).join('')+'</tbody></table>';};draw();
  el('sourceResetOrder').addEventListener('click',()=>{ordered=route.stops.slice();draw();});
  el('sourceBuildStops').addEventListener('click',event=>{const b=event.target.closest('[data-source-up],[data-source-down]');if(!b)return;const i=Number(b.dataset.sourceUp??b.dataset.sourceDown),j=i+(b.dataset.sourceUp!==undefined?-1:1);if(ordered[j]){[ordered[i],ordered[j]]=[ordered[j],ordered[i]];draw();}});
  el('sourceBuildForm').addEventListener('submit',async event=>{event.preventDefault();const submit=event.target.querySelector('button.primary');submit.disabled=true;try{const serviceDate=el('sourceBuildDate').value,result=await api('/api/source-catalog/'+kind+'/build-trip',{method:'POST',body:JSON.stringify({batchId:data.batchId,routeCode:route.routeCode,serviceDate,departureTime:el('sourceBuildTime').value,pickupPointId:el('sourceBuildPickup').value,quantity:Number(el('sourceBuildQuantity').value),verified:el('sourceBuildVerified').checked,stopOrder:ordered.map(s=>s.sequence)})});el('sourceBuildModal').remove();document.dispatchEvent(new CustomEvent('wayan:shopee-date',{detail:serviceDate}));el('deliveryRefresh').click();message(kind,`車趟 ${result.taskCode||result.tripId} ${result.duplicate?'已存在，未重複建立':'已建立'}。可至下方車趟清單「明細／調整順序／派車」繼續操作。`);}catch(e){el('sourceBuildError').textContent=e.message;submit.disabled=false;}});
 }
 let sessionToken;
 function beginSession(){const token=getToken();if(!token||sessionToken===token)return;sessionToken=token;for(const [kind,state]of states){state.data=null;state.catalogTotal=undefined;state.optionsBatch=undefined;state.error=false;state.pending=null;el('sourceSearch-'+kind).value='';load(kind);}updateHub();}
 document.addEventListener('wayan:session',()=>{if(getToken())beginSession();else{sessionToken=null;for(const [kind,state]of states){state.generation++;state.data=null;state.catalogTotal=undefined;el('sourceTable-'+kind).textContent='';}updateHub();el('sourceHubStatus').textContent='登入後自動載入已同步資料。';}});
 beginSession();
 window.WayanSourceCatalog={load};
})();
