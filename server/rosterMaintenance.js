const crypto=require('node:crypto');
const {SOURCE_ID,SPECS,hash,plate}=require('./sourceCatalog');
const {isValidDateKey}=require('./dates');
const {audit}=require('./transaction');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const fields={drivers:{externalDriverId:100,name:50,phone:30,vehicleType:50,licenseType:50,license:10,warehouse:30,sourceStatus:80,employeeId:100},vehicles:{plate:20,vehicleType:50,driverName:50,externalDriverId:100},parking:{supplier:100,plate:20,vehicleType:50,use:10,externalDriverId:100}};
function validate(kind,input){
 if(!fields[kind]||!input||typeof input!=='object'||Array.isArray(input))fail('僅支援司機、車輛與園區停車場清冊');
 if(Object.keys(input).some(k=>!Object.hasOwn(fields[kind],k)))fail('包含不支援的欄位');
 const r={};for(const [key,max]of Object.entries(fields[kind])){if(input[key]!==undefined&&typeof input[key]!=='string')fail('欄位必須為文字');r[key]=(input[key]||'').trim();if(r[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r[key]))fail('欄位長度或格式無效');}
 if(kind==='drivers'){if(!r.name||!r.externalDriverId||/\s/.test(r.externalDriverId))fail('請填寫姓名與不含空白的司機ID');if(r.license&&!isValidDateKey(r.license))fail('證照期限格式無效');if(r.phone&&!/^[0-9+()#\-\s]{5,30}$/.test(r.phone))fail('電話格式無效');return {...r,key:r.externalDriverId,licenseProvided:Boolean(r.license)};}
 r.plate=r.plate.toUpperCase();if(!/^[A-Z0-9]{4,12}$/.test(plate(r.plate)))fail('請填有效車牌');if(!r.vehicleType)fail('請填寫車型');if(kind==='parking'&&!['營業貨車','自用車'].includes(r.use))fail('請選擇營業貨車或自用車');return {...r,key:(kind==='parking'?(r.use==='營業貨車'?'COMMERCIAL-':'PRIVATE-'):'')+plate(r.plate),plateKey:plate(r.plate)};
}
function recheck(kind,records){
 const known=new Set(['缺少姓名或司機編號','證照期限待核對','車牌格式待核對','來源識別編號重複']),counts=new Map();for(const r of records)counts.set(r.key,(counts.get(r.key)||0)+1);
 return records.map(r=>{const problems=(r.problems||[]).filter(p=>!known.has(p));if(kind==='drivers'){if(!r.name||!r.externalDriverId)problems.push('缺少姓名或司機編號');if(!isValidDateKey(r.license))problems.push('證照期限待核對');}else if(!/^[A-Z0-9]{4,12}$/.test(r.plateKey||''))problems.push('車牌格式待核對');if(counts.get(r.key)>1)problems.push('來源識別編號重複');return {...r,problems:[...new Set(problems)]};});
}
function mergeManual(current,parsed){
 if(!fields[parsed.kind])return parsed;const manual=(current?.records||[]).filter(r=>r.managedLocally);if(!manual.length)return parsed;
 let records=parsed.records.slice();for(const r of manual){const matches=records.map((v,i)=>v.key===(r.sourceKey||r.key)||v.key===r.key?i:-1).filter(i=>i>=0);if(matches.length>1)fail('來源編號與平台維護紀錄有重複，請先核對名冊再同步',409);if(matches.length)records[matches[0]]=r;else records.push(r);}
 records=recheck(parsed.kind,records);return {...parsed,records,count:records.length,blocked:records.filter(r=>r.problems.length).length,digest:hash({kind:parsed.kind,records,issues:parsed.issues})};
}
async function saveEntry(db,kind,body,sourceRow,actor){
 if(!fields[kind]||body?.verified!==true)fail('請核對名冊資料後再儲存');
 await db.query('SELECT pg_advisory_xact_lock(870033)');
 const current=(await db.query('SELECT * FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1',[SOURCE_ID,kind])).rows[0];
 if(!Object.hasOwn(body,'expectedBatchId')||String(body.expectedBatchId||'')!==String(current?.id||''))fail('名冊已由其他人更新，請重新載入後再修改',409);
 const records=structuredClone(current?.records||[]);let index=-1,before=null;
 if(sourceRow!==undefined){if(!/^\d{1,8}$/.test(String(sourceRow))||typeof body.recordKey!=='string')fail('名冊紀錄識別無效');index=records.findIndex(r=>String(r.sourceRow)===String(sourceRow)&&r.key===body.recordKey);if(index<0)fail('找不到原名冊紀錄，請重新載入',404);before=records[index];}
 else if(records.length>=5000)fail('名冊已達5000筆上限，請先整理資料');
 const input=validate(kind,body.record);if(records.some((r,i)=>i!==index&&r.key===input.key))fail(kind==='drivers'?'司機ID已存在，請核對後使用變更':'車牌已存在，請核對後使用變更',409);
 if(kind==='drivers'&&before){const profile=(await db.query('SELECT d.id,EXISTS(SELECT 1 FROM line_driver_bindings b WHERE b.driver_id=d.id) AS bound FROM drivers d WHERE d.roster_source_id=$1 AND d.roster_driver_id=$2 FOR UPDATE OF d',[SOURCE_ID,before.externalDriverId])).rows[0];if(profile&&input.externalDriverId!==before.externalDriverId)fail('此司機已有LINE身分或歷程，不能直接更換司機ID',409);if(profile?.bound&&input.name!==before.name)fail('司機已綁定LINE，請先解除綁定並重新核對身分，再變更姓名',409);}
 const row=before?.sourceRow||Math.max(SPECS[kind].end,...records.map(r=>Number(r.sourceRow)||0))+1;
 const record={...before,...input,sourceRow:row,rosterUid:before?require('./rosterSheetSchema').uid(kind,before):crypto.randomUUID(),managedLocally:true,sourceKey:before?.sourceKey||before?.key||input.key,manualRevision:crypto.randomUUID(),maintainedBy:actor.username,maintainedAt:new Date().toISOString(),problems:before?.problems||[]};if(index<0)records.push(record);else records[index]=record;
 const checked=recheck(kind,records),issues=current?.issues||[],digest=hash({kind,records:checked,issues}),spec=SPECS[kind];
 const saved=(await db.query('INSERT INTO source_catalog_batches(source_id,kind,sheet_id,sheet_name,digest,records,issues,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[SOURCE_ID,kind,spec.sheetId,spec.name,digest,JSON.stringify(checked),JSON.stringify(issues),actor.username])).rows[0];
 const after=checked.find(r=>r.sourceRow===row&&r.key===input.key);await audit(db,actor,index<0?'新增名冊紀錄':'變更名冊紀錄',kind==='drivers'?'雲端司機名冊':kind==='parking'?'園區停車場清冊':'雲端車輛名冊',input.key,JSON.stringify({previousBatchId:current?.id||null,batchId:saved.id,before,after}));
 if(kind!=='parking')await require('./fleetOperations').enqueueSheet(db,require('./rosterSheetSchema').specs[kind].key,'current');
 return {batchId:saved.id,record:after,created:index<0};
}
module.exports={validate,recheck,mergeManual,saveEntry};
