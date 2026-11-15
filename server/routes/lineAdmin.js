const express=require('express');
const crypto=require('node:crypto');
const {pool}=require('../db');
const {requireAuth,requireRole}=require('../auth');
const {transaction,audit}=require('../transaction');
const {codeHash,processEvent}=require('../lineWorkflow');
const {isConfigured}=require('../line');
const router=express.Router();
router.use(requireAuth,requireRole('admin'));
router.get('/drivers',async(req,res,next)=>{
 try {
  const {SOURCE_ID}=require('../sourceCatalog');
  const batch=(await pool.query('SELECT records,created_at FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1',[SOURCE_ID,'drivers'])).rows[0];
  const drivers=(await pool.query('SELECT id,name,roster_driver_id FROM drivers WHERE roster_source_id IS NULL OR roster_source_id=$1',[SOURCE_ID])).rows;
  const bindings=(await pool.query('SELECT driver_id FROM line_driver_bindings')).rows;
  const owned=(await pool.query("SELECT records FROM personnel_source_snapshots WHERE kind='own_roster'")).rows[0]?.records||[];const records=require('../lineDriverDirectory').project(batch?.records||[],drivers,bindings,owned);
  res.set('Cache-Control','no-store').json({records,total:records.length,updatedAt:batch?.created_at||null});
 }catch(e){next(e);}
});
router.get('/quota',async(req,res)=>{try{res.set('Cache-Control','no-store').json(await require('../line').getMessageQuota());}catch(e){res.status(e.code==='LINE_NOT_CONFIGURED'?409:502).json({error:e.message});}});
router.get('/status',async(req,res,next)=>{
  try {
    const bindings=(await pool.query('SELECT b.driver_id,d.name,b.bound_at FROM line_driver_bindings b JOIN drivers d ON d.id=b.driver_id ORDER BY b.bound_at DESC')).rows;
    const events=(await pool.query('SELECT event_id,status,delivery_status,attempts,received_at,error_code FROM line_events ORDER BY received_at DESC LIMIT 50')).rows;
    res.set('Cache-Control','no-store').json({configured:isConfigured(),bindings,events});
  } catch(err) {next(err);}
});
router.post('/binding-codes',async(req,res,next)=>{
  const driverId=req.body?.driverId;
  if (typeof driverId!=='string' || driverId.length>100) return res.status(400).json({error:'請選擇司機'});
  try {
    const result=await transaction(pool,async db=>{
      const driver=(await db.query('SELECT id FROM drivers WHERE id=$1 FOR UPDATE',[driverId])).rows[0];
      if (!driver) return {error:'找不到司機',status:404};
      if ((await db.query('SELECT 1 FROM line_driver_bindings WHERE driver_id=$1',[driverId])).rowCount) return {error:'請先解除原有綁定',status:409};
      const code=crypto.randomBytes(16).toString('base64url');
      const row=(await db.query(`INSERT INTO line_binding_codes(code_hash,driver_id,expires_at,created_by) VALUES($1,$2,NOW()+INTERVAL '10 minutes',$3)
        ON CONFLICT(driver_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by RETURNING expires_at`,[codeHash(code),driverId,req.user.username])).rows[0];
      await audit(db,req.user,'產生綁定碼','LINE',driverId,'10 分鐘有效；舊碼立即失效');
      return {code,expiresAt:row.expires_at};
    });
    res.set('Cache-Control','no-store').status(result.status||201).json(result);
  } catch(err) {next(err);}
});
router.post('/owned-binding-codes',async(req,res,next)=>{try{const result=await transaction(pool,async db=>{
 const b=req.body;if(b?.verified!==true||typeof b.driverCode!=='string'||!b.driverCode||b.driverCode.length>100||!Number.isInteger(b.sourceRow))return {status:400,error:'請核對司機ID與來源列'};
 await db.query('SELECT pg_advisory_xact_lock(870033)');const records=(await db.query("SELECT records FROM personnel_source_snapshots WHERE kind='own_roster'")).rows[0]?.records||[],matches=records.filter(r=>r.driverCode===b.driverCode);
 if(matches.length!==1||matches[0].sourceRow!==b.sourceRow||matches[0].problems?.length)return {status:409,error:'自有司機來源不存在、不唯一或待核對'};
 const r=matches[0];if(!require('../dates').isValidDateKey(r.license)||r.license<require('../dates').todayInTaipei()||r.name.length>50||String(r.phone||'').length>30)return {status:409,error:'證照期限、姓名或電話需先核對'};
 const existing=(await db.query('SELECT * FROM drivers WHERE id=$1 OR roster_driver_id=$1 OR name=$2 FOR UPDATE',[r.driverCode,r.name])).rows;
 if(existing.some(d=>d.id!==r.driverCode)||existing.length>1||existing[0]?.name&&existing[0].name!==r.name)return {status:409,error:'現有司機身分需先核對，請沿用原名冊紀錄或由管理員處理，不重複建立'};
 if((await db.query('SELECT 1 FROM line_driver_bindings WHERE driver_id=$1',[r.driverCode])).rowCount)return {status:409,error:'司機已綁定，請先核對原綁定'};
 await db.query("INSERT INTO drivers(id,name,phone,license,status) VALUES($1,$2,$3,$4,'可派車') ON CONFLICT(id) DO UPDATE SET name=$2,phone=$3,license=$4",[r.driverCode,r.name,r.phone||'',r.license]);
 const code=crypto.randomBytes(16).toString('base64url'),row=(await db.query("INSERT INTO line_binding_codes(code_hash,driver_id,expires_at,created_by) VALUES($1,$2,NOW()+INTERVAL '10 minutes',$3) ON CONFLICT(driver_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by RETURNING expires_at",[codeHash(code),r.driverCode,req.user.username])).rows[0];await audit(db,req.user,'核對自有司機並產生綁定碼','LINE',r.driverCode,'來源列'+r.sourceRow+'；未自動綁定LINE身分');return {code,expiresAt:row.expires_at};
 });res.set('Cache-Control','no-store').status(result.status||201).json(result);}catch(e){next(e);}});
router.post('/roster-binding-codes',async(req,res,next)=>{try{const result=await transaction(pool,db=>require('../driverRouteClaims').createRosterCode(db,req.body,req.user));res.set('Cache-Control','no-store').status(201).json(result);}catch(e){if(e.claimStatus)return res.status(e.claimStatus).json({error:e.message});next(e);}});
router.delete('/bindings/:driverId',async(req,res,next)=>{
  try {
    await transaction(pool,async db=>{
      await db.query('DELETE FROM line_driver_bindings WHERE driver_id=$1',[req.params.driverId]);
      await db.query('DELETE FROM line_binding_codes WHERE driver_id=$1',[req.params.driverId]);
      await audit(db,req.user,'解除綁定','LINE',req.params.driverId,'');
    });
    res.status(204).end();
  } catch(err) {next(err);}
});
router.post('/events/:id/retry',async(req,res,next)=>{
  try {
    const row=(await pool.query('SELECT status FROM line_events WHERE event_id=$1',[req.params.id])).rows[0];
    if (!row) return res.status(404).json({error:'找不到事件'});
    if (row.status!=='failed') return res.status(409).json({error:'僅可重試處理失敗事件；已完成異動不會重做。回覆失敗請司機重新發送查詢。'});
    await audit(pool,req.user,'重試事件','LINE',req.params.id,'');
    const ok=await processEvent(req.params.id);
    res.status(ok?200:503).json({ok});
  } catch(err) {next(err);}
});
module.exports=router;
