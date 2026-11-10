// Read-only projection: preserve source route and mapping history.
const {SOURCES}=require('./carrierMappings');
async function attach(db,batch){
 if(!batch||!['NB','FN','WB'].includes(batch.kind))return batch;
 const mapping=(await db.query("SELECT id,records FROM dispatch_source_batches WHERE kind='mapping' AND source_id=$1 ORDER BY id DESC LIMIT 1",[SOURCES.mapping])).rows[0];
 const byCode=new Map();for(const row of mapping?.records||[]){const rows=byCode.get(row.routeCode)||[];rows.push(row);byCode.set(row.routeCode,rows);}
 const records=batch.records.map(route=>{const matches=byCode.get(route.routeCode)||[],one=matches.length===1?matches[0]:null,valid=!!one?.fleetName&&!one.problems?.length;
 return {...route,...require('../public/routeRegions').classify(route.routeCode),sourceFleetName:valid?one.fleetName:'',carrierMatch:valid?'已核對':matches.length>1?'對照重複':one?'車行待核對':'未對應',carrierMappingId:mapping?.id||null};});
 return {...batch,records,carrierMappingId:mapping?.id||null};
}
async function attachTrips(db,trips){
 if(!trips.length)return trips;
 const rows=(await db.query('SELECT DISTINCT trip_id,route_code FROM delivery_trip_stops WHERE trip_id=ANY($1::bigint[]) AND released_at IS NULL',[trips.map(t=>t.id)])).rows,tripCodes=new Map(),allCodes=new Set();
 for(const row of rows){const id=String(row.trip_id),code=String(row.route_code||'').trim();if(!tripCodes.has(id))tripCodes.set(id,new Set());tripCodes.get(id).add(code);if(code)allCodes.add(code);}
 const mapped=await attach(db,{kind:'NB',records:[...allCodes].map(routeCode=>({routeCode}))}),byCode=new Map(mapped.records.map(r=>[r.routeCode,r]));
 return trips.map(t=>{const codes=tripCodes.get(String(t.id))||new Set(),missing=codes.has(''),list=[...codes].filter(Boolean).map(code=>byCode.get(code)),names=[...new Set(list.map(r=>r.sourceFleetName).filter(Boolean))],valid=!missing&&list.length>0&&list.every(r=>r.carrierMatch==='已核對')&&names.length===1;
 return {...t,source_fleet_snapshot:t.source_fleet_snapshot??t.source_fleet_name??'',source_fleet_name:valid?names[0]:'',source_carrier_status:valid?'已核對':!list.length||missing?'路線未填':names.length>1?'多車行待確認':list.some(r=>r.carrierMatch==='對照重複')?'對照重複':list.some(r=>r.carrierMatch==='車行待核對')?'車行未填':'未對應',source_carrier_mapping_id:mapped.carrierMappingId,source_route_carriers:list};});
}
module.exports={attach,attachTrips};
