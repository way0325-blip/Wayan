const {cycle}=require('./staffingModel'),{isValidDateKey}=require('./dates');
const fail=message=>{throw Object.assign(new Error(message),{code:'STAFF_SOURCE_FORMAT'});};
function parse(source,values,start){
 const c=cycle(start);if(!Array.isArray(values)||values.length>2000||values[6]?.[0]!=='路線編號'||values[6]?.[1]!=='類型')fail('來源欄位已變更');
 if(String(values[2]?.[0]||'').trim()!==source.fleet+' 司機回填表')fail('來源車行標題不符');
 const cols=(values[3]||[]).map((v,i)=>({date:String(v||'').replaceAll('/','-'),i})).filter(x=>isValidDateKey(x.date)&&x.date>=c.start_date&&x.date<=c.end_date);
 if(cols.length!==7||new Set(cols.map(x=>x.date)).size!==7)fail('來源尚未包含本週完整七天');
 const rows=[],issues=[];
 values.slice(7).forEach((r,index)=>{const raw=String(r?.[0]??'').trim();if(!raw)return;if(raw==='備援')return;const m=raw.match(/^([A-Z]+-\d{2}-\d+(?:-\d+)?)(.*)$/);if(!m){issues.push({fleet:source.fleet,row:index+8,route:raw,reason:'路線格式待核對'});return;}
 for(const col of cols){const driver=String(r[col.i]??'').trim();if(driver.length>100||/[\r\n\0]/.test(driver))fail('司機欄位格式錯誤');rows.push({date:col.date,route:m[1],raw,suffix:m[2],fleet:source.fleet,driver,sourceId:source.id,row:index+8,col:col.i+1});}});
 return {rows,issues};
}
function partition(rows){const map=new Map();for(const r of rows){const k=r.date+'|'+r.route;const list=map.get(k)||[];list.push(r);map.set(k,list);}const accepted=[],issues=[];for(const list of map.values()){if(list.length>1){for(const r of list)issues.push({...r,reason:'同日同路線重複，未自動選擇來源'});}else accepted.push(list[0]);}return {accepted,issues};}
module.exports={parse,partition};
