const {cycle}=require('./staffingModel'),{isValidDateKey}=require('./dates');
const fail=message=>{throw Object.assign(new Error(message),{code:'STAFF_SOURCE_FORMAT',status:400});};
function parse(source,values,start){
 const c=cycle(start);if(!Array.isArray(values)||values.length>2000||values[6]?.[0]!=='路線編號'||values[6]?.[1]!=='類型')fail('來源欄位已變更');
 if(String(values[2]?.[0]||'').trim()!==source.fleet+' 司機回填表')fail('來源車行標題不符');
 const cols=(values[3]||[]).map((v,i)=>({date:String(v||'').replaceAll('/','-'),i})).filter(x=>isValidDateKey(x.date)&&x.date>=c.start_date&&x.date<=c.end_date);
 if(cols.length!==7||new Set(cols.map(x=>x.date)).size!==7)fail('來源尚未包含本週完整七天');
 const rows=[],issues=[];
 values.slice(7).forEach((r,index)=>{const raw=String(r?.[0]??'').trim();if(!raw)return;if(raw==='備援')return;const m=raw.match(/^([A-Z]+-\d{2}-\d+(?:-\d+)?)(.*)$/);if(!m){issues.push({fleet:source.fleet,row:index+8,route:raw,reason:'路線格式待核對'});return;}
 for(const col of cols){const driver=String(r[col.i]??'').trim();if(driver.length>100||/[\r\n\0]/.test(driver))fail('司機欄位格式錯誤');rows.push({date:col.date,route:m[1],sourceType:String(r[1]??'').trim(),raw,suffix:m[2],fleet:source.fleet,driver,sourceId:source.id,row:index+8,col:col.i+1});}});
 return {rows,issues};
}
function partition(rows){const map=new Map();for(const r of rows){const k=r.date+'|'+r.route;const list=map.get(k)||[];list.push(r);map.set(k,list);}const accepted=[],issues=[];for(const list of map.values()){if(list.length===1){accepted.push(list[0]);continue;}const merged=require('./dailyReconciliation').reconcile(list.map(r=>({...r,routeCode:r.route,driverCode:r.driver,sourceRow:r.row,sourceColumn:r.col})));if(merged.length===1){const r=merged[0];accepted.push({...r,driver:r.driverCode,row:r.sourceRow,col:r.sourceColumn});}else for(const r of list)issues.push({...r,reason:'同日同路線來源衝突，未自動選擇來源'});}return {accepted,issues};}
function routeMatches(routes,code,sourceType){const matches=routes.filter(r=>r.routeCode===code),type=String(sourceType||'').trim().toUpperCase().replace(/\s+/g,'');if(matches.length<2||!['主線','NDD','WHNDD'].includes(type))return matches;const typed=matches.filter(r=>(r.business||require('./staffingModel').business(r.routeCode,r.category))===type);return typed.length?typed:matches;}
module.exports={parse,partition,routeMatches};
