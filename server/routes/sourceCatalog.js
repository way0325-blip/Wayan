const express=require('express'),crypto=require('node:crypto');
const {pool:rawPool}=require('../db'),{requireAuth,requireRole}=require('../auth');
const {transactionalRouter}=require('../transactionalRouter'),{isValidDateKey}=require('../dates');
const {SOURCE_ID,SPECS,parse,readSource,hash}=require('../sourceCatalog');
const router=express.Router();
router.use(requireAuth,requireRole('admin','dispatcher'),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const latest=async(db,kind)=>(await db.query('SELECT * FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1',[SOURCE_ID,kind])).rows[0];
function changes(previous,next){const before=new Map((previous?.records||[]).map(r=>[r.key,hash(r)])),after=new Map(next.records.map(r=>[r.key,hash(r)]));return {added:[...after.keys()].filter(k=>!before.has(k)).length,changed:[...after.keys()].filter(k=>before.has(k)&&before.get(k)!==after.get(k)).length,absent:[...before.keys()].filter(k=>!after.has(k)).length};}
router.get('/config',(req,res)=>res.json({sourceId:SOURCE_ID,specs:SPECS,serviceAccount:process.env.WAYAN_GOOGLE_CLIENT_EMAIL||'',notice:'來源名冊與自有派車資源分開，缺漏資料不自動補值。'}));
router.get('/:kind',async(req,res,next)=>{try{
 if(!SPECS[req.params.kind])return res.status(400).json({error:'來源種類無效'});
 const batch=await latest(rawPool,req.params.kind);if(!batch)return res.json({batchId:null,total:0,records:[],issues:[]});
 const q=String(req.query.q||'').trim().slice(0,100),page=Number(req.query.page||1);
 if(!Number.isInteger(page)||page<1||page>10000)return res.status(400).json({error:'頁碼無效'});
 const records=batch.records.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
 res.json({batchId:batch.id,total:records.length,page,records:records.slice((page-1)*50,page*50),issues:batch.issues,updatedAt:batch.created_at,blocked:batch.records.filter(r=>r.problems.length).length});
 }catch(e){next(e);}});
// Network reads finish before opening a database transaction.
router.post('/:kind/pull',requireRole('admin'),async(req,res)=>{try{const rows=await readSource(req.params.kind),preview=parse(req.params.kind,rows),current=await latest(rawPool,req.params.kind);res.json({rows,preview,changes:changes(current,preview),expectedBatchId:current?.id||null});}catch(e){res.status(422).json({error:e.message});}});
router.post('/:kind/preview',requireRole('admin'),async(req,res)=>{try{const preview=parse(req.params.kind,req.body?.rows),current=await latest(rawPool,req.params.kind);res.json({preview,changes:changes(current,preview),expectedBatchId:current?.id||null});}catch(e){res.status(400).json({error:e.message});}});
const {pool,logAction}=transactionalRouter(router,rawPool,870045);
router.post('/:kind/import',requireRole('admin'),async(req,res,next)=>{try{
 let p;try{p=parse(req.params.kind,req.body?.rows);}catch(e){return res.status(400).json({error:e.message});}
 if(req.body.digest!==p.digest)return res.status(409).json({error:'預覽已變更，請重新預覽'});
 if(!p.records.length)return res.status(400).json({error:'來源沒有可匯入資料；不清空既有名冊'});
 const current=await latest(pool,p.kind);
 if(current?.digest===p.digest)return res.json({batchId:current.id,duplicate:true,count:p.count});
 if(String(req.body.expectedBatchId||'')!==String(current?.id||''))return res.status(409).json({error:'其他人已更新名冊，請重新預覽'});
 const prior=(await pool.query('SELECT id FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 AND digest=$3',[SOURCE_ID,p.kind,p.digest])).rows[0];
 if(prior)return res.status(409).json({error:'這是較舊版本的重送，不會覆蓋最新名冊'});
 const result=await pool.query('INSERT INTO source_catalog_batches(source_id,kind,sheet_id,sheet_name,digest,records,issues,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[SOURCE_ID,p.kind,p.sheetId,p.sheetName,p.digest,JSON.stringify(p.records),JSON.stringify(p.issues),req.user.username]);
 await logAction(req,'更新來源名冊','來源資料',result.rows[0].id,`${p.kind} ${p.count}筆，待核對${p.blocked}筆；未修改自有派車資源`);
 res.status(201).json({batchId:result.rows[0].id,count:p.count,blocked:p.blocked});
 }catch(e){next(e);}});
router.post('/:kind/build-trip',requireRole('admin'),async(req,res,next)=>{try{
 const b=req.body||{};if(!['NB','FN','WB'].includes(req.params.kind)||!isValidDateKey(b.serviceDate)||b.verified!==true||typeof b.routeCode!=='string'||typeof b.pickupPointId!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.departureTime||'')||!Number.isInteger(b.quantity)||b.quantity<1||b.quantity>100000)return res.status(400).json({error:'請核對門店、選有效日期、出發時間及每站件數（無件數時不可猜測）'});
 await pool.query('SELECT pg_advisory_xact_lock(870033)');
 const batch=await latest(pool,req.params.kind);if(!batch||String(batch.id)!==String(b.batchId))return res.status(409).json({error:'路線版本已變更，請重新載入'});
 const route=batch.records.find(r=>r.routeCode===b.routeCode);if(!route||route.problems.length)return res.status(409).json({error:'路線不存在或尚有待核對問題，整條路線不拆除停靠站'});
 if(route.routeCode.length>31)return res.status(400).json({error:'路線編號過長，加入日期後超出LINE報到代碼限制，請先調整來源編號'});
 const old=(await pool.query('SELECT trip_id FROM source_catalog_trip_links WHERE source_id=$1 AND kind=$2 AND route_code=$3 AND service_date=$4',[SOURCE_ID,req.params.kind,route.routeCode,b.serviceDate])).rows[0];
 if(old){const trip=(await pool.query('SELECT * FROM delivery_trips WHERE id=$1',[old.trip_id])).rows[0],quantities=(await pool.query('SELECT DISTINCT o.quantity FROM delivery_orders o JOIN delivery_trip_stops s ON s.order_id=o.id WHERE s.trip_id=$1',[old.trip_id])).rows;if(trip.status==='已取消'||trip.pickup_point_id!==b.pickupPointId||trip.departure_time!==b.departureTime||quantities.some(q=>q.quantity!==b.quantity))return res.status(409).json({error:'此日此路線已有不同安排或取消紀錄，請先查看既有車趟，不能重複建立'});return res.json({tripId:old.trip_id,taskCode:trip.task_code,duplicate:true});}
 const pickup=(await pool.query('SELECT p.*,w.address AS warehouse_address FROM delivery_pickup_points p JOIN delivery_warehouses w ON w.id=p.warehouse_id WHERE p.id=$1',[b.pickupPointId])).rows[0];
 if(!pickup||pickup.box_type!==route.boxType)return res.status(400).json({error:'取貨點箱型不符：N／F大園橘箱，W楊梅黑箱'});
 const key=hash([SOURCE_ID,req.params.kind,route.routeCode,b.serviceDate]),taskCode=b.serviceDate.replace(/-/g,'')+'-'+route.routeCode;
 const trip=(await pool.query(`INSERT INTO delivery_trips(request_id,request_hash,warehouse_id,service_date,departure_time,note,created_by,warehouse_address,task_code,task_name,required_checkins,pickup_point_id,pickup_point_name,box_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) RETURNING *`,[crypto.randomUUID(),key,pickup.warehouse_id,b.serviceDate,b.departureTime,'來源路線範本；來源司機僅供參考，未自動指派',req.user.username,pickup.warehouse_address,taskCode,route.routeCode+' '+route.serviceType,pickup.id,pickup.name,pickup.box_type])).rows[0];
 for(const stop of route.stops){
  const storeCode='SRC-'+hash([stop.name,stop.address]).slice(0,24).toUpperCase();
  let store=(await pool.query('SELECT * FROM delivery_stores WHERE code=$1',[storeCode])).rows[0];
  if(store&&(!store.active||!store.verified||store.name!==stop.name||store.address!==stop.address))return res.status(409).json({error:'門店已停用、尚未核對或資料衝突，請先人工核對'});
  if(!store)store=(await pool.query('INSERT INTO delivery_stores(code,name,city,district,address,source,verified) VALUES($1,$2,$3,$4,$5,$6,TRUE) RETURNING *',[storeCode,stop.name,stop.city,stop.district,stop.address,`https://docs.google.com/spreadsheets/d/${SOURCE_ID}/edit#gid=${batch.sheet_id}`])).rows[0];
  const order=(await pool.query("INSERT INTO delivery_orders(reference,warehouse_id,store_id,service_date,quantity,note,status,created_by,pickup_point_id,route_code) VALUES($1,$2,$3,$4,$5,$6,'已安排',$7,$8,$9) RETURNING id",['SRC-'+key.slice(0,24)+'-'+stop.sequence,pickup.warehouse_id,store.id,b.serviceDate,b.quantity,stop.note,req.user.username,pickup.id,route.routeCode])).rows[0];
  await pool.query('INSERT INTO delivery_trip_stops(trip_id,order_id,stop_no,store_code,store_name,city,district,address,route_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[trip.id,order.id,stop.sequence,store.code,stop.name,stop.city,stop.district,stop.address,route.routeCode]);
 }
 await pool.query('INSERT INTO source_catalog_trip_links(source_id,kind,route_code,service_date,batch_id,trip_id) VALUES($1,$2,$3,$4,$5,$6)',[SOURCE_ID,req.params.kind,route.routeCode,b.serviceDate,batch.id,trip.id]);
 await logAction(req,'來源路線建立車趟','蝦皮門店車趟',trip.id,`${route.routeCode} ${route.stops.length}站；來源批次${batch.id}，尚未派車及發送LINE`);
 res.status(201).json({tripId:trip.id,taskCode:trip.task_code,stops:route.stops.length});
 }catch(e){next(e);}});
module.exports=router;
