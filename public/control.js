(() => {
  let controller, reconnect, refreshTimer, active=false, refreshing=false, reloadTimer;
  const el=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const set=(id,value)=>{if(el(id)) el(id).textContent=value;};
  const go=page=>document.querySelector(`[data-page="${page}"]`)?.click();
  function sync(state,text) {el('controlSync').dataset.state=state;set('controlSync',text);}
  async function refresh() {
    if (!active || refreshing) return;
    refreshing=true;
    try {
      const [s,incidents]=await Promise.all([api('/api/control/summary'),api('/api/control/incidents')]);
      set('controlDate',`${s.date} · 台灣時間`);
      set('controlUpdated','最後同步 '+new Date(s.updatedAt).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei'}));
      set('controlActive',s.port.active);set('controlRequired',s.shopee.required);set('controlConfirmed',s.shopee.confirmed);
      set('controlShortage',s.shopee.shortage);set('controlPendingFleet',s.shopee.pending);set('controlIncidents',s.open_incidents);
      set('controlDrivers',s.drivers.total?Math.round(s.drivers.available/s.drivers.total*100)+'%':'—');
      set('controlDriverCount',`${s.drivers.available} / ${s.drivers.total} 位可用`);
      set('controlVehicles',s.vehicles.total?Math.round(s.vehicles.available/s.vehicles.total*100)+'%':'—');
      set('controlVehicleCount',`${s.vehicles.available} / ${s.vehicles.total} 輛可用`);
      set('statOrders',s.port.total);set('statDone',s.port.done);set('statPending',s.port.pending);set('statAlerts',s.abnormal_trips);
      const rate=s.port.total?Math.round(s.port.done/s.port.total*100):0;
      set('completionText',rate+'%');el('completionBar').style.width=rate+'%';
      set('controlFailed',s.failed_events);
      set('controlViolations',s.pendingViolations);
      el('controlIncidentList').innerHTML=incidents.filter(i=>i.status==='待處理').slice(0,12).map(i=>`<div class="incident-row"><strong>${escape(i.kind)}</strong> · ${escape(i.order_id)}<br>${escape(i.detail)}<br><small>司機 ${escape(i.driver_id)} · ${escape(i.vehicle_id||'無車籍')} · ${escape(new Date(i.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</small>${isAdmin()?`<br><button class="action secondary small" data-resolve="${escape(i.id)}">登記處理結果</button>`:''}</div>`).join('') || '<div class="empty">目前沒有待處理異常</div>';
      set('controlError','');document.dispatchEvent(new CustomEvent('wayan:summary',{detail:s}));
    } catch(err) {set('controlError','更新失敗：'+err.message);}
    finally {refreshing=false;}
  }
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer=setTimeout(()=>{refreshTimer=null;refresh();},2000);
    // Update operational lists without interrupting an open form or another module.
    if (!reloadTimer) reloadTimer=setTimeout(()=>{
      reloadTimer=null;
      if (active && !document.querySelector('.modal:not(.hidden)') && el('dashboard').classList.contains('active')) window.WayanViewUpdates?.request('dashboard-lists',()=>loadAll().catch(()=>{}));
    },30000);
  }
  async function connect() {
    if (!active) return;
    controller=new AbortController();
    try {
      const res=await fetch('/api/control/events',{headers:{Authorization:'Bearer '+getToken()},signal:controller.signal});
      if (res.status===401 || res.status===403) {logout();return;}
      if (!res.ok || !res.body) throw new Error('connection');
      const reader=res.body.getReader(), decoder=new TextDecoder();let buffer='';
      while(active) {
        const {value,done}=await reader.read();if(done) break;
        buffer+=decoder.decode(value,{stream:true});
        let end;
        while((end=buffer.indexOf('\n\n'))!==-1) {
          const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
          if(frame.includes('event: expired')) {logout();return;}
          if(frame.includes('event: offline')) sync('offline','同步中斷 · 正在重連');
          if(frame.includes('event: ready')) {sync('online','● 即時同步已連線');scheduleRefresh();document.dispatchEvent(new Event('wayan:refresh'));}
          if(frame.includes('event: refresh')) {scheduleRefresh();let detail={};try{detail=JSON.parse(frame.split('data: ')[1]||'{}');}catch{}document.dispatchEvent(new CustomEvent('wayan:refresh',{detail}));}
        }
      }
    } catch(err) {if(err.name==='AbortError') return;}
    if(active) {sync('offline','同步中斷 · 3 秒後重連');reconnect=setTimeout(connect,3000);}
  }
  let botDirectory=[];
  function renderBotDrivers(){
    const previous=el('botDriver').value,q=(el('botDriverSearch')?.value||'').trim().toLowerCase(),status=el('botDriverStatus')?.value||'';
    const list=botDirectory.filter(d=>(!q||[d.driverCode,d.name,d.warehouse].join(' ').toLowerCase().includes(q))&&(!status||(status==='bound'?d.bound:status==='review'?d.problems.length:!d.bound)));
    el('botDriver').innerHTML='<option value="">請選擇司機</option>'+list.map(d=>'<option value="'+escape(d.key)+'">'+escape(d.driverCode+' · '+d.name+' · '+(d.warehouse||'未分類')+' · '+(d.bound?'已綁定':d.problems.length?'待核對':'未綁定'))+'</option>').join('');
    if(list.some(d=>d.key===previous))el('botDriver').value=previous;
    set('botDirectoryCount','顯示 '+list.length+' / 全部 '+botDirectory.length+' 位；已綁定 '+botDirectory.filter(d=>d.bound).length+' 位。');
  }
  document.addEventListener('input',e=>{if(e.target.id==='botDriverSearch')renderBotDrivers();});
  document.addEventListener('change',e=>{if(e.target.id==='botDriverStatus')renderBotDrivers();});
  async function loadBot() {
    if(!active || !isAdmin()) return;
    try {
      const [s,list,q]=await Promise.all([api('/api/line/admin/status'),api('/api/line/admin/drivers'),api('/api/line/admin/quota').catch(e=>({error:e.message}))]);
      set('botQuota',q.error?q.error:'API本月上限 '+(q.limit??'依LINE方案')+'／已計量 '+q.used+'／剩餘 '+(q.remaining??'依方案')+'｜'+new Date(q.retrievedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}));
      set('botConfigured',s.configured?'測試頻道已設定；仍需實際手機驗收':'尚未設定測試頻道金鑰');
      botDirectory=list.records;renderBotDrivers();
      el('botBindings').innerHTML=s.bindings.map(b=>`<div class="incident-row">${escape(b.name)} · ${escape(b.driver_id)} <button class="action secondary small" data-unbind="${escape(b.driver_id)}">解除綁定</button></div>`).join('')||'<div class="empty">尚無司機綁定</div>';
      el('botEvents').innerHTML=s.events.length?`<table><thead><tr><th>接收時間</th><th>處理</th><th>回覆</th><th>嘗試次數</th><th>操作</th></tr></thead><tbody>${s.events.map(e=>`<tr><td>${escape(new Date(e.received_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</td><td>${escape(({pending:'待處理',processed:'完成',failed:'失敗'})[e.status])}</td><td>${escape(({pending:'等待',sent:'已送出',failed:'失敗',skipped:'無需回覆'})[e.delivery_status])}</td><td>${escape(e.attempts)}</td><td>${e.status==='failed'?`<button class="action secondary small" data-retry="${escape(e.event_id)}">重試處理</button>`:escape(e.error_code||'—')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">尚未收到 LINE 事件</div>';
      set('botError','');
    } catch(err) {set('botError',err.message);}
  }
  async function action(fn) {try {await fn();} catch(err) {set('botError',err.message);set('controlError',err.message);}}
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target) return;
    if(target.dataset.controlGo) go(target.dataset.controlGo);
    if(target.dataset.page==='lineControl') {set('botCode','');loadBot();}
    if(target.id==='controlRefresh') refresh();
    if(target.id==='botRefresh') loadBot();
    if(target.id==='botGenerate') action(async()=>{
      target.disabled=true;
      try {
        const d=botDirectory.find(v=>v.key===el('botDriver').value);
        if(!d)throw new Error('請先選擇司機');
        if(d.bound)throw new Error('此司機已綁定，請先核對原綁定');
        if(d.problems.length)throw new Error('名冊待核對：'+d.problems.join('、'));
        if(!confirm('請確認已核對 '+d.name+' 的司機 ID '+d.driverCode+' 與本人身分，綁定指令只交給本人。'))return;
        const r=await api(d.source==='owned'?'/api/line/admin/owned-binding-codes':d.source==='roster'?'/api/line/admin/roster-binding-codes':'/api/line/admin/binding-codes',{method:'POST',body:JSON.stringify(['roster','owned'].includes(d.source)?{driverCode:d.driverCode,sourceRow:d.sourceRow,verified:true}:{driverId:d.runtimeId})});
        set('botCode',`請只交給指定司機，在私人對話輸入：\n綁定 ${r.code}\n有效至 ${new Date(r.expiresAt).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei'})}，舊碼已失效。`);
        set('botError','');
      } finally {target.disabled=false;}
    });
    if(target.dataset.unbind) action(async()=>{
      if(!confirm('解除後該司機 LINE 將立即失去任務存取權，確定解除？')) return;
      await api('/api/line/admin/bindings/'+encodeURIComponent(target.dataset.unbind),{method:'DELETE'});await loadBot();
    });
    if(target.dataset.retry) action(async()=>{await api('/api/line/admin/events/'+encodeURIComponent(target.dataset.retry)+'/retry',{method:'POST'});await loadBot();});
    if(target.dataset.resolve) action(async()=>{
      const resolution=prompt('請填寫處理結果（1～500 字）。車輛維持停派，請完成維修後再至車籍管理確認狀態。');
      if(resolution===null) return;
      if(!resolution.trim() || resolution.length>500) throw new Error('處理說明須為 1～500 字');
      await api('/api/control/incidents/'+target.dataset.resolve+'/resolve',{method:'PATCH',body:JSON.stringify({resolution})});await refresh();
    });
  });
  document.addEventListener('visibilitychange',()=>{if(active && !document.hidden) refresh();});
  window.WayanControl={
    start(){if(active) return;active=true;sync('connecting','正在連接即時同步');refresh();connect();},
    stop(){botDirectory=[];if(el('botDriver'))el('botDriver').innerHTML='';set('botDirectoryCount','');active=false;controller?.abort();clearTimeout(reconnect);clearTimeout(refreshTimer);clearTimeout(reloadTimer);refreshTimer=null;reloadTimer=null;set('botCode','');},
    refresh,
  };
})();
