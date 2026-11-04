(() => {
 const el=id=>document.getElementById(id),esc=v=>escapeHTML(String(v??'')),states=new Map();
 const labels={drivers:'雲端司機名冊',parking:'園區停車場清冊',vehicles:'S-SOC 車輛名冊',cars:'汽車造冊名單',NB:'店配路線（N）',FN:'隔日到貨路線（F）',WB:'黑箱隔日到貨路線（W）'};
 const fields={drivers:[['externalDriverId','司機編號'],['name','姓名'],['phone','手機'],['vehicleType','車型'],['licenseType','駕照類型'],['license','證照期限'],['warehouse','倉別'],['sourceStatus','來源狀態']],parking:[['supplier','供應商'],['plate','車牌'],['vehicleType','車型'],['use','車輛用途'],['externalDriverId','車主司機編號']],vehicles:[['plate','車牌'],['vehicleType','車型'],['driverName','來源司機姓名'],['externalDriverId','來源司機編號']],cars:[['plate','車牌'],['vehicleType','車型'],['phone','聯絡電話'],['registeredOn','登錄日期'],['submitted','提交狀態']]};
 const message=(kind,value)=>{el('sourceMessage-'+kind).textContent=value;};
 async function load(kind,page=1){const state=states.get(kind),generation=++state.generation;message(kind,'讀取名冊…');try{const data=await api('/api/source-catalog/'+kind+'?page='+page+'&q='+encodeURIComponent(el('sourceSearch-'+kind).value));if(generation!==state.generation)return;state.data=data;render(kind,data);message(kind,data.batchId?'來源批次 '+data.batchId+' · '+new Date(data.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未更新來源資料，請由管理員先預覽匯入。');}catch(e){if(generation===state.generation)message(kind,e.message);}}
 function render(kind,data){
  const route=['NB','FN','WB'].includes(kind),columns=route?[['routeCode','路線編號'],['vehicleType','車型'],['timeWindow','來源出車時段'],['dock','碼頭'],['sourceDriverId','來源司機編號']]:fields[kind];
  el('sourceCount-'+kind).textContent=`搜尋結果 ${data.total} 筆 · 全名冊待核對 ${data.blocked||0} 筆`;
  el('sourceTable-'+kind).innerHTML=data.records.length?'<table><thead><tr>'+columns.map(([,label])=>'<th>'+esc(label)+'</th>').join('')+'<th>檢核／明細</th></tr></thead><tbody>'+data.records.map((r,index)=>'<tr>'+columns.map(([key])=>'<td>'+esc(r[key]||'—')+'</td>').join('')+'<td>'+esc(r.problems.length?r.problems.join('；'):'來源格式通過，仍須人工核對')+(route?`<details><summary>${r.stops.length} 站停靠順序</summary><ol>${r.stops.map(s=>'<li>'+esc(s.name)+'<br>'+esc(s.address)+'</li>').join('')}</ol></details><button class="action small admin-only hidden" data-source-build="${kind}" data-index="${index}" ${r.problems.length?'disabled':''}>建立當日車趟</button>`:'')+'</td></tr>').join('')+'</tbody></table>':'<p class="empty">沒有符合的來源紀錄。</p>';
  el('sourcePage-'+kind).textContent=`第 ${data.page||1} 頁／${Math.max(1,Math.ceil(data.total/50))} 頁`;
  el('sourcePrev-'+kind).disabled=(data.page||1)<=1;el('sourceNext-'+kind).disabled=(data.page||1)*50>=data.total;
  // Dynamically rendered admin controls follow the same role as existing administration controls.
  const adminVisible=getRole()==='admin';
  if(adminVisible)el('sourceTable-'+kind).querySelectorAll('.admin-only').forEach(n=>n.classList.remove('hidden'));
 }
 function preview(kind,result,rows){const state=states.get(kind);state.pending={...result,rows};const p=result.preview;message(kind,`預覽 ${p.count} 筆，待核對 ${p.blocked} 筆，其他問題 ${p.issues.length} 項。新增 ${result.changes?.added||0}、異動 ${result.changes?.changed||0}、來源未出現 ${result.changes?.absent||0}（舊版本保留）。尚未儲存。`);el('sourceCommit-'+kind).classList.remove('hidden');el('sourcePreview-'+kind).innerHTML='<details open><summary>本次更新預覽（前10筆）</summary><ul>'+p.records.slice(0,10).map(r=>'<li>'+esc(r.routeCode||r.externalDriverId||r.plate||r.key)+' · '+esc(r.name||r.vehicleType||'')+' · '+esc(r.problems.join('；')||'格式通過')+'</li>').join('')+'</ul><p>有問題的來源資料會保留標示，不會自動成為可派車資源。</p></details>';}
 for(const [page,kinds]of [['drivers',['drivers']],['vehicles',['parking','vehicles','cars']],['orders',['NB','FN','WB']]]){
  const wrap=document.createElement('details');wrap.className='panel';wrap.id='sourceSection-'+page;wrap.innerHTML=`<summary>${page==='orders'?'雲端路線範本 → 當日車趟':'雲端來源名冊（與自有派車資源分開）'}</summary><p class="hint">保留原始試算表。依來源編號／車牌核對，不以姓名自動合併，不複製帳號、密碼或證件號碼。更新不會刪除既有派車資源。</p>`;
  for(const kind of kinds){states.set(kind,{generation:0});wrap.insertAdjacentHTML('beforeend',`<section class="panel"><h3>${labels[kind]}</h3><div class="control-toolbar"><input id="sourceSearch-${kind}" aria-label="搜尋${labels[kind]}" placeholder="編號、車牌、姓名或路線"><button class="action secondary" data-source-load="${kind}">搜尋／更新畫面</button><button class="action secondary admin-only hidden" data-source-pull="${kind}">從 Google 預覽更新</button><label class="admin-only hidden">匯入私人快照 <input type="file" id="sourceFile-${kind}" accept=".json"></label><button class="action admin-only hidden" id="sourceCommit-${kind}">確認儲存本次來源版本</button></div><p class="hint" id="sourceCount-${kind}"></p><p role="status" id="sourceMessage-${kind}">展開後按「搜尋／更新畫面」載入。</p><div id="sourcePreview-${kind}"></div><div class="table-wrap" id="sourceTable-${kind}"></div><div class="control-toolbar"><button class="action secondary small" id="sourcePrev-${kind}">上一頁</button><span id="sourcePage-${kind}"></span><button class="action secondary small" id="sourceNext-${kind}">下一頁</button></div></section>`);
  }
  el(page).prepend(wrap);
  if(getToken()&&getRole()==='admin')wrap.querySelectorAll('.admin-only').forEach(n=>n.classList.remove('hidden'));
  wrap.addEventListener('toggle',()=>{if(wrap.open&&getToken())for(const kind of kinds)load(kind);});
 }
 for(const kind of Object.keys(labels)){
  el('sourceCommit-'+kind).disabled=true;
  el('sourceCommit-'+kind).addEventListener('click',async event=>{const state=states.get(kind),pending=state.pending;if(!pending)return;event.target.disabled=true;try{const result=await api('/api/source-catalog/'+kind+'/import',{method:'POST',body:JSON.stringify({rows:pending.rows,digest:pending.preview.digest,expectedBatchId:pending.expectedBatchId})});state.pending=null;el('sourcePreview-'+kind).textContent='';await load(kind);message(kind,`已更新來源批次 ${result.batchId}（${result.count} 筆）。自有派車資源保持人工核對。`);}catch(e){message(kind,e.message);event.target.disabled=false;}});
  el('sourceFile-'+kind).addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file||file.size>3*1024*1024)throw Error('請選擇3MB以內的私人快照JSON');const json=JSON.parse(await file.text());if(json.spreadsheetId!=='12nj_N2zUrNHnYi0krf1kgorfqtJpz6y6MrMvAJ0WXSc')throw Error('來源試算表不符');const rows=json.datasets?.find(d=>d.kind===kind)?.rows;if(!rows)throw Error('快照沒有這個分頁');const result=await api('/api/source-catalog/'+kind+'/preview',{method:'POST',body:JSON.stringify({rows})});preview(kind,result,rows);el('sourceCommit-'+kind).disabled=false;}catch(e){message(kind,e.message);}});
  el('sourcePrev-'+kind).addEventListener('click',()=>load(kind,Math.max(1,(states.get(kind).data?.page||1)-1)));
  el('sourceNext-'+kind).addEventListener('click',()=>load(kind,(states.get(kind).data?.page||1)+1));
 }
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-source-load],[data-source-pull],[data-source-build]');if(!button)return;
  const kind=button.dataset.sourceLoad||button.dataset.sourcePull||button.dataset.sourceBuild;
  if(button.dataset.sourceLoad){load(kind);return;}
  button.disabled=true;
  try{if(button.dataset.sourcePull){const result=await api('/api/source-catalog/'+kind+'/pull',{method:'POST',body:'{}'});preview(kind,result,result.rows);el('sourceCommit-'+kind).disabled=false;}
   else await build(kind,Number(button.dataset.index));
  }catch(e){message(kind,e.message);}finally{button.disabled=false;}
 });
 async function build(kind,index){
  const data=states.get(kind).data,route=data?.records[index];if(!route||route.problems.length)return;
  const config=await api('/api/store-delivery/config');
  el('sourceBuildModal')?.remove();
  document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="sourceBuildModal"><div class="modal-box"><div class="modal-head"><h3>建立 ${esc(route.routeCode)} 當日車趟</h3><button class="close" id="sourceBuildClose">×</button></div><form id="sourceBuildForm"><p>整條路線 ${route.stops.length} 站，依 G 欄順序建立1趟／需求1車；建立後再人工派車。來源司機不會自動指派。</p><div class="field"><label>作業日期</label><input type="date" id="sourceBuildDate" required value="${esc(el('deliveryDate')?.value||'')}"></div><div class="field"><label>實際取貨點</label><select id="sourceBuildPickup" required><option value="">請選擇</option>${config.pickupPoints.filter(p=>p.box_type===route.boxType).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label>實際出發時間（來源時段 ${esc(route.timeWindow||'未提供')}）</label><input type="time" id="sourceBuildTime" required></div><div class="field"><label>每站件數（本表未提供，請先確認；各站不同請使用訂單CSV）</label><input type="number" id="sourceBuildQuantity" required min="1" max="100000"></div><label><input type="checkbox" id="sourceBuildVerified" required> 我已核對全部停靠站名稱、地址、順序及件數</label><p role="alert" id="sourceBuildError"></p><button class="primary">確認建立待派車趟</button></form></div></div>`);
  el('sourceBuildClose').addEventListener('click',()=>el('sourceBuildModal').remove());
  el('sourceBuildForm').addEventListener('submit',async event=>{event.preventDefault();const submit=event.target.querySelector('button');submit.disabled=true;try{const result=await api('/api/source-catalog/'+kind+'/build-trip',{method:'POST',body:JSON.stringify({batchId:data.batchId,routeCode:route.routeCode,serviceDate:el('sourceBuildDate').value,departureTime:el('sourceBuildTime').value,pickupPointId:el('sourceBuildPickup').value,quantity:Number(el('sourceBuildQuantity').value),verified:el('sourceBuildVerified').checked})});el('sourceBuildModal').remove();message(kind,`車趟 ${result.taskCode||result.tripId} ${result.duplicate?'已存在，未重複建立':'已建立，請按蝦皮店到店「更新資料」查看及派車'}。`);}catch(e){el('sourceBuildError').textContent=e.message;submit.disabled=false;}});
 }
 window.WayanSourceCatalog={load};
})();
