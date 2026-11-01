(() => {
  const el=id=>document.getElementById(id),esc=v=>escapeHTML(v);
  let rows=[],cursor=null,generation=0,loadingMore=false,timer,selected='',currentFleets=[];
  const date=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未收到';
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  el('fleetOpsMessage').insertAdjacentHTML('afterend',`<div class="panel fleet-chat" id="fleetActivityPanel"><div class="chat-heading"><div><h2>車隊聊天室與調度工作區</h2><p class="hint">接收已綁定群組的新訊息；圖片、語音與貼圖目前顯示類型。僅呈現本平台實際收到的紀錄。</p></div><button id="activityRefresh" class="action secondary">更新LINE動態</button></div><div class="control-toolbar"><label>車隊 <select id="activityFleet"><option value="">全部車隊</option></select></label><label>車趟日期 <input id="chatDate" type="date"></label><span id="activityUpdated" class="hint" role="status"></span></div><p id="activityError" class="control-error" role="alert"></p><div class="chat-layout"><aside class="chat-fleets" aria-label="車隊群組"><h3>車隊群組</h3><div id="activityCoverage"></div></aside><section class="chat-conversation" aria-label="LINE 對話"><header><h3 id="chatFleetTitle">全部車隊</h3><p id="chatGroupState" class="hint"></p></header><button id="activityMore" class="action secondary hidden">載入較早動態</button><div id="activityRows" class="chat-messages" tabindex="0" aria-label="群組對話紀錄"></div><footer class="hint">此處為接收紀錄與 Bot 回覆；人工聊天請使用 LINE。訊息處理完成不代表回覆已送達或 Sheets 已同步。</footer></section><aside class="chat-dispatch" aria-label="調度工作區"><h3>調度工作區</h3><p id="chatOpsError" class="control-error" role="alert"></p><div id="chatCheckins"></div><h4>車隊任務</h4><div id="chatTasks"></div><h4>異常案件</h4><div id="chatCases"></div><div class="control-toolbar"><button class="action secondary small" data-chat-target="fleetTaskList">任務管理</button><button class="action secondary small" data-chat-target="fleetCaseList">異常處理</button><button class="action secondary small admin-only hidden" data-chat-target="fleetJobs">Sheets 同步紀錄</button></div></aside></div></div><br>`);
  el('chatDate').value=today();
  const local=['127.0.0.1','localhost','[::1]'].includes(location.hostname);
  if(local){el('fleetDataSource').textContent='目前為本機驗收資料。LINE Bot 的群組綁定、訊息與異常回報保存在雲端測試平台，不會自動出現在本機資料庫。請開啟雲端平台並登入查看。';el('fleetCloudWorkspace').classList.remove('hidden');}
  function focus(id){const target=el(id);if(!target)return;target.scrollIntoView?.({behavior:'smooth',block:'start'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
  document.querySelectorAll('[data-fleet-section]').forEach(button=>button.addEventListener('click',()=>{focus(button.dataset.fleetSection);if(button.dataset.fleetSection==='fleetActivityPanel')load();}));
  function coverage(){
    el('activityCoverage').innerHTML='<button class="chat-fleet '+(!selected?'selected':'')+'" data-chat-fleet="" aria-pressed="'+(!selected)+'">全部車隊</button>'+currentFleets.map(f=>'<button class="chat-fleet '+(selected===f.id?'selected':'')+'" data-chat-fleet="'+esc(f.id)+'" aria-pressed="'+(selected===f.id)+'"><strong>'+esc(f.name)+'／'+esc(f.status)+'</strong><span>'+esc(f.group_name||(f.bound?'已綁定，未命名':'未綁定'))+'</span><span>'+(f.bound?(f.bot_present===true?'最近事件已驗證':f.bot_present===false?'Bot已離開':'尚無群組事件'):'待綁定')+'</span><small>'+esc(date(f.last_activity||f.last_seen_at))+'</small></button>').join('');
    const fleet=currentFleets.find(f=>f.id===selected);el('chatFleetTitle').textContent=fleet?.name||'全部車隊';el('chatGroupState').textContent=fleet?(fleet.bound?'已綁定群組 · '+(fleet.group_name||'尚未命名'):'尚未綁定，請由管理員設定'):'選擇左側車隊可同時篩選對話、任務與異常。';
  }
  function messages(more,changed){
    const panel=el('activityRows'),height=panel.scrollHeight,top=panel.scrollTop,nearBottom=height-top-panel.clientHeight<100;
    const processing={pending:'待處理',processed:'處理完成',failed:'處理失敗'},delivery={pending:'回覆待送',sent:'回覆已送',failed:'回覆失敗',skipped:'無回覆'};
    panel.innerHTML=rows.length?rows.slice().reverse().map(a=>'<article class="chat-event"><div class="chat-bubble incoming"><strong>'+esc(a.fleet_name)+' · '+esc(a.sender_label)+'</strong><p>'+esc(a.content)+'</p><small>'+esc(date(a.received_at))+' · '+esc(processing[a.status]||a.status)+'</small></div>'+(a.reply_text&&!a.hidden?'<div class="chat-bubble outgoing"><strong>Wayan Bot</strong><p>'+esc(a.reply_text)+'</p><small>'+esc(delivery[a.delivery_status]||a.delivery_status)+'</small></div>':'')+'</article>').join(''):'<div class="empty">尚未收到符合條件的 LINE 動態。Bot加入群組後仍需完成測試Webhook與車隊綁定，再於群組傳送訊息。</div>';
    if(more)panel.scrollTop=top+panel.scrollHeight-height;else if(changed||nearBottom)panel.scrollTop=panel.scrollHeight;else panel.scrollTop=top;
    el('activityMore').classList.toggle('hidden',!cursor);
  }
  async function operations(fleetId,stamp,day){
    const query='?fleetId='+encodeURIComponent(fleetId);
    const results=await Promise.allSettled([api('/api/fleet-ops/tasks'+query),api('/api/fleet-ops/incidents'+query),api('/api/store-delivery/trips?date='+encodeURIComponent(day))]);
    if(stamp!==generation||!getToken())return;
    const [tasks,cases,trips]=results;el('chatOpsError').textContent=results.some(r=>r.status==='rejected')?'部分調度資料更新失敗，請重新整理。':'';
    el('chatTasks').innerHTML=tasks.status==='fulfilled'?(tasks.value.items.slice(0,5).map(t=>'<article class="chat-card"><strong>'+esc(t.number)+' '+esc(t.title)+'</strong><p>'+esc(t.fleet_name)+' · '+esc(t.service_date)+'</p><p>'+esc(t.origin)+' → '+esc(t.destination)+'</p><small>'+esc(t.status)+' · 已確認 '+Number(t.confirmed_trucks)+'／需求 '+Number(t.requested_trucks)+' 車</small></article>').join('')||'<p class="hint">尚無車隊任務</p>'):'<p class="hint">任務資料暫不可用</p>';
    el('chatCases').innerHTML=cases.status==='fulfilled'?(cases.value.items.slice(0,5).map(c=>'<button class="chat-card chat-case" data-fleet-case="'+esc(c.id)+'"><strong>'+esc(c.number)+' · '+esc(c.kind)+'</strong><p>'+esc(c.description)+'</p><small>'+esc(c.fleet_name)+' · '+esc(c.status)+'</small></button>').join('')||'<p class="hint">尚無異常案件</p>'):'<p class="hint">案件資料暫不可用</p>';
    if(trips.status==='fulfilled'){const list=trips.value.filter(t=>(!fleetId||t.fleet_id===fleetId)&&t.status!=='已取消'),sum=k=>list.reduce((n,t)=>n+Number(t[k]||0),0),required=sum('required_checkins'),checked=sum('checked_in');el('chatCheckins').innerHTML='<h4>'+esc(day)+' 門店車趟報到</h4><div class="chat-counts"><div><strong>'+required+'</strong><span>需求車數</span></div><div><strong>'+checked+'</strong><span>已報到</span></div><div><strong>'+list.reduce((n,t)=>n+Math.max(Number(t.required_checkins)-Number(t.checked_in),0),0)+'</strong><span>待報到</span></div></div><p class="hint">已載入 '+list.length+' 趟，最多500趟；同一人每車趟報到一次。任務與案件各列最近5筆。</p>';}
    else el('chatCheckins').innerHTML='<p class="hint">報到資料暫不可用</p>';
  }
  async function load(more=false){
    if(!getToken()||(more&&loadingMore))return;const stamp=more?generation:++generation,fleetId=selected,day=el('chatDate').value;if(more)loadingMore=true;
    const before=more?cursor:null;
    if(!more&&el('activityRows').dataset.fleet!==fleetId){el('activityRows').textContent='正在載入此車隊對話…';cursor=null;}
    if(!more){el('chatTasks').textContent='載入中…';el('chatCases').textContent='載入中…';el('chatCheckins').textContent='載入中…';operations(fleetId,stamp,day);}
    try{
      if(!more){const fleets=await api('/api/fleet-ops/activity-status');if(stamp!==generation||!getToken())return;currentFleets=fleets;el('activityFleet').innerHTML='<option value="">全部車隊</option>'+fleets.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join('');el('activityFleet').value=fleetId;coverage();}
      const data=await api('/api/fleet-ops/activity?fleetId='+encodeURIComponent(fleetId)+(before?'&before='+encodeURIComponent(before):''));if(stamp!==generation||!getToken())return;
      const previous=el('activityRows').dataset.fleet;rows=more?Array.from(new Map(rows.concat(data.items).map(a=>[a.event_id,a])).values()):data.items;cursor=data.nextCursor;messages(more,previous!==fleetId);el('activityRows').dataset.fleet=fleetId;
      el('activityUpdated').textContent='更新於 '+date(new Date());el('activityError').textContent='';
    }catch(e){if(stamp===generation)el('activityError').textContent=e.message;}finally{if(more)loadingMore=false;}
  }
  function schedule(){if(timer)return;timer=setTimeout(()=>{timer=null;if(!document.hidden&&el('fleetOps').classList.contains('active'))load();},1500);}
  document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.page==='fleetOps'||b.id==='activityRefresh'||b.id==='fleetOpsRefresh')load();if(b.id==='activityMore'&&cursor)load(true);if(b.hasAttribute('data-chat-fleet')){selected=b.dataset.chatFleet;el('activityFleet').value=selected;load();}if(b.dataset.chatTarget)focus(b.dataset.chatTarget);});
  el('activityFleet').addEventListener('change',()=>{selected=el('activityFleet').value;load();});el('chatDate').addEventListener('change',()=>load());document.addEventListener('wayan:refresh',schedule);document.addEventListener('visibilitychange',schedule);setInterval(schedule,30000);
})();
