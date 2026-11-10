// Read-only projection: preserve source route and mapping history.
const {SOURCES}=require('./weeklyRoutes');
async function attach(db,batch){
 if(!batch||!['NB','FN','WB'].includes(batch.kind))return batch;
 const mapping=(await db.query("SELECT id,records FROM dispatch_source_batches WHERE kind='mapping' AND source_id=$1 ORDER BY id DESC LIMIT 1",[SOURCES.mapping])).rows[0];
 const byCode=new Map();for(const row of mapping?.records||[]){const rows=byCode.get(row.routeCode)||[];rows.push(row);byCode.set(row.routeCode,rows);}
 const records=batch.records.map(route=>{const matches=byCode.get(route.routeCode)||[],one=matches.length===1?matches[0]:null,valid=!!one?.fleetName&&!one.problems?.length;
 return {...route,...require('../public/routeRegions').classify(route.routeCode),sourceFleetName:valid?one.fleetName:'',carrierMatch:valid?'已核對':matches.length>1?'對照重複':one?'車行待核對':'未對應',carrierMappingId:mapping?.id||null};});
 return {...batch,records,carrierMappingId:mapping?.id||null};
}
module.exports={attach};
