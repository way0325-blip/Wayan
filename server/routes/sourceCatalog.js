const express=require('express');
const {pool:rawPool}=require('../db'),{requireAuth,requireRole}=require('../auth');
const {transactionalRouter}=require('../transactionalRouter');
const {SOURCE_ID,SPECS,parse,readSource,hash}=require('../sourceCatalog');
const grouping=require('../../public/routeCatalogGroups');
const warehouses=require('../../public/warehouseGroups');
const {mergeManual,saveEntry}=require('../rosterMaintenance');
const router=express.Router();
router.use(requireAuth,requireRole('admin','dispatcher'),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const latest=async(db,kind)=>require('../sourceCatalog').projectRegions((await db.query('SELECT * FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1',[SOURCE_ID,kind])).rows[0]);
function changes(previous,next){const before=new Map((previous?.records||[]).map(r=>[r.key,hash(r)])),after=new Map(next.records.map(r=>[r.key,hash(r)]));return {added:[...after.keys()].filter(k=>!before.has(k)).length,changed:[...after.keys()].filter(k=>before.has(k)&&before.get(k)!==after.get(k)).length,absent:[...before.keys()].filter(k=>!after.has(k)).length};}
router.get('/config',(req,res)=>res.json({sourceId:SOURCE_ID,specs:SPECS,serviceAccount:process.env.WAYAN_GOOGLE_CLIENT_EMAIL||'',notice:'來源名冊與自有派車資源分開，缺漏資料不自動補值。'}));
router.get('/:kind/options',async(req,res,next)=>{try{
 if(!['NB','FN','WB'].includes(req.params.kind))return res.status(400).json({error:'請選擇N、F或W路線清單'});
 const batch=await require('../routeCarriers').attach(rawPool,await latest(rawPool,req.params.kind));
 const q=String(req.query.q||'').trim().slice(0,100),window=String(req.query.window||''),area=String(req.query.area||'').slice(0,60),vehicleType=String(req.query.vehicleType||'').slice(0,60);
 const carrier=String(req.query.carrier||'').slice(0,100);
 const routes=(batch?.records||[]).filter(r=>{const visible={...r};delete visible.sourceDriverId;return (!carrier||r.sourceFleetName===carrier||(carrier==='__pending__'&&!r.sourceFleetName))&&(!q||JSON.stringify(visible).toLowerCase().includes(q.toLowerCase()))&&grouping.matches(r,window)&&(!area||grouping.areas(r).districts.includes(area))&&(!vehicleType||r.vehicleType===vehicleType);}).map(r=>({routeCode:r.routeCode,sourceFleetName:r.sourceFleetName,carrierMatch:r.carrierMatch,vehicleType:r.vehicleType,boxType:r.boxType,timeWindow:r.timeWindow,window:grouping.timeWindow(r.timeWindow),areas:grouping.areas(r),stopCount:r.stops.length,firstStop:r.stops[0]?.name||'',lastStop:r.stops.at(-1)?.name||'',blocked:r.problems.length>0})).sort((a,b)=>a.routeCode.localeCompare(b.routeCode,'en',{numeric:true}));
 res.json({batchId:batch?.id||null,carrierMappingId:batch?.carrierMappingId||null,routes,timeGroups:grouping.groups(batch?.records||[])});
 }catch(e){next(e);}});
router.get('/:kind',async(req,res,next)=>{try{
 if(!SPECS[req.params.kind])return res.status(400).json({error:'來源種類無效'});
 const window=String(req.query.window||'');if(window&&(!['NB','FN','WB'].includes(req.params.kind)||window.length>30||window!=='pending'&&grouping.timeWindow(window).key!==window))return res.status(400).json({error:'出車時段篩選無效'});
 const warehouse=String(req.query.warehouse||'');if(warehouse&&(req.params.kind!=='drivers'||!['N-SOC','C-SOC','S-SOC','other'].includes(warehouse)))return res.status(400).json({error:'司機倉別篩選無效'});
 const batch=await require('../routeCarriers').attach(rawPool,await latest(rawPool,req.params.kind));if(!batch)return res.json({batchId:null,total:0,records:[],issues:[],sheetSync:['drivers','vehicles'].includes(req.params.kind)?await require('../rosterSheets').status(req.params.kind):undefined});
 const q=String(req.query.q||'').trim().slice(0,100),page=Number(req.query.page||1);
 if(!Number.isInteger(page)||page<1||page>10000)return res.status(400).json({error:'頁碼無效'});
 const rosterProfiles=req.params.kind==='drivers'?(await rawPool.query('SELECT d.id,d.roster_driver_id,EXISTS(SELECT 1 FROM line_driver_bindings b WHERE b.driver_id=d.id) AS bound FROM drivers d WHERE d.roster_source_id=$1',[SOURCE_ID])).rows:[];
 const visible=batch.records.map(r=>{const copy={...r};if(req.params.kind==='drivers'){const reminder=require('../../public/licenseReminders').classify(r.license);copy.licenseReminder=r.license?reminder.status:r.licenseProvided===true?'待核對':r.licenseProvided===false?'未提供':'未提供／待核對';copy.licenseRemindOn=reminder.remindOn;copy.licenseDays=reminder.days;const profile=rosterProfiles.find(p=>p.roster_driver_id===r.externalDriverId);copy.rosterBinding=profile?{runtimeId:profile.id,bound:profile.bound}:{runtimeId:null,bound:false};}if(['NB','FN','WB'].includes(req.params.kind))delete copy.sourceDriverId;return copy;});
 const area=String(req.query.area||'').slice(0,60),vehicleType=String(req.query.vehicleType||'').slice(0,60);
 const carrier=String(req.query.carrier||'').slice(0,100);
 const records=visible.filter(r=>(!carrier||r.sourceFleetName===carrier||(carrier==='__pending__'&&!r.sourceFleetName))&&(!q||JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))&&(!area||grouping.areas(r).districts.includes(area))&&(!vehicleType||r.vehicleType===vehicleType)&&grouping.matches(r,window)&&warehouses.matches(r,warehouse));
 res.json({sheetSync:['drivers','vehicles'].includes(req.params.kind)?await require('../rosterSheets').status(req.params.kind):undefined,batchId:batch.id,carrierMappingId:batch.carrierMappingId||null,total:records.length,catalogTotal:batch.records.length,warehouseGroups:req.params.kind==='drivers'?warehouses.groups(batch.records):undefined,page,records:records.slice((page-1)*50,page*50),issues:batch.issues,updatedAt:batch.created_at,blocked:batch.records.filter(r=>r.problems.length).length});
 }catch(e){next(e);}});
