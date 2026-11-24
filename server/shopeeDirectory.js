async function carriers(db){
 const mapping=(await db.query("SELECT id,created_at,records FROM dispatch_source_batches WHERE kind='mapping' AND source_id=$1 ORDER BY id DESC LIMIT 1",[require('./carrierMappings').SOURCES.mapping])).rows[0];
 const aliases=(await db.query('SELECT a.source_name,a.fleet_id,f.name AS fleet_name,f.status FROM dispatch_source_fleet_aliases a JOIN partner_fleets f ON f.id=a.fleet_id')).rows;
 const groups=new Map();for(const r of mapping?.records||[]){const name=r.fleetName||'';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(r);}
 return {mappingId:mapping?.id||null,updatedAt:mapping?.created_at||null,records:[...groups].map(([sourceName,rows])=>{const alias=aliases.find(a=>a.source_name===sourceName);return {sourceName,routeCount:new Set(rows.map(r=>r.routeCode)).size,pendingRows:rows.filter(r=>r.problems?.length||!sourceName).length,fleetId:alias?.fleet_id||'',fleetName:alias?.fleet_name||'',fleetStatus:alias?.status||'',routeCodes:[...new Set(rows.map(r=>r.routeCode))]};}).sort((a,b)=>a.sourceName.localeCompare(b.sourceName,'zh-TW'))};
}
module.exports={carriers};
