(() => {
  const el=id=>document.getElementById(id),esc=v=>escapeHTML(v),show=(id,text)=>{el(id).textContent=text;};
  let rules=[],live=[],fleetTotals=[],currentAssignment=null,timer,loading=false,ruleLoading=false;
  const date=v=>new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
  async function action(fn){try{await fn();}catch(e){show('opsError',e.message);show('rulesError',e.message);const n=document.querySelector('.modal:not(.hidden) .opsFormError');if(n)n.textContent=e.message;}}
  async function loadRules(){
    if(ruleLoading)return;ruleLoading=true;
    try{rules=await api('/api/penalty-rules');
      el('ruleList').innerHTML=rules.length?`<table><thead><tr><th>規則／版本</th><th>條款與來源</th><th>記點／參考金額</th><th>生效日</th><th>覆核狀態</th><th>操作</th></tr></thead><tbody>${rules.map(r=>`<tr><td>${esc(r.rule_code)} v${r.version}<br>${esc(r.title)}</td><td><div style="white-space:pre-wrap;max-width:420px">${esc(r.terms)}</div><small>來源：${esc(r.source)}</small></td><td>${r.points} 點<br>${r.proposed_amount===null?'未定':esc(r.proposed_amount)+' 元'}</td><td>${esc(r.effective_date||'待確認')}</td><td>${esc(r.status)}<br>${esc(r.verified_by||'尚未核實')}<br><small>${esc(r.verification_note)}</small></td><td><button class="action secondary small" data-rule-history="${r.id}">歷程</button>${isAdmin()?` <button class="action secondary small" data-rule-copy="${r.id}">建立新版本</button>${r.status==='草稿'?` <button class="action small" data-rule-verify="${r.id}">核實</button>`:''}${r.status!=='已停用'?` <button class="action secondary small" data-rule-retire="${r.id}">停用</button>`:''}`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">尚無規則。請由管理員依核准條款建立草稿；平台不預填罰款金額。</div>';
    }finally{ruleLoading=false;}
  }
  function openRule(r){el('ruleForm').reset();if(r){el('ruleCode').value=r.rule_code;el('ruleTitle').value=r.title;el('ruleTerms').value=r.terms;el('ruleSource').value=r.source;el('ruleAmount').value=r.proposed_amount??'';el('rulePoints').value=r.points;el('ruleDate').value=r.effective_date;}else el('ruleDate').value='';el('ruleFormError').textContent='';el('ruleModal').classList.remove('hidden');}
  async function loadLive(){
    if(loading||!getToken())return;loading=true;
    try{
      if(!el('opsDate').value)el('opsDate').value=localToday();
      const r=await api('/api/shopee-live?date='+el('opsDate').value);live=r.items;fleetTotals=r.fleets;
      const sum=k=>fleetTotals.reduce((n,a)=>n+Number(a[k]||0),0);
      el('opsKpis').innerHTML=[['路線需求',r.required],['已確認承接',sum('confirmed')],['已報到總數',sum('reported')],['承接缺口',Math.max(r.required-sum('confirmed'),0)],['尚未報到',Math.max(sum('confirmed')-sum('reported'),0)],['待車隊回覆',sum('pending')]].map(([label,n])=>'<div class="control-metric"><small>'+label+'</small><strong>'+n+'</strong></div>').join('');
      el('opsFleetSummary').innerHTML=fleetTotals.length?'<table><thead><tr><th>車隊</th><th>要求趟數</th><th>已承接</th><th>累計報到總車數</th><th>待報到</th><th>最近回報</th><th>操作</th></tr></thead><tbody>'+fleetTotals.map(g=>'<tr><td>'+esc(g.fleet_name)+'</td><td>'+g.requested+'</td><td>'+g.confirmed+'</td><td>'+g.reported+'</td><td>'+(g.confirmed-g.reported)+'</td><td>'+esc(g.source||'尚未回報')+'<br>'+esc(g.reported_at?date(g.reported_at):'—')+'</td><td><button class="action secondary small" data-ops-detail="'+esc(g.fleet_id)+'">回報總數／歷程</button></td></tr>').join('')+'</tbody></table>':'<div class="empty">當日尚無車隊分派，請先建立需求並分派。</div>';
      el('opsAssignments').innerHTML=live.length?'<table><thead><tr><th>任務／車隊</th><th>路線／車型</th><th>要求／承接趟數</th><th>狀態</th><th>操作</th></tr></thead><tbody>'+live.map(a=>'<tr><td>'+esc(a.number)+'<br>'+esc(a.fleet_name)+'</td><td>'+esc(a.origin)+'→'+esc(a.destination)+'<br>'+esc(a.vehicle_type)+'</td><td>'+a.requested_trucks+'／'+a.confirmed_trucks+'</td><td>'+esc(a.status)+'<br>'+(a.group_bound?'群組已綁定':'群組未綁定')+'</td><td>'+(a.group_bound&&a.status!=='已拒絕'?'<button class="action secondary small" data-ops-notify="'+a.id+'">通知群組</button>':'請至夥伴車隊營運綁定群組')+'</td></tr>').join('')+'</tbody></table>':'';
      show('opsUpdated','資料更新：'+date(r.updatedAt)+'；使用 LINE 即時事件更新，斷線時每 30 秒補查。');show('opsError','');
    }catch(e){show('opsError',e.message);}finally{loading=false;}
  }
  async function detail(id){
    const a=fleetTotals.find(a=>a.fleet_id===id);if(!a)return;currentAssignment={...a,serviceDate:el('opsDate').value};
    const rows=await api('/api/shopee-live/fleets/'+encodeURIComponent(id)+'/reports?date='+currentAssignment.serviceDate);
    show('opsDetailTitle',a.fleet_name+'｜'+currentAssignment.serviceDate+' 累計總車數');
    el('opsCheckinForm').reset();el('opsTotal').value=a.reported;show('opsFormError','');
    show('opsCommand','LINE 群組指令：蝦皮報到 目前累計總車數（例如：蝦皮報到 5）\n同一數字重送不累加；總數降低須由管理員填寫原因更正；僅可回報台灣時間今日資料。');
    el('opsCheckinRows').innerHTML=rows.length?'<table><thead><tr><th>累計總數</th><th>來源／回報者</th><th>時間</th><th>說明</th></tr></thead><tbody>'+rows.map(c=>'<tr><td>'+c.reported_total+'</td><td>'+esc(c.source)+'<br>'+esc(c.reported_by)+'</td><td>'+esc(date(c.created_at))+'</td><td>'+esc(c.note||'—')+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">尚無回報紀錄</div>';
    el('opsDetailModal').classList.remove('hidden');
  }
  function schedule(){if(timer)return;timer=setTimeout(()=>{timer=null;if(document.hidden)return;if(el('shopee').classList.contains('active'))loadLive();if(el('penaltyRules').classList.contains('active'))loadRules().catch(e=>show('rulesError',e.message));},600);}
  document.addEventListener('wayan:refresh',schedule);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  setInterval(()=>{if(getToken())schedule();},30000);
  document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
    if(b.dataset.page==='shopee'||b.dataset.shopee==='fleets')loadLive();
    if(b.dataset.page==='penaltyRules'||b.id==='ruleRefresh')action(loadRules);
    if(b.id==='ruleAdd')openRule();
    if(b.id==='opsRefresh')loadLive();
    if(b.dataset.ruleCopy)openRule(rules.find(r=>String(r.id)===b.dataset.ruleCopy));
    if(b.dataset.ruleVerify||b.dataset.ruleRetire)action(async()=>{const id=b.dataset.ruleVerify||b.dataset.ruleRetire,note=prompt('填寫條款核對來源與覆核說明（核實僅確認規則版本，不代表個案可直接計罰）：');if(note===null)return;await api('/api/penalty-rules/'+id+'/review',{method:'POST',body:JSON.stringify({status:b.dataset.ruleVerify?'已核實':'已停用',note})});await loadRules();});
    if(b.dataset.ruleHistory)action(async()=>{const rows=await api('/api/penalty-rules/'+b.dataset.ruleHistory+'/history');show('ruleHistory',rows.map(h=>`${date(h.created_at)} ${h.actor} ${h.action}\n${h.note}`).join('\n\n'));});
    if(b.dataset.opsDetail)action(()=>detail(b.dataset.opsDetail));
    if(b.dataset.opsNotify)action(async()=>{b.disabled=true;try{const r=await api('/api/shopee-live/'+b.dataset.opsNotify+'/notify',{method:'POST'});show('opsError',r.duplicate?'此版本已排入通知，未重複發送。':'已排入 LINE 通知，實際結果請至夥伴車隊營運查看傳送紀錄。');}finally{b.disabled=false;}});
  });
  el('opsDate').addEventListener('change',loadLive);
  el('ruleForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const b=el('ruleSave');b.disabled=true;try{await api('/api/penalty-rules',{method:'POST',body:JSON.stringify({ruleCode:el('ruleCode').value,title:el('ruleTitle').value,terms:el('ruleTerms').value,source:el('ruleSource').value,proposedAmount:el('ruleAmount').value,points:Number(el('rulePoints').value),effectiveDate:el('ruleDate').value})});closeModal('ruleModal');await loadRules();}finally{b.disabled=false;}});});
  el('opsCheckinForm').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const b=el('opsCheckinSave');b.disabled=true;try{await api('/api/shopee-live/fleets/'+encodeURIComponent(currentAssignment.fleet_id)+'/reports',{method:'POST',body:JSON.stringify({serviceDate:currentAssignment.serviceDate,total:Number(el('opsTotal').value),note:el('opsReportNote').value})});await loadLive();await detail(currentAssignment.fleet_id);}finally{b.disabled=false;}});});
})();
