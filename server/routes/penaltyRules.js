const express=require('express');
const {pool:rawPool}=require('../db');
const {requireAuth,requireRole}=require('../auth');
const {transactionalRouter}=require('../transactionalRouter');
const router=express.Router();
const {pool,logAction}=transactionalRouter(router,rawPool,870035);
router.use(requireAuth,requireRole('admin','dispatcher'));
const clean=v=>typeof v==='string'?v.trim():'';
router.get('/',async(req,res,next)=>{try{
  res.json((await pool.query('SELECT * FROM penalty_rules ORDER BY rule_code,version DESC LIMIT 500')).rows);
}catch(e){next(e);}});
router.get('/:id/history',async(req,res,next)=>{try{
  if(!/^\d{1,15}$/.test(req.params.id))return res.status(400).json({error:'規則編號格式錯誤'});
  res.json((await pool.query('SELECT * FROM penalty_rule_history WHERE rule_id=$1 ORDER BY id',[req.params.id])).rows);
}catch(e){next(e);}});
router.post('/',requireRole('admin'),async(req,res,next)=>{try{
  const b=req.body||{},code=clean(b.ruleCode).toUpperCase(),title=clean(b.title),terms=clean(b.terms),source=clean(b.source),date=clean(b.effectiveDate);
  if(!/^[A-Z0-9_-]{1,40}$/.test(code)||!title||title.length>100||!terms||terms.length>4000||!source||source.length>1000||(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)))return res.status(400).json({error:'請填寫有效規則代碼、名稱、條款、來源及日期（未確認可留空）'});
  const amount=b.proposedAmount===null||b.proposedAmount===''||b.proposedAmount===undefined?null:String(b.proposedAmount);
  if(amount!==null&&!/^\d{1,10}(\.\d{1,2})?$/.test(amount))return res.status(400).json({error:'金額須為非負數，最多兩位小數；未定金額請留空'});
  const points=typeof b.points==='boolean'?NaN:Number(b.points??0);
  if(!/^\d{1,5}(\.\d{1,2})?$/.test(String(points))||points<0||points>10000)return res.status(400).json({error:'記點須為 0～10000，最多兩位小數'});
  const version=(await pool.query('SELECT COALESCE(MAX(version),0)+1 AS n FROM penalty_rules WHERE rule_code=$1',[code])).rows[0].n;
  const r=(await pool.query(`INSERT INTO penalty_rules(rule_code,version,title,terms,source,proposed_amount,effective_date,created_by,points) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[code,version,title,terms,source,amount,date||null,req.user.username,points])).rows[0];
  await pool.query("INSERT INTO penalty_rule_history(rule_id,actor,action,note) VALUES($1,$2,'建立草稿','新版本；尚未核實')",[r.id,req.user.username]);
  await logAction(req,'建立版本','罰款規則',r.id,`${code} v${version}`);res.status(201).json(r);
}catch(e){next(e);}});
router.post('/:id/review',requireRole('admin'),async(req,res,next)=>{try{
  const status=req.body?.status,note=clean(req.body?.note);
  if(!/^\d{1,15}$/.test(req.params.id)||!['已核實','已停用'].includes(status)||!note||note.length>1000)return res.status(400).json({error:'請選擇核實或停用，並填寫 1～1000 字覆核依據'});
  const old=(await pool.query('SELECT * FROM penalty_rules WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(!old)return res.status(404).json({error:'規則不存在'});
  if((status==='已核實'&&old.status!=='草稿')||(status==='已停用'&&old.status==='已停用'))return res.status(409).json({error:'此版本不能重複核實或重新啟用，請建立新版本'});
  const r=(await pool.query(`UPDATE penalty_rules SET status=$2,verified_by=CASE WHEN $2='已核實' THEN $3 ELSE verified_by END,verified_at=CASE WHEN $2='已核實' THEN NOW() ELSE verified_at END,verification_note=$4 WHERE id=$1 RETURNING *`,[old.id,status,req.user.username,note])).rows[0];
  await pool.query('INSERT INTO penalty_rule_history(rule_id,actor,action,note) VALUES($1,$2,$3,$4)',[old.id,req.user.username,status,note]);
  await logAction(req,status,'罰款規則',old.id,note);res.json(r);
}catch(e){next(e);}});
module.exports=router;
