(()=>{
 const el=id=>document.getElementById(id),esc=v=>escapeHTML(String(v??'')),pane=el('shopeeIntegrated-staffing');if(!pane)return;let importSeq=0;let data,source,seq=0,busy=false,importInput,importPreview;
 const plus=(key,n)=>{const [y,m,d]=key.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10);};
 const next=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])),key=p.year+'-'+p.month+'-'+p.day,w=new Date(key+'T00:00:00Z').getUTCDay();return plus(key,(2-w+7)%7);};
 pane.innerHTML='<div class="panel"><div class="staffing-header"><div><h3>這週，還有誰沒排好？</h3><p class="hint">依車行查看待填路線。填入有效司機 ID 是預排，與實際 LINE 報到分開。</p></div><div class="staffing-toolbar"><button id="staffPrev" class="action secondary">上一週</button><label>週期開始（星期二）<input id="staffStart" type="date"></label><button id="staffNext" class="action secondary">下一週</button><button id="staffRefresh" class="action secondary">重新整理</button></div></div><div id="staffDeadline" class="staffing-deadline"></div><div id="staffCards" class="staffing-cards"></div><div class="staffing-toolbar"><button id="staffAdd" class="action">加入本週要跑的路線</button><button id="staffImport" class="action secondary">匯入司機回填</button><button id="staffTemplate" class="action secondary">下載本週填寫範本</button><button id="staffExport" class="action secondary">匯出目前清單</button><button id="staffCopy" class="action secondary">複製催填清單</button></div><div class="staffing-toolbar"><input id="staffSearch" type="search" placeholder="搜尋路線、車行、司機 ID"><details class="staffing-filter" id="staffBusiness"><summary></summary><div class="staffing-filter-options"></div></details><details class="staffing-filter" id="staffDate"><summary></summary><div class="staffing-filter-options"></div></details></div><fieldset class="staffing-state-filter" id="staffFilter"><legend>排班狀態（可複選）</legend><div class="staffing-state-options"></div></fieldset><p id="staffStatus" role="status"></p><div id="staffRows"></div></div>';
 el('staffStart').value=next();
 function modal(title,html){el('staffModal')?.remove();document.body.insertAdjacentHTML('beforeend','<div class="modal staffing-modal" id="staffModal"><div class="modal-box"><div class="modal-head"><h3>'+esc(title)+'</h3><button class="close" id="staffClose">×</button></div>'+html+'<p id="staffError" role="alert"></p></div></div>');el('staffClose').onclick=()=>el('staffModal').remove();}
 async function action(fn){if(busy)return;busy=true;const status=el('staffError')||el('staffStatus');status.textContent='正在處理，請稍候…';try{await fn();}catch(e){(el('staffError')||el('staffStatus')).textContent=e.message;}finally{busy=false;if(status.isConnected&&status.textContent==='正在處理，請稍候…')status.textContent='';}}
 async function load(){if(!getToken()||!['admin','dispatcher'].includes(getRole()))return;const stamp=++seq,token=getToken();try{const d=await api('/api/weekly-staffing?start='+encodeURIComponent(el('staffStart').value));if(stamp!==seq||token!==getToken())return;data=d;render();}catch(e){el('staffStatus').textContent=e.message;}}
 const stateOptions = [
  ['incomplete', '尚未完成'], ['missing', '尚未填入 ID'], ['review', 'ID／車隊待核對'],
  ['urgent', '需立即處理'], ['arranged', '已安排'], ['cancelled', '已停駛']
 ];
 const stateMatches = {
  incomplete: row => !row.cancelled && !row.complete,
  missing: row => !row.cancelled && !row.driver_code,
  review: row => !row.cancelled && !!row.driver_code && !row.complete,
  urgent: row => row.daily_late,
  arranged: row => row.complete,
  cancelled: row => row.cancelled
 };
 function createFilter(id, label, allLabel, defaultValues = [], toggleSelection) {
  const control = el(id), summary = control.querySelector('summary');
  const list = control.querySelector('.staffing-filter-options, .staffing-state-options');
  let options;
  const selected = new Set(defaultValues);
  function update() {
   if (summary) summary.textContent = label + ' · ' + (selected.size ? '已選 ' + selected.size + ' 項' : allLabel);
   for (const input of list.querySelectorAll('input')) {
    input.checked = input.value ? selected.has(input.value) : selected.size === 0;
   }
  }
  function setOptions(next) {
   if (JSON.stringify(next) === JSON.stringify(options)) return;
   options = next;
   const allowed = new Set(options.map(([value]) => value));
   for (const value of selected) {
    if (!allowed.has(value)) selected.delete(value);
   }
   list.innerHTML = [['', allLabel], ...options].map(([value, text]) =>
    '<label><input type="checkbox" value="' + esc(value) + '">' + esc(text) + '</label>'
   ).join('');
   update();
  }
  list.onchange = ({target}) => {
   if (!target.value) selected.clear();
   else if (toggleSelection) toggleSelection(selected, target.value, target.checked);
   else if (target.checked) selected.add(target.value);
   else selected.delete(target.value);
   update();
   render();
  };
  update();
  return {
   selected, setOptions,
   selectOnly(value) {
    selected.clear();
    if (value) selected.add(value);
    update();
   }
  };
 }
 const states = createFilter('staffFilter', '排班狀態', '全部需求', ['incomplete'], (selected, value, checked) => {
  if (!checked) {
   selected.delete(value);
   return;
  }
  if (value === 'incomplete') {
   selected.delete('missing');
   selected.delete('review');
  } else if (value === 'missing' || value === 'review') {
   selected.delete('incomplete');
  }
  selected.add(value);
 });
 const businesses = createFilter('staffBusiness', '業務類型', '所有業務類型');
 const dates = createFilter('staffDate', '任務日期', '整週');
 states.setOptions(stateOptions);
 function filtered() {
  const query = el('staffSearch').value.trim().toLowerCase();
  const selectedStates = [...states.selected];
  return (data?.rows || []).filter(row =>
   (!selectedStates.length || selectedStates.some(state => stateMatches[state](row))) &&
   (!businesses.selected.size || businesses.selected.has(row.business_type)) &&
   (!dates.selected.size || dates.selected.has(row.service_date)) &&
   (!query || [row.route_code, row.fleet_name, row.driver_code, row.driver_name, row.slot].join(' ').toLowerCase().includes(query))
  );
 }
 function render(){if(!data)return;const c=data.cycle,s=data.summary;el('staffDeadline').textContent=c.start_date+'（二）～'+c.end_date+'（一）｜整週請在 '+c.weekly_due_date+'（一）23:59 前填齊；每項任務最晚在前一天23:59前完成。';el('staffCards').innerHTML=[['已建排班需求',s.total,'all',''],['已安排',s.arranged,'arranged',''],['還要補齊',s.incomplete,'incomplete','attention'],['需立即處理',s.urgent,'urgent','urgent']].map(([label,n,f,css])=>'<button class="staffing-card '+css+'" data-staff-filter="'+f+'"><span>'+label+'</span><strong>'+n+' <small>趟</small></strong></button>').join('');businesses.setOptions([...new Set(data.rows.map(r => r.business_type).filter(Boolean))].map(value => [value, value]));
  dates.setOptions(Array.from({length: 7}, (_, i) => { const value = plus(c.start_date, i); return [value, value]; }));
  const rows = filtered();
  const showAllFleets = states.selected.size === 1 && states.selected.has('incomplete') &&
   !el('staffSearch').value.trim() && !businesses.selected.size && !dates.selected.size;
  const fleets = [...new Set((showAllFleets ? data.rows.filter(r => !r.cancelled) : rows).map(r => r.fleet_name))];
  el('staffStatus').textContent=(s.total?s.incomplete?'這週還有 '+s.missing+' 趟未填 ID，另有 '+s.review+' 趟待核對。':'這週已排齊。':'這週還沒有路線需求，先勾選實際要跑的路線與日期。')+' 最新讀取：'+new Date(data.refreshedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'｜目前顯示 '+rows.length+' 筆';el('staffRows').innerHTML=!fleets.length?'<div class="staffing-empty">'+(s.total?'目前篩選下沒有資料，可改選「全部需求」。':'點「加入本週要跑的路線」開始；不會自動假設每天都跑。')+'</div>':fleets.map(name=>{const f=data.fleets.find(f=>f.key===name),items=rows.filter(r=>r.fleet_name===name);return '<details class="staffing-fleet"><summary>'+esc(name||'尚未指定車行')+'<span>本週 '+(f?.total||0)+' 趟／'+(f?.routeCount||0)+'條路線 · 已安排 '+(f?.arranged||0)+' · 待補 '+(f?.incomplete||0)+'｜目前顯示 '+items.length+' 筆</span></summary><div class="table-wrap"><table><thead><tr><th>日期／波次</th><th>路線／業務</th><th>出車／店數</th><th>預排司機</th><th>目前狀態</th><th>處理</th></tr></thead><tbody>'+items.map(r=>'<tr><td>'+esc(r.service_date)+'<br>'+esc(r.slot)+'</td><td><strong>'+esc(r.route_code)+'</strong><br>'+esc(r.business_type)+'</td><td>'+esc(r.departure_window||'時段待核對')+'<br>'+(r.stop_count===null?'店數待補':r.stop_count+'店')+'</td><td>'+esc(r.driver_code||'尚未填寫')+'<br>'+esc(r.driver_name||'')+'</td><td><span class="staffing-badge '+r.phase+'">'+esc(r.label)+'</span><div class="staffing-note">'+esc(!r.complete?r.driver_problem:r.filled_after_daily_due?'任務當日補填':r.filled_after_weekly_due?'整週截止後補填':'')+'</div></td><td><button class="action secondary" data-staff-edit="'+r.id+'">'+(r.driver_code?'調整':'填司機')+'</button> <button class="action secondary" data-staff-history="'+r.id+'">紀錄</button></td></tr>').join('')+(!items.length?'<tr><td colspan="6">此車隊目前沒有待補資料。切換「全部需求」即可查看已安排內容。</td></tr>':'')+'</tbody></table></div></details>';}).join('');}
 function csv(rows){return '\uFEFF'+rows.map(r=>r.map(v=>{v=String(v??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
 function download(name,rows){WayanExcel.download(rows,name).catch(e=>{el('staffStatus').textContent=e.message;});}
 const templateHeaders=['需求編號','任務日期','業務類型','路線編號','波次','車行','司機ID'];
 el('staffTemplate').onclick=()=>{if(!data?.rows.length){el('staffStatus').textContent='請先加入本週路線需求，再下載填寫範本。';return;}download('週期司機填寫-'+data.cycle.start_date+'.csv',[templateHeaders,...data.rows.filter(r=>!r.cancelled).map(r=>[r.id,r.service_date,r.business_type,r.route_code,r.slot,r.fleet_name,''])]);};
 el('staffExport').onclick=()=>{if(!data)return;download('週期排班清單-'+data.cycle.start_date+'.csv',[[...templateHeaders,'姓名','狀態','最晚填寫日','備註'],...filtered().map(r=>[r.id,r.service_date,r.business_type,r.route_code,r.slot,r.fleet_name,r.driver_code,r.driver_name,r.label,r.daily_due_date,r.note])]);};
 el('staffCopy').onclick=()=>{if(!data)return;const rows=filtered().filter(r=>!r.cancelled&&!r.complete);if(!rows.length){el('staffStatus').textContent='目前篩選沒有待補項目。';return;}const names=[...new Set(rows.map(r=>r.fleet_name))],text='【週期司機 ID 待補】'+data.cycle.start_date+'～'+data.cycle.end_date+'\n請於'+data.cycle.weekly_due_date+' 23:59前填齊；最晚任務前一天。\n'+names.map(n=>'\n'+(n||'未指定車行')+'：\n'+rows.filter(r=>r.fleet_name===n).map(r=>r.service_date+' '+r.route_code+'／'+r.slot+' '+(r.driver_code?'ID待核對：'+r.driver_code:'尚未填ID')).join('\n')).join('\n');modal('複製催填清單','<p>只包含目前篩選的待補項目；由你確認後貼到對應車隊群組，不會自動發送。</p><textarea id="staffCopyText" class="staffing-copy" readonly>'+esc(text)+'</textarea><button id="staffCopyNow" class="action">複製文字</button>');el('staffCopyNow').onclick=async()=>{try{await navigator.clipboard.writeText(text);el('staffError').textContent='已複製，可貼到LINE。';}catch{el('staffCopyText').select();el('staffError').textContent='請按Ctrl+C或手機長按複製。';}};};
 el('staffAdd').onclick=()=>action(async()=>{source=await api('/api/weekly-staffing/options');const start=el('staffStart').value;modal('加入本週路線需求','<p>每個勾選路線在每個勾選日期建立一趟；只排需求，不建立實際車趟或發送LINE。</p><div class="staffing-form"><label>查找路線／來源車行<input id="staffRouteSearch" type="search"></label><label>波次（加開可另命名）<input id="staffSlot" value="原路線" maxlength="40"></label></div><div class="staffing-checks"><label><input id="staffAllDates" type="checkbox">明確選擇整週</label>'+Array.from({length:7},(_,i)=>'<label><input type="checkbox" data-staff-day="'+plus(start,i)+'">'+plus(start,i).slice(5)+'</label>').join('')+'</div><label><input id="staffAllRoutes" type="checkbox">全選目前顯示的路線</label><div id="staffRouteOptions" class="staffing-select"></div><p id="staffDemandCount"></p><label><input id="staffDemandVerified" type="checkbox">已確認執行日期、路線及需求趟次</label><button id="staffDemandSave" class="action">建立本週需求</button>');const selected=new Set(),visible=()=>source.routes.filter(r=>[r.routeCode,r.fleet,r.business].join(' ').toLowerCase().includes(el('staffRouteSearch').value.toLowerCase())),count=()=>el('staffDemandCount').textContent=selected.size+'條路線 × '+document.querySelectorAll('[data-staff-day]:checked').length+'天 = '+selected.size*document.querySelectorAll('[data-staff-day]:checked').length+'趟需求',draw=()=>{el('staffRouteOptions').innerHTML=visible().map(r=>'<label><input type="checkbox" data-staff-route="'+r.uid+'" '+(selected.has(r.uid)?'checked':'')+'>'+esc(r.routeCode)+'｜'+esc(r.fleet||'車行待確認')+'｜'+esc(r.business)+'｜'+esc(r.time||'時段待核對')+'</label>').join('');el('staffAllRoutes').checked=visible().length>0&&visible().every(r=>selected.has(r.uid));count();};draw();el('staffRouteSearch').oninput=draw;el('staffRouteOptions').onchange=e=>{const id=e.target.dataset.staffRoute;if(id)e.target.checked?selected.add(id):selected.delete(id);draw();};el('staffAllRoutes').onchange=e=>{for(const r of visible())e.target.checked?selected.add(r.uid):selected.delete(r.uid);draw();};el('staffAllDates').onchange=e=>{for(const n of document.querySelectorAll('[data-staff-day]'))n.checked=e.target.checked;count();};for(const n of document.querySelectorAll('[data-staff-day]'))n.onchange=count;el('staffDemandSave').onclick=()=>action(async()=>{if(!el('staffDemandVerified').checked)throw Error('請先核對需求');const r=await api('/api/weekly-staffing/demands',{method:'POST',body:JSON.stringify({start,routeUids:[...selected],dates:[...document.querySelectorAll('[data-staff-day]:checked')].map(n=>n.dataset.staffDay),slot:el('staffSlot').value,catalogVersion:source.catalogVersion,verified:true})});el('staffModal').remove();states.selectOnly('incomplete');await load();el('staffStatus').textContent+='｜新增 '+r.added+' 筆，略過既有 '+r.duplicate+' 筆';});});
 pane.onclick=e=>{const card=e.target.closest('[data-staff-filter]');if(card){states.selectOnly(card.dataset.staffFilter==='all'?'':card.dataset.staffFilter);render();}const b=e.target.closest('[data-staff-edit]');if(b)edit(data.rows.find(r=>String(r.id)===b.dataset.staffEdit));const h=e.target.closest('[data-staff-history]');if(h)action(async()=>{const rows=await api('/api/weekly-staffing/history/'+h.dataset.staffHistory);modal('安排異動紀錄',rows.length?rows.map(r=>'<div class="panel"><strong>'+esc(r.action)+'／'+esc(r.actor)+'</strong><p>'+esc(new Date(r.at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))+'</p><p>司機ID：'+esc(r.before_data?.driver_code||'未填')+' → '+esc(r.after_data.driver_code||'未填')+'；車行：'+esc(r.after_data.fleet_name||'未指定')+'</p></div>').join(''):'<p>尚無異動。</p>');});};
 function edit(r){modal(r.service_date+'／'+r.route_code,'<p>'+esc(r.slot)+'｜'+esc(r.departure_window||'時段待核對')+'｜'+(r.stop_count===null?'店數待補':r.stop_count+'店')+'。最晚填寫：'+r.daily_due_date+' 23:59。</p><div class="staffing-form"><label>司機 ID（文字，保留開頭0）<input id="staffDriver" value="'+esc(r.driver_code)+'" maxlength="100" autocomplete="off"></label><label>車行<input id="staffFleet" value="'+esc(r.fleet_name)+'" maxlength="100"></label></div><label>備註／停駛或恢復原因<input id="staffNote" value="'+esc(r.note)+'" maxlength="500"></label><p class="staffing-note">只修改這一天；ID查無名冊時會保留為待核對，不算完成。跨日批次安排請使用回填範本。</p><label><input id="staffEditVerified" type="checkbox">已核對日期、路線與司機 ID</label><div class="staffing-toolbar"><button id="staffEditSave" class="action">儲存這一天</button><button id="staffCancel" class="action secondary">'+(r.cancelled?'恢復執行':'此日停駛')+'</button></div>');const save=cancelled=>action(async()=>{if(!el('staffEditVerified').checked)throw Error('請先核對安排');await api('/api/weekly-staffing/demands/'+r.id,{method:'PUT',body:JSON.stringify({driverCode:el('staffDriver').value,fleetName:el('staffFleet').value,note:el('staffNote').value,expectedRevision:r.revision,verified:true,...(cancelled===undefined?{}:{cancelled})})});el('staffModal').remove();await load();});el('staffEditSave').onclick=()=>save();el('staffCancel').onclick=()=>save(!r.cancelled);}
 function parse(raw){const grid=WayanWeeklyRouteFormat.table(raw);if(grid.length<2)throw Error('請提供表頭及資料列');const aliases={demandId:['需求編號'],date:['任務日期','日期'],routeCode:['路線編號'],slot:['波次'],fleetName:['車行'],driverCode:['司機ID']},columns={};for(const[k,names]of Object.entries(aliases)){const hits=grid[0].map((v,i)=>names.includes(String(v).replace(/\s/g,''))?i:-1).filter(i=>i>=0);if(hits.length>1)throw Error('欄位重複：'+k);if(hits.length)columns[k]=hits[0];}if(columns.driverCode===undefined||columns.demandId===undefined&&(columns.date===undefined||columns.routeCode===undefined))throw Error('需要「司機ID」及「需求編號」，或「任務日期＋路線編號」；可先下載本週範本。');return grid.slice(1).filter(r=>r.some(v=>String(v).trim())).map(r=>Object.fromEntries(Object.entries(columns).map(([k,i])=>[k,String(r[i]??'').trim()])));}
 el('staffImport').onclick=()=>{importInput=null;importPreview=null;modal('匯入車隊回填','<p>先下載本週範本，填司機 ID 後直接上傳 Excel（.xlsx）。也可直接貼上含表頭的Excel儲存格。司機 ID 欄請設文字，保留開頭0；空白略過，填「（清空）」才清除舊安排。</p><input id="staffImportFile" type="file" accept=".xlsx,.csv,.tsv,.txt"><textarea id="staffImportText" class="staffing-copy" placeholder="貼上含表頭的回填資料"></textarea><button id="staffImportPreview" class="action secondary">先預覽，不寫入</button><div id="staffImportResult" class="table-wrap"></div><label><input id="staffImportVerified" type="checkbox">已核對日期、路線、ID及警示</label><button id="staffImportSave" class="action" disabled>確認套用回填</button>');const reset=()=>{importSeq++;importInput=null;importPreview=null;el('staffImportSave').disabled=true;el('staffImportVerified').checked=false;};el('staffImportText').oninput=reset;el('staffImportFile').onchange=reset;el('staffImportPreview').onclick=()=>action(async()=>{reset();const stamp=importSeq;const file=el('staffImportFile').files[0];if(file&&file.size>2800000)throw Error('檔案最多2.8MB');const raw=file?(/\.xlsx$/i.test(file.name)?WayanExcel.csv(await WayanExcel.read(file)):await file.text()):el('staffImportText').value;importInput={start:el('staffStart').value,rows:parse(raw)};const p=await api('/api/weekly-staffing/preview',{method:'POST',body:JSON.stringify(importInput)});if(stamp!==importSeq||!el('staffImportResult'))return;importPreview=p;el('staffImportResult').innerHTML='<p>將套用 '+p.changes.length+' 筆，略過空白 '+p.skipped+' 筆，錯誤 '+p.errors.length+' 筆。</p>'+p.errors.map(v=>'<p>'+esc(v)+'</p>').join('')+'<table><thead><tr><th>日期／路線</th><th>原ID</th><th>新ID／姓名</th><th>提醒</th></tr></thead><tbody>'+p.changes.map(r=>'<tr><td>'+esc(r.date)+'／'+esc(r.routeCode)+'</td><td>'+esc(r.previous)+'</td><td>'+esc(r.driverCode||'清空')+'／'+esc(r.driverName)+'</td><td>'+esc(r.warning)+'</td></tr>').join('')+'</tbody></table>';el('staffImportSave').disabled=!!p.errors.length||!p.changes.length;});el('staffImportSave').onclick=()=>action(async()=>{if(!importPreview||!el('staffImportVerified').checked)throw Error('請先預覽並核對');const r=await api('/api/weekly-staffing/import',{method:'POST',body:JSON.stringify({...importInput,digest:importPreview.digest,verified:true})});el('staffModal').remove();await load();el('staffStatus').textContent+='｜已套用 '+r.applied+' 筆，其中 '+r.review+' 筆待核對';});};
 el('staffRefresh').onclick=load;el('staffStart').onchange=()=>{el('staffModal')?.remove();load();};el('staffPrev').onclick=()=>{el('staffStart').value=plus(el('staffStart').value,-7);load();};el('staffNext').onclick=()=>{el('staffStart').value=plus(el('staffStart').value,7);load();};el('staffSearch').addEventListener('input',render);
 document.addEventListener('wayan:session',()=>{seq++;data=null;el('staffModal')?.remove();el('staffRows').textContent='';el('staffCards').textContent='';el('staffStatus').textContent='';if(getToken()&&!pane.hidden)load();});let timer;document.addEventListener('wayan:refresh',e=>{if(!['staffing_demands','staffing_cycles','source_catalog_batches'].includes(e.detail?.table)||timer)return;timer=setTimeout(()=>{timer=null;if(!pane.hidden&&!document.hidden)window.WayanViewUpdates?.request('weekly-staffing',load);},700);});setInterval(()=>{if(!pane.hidden&&!document.hidden&&!busy)window.WayanViewUpdates?.request('weekly-staffing',load);},60000);window.WayanWeeklyStaffing={load};
})();
