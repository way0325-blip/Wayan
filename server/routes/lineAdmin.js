const express=require('express');
const crypto=require('node:crypto');
const {pool}=require('../db');
const {requireAuth,requireRole}=require('../auth');
const {transaction,audit}=require('../transaction');
const {codeHash,processEvent}=require('../lineWorkflow');
const {isConfigured}=require('../line');
const router=express.Router();
router.use(requireAuth,requireRole('admin'));
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
