const {hash}=require('./sourceCatalog'),{isValidDateKey}=require('./dates'),{audit}=require('./transaction');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const key=r=>hash([r.staff_type||r.staffType,r.staff_id||r.staffId,r.date]);
async function state(db,b){return (await db.query('SELECT * FROM attendance_sync_state WHERE staff_type=$1 AND staff_id=$2 AND date=$3',[b.staffType,b.staffId,b.date])).rows[0];}
async function save(db,b,actor,requireVersion=true){
 if(!b||!['driver','dispatcher'].includes(b.staffType)||typeof b.staffId!=='string'||!b.staffId||b.staffId.length>100||!isValidDateKey(b.date)||![null,undefined,'出勤','休假','曠職'].includes(b.status)||b.note!==undefined&&(typeof b.note!=='string'||b.note.length>500))fail('出勤資料格式無效');
 await db.query('SELECT pg_advisory_xact_lock(870047)');const before=await state(db,b);
 if(requireVersion&&(!Object.hasOwn(b,'expectedVersion')||String(b.expectedVersion||'')!==String(before?.version||'')))fail('出勤已由平台或Sheets更新，請重新載入後再修改',409);
 const table=b.staffType==='driver'?'drivers':'dispatch_staff';if(!(await db.query('SELECT 1 FROM '+table+' WHERE id=$1',[b.staffId])).rowCount)fail('找不到此人員',404);
 const note=b.note===undefined?before?.note||'':b.note;
 if(b.status){await db.query('INSERT INTO attendance_records(staff_type,staff_id,date,status,note,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(staff_type,staff_id,date) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()',[b.staffType,b.staffId,b.date,b.status,note,actor.username]);}
 else {await db.query('DELETE FROM attendance_records WHERE staff_type=$1 AND staff_id=$2 AND date=$3',[b.staffType,b.staffId,b.date]);if(!before)await db.query('INSERT INTO attendance_sync_state(staff_type,staff_id,date,status) VALUES($1,$2,$3,NULL)',[b.staffType,b.staffId,b.date]);await require('./fleetOperations').enqueueSheet(db,'attendance','current');}
 const after=await state(db,b);await audit(db,actor,'設定出勤與班表','出勤紀錄',b.staffId,JSON.stringify({before:before||null,after}));return after;
}
module.exports={key,state,save};
