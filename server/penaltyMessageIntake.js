function parse(text){const m=String(text||'').normalize('NFKC').trim().match(/^([A-Z]+-\d{2}-\d+(?:-\d+)?)\s+(\d{1,20})\s+(.{1,100}?)\s*罰款\s*([\d,]+(?:\.\d{1,2})?)\s*(?:元)?$/i);if(!m)return null;if(!m[3].trim()||! /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(m[4]))return null;const amount=m[4].replaceAll(',','');if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount))return null;return {routeCode:m[1].toUpperCase(),driverCode:m[2],kind:m[3].trim(),proposedAmount:amount};}
async function capture(db,event,eventId){
 if(event.source?.type!=='group'||event.message?.type!=='text')return null;const p=parse(event.message.text);if(!p)return null;
 const allowed=(await db.query('SELECT 1 FROM line_demand_sources WHERE group_id=$1 AND enabled UNION ALL SELECT 1 FROM line_shared_group_fleets WHERE group_id=$1 UNION ALL SELECT 1 FROM line_fleet_groups WHERE group_id=$1 LIMIT 1',[event.source.groupId])).rowCount;if(!allowed)return null;
 const sourceFleetRecord=(await db.query('SELECT g.fleet_id,f.name FROM line_fleet_groups g JOIN partner_fleets f ON f.id=g.fleet_id WHERE g.group_id=$1',[event.source.groupId])).rows[0];const sourceFleet=sourceFleetRecord?.fleet_id||null;
 const r=(await db.query('INSERT INTO penalty_message_drafts(source_event_id,source_group_id,route_code,driver_code,violation_kind,source_amount,source_text,source_fleet_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_event_id) DO UPDATE SET source_event_id=EXCLUDED.source_event_id RETURNING id',[eventId,event.source.groupId,p.routeCode,p.driverCode,p.kind,p.proposedAmount,String(event.message.text).slice(0,2000),sourceFleet])).rows[0];
 await require('./transaction').audit(db,{username:'LINE罰款訊息擷取',role:'system'},'擷取待核對罰款訊息','罰款草稿',r.id,'未核實條款、發生日或責任；未計罰');
 return (sourceFleetRecord?.name?'【'+sourceFleetRecord.name+'】\n':'')+'已登錄待核對訊息 V'+r.id+'\n路線：'+p.routeCode+'\n司機ID：'+p.driverCode+'\n異常：'+p.kind+'\n原訊息金額：'+p.proposedAmount+' 元（未確認）\n請調度核對發生日、車隊與適用規則；尚未計罰或扣款。';
}
module.exports={parse,capture};
