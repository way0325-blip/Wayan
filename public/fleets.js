(() => {
  const el=id=>document.getElementById(id),esc=v=>escapeHTML(v);
  async function groups(){if(!isAdmin())return;const rows=await api('/api/fleet-ops/groups');
    el('fleetGroupChoice').innerHTML='<option value="">暫不綁定／保留原綁定</option>'+rows.filter(g=>g.bot_present&&g.last_seen_at&&!g.fleet_id).map(g=>'<option value="'+esc(g.group_id)+'">'+esc(g.label||g.group_id)+'</option>').join('');
    el('groupDirectory').innerHTML=rows.length?'<table><thead><tr><th>群組名稱／Group ID</th><th>對應車隊</th><th>Bot 狀態</th><th>最近事件</th><th>失敗事件／通知</th></tr></thead><tbody>'+rows.map(g=>'<tr><td>'+esc(g.label||'尚未命名')+'<br><small>'+esc(g.group_id)+'</small></td><td>'+esc(g.fleet_name||'尚未綁定')+'</td><td>'+(g.bot_present===null?'手動登記，未驗證':g.bot_present?'最近事件確認 Bot 在群組':'Bot 已離開')+'</td><td>'+esc(g.last_seen_at?new Date(g.last_seen_at).toLocaleString('zh-TW'):'尚未收到')+'<br>'+esc(g.last_event_type||'')+'</td><td>'+g.failed_events+'／'+g.failed_notifications+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">尚無群組，可先登記或邀請 Bot。</div>';
  }
  let fleetRows=[],fleetCursor=null,tasks=[],cases=[],taskCursor=null,caseCursor=null,selectedCase=null,loading=false;
  const date=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'—';
  const jobErrors={GOOGLE_NOT_CONFIGURED:'尚未設定試算表寫入授權',LINE_NOT_CONFIGURED:'尚未設定測試 LINE 頻道',GOOGLE_AUTH_FAILED:'Google 授權無效或已過期',GOOGLE_PERMISSION_DENIED:'寫入帳號沒有這份試算表的權限',GOOGLE_KEY_INVALID:'後端 Google 金鑰格式無效',SHEET_HEADERS_CHANGED:'欄位名稱已變更，請恢復原始欄位',SHEET_ROW_CONFLICT:'資料列編號不符，已停止寫入以保護紀錄',SHEET_TAB_MISSING:'缺少必要工作表',TASK_OR_GROUP_CHANGED:'任務或綁定群組已變更，請重新確認',RETRY_WINDOW_EXPIRED:'LINE 安全重試期限已過，請人工核對通知',GOOGLE_RATE_LIMITED:'Google 請求頻率過高，稍後重試',GOOGLE_WRITE_FAILED:'Google 寫入失敗，請檢查試算表設定',RECORD_DELETED:'原始紀錄已移除',DELIVERY_FAILED:'傳送失敗，請稍後重試'};
  const message=text=>{el('fleetOpsMessage').textContent=text;};
  async function action(fn){try{document.querySelectorAll('.fleetFormError').forEach(n=>n.textContent='');await fn();}catch(err){
    message(err.message);
    const form=document.querySelector('.modal:not(.hidden)[id^="fleet"] form');
    if(form){let note=form.querySelector('.fleetFormError');if(!note){note=document.createElement('p');note.className='fleetFormError control-error';note.setAttribute('role','alert');form.prepend(note);}note.textContent=err.message;}
  }}
  async function fleetList(more=false){
    const q=el('fleetSearch').value;
    const r=await api('/api/fleet-ops/fleets?q='+encodeURIComponent(q)+(more&&fleetCursor?'&after='+encodeURIComponent(fleetCursor):''));
    fleetRows=more?fleetRows.concat(r.items):r.items;fleetCursor=r.nextCursor;
    el('fleetMore').classList.toggle('hidden',!fleetCursor);
    const selected=el('fleetFilter').value;
    el('fleetFilter').innerHTML='<option value="">全部車隊</option>'+fleetRows.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    if(fleetRows.some(f=>f.id===selected))el('fleetFilter').value=selected;
    el('fleetTaskFleet').innerHTML=fleetRows.filter(f=>f.status==='啟用').map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    el('fleetDirectory').innerHTML=fleetRows.length?`<table><thead><tr><th>車隊</th><th>聯絡窗口</th><th>每日上限</th><th>狀態</th><th>LINE 群組</th><th>操作</th></tr></thead><tbody>${fleetRows.map(f=>`<tr><td>${esc(f.name)}<br><small>${esc(f.id)}</small></td><td>${esc(f.contact_name||'—')}<br>${esc(f.phone||'')}</td><td>${f.daily_capacity||'不限'} 車</td><td>${esc(f.status)}</td><td>${f.group_bound?'已綁定':'未綁定'}</td><td><button class="action secondary small" data-fleet-edit="${esc(f.id)}">編輯</button>${isAdmin()?` <button class="action secondary small" data-fleet-bind="${esc(f.id)}">${f.group_bound?'解除群組':'取得綁定碼'}</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">尚無符合條件的車隊，請新增車隊。</div>';
  }
  async function taskList(more=false){
    const r=await api('/api/fleet-ops/tasks?fleetId='+encodeURIComponent(el('fleetFilter').value)+(more&&taskCursor?'&before='+taskCursor:''));
    tasks=more?tasks.concat(r.items):r.items;taskCursor=r.nextCursor;el('fleetTaskMore').classList.toggle('hidden',!taskCursor);
    el('fleetTaskList').innerHTML=tasks.length?`<table><thead><tr><th>任務</th><th>車隊</th><th>作業日期／路線</th><th>車數</th><th>狀態</th><th>操作</th></tr></thead><tbody>${tasks.map(t=>`<tr><td>${esc(t.number)}<br>${esc(t.title)}</td><td>${esc(t.fleet_name)}</td><td>${esc(t.service_date)}<br>${esc(t.origin)}→${esc(t.destination)}</td><td>${t.confirmed_trucks} / ${t.requested_trucks}</td><td>${esc(t.status)}</td><td>${!['已取消','已拒絕','已完成'].includes(t.status)?`<button class="action secondary small" data-fleet-notify="${t.id}">發送到群組</button>`:''} <button class="action secondary small" data-fleet-report="${t.id}">登記異常</button>${['待回覆','已確認','已拒絕'].includes(t.status)?` <button class="action secondary small" data-fleet-cancel="${t.id}">取消</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">尚無車隊任務</div>';
  }
  async function caseList(more=false){
    const r=await api('/api/fleet-ops/incidents?fleetId='+encodeURIComponent(el('fleetFilter').value)+'&status='+encodeURIComponent(el('fleetCaseStatus').value)+(more&&caseCursor?'&before='+caseCursor:''));
    cases=more?cases.concat(r.items):r.items;caseCursor=r.nextCursor;el('fleetCaseMore').classList.toggle('hidden',!caseCursor);
    el('fleetCaseList').innerHTML=cases.length?`<table><thead><tr><th>案件</th><th>車隊／任務</th><th>回報內容</th><th>狀態</th><th>處理人</th><th>操作</th></tr></thead><tbody>${cases.map(i=>`<tr><td>${esc(i.number)}<br>${esc(i.kind)}${i.severity==='緊急'?' · 緊急':''}</td><td>${esc(i.fleet_name)}<br>${esc(i.taskNumber)}</td><td>${esc(i.description)}<br><small>${esc(date(i.created_at))}</small></td><td>${esc(i.status)}</td><td>${esc(i.handler||'待指派')}</td><td><button class="action secondary small" data-fleet-case="${i.id}">開啟回報單</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">目前沒有符合條件的異常案件</div>';
  }
  async function status(){
    const s=await api('/api/fleet-ops/status');
    el('fleetKpis').innerHTML=[['啟用車隊',s.active_fleets],['已綁群組',s.bound_groups],['待回覆任務',s.pending_tasks],['未結案異常',s.open_incidents]].map(([label,value])=>`<div class="control-metric"><small>${label}</small><strong>${value}</strong></div>`).join('');
    el('fleetConnection').textContent=`LINE：${s.lineConfigured?'頻道已設定':'尚未設定測試頻道'}；Google Sheets：${s.sheetConfigured?'寫入授權已設定，依同步紀錄確認結果':'後端自動寫入授權尚未完成'}。待設定 ${s.blocked_jobs} 筆，失敗 ${s.failed_jobs} 筆。`;
    el('fleetSheetLink').classList.toggle('hidden',!s.sheetUrl);if(s.sheetUrl)el('fleetSheetLink').href=s.sheetUrl;
    if(isAdmin()&&s.sheetId&&!el('fleetSheetId').value)el('fleetSheetId').value=s.sheetId;
    if(isAdmin()){
      const jobs=await api('/api/fleet-ops/jobs');
      const labels={pending:'待處理',processing:'傳送中',sent:'已送出',blocked:'待設定',failed:'失敗',cancelled:'已取消'};
      el('fleetJobs').innerHTML=jobs.length?`<table><thead><tr><th>類型</th><th>狀態</th><th>嘗試次數</th><th>原因</th><th>操作</th></tr></thead><tbody>${jobs.map(j=>`<tr><td>${j.kind==='line'?'LINE 通知':'Google Sheets'}</td><td>${labels[j.status]||esc(j.status)}</td><td>${j.attempts}</td><td>${esc(jobErrors[j.error_code]||j.error_code||'—')}</td><td>${['blocked','failed'].includes(j.status)?`<button class="action secondary small" data-fleet-retry="${j.id}">重試</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">尚無同步工作</div>';
    }
  }
  async function refresh(){if(loading)return;loading=true;try{await Promise.all([status(),taskList(),caseList()]);}finally{loading=false;}}
  async function openCase(id){
    const data=await api('/api/fleet-ops/incidents/'+id),i=data.incident;selectedCase=i;
    el('fleetCaseNumber').textContent=i.number+' 異常回報單';
    el('fleetCaseDetails').innerHTML=`<dl><dt>車隊／任務</dt><dd>${esc(i.fleet_name)} · ${esc(i.taskNumber)} ${esc(i.task_title)}</dd><dt>回報時間</dt><dd>${esc(date(i.created_at))}</dd><dt>類型／嚴重程度</dt><dd>${esc(i.kind)} · ${esc(i.severity)}</dd><dt>回報內容</dt><dd>${esc(i.description)}</dd><dt>處理結果</dt><dd>${esc(i.resolution||'尚未登記')}</dd></dl>`;
    el('fleetCaseHandler').value=i.handler||localStorage.getItem('username');el('fleetCaseResolution').value=i.resolution;el('fleetCaseNote').value='';
    const allowed={'待處理':['待處理','處理中'],'處理中':['處理中','待確認'],'待確認':['待確認','處理中',...(isAdmin()?['已結案']:[])],'已結案':['已結案',...(isAdmin()?['處理中']:[])]}[i.status];
    el('fleetCaseNext').innerHTML=allowed.map(s=>`<option>${s}</option>`).join('');
    el('fleetCaseHistory').innerHTML=data.history.map(h=>`<div class="incident-row"><strong>${esc(h.action)} · ${esc(h.next_status)}</strong><br>${esc(h.note)}<br><small>${esc(h.actor)} · ${esc(date(h.created_at))}</small></div>`).join('');
    el('fleetCaseModal').classList.remove('hidden');
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.id==='groupReload'||b.dataset.page==='fleetOps')action(groups);
    if(b.id==='groupImport')action(async()=>{const text=prompt('每行：群組名稱,Group ID（C開頭33碼）。不可使用邀請網址；最多100筆。');if(text===null)return;const rows=text.split(/\r?\n/).filter(v=>v.trim()).map(v=>{const i=v.lastIndexOf(',');return {name:v.slice(0,i).trim(),groupId:v.slice(i+1).trim()};});await api('/api/fleet-ops/groups/import',{method:'POST',body:JSON.stringify({groups:rows})});await groups();message('群組已登記；收到 LINE 簽章事件後可供選擇綁定。');});
    if(b.dataset.page==='fleetOps')action(async()=>{await fleetList();await refresh();await groups();});
    if(b.id==='fleetSearchBtn')action(()=>fleetList());if(b.id==='fleetMore')action(()=>fleetList(true));
    if(b.id==='fleetOpsRefresh')action(refresh);if(b.id==='fleetTaskMore')action(()=>taskList(true));if(b.id==='fleetCaseMore')action(()=>caseList(true));
    if(b.id==='fleetCreate'){groups().catch(e=>message(e.message));
      el('fleetName').value='';el('fleetContact').value='';el('fleetPhone').value='';el('fleetCapacity').value='0';el('fleetProfileStatus').value='啟用';el('fleetProfileId').value='';el('fleetProfileModal').classList.remove('hidden');
    }
    if(b.dataset.fleetEdit){groups().catch(e=>message(e.message));const f=fleetRows.find(f=>f.id===b.dataset.fleetEdit);el('fleetProfileId').value=f.id;el('fleetName').value=f.name;el('fleetContact').value=f.contact_name;el('fleetPhone').value=f.phone;el('fleetCapacity').value=f.daily_capacity;el('fleetProfileStatus').value=f.status;el('fleetProfileModal').classList.remove('hidden');}
    if(b.id==='fleetTaskCreate'){el('fleetTaskForm').reset();el('fleetTaskDate').value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());el('fleetTaskRequest').value=crypto.randomUUID();el('fleetTaskModal').classList.remove('hidden');}
    if(b.dataset.fleetBind)action(async()=>{
      const f=fleetRows.find(f=>f.id===b.dataset.fleetBind);
      if(f.group_bound){if(!confirm('解除後該群組將無法再存取車隊任務，確定解除？'))return;await api('/api/fleet-ops/fleets/'+encodeURIComponent(f.id)+'/group',{method:'DELETE'});await fleetList();return;}
      const r=await api('/api/fleet-ops/fleets/'+encodeURIComponent(f.id)+'/group-code',{method:'POST'});
      el('fleetBindInstructions').textContent=`請將測試官方帳號加入「${f.name}」群組，再由信任的聯絡人於群組輸入：\n${r.command}\n有效至 ${date(r.expiresAt)}。群組成員均可操作此車隊的任務。`;
    });
    if(b.dataset.fleetNotify)action(async()=>{const r=await api('/api/fleet-ops/tasks/'+b.dataset.fleetNotify+'/notify',{method:'POST'});message(r.duplicate?'這個版本的通知已排入工作，不會重複排送。':'通知已排入傳送；可在同步紀錄查看結果。');await status();});
    if(b.dataset.fleetCancel)action(async()=>{const reason=prompt('取消原因');if(reason===null)return;await api('/api/fleet-ops/tasks/'+b.dataset.fleetCancel+'/cancel',{method:'POST',body:JSON.stringify({reason})});await refresh();});
    if(b.dataset.fleetReport)action(async()=>{const description=prompt('請輸入異常說明（案件先登記為其他類型）');if(description===null)return;await api('/api/fleet-ops/incidents',{method:'POST',body:JSON.stringify({taskId:b.dataset.fleetReport,kind:'其他',description})});await refresh();});
    if(b.dataset.fleetCase)action(()=>openCase(b.dataset.fleetCase));
    if(b.dataset.fleetRetry)action(async()=>{await api('/api/fleet-ops/jobs/'+b.dataset.fleetRetry+'/retry',{method:'POST'});await status();});
    if(b.id==='fleetSheetSave')action(async()=>{const value=el('fleetSheetId').value.trim(),match=value.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);await api('/api/fleet-ops/sheet-target',{method:'PUT',body:JSON.stringify({spreadsheetId:match?match[1]:value})});await status();message('試算表目標已儲存；後端自動寫入仍需專用授權。');});
    if(b.id==='fleetSheetResync')action(async()=>{await api('/api/fleet-ops/sheet-resync',{method:'POST'});await status();message('既有車隊、任務及異常歷程已排入同步。');});
  });
  el('fleetFilter').addEventListener('change',()=>action(refresh));el('fleetCaseStatus').addEventListener('change',()=>action(()=>caseList()));
  el('fleetProfileForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    const id=el('fleetProfileId').value,b={name:el('fleetName').value,contactName:el('fleetContact').value,phone:el('fleetPhone').value,dailyCapacity:Number(el('fleetCapacity').value),...(isAdmin()&&el('fleetGroupChoice').value?{groupId:el('fleetGroupChoice').value}:{}),...(id?{status:el('fleetProfileStatus').value}:{})};
    await api('/api/shopee/fleets'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:JSON.stringify(b)});closeModal('fleetProfileModal');await fleetList();await refresh();
  });});
  el('fleetTaskForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    const b={requestId:el('fleetTaskRequest').value,fleetId:el('fleetTaskFleet').value,title:el('fleetTaskTitle').value,serviceDate:el('fleetTaskDate').value,origin:el('fleetTaskOrigin').value,destination:el('fleetTaskDestination').value,vehicleType:el('fleetTaskType').value,requestedTrucks:Number(el('fleetTaskCount').value),note:el('fleetTaskNote').value};
    await api('/api/fleet-ops/tasks',{method:'POST',body:JSON.stringify(b)});closeModal('fleetTaskModal');await refresh();message('任務已建立，可按「發送到群組」傳送。');
  });});
  el('fleetCaseForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    await api('/api/fleet-ops/incidents/'+selectedCase.id,{method:'PATCH',body:JSON.stringify({status:el('fleetCaseNext').value,handler:el('fleetCaseHandler').value,resolution:el('fleetCaseResolution').value,note:el('fleetCaseNote').value})});await openCase(selectedCase.id);await refresh();
  });});
  setInterval(()=>{if(getToken()&&el('fleetOps').classList.contains('active')&&!document.querySelector('.modal:not(.hidden)'))action(refresh);},20000);
})();
