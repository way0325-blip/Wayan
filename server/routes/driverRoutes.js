const express=require('express');
const crypto=require('node:crypto');
const {pool:rawPool}=require('../db');
const {requireAuth,requireRole}=require('../auth');
const {transactionalRouter}=require('../transactionalRouter');
const {todayInTaipei,isValidDateKey}=require('../dates');
const router=express.Router();
router.use(requireAuth,requireRole('admin','dispatcher'),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const id=v=>/^\d{1,15}$/.test(String(v||''));
router.get('/board',async(req,res,next)=>{try{
 const date=String(req.query.date||todayInTaipei()),fleetId=String(req.query.fleetId||'');if(!isValidDateKey(date)||fleetId.length>100)return res.status(400).json({error:'日期或車隊條件無效'});
 const trips=(await rawPool.query("SELECT t.id,t.task_code,t.task_name,t.service_date,t.departure_time,t.status,t.fleet_id,t.is_simulated,t.driver_claim_required,t.required_checkins,f.name AS fleet_name,c.id AS claim_id,c.driver_code,c.driver_name,c.accepted_at,c.checked_in_at,j.status AS sheet_status,j.error_code AS sheet_error,(SELECT count(*)::int FROM delivery_active_checkins r WHERE r.trip_id=t.id) AS reported FROM delivery_trips t LEFT JOIN partner_fleets f ON f.id=t.fleet_id LEFT JOIN delivery_route_claims c ON c.trip_id=t.id AND c.revoked_at IS NULL LEFT JOIN fleet_delivery_jobs j ON j.job_key='sheet:routeCheckins:'||c.id::text WHERE t.service_date=$1 AND ($2='' OR t.fleet_id=$2) ORDER BY t.departure_time,t.task_code LIMIT 1000",[date,fleetId])).rows;
 const returns=(await rawPool.query("SELECT r.id,r.trip_id,r.target_trip_id,r.kind,r.status,r.reason,r.driver_code,r.requested_at,r.processed_at,r.reviewed_by,r.review_note,t.task_code,x.task_code AS target_code,j.status AS sheet_status,j.error_code AS sheet_error FROM delivery_trip_returns r JOIN delivery_trips t ON t.id=r.trip_id LEFT JOIN delivery_trips x ON x.id=r.target_trip_id LEFT JOIN fleet_delivery_jobs j ON j.job_key='sheet:tripReturns:'||r.id::text WHERE t.service_date=$1 AND ($2='' OR t.fleet_id=$2) ORDER BY r.id DESC LIMIT 200",[date,fleetId])).rows;
 res.json({date,trips,returns,truncated:trips.length===1000});
 }catch(e){next(e);}});
router.get('/trips/:id/checkins',async(req,res,next)=>{try{if(!id(req.params.id))return res.status(400).json({error:'車趟編號無效'});res.json((await rawPool.query('SELECT r.id,r.created_at,r.voided_at,r.voided_by,r.void_reason,c.driver_code,c.driver_name,c.accepted_at FROM delivery_checkins r LEFT JOIN delivery_route_claims c ON c.id=r.claim_id WHERE r.trip_id=$1 ORDER BY r.id DESC LIMIT 200',[req.params.id])).rows);}catch(e){next(e);}});
const {pool}=transactionalRouter(router,rawPool,870033);
router.post('/trips/:id/return',requireRole('admin'),async(req,res,next)=>{try{
 if(!id(req.params.id)||req.body?.verified!==true||!['退趟','改報'].includes(req.body?.kind))return res.status(400).json({error:'請核對原車趟、選擇退趟／改報並確認身分'});
 const engine=require('../tripReturns'),claims=require('../driverRouteClaims'),t=await engine.trip(pool,req.params.id);if(!t)return res.status(404).json({error:'找不到車趟'});
 const c=await claims.active(pool,t.id),checks=(await pool.query('SELECT * FROM delivery_active_checkins WHERE trip_id=$1 ORDER BY id FOR UPDATE',[t.id])).rows;
 const check=req.body.checkinId?checks.find(r=>String(r.id)===String(req.body.checkinId)):checks.length===1?checks[0]:null;if(checks.length>1&&!check)return res.status(400).json({error:'請先選擇要退回的報到紀錄，不能整批刪除'});
 if(!c&&!check)return res.status(409).json({error:'此車趟沒有有效接取或報到可退回'});
 const verifiedRecord={reporter_hash:c?.reporter_hash||check.reporter_hash,claim_id:c?.id||null,checkin_id:check?.id||null};
 const target=req.body.kind==='改報'&&id(req.body.targetTripId)?await engine.trip(pool,req.body.targetTripId):null;
 if(req.body.kind==='改報'&&(!target||String(target.id)===String(t.id)||target.fleet_id!==t.fleet_id))return res.status(400).json({error:'改報須選同車隊且不同於原車趟的目標路線'});
 let binding;if(target){binding=(await pool.query('SELECT line_user_id FROM line_driver_bindings WHERE driver_id=$1',[c?.driver_id])).rows[0];if(!binding||claims.hash(binding.line_user_id)!==c?.reporter_hash)return res.status(409).json({error:'原司機LINE綁定不完整，請先核對身分，不能代換司機報到'});}
 const r=await engine.request(pool,{trip:t,reason:req.body.reason,target,kind:req.body.kind,eventId:'admin-return:'+crypto.randomUUID(),actor:req.user,admin:true,verifiedRecord});
 if(target)await engine.finishCorrection(pool,target,binding.line_user_id,'admin-correction:'+r.record.id,req.user);
 res.json({id:r.record.id,status:'已處理',notice:t.status==='配送中'?'原車趟仍為配送中，請另外核對現場與調度狀態':'原紀錄已保留，有效報到已更新'});
 }catch(e){if(e.claimStatus)return res.status(e.claimStatus).json({error:e.message});next(e);}});
router.post('/returns/:id/review',requireRole('admin'),async(req,res,next)=>{try{if(!id(req.params.id))return res.status(400).json({error:'申請編號無效'});res.json(await require('../tripReturns').review(pool,req.params.id,req.body,req.user));}catch(e){if(e.claimStatus)return res.status(e.claimStatus).json({error:e.message});next(e);}});
module.exports=router;
