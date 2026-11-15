'use strict';
// Safe projection: no phone, identity document, token or LINE user ID is returned.
function project(records=[],drivers=[],bindings=[]){
 const bound=new Set(bindings.map(b=>b.driver_id)),counts=new Map();
 for(const r of records){const id=String(r.externalDriverId||'');if(id)counts.set(id,(counts.get(id)||0)+1);}
 const represented=new Set();
 const rows=records.map(r=>{
  const id=String(r.externalDriverId||''),matches=drivers.filter(d=>d.roster_driver_id===id&&id);
  matches.forEach(d=>represented.add(d.id));
  const problems=[...(r.problems||[])];
  if(!id)problems.push('未填司機 ID');if(counts.get(id)>1)problems.push('司機 ID 重複');if(matches.length>1)problems.push('系統司機對應不唯一');
  const d=matches.length===1?matches[0]:null;
  return {key:'roster:'+r.sourceRow,source:'roster',driverCode:id,name:r.name||'',warehouse:r.warehouse||r.warehouseCode||'',sourceRow:r.sourceRow,runtimeId:d?.id||null,bound:Boolean(d&&bound.has(d.id)),problems:[...new Set(problems)]};
 });
 for(const d of drivers){if(represented.has(d.id))continue;rows.push({key:'runtime:'+d.id,source:'runtime',driverCode:d.roster_driver_id||d.id,name:d.name||'',warehouse:'',runtimeId:d.id,bound:bound.has(d.id),problems:[]});}
 return rows.sort((a,b)=>a.driverCode.localeCompare(b.driverCode,'zh-Hant',{numeric:true})||a.key.localeCompare(b.key));
}
module.exports={project};
