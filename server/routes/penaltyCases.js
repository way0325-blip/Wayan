const express=require('express'),{pool:rawPool}=require('../db'),{requireAuth,requireRole}=require('../auth'),{transactionalRouter}=require('../transactionalRouter'),{isValidDateKey,todayInTaipei}=require('../dates');
const router=express.Router(),{pool,logAction}=transactionalRouter(router,rawPool,870035);
router.use(requireAuth,requireRole('admin','dispatcher'));
const clean=(v,max)=>typeof v==='string'&&v.trim().length<=max?v.trim():'';
const id=v=>/^\d{1,15}$/.test(String(v||''));
async function history(req,c,action,note){await pool.query('INSERT INTO penalty_case_history(case_id,actor,action,note) VALUES($1,$2,$3,$4)',[c.id,req.user.username,action,note]);await logAction(req,action,'罰款案件',c.id,note);}
router.get('/',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json((await pool.query('SELECT c.*,f.name AS fleet_name,r.title AS rule_title FROM penalty_cases c JOIN partner_fleets f ON f.id=c.fleet_id JOIN penalty_rules r ON r.id=c.rule_id ORDER BY c.id DESC LIMIT 200')).rows);}catch(e){next(e);}});
router.get('/:id/history',async(req,res,next)=>{try{if(!id(req.params.id))return res.status(400).json({error:'案件編號錯誤'});res.json((await pool.query('SELECT * FROM penalty_case_history WHERE case_id=$1 ORDER BY id',[req.params.id])).rows);}catch(e){next(e);}});
router.post('/',async(req,res,next)=>{try{
  const b=req.body||{},responsibility=clean(b.responsibility,2000);
  if(!id(b.ruleId)||!isValidDateKey(b.occurredOn)||b.occurredOn>todayInTaipei()||!responsibility)return res.status(400).json({error:'需填寫規則、非未來發生日及責任事實（1～2000字）'});
  const rule=(await pool.query("SELECT * FROM penalty_rules WHERE id=$1 AND status='已核實'",[b.ruleId])).rows[0];
  if(!rule?.effective_date||rule.effective_date>b.occurredOn)return res.status(409).json({error:'須使用已核實且生效日不晚於發生日的規則版本'});
  if(!(await pool.query('SELECT 1 FROM partner_fleets WHERE id=$1',[b.fleetId])).rowCount)return res.status(400).json({error:'車隊不存在'});
  const incidentId=b.incidentId?String(b.incidentId):null;
  if(incidentId){if(!id(incidentId))return res.status(400).json({error:'異常案件編號無效'});const i=(await pool.query('SELECT * FROM fleet_incidents WHERE id=$1',[incidentId])).rows[0];if(!i||i.fleet_id!==b.fleetId)return res.status(409).json({error:'異常案件與車隊不符'});if((await pool.query('SELECT 1 FROM penalty_cases WHERE incident_id=$1 AND rule_id=$2',[incidentId,b.ruleId])).rowCount)return res.status(409).json({error:'此異常已建立相同規則案件'});}
  const c=(await pool.query('INSERT INTO penalty_cases(fleet_id,rule_id,occurred_on,responsibility,created_by,incident_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[b.fleetId,b.ruleId,b.occurredOn,responsibility,req.user.username,incidentId])).rows[0];await history(req,c,'建立待覆核案件',responsibility);res.status(201).json(c);
}catch(e){next(e);}});
router.post('/:id/review',requireRole('admin'),async(req,res,next)=>{try{
  const b=req.body||{},note=clean(b.note,2000);if(!id(req.params.id)||!note||!['已確認','已撤銷'].includes(b.status))return res.status(400).json({error:'需選擇確認或撤銷並填寫覆核結論'});
  const c=(await pool.query('SELECT * FROM penalty_cases WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!c)return res.status(404).json({error:'案件不存在'});
  if(!['待覆核','申訴中'].includes(c.status))return res.status(409).json({error:'請先提出申訴再裁決，禁止覆寫已決案件'});
  const amount=b.status==='已撤銷'?'0':String(b.amount??''),points=b.status==='已撤銷'?'0':String(b.points??'');
  if(!/^\d{1,10}(\.\d{1,2})?$/.test(amount)||!/^\d{1,5}(\.\d{1,2})?$/.test(points)||Number(points)>10000)return res.status(400).json({error:'須明確填寫人工確認金額與點數（可為0，最多兩位小數）'});
  const rule=(await pool.query('SELECT * FROM penalty_rules WHERE id=$1',[c.rule_id])).rows[0];if(b.status==='已確認'&&(rule.status!=='已核實'||!rule.effective_date||rule.effective_date>c.occurred_on))return res.status(409).json({error:'規則未核實或已停用，不能確認罰款'});
  const r=(await pool.query('UPDATE penalty_cases SET status=$2,points=$3,amount=$4,reviewer=$5,decision=$6,updated_at=NOW() WHERE id=$1 RETURNING *',[c.id,b.status,points,amount,req.user.username,note])).rows[0];await history(req,r,b.status,note);res.json(r);
}catch(e){next(e);}});
router.post('/:id/appeal',async(req,res,next)=>{try{
  const note=clean(req.body?.note,2000);if(!id(req.params.id)||!note)return res.status(400).json({error:'請填寫申訴原因（1～2000字）'});
  const c=(await pool.query("UPDATE penalty_cases SET status='申訴中',appeal=$2,updated_at=NOW() WHERE id=$1 AND status='已確認' RETURNING *",[req.params.id,note])).rows[0];if(!c)return res.status(409).json({error:'只有已確認案件可提出申訴'});
  await history(req,c,'提出申訴',note);res.json(c);
}catch(e){next(e);}});
module.exports=router;
