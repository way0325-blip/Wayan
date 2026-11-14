const {SOURCE_ID,hash}=require('./sourceCatalog');
const {isValidDateKey}=require('./dates');
const reject=message=>{throw Object.assign(new Error(message),{status:400});};
async function preview(db,rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>200)reject('每日匯入限1～200條路線');
 const batches=new Map(),pickups=(await db.query('SELECT * FROM delivery_pickup_points')).rows,seen=new Set(),items=[];
 for(const [index,r]of rows.entries()){
  if(!r||typeof r!=='object')reject('第'+(index+1)+'列格式錯誤');
  const routeCode=String(r.routeCode||'').trim().toUpperCase(),kind=({N:'NB',F:'FN',W:'WB'})[routeCode[0]],serviceDate=String(r.serviceDate||''),pickupPointId=String(r.pickupPointId||'');
  if(!kind||!isValidDateKey(serviceDate))reject('第'+(index+1)+'列：路線、日期、時間無效');
  const key=serviceDate+':'+routeCode;if(seen.has(key))reject('日期與路線重複：'+key);seen.add(key);
  if(!batches.has(kind))batches.set(kind,require('./sourceCatalog').projectRegions((await db.query('SELECT * FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1',[SOURCE_ID,kind])).rows[0]));
  const batch=batches.get(kind),route=batch?.records.find(x=>x.routeCode===routeCode),pickup=pickups.find(p=>p.id===pickupPointId);
  if(!route||route.problems.length||route.routeCode.length>31)reject('第'+(index+1)+'列：路線未同步或尚待核對');
  const departureTime=String(r.departureTime||require('../public/routeCatalogGroups').timeWindow(route.timeWindow).start);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime))reject('第'+(index+1)+'列：出發時間或來源時段待核對');
  if(!pickup||pickup.box_type!==route.boxType)reject('第'+(index+1)+'列：取貨點不存在或箱型不符');
  items.push({kind,batchId:String(batch.id),routeCode,serviceDate,departureTime,pickupPointId,verified:true,stopCount:route.stops.length});
 }
 return {items,digest:hash(items)};
}
module.exports={preview};