// Network reads finish before opening a database transaction.
router.post('/daily/link',requireRole('admin'),async(req,res)=>{try{const rows=await require('../dailyTaskSheet').read(req.body?.url);res.json({rows,...await require('../dailyTasks').preview(rawPool,rows)});}catch(e){res.status(422).json({error:e.status?e.message:'無法讀取連結，請確認網址、分頁欄位與服務帳戶檢視者授權'});}});
router.post('/daily/preview',requireRole('admin'),async(req,res,next)=>{try{res.json(await require('../dailyTasks').preview(rawPool,req.body?.rows));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
router.post('/:kind/pull',requireRole('admin'),async(req,res)=>{try{const rows=await readSource(req.params.kind),current=await latest(rawPool,req.params.kind),preview=mergeManual(current,parse(req.params.kind,rows));res.json({rows,preview,changes:changes(current,preview),expectedBatchId:current?.id||null});}catch(e){res.status(422).json({error:e.message});}});
router.post('/:kind/preview',requireRole('admin'),async(req,res)=>{try{const current=await latest(rawPool,req.params.kind),preview=mergeManual(current,parse(req.params.kind,req.body?.rows));res.json({preview,changes:changes(current,preview),expectedBatchId:current?.id||null});}catch(e){res.status(400).json({error:e.message});}});
router.get('/:kind/sheet-requests',requireRole('admin'),async(req,res,next)=>{try{if(!['drivers','vehicles'].includes(req.params.kind))return res.status(400).json({error:'名冊種類無效'});const batch=await latest(rawPool,req.params.kind),schema=require('../rosterSheetSchema');const rows=(await rawPool.query("SELECT id,kind,record_uid,submission,sheet_row,patch,status,message,created_at FROM roster_sheet_requests WHERE kind=$1 AND status IN ('conflict','rejected') AND resolved_by IS NULL ORDER BY created_at DESC LIMIT 50",[req.params.kind])).rows;res.json(rows.map(r=>{const current=batch?.records.find(v=>schema.uid(req.params.kind,v)===r.record_uid);return {...r,current:current?schema.values(req.params.kind,current):null,expectedBatchId:batch?.id||null};}));}catch(e){next(e);}});
const {pool,logAction}=transactionalRouter(router,rawPool,870045);
router.post('/:kind/sheet-sync',requireRole('admin'),async(req,res,next)=>{try{if(!['drivers','vehicles'].includes(req.params.kind))return res.status(400).json({error:'名冊種類無效'});await require('../fleetOperations').enqueueSheet(pool,require('../rosterSheetSchema').specs[req.params.kind].key,'current');await logAction(req,'重試名冊同步','Google Sheets',req.params.kind,'排入同步，成功後更新狀態');res.json({queued:true});}catch(e){next(e);}});
router.post('/:kind/sheet-requests/:id/resolve',requireRole('admin'),async(req,res,next)=>{try{if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.status(400).json({error:'紀錄編號無效'});const row=(await pool.query('SELECT kind FROM roster_sheet_requests WHERE id=$1',[req.params.id])).rows[0];if(!row||row.kind!==req.params.kind)return res.status(404).json({error:'找不到變更紀錄'});res.json(await require('../rosterSheets').resolve(pool,req.params.id,req.body,req.user));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
router.post('/:kind/entries',requireRole('admin'),async(req,res,next)=>{try{res.status(201).json(await saveEntry(pool,req.params.kind,req.body,undefined,req.user));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
router.put('/:kind/entries/:sourceRow',requireRole('admin'),async(req,res,next)=>{try{res.json(await saveEntry(pool,req.params.kind,req.body,req.params.sourceRow,req.user));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
router.post('/daily/commit',requireRole('admin'),async(req,res,next)=>{try{if(req.body?.verified!==true)return res.status(400).json({error:'請先核對本次全部任務'});const p=await require('../dailyTasks').preview(pool,req.body?.rows);if(req.body.digest!==p.digest)return res.status(409).json({error:'來源或匯入資料已變更，請重新預覽'});const results=[];for(const item of p.items)results.push(await require('../sourceTripBuilder').buildTrip(pool,item.kind,item,req.user,(...args)=>logAction(req,...args)));await logAction(req,'每日任務匯入','蝦皮門店車趟','batch',JSON.stringify({digest:p.digest,count:results.length}));res.json({results,created:results.filter(r=>!r.duplicate).length,duplicate:results.filter(r=>r.duplicate).length});}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
router.post('/:kind/import',requireRole('admin'),async(req,res,next)=>{try{
 let p;try{p=mergeManual(await latest(pool,req.params.kind),parse(req.params.kind,req.body?.rows));}catch(e){return res.status(400).json({error:e.message});}
 if(req.body.digest!==p.digest)return res.status(409).json({error:'預覽已變更，請重新預覽'});
 if(!p.records.length)return res.status(400).json({error:'來源沒有可匯入資料；不清空既有名冊'});
 const current=await latest(pool,p.kind);
 if(current?.digest===p.digest)return res.json({batchId:current.id,duplicate:true,count:p.count});
 if(String(req.body.expectedBatchId||'')!==String(current?.id||''))return res.status(409).json({error:'其他人已更新名冊，請重新預覽'});
 const prior=(await pool.query('SELECT id FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 AND digest=$3',[SOURCE_ID,p.kind,p.digest])).rows[0];
 if(prior)return res.status(409).json({error:'這是較舊版本的重送，不會覆蓋最新名冊'});
 const result=await pool.query('INSERT INTO source_catalog_batches(source_id,kind,sheet_id,sheet_name,digest,records,issues,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[SOURCE_ID,p.kind,p.sheetId,p.sheetName,p.digest,JSON.stringify(p.records),JSON.stringify(p.issues),req.user.username]);
 if(['drivers','vehicles'].includes(p.kind))await require('../fleetOperations').enqueueSheet(pool,require('../rosterSheetSchema').specs[p.kind].key,'current');
 await logAction(req,'更新來源名冊','來源資料',result.rows[0].id,`${p.kind} ${p.count}筆，待核對${p.blocked}筆；未修改自有派車資源`);
 res.status(201).json({batchId:result.rows[0].id,count:p.count,blocked:p.blocked});
 }catch(e){next(e);}});
router.post('/:kind/build-trip',requireRole('admin'),async(req,res,next)=>{try{const result=await require('../sourceTripBuilder').buildTrip(pool,req.params.kind,req.body||{},req.user,(...args)=>logAction(req,...args));res.status(result.duplicate?200:201).json(result);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
module.exports=router;
