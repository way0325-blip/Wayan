const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { todayInTaipei } = require('../dates');
const { transaction, audit } = require('../transaction');
const { subscribe } = require('../realtime');
const router = express.Router();
router.use(require('express-rate-limit').rateLimit({windowMs:15*60*1000,limit:1800,standardHeaders:true,legacyHeaders:false}));
router.use(requireAuth, requireRole('admin','dispatcher'));
router.get('/summary', async (req,res,next) => {
  const date = req.query.date || todayInTaipei();
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) return res.status(400).json({error:'日期格式錯誤'});
  try {
    // One SQL statement gives a consistent PostgreSQL snapshot across all cards.
    const result = (await pool.query(`SELECT
      (SELECT json_build_object('total',count(*),'pending',count(*) FILTER(WHERE status='待派車'),
        'active',count(*) FILTER(WHERE status IN ('已派車','執行中')),'done',count(*) FILTER(WHERE status='已完成'))
        FROM orders WHERE time LIKE $1 || '%') AS port,
      (SELECT json_build_object('required',coalesce(sum(r.required_trucks),0),'confirmed',coalesce(sum(a.confirmed),0),
        'pending',coalesce(sum(a.pending),0),'shortage',coalesce(sum(greatest(r.required_trucks-coalesce(a.confirmed,0),0)),0))
        FROM shopee_routes r LEFT JOIN (SELECT route_id,
          sum(confirmed_trucks) FILTER(WHERE status='已確認') AS confirmed,
          sum(requested_trucks) FILTER(WHERE status='待回覆') AS pending
          FROM shopee_assignments GROUP BY route_id) a ON a.route_id=r.id WHERE r.service_date=$1) AS shopee,
      (SELECT json_build_object('total',count(*),'available',count(*) FILTER(WHERE status='可派車' AND license >= $1
        AND NOT EXISTS(SELECT 1 FROM attendance_records ar WHERE ar.staff_type='driver' AND ar.staff_id=drivers.id AND ar.date=$1 AND ar.status IN ('休假','曠職')))) FROM drivers) AS drivers,
      (SELECT json_build_object('total',count(*),'available',count(*) FILTER(WHERE status='可用' AND maintenance >= $1 AND (inspection_date IS NULL OR inspection_date='' OR inspection_date >= $1))) FROM vehicles) AS vehicles,
      (SELECT count(*)::int FROM operational_incidents WHERE status='待處理') AS open_incidents,
      (SELECT count(DISTINCT order_id)::int FROM operational_incidents WHERE status='待處理' AND order_id IS NOT NULL) AS abnormal_trips,
      (SELECT count(*)::int FROM line_events WHERE status='failed' OR delivery_status='failed') AS failed_events,
      (SELECT count(*)::int FROM penalty_cases WHERE status IN ('待覆核','申訴中')) AS "pendingViolations"`, [date])).rows[0];
    res.set('Cache-Control','no-store').json({...result,date,updatedAt:new Date().toISOString()});
  } catch(err) {next(err);}
});
router.get('/incidents', async(req,res,next)=>{
  try {res.set('Cache-Control','no-store').json((await pool.query('SELECT * FROM operational_incidents ORDER BY created_at DESC LIMIT 100')).rows);}
  catch(err) {next(err);}
});
router.patch('/incidents/:id/resolve', requireRole('admin'), async(req,res,next)=>{
  const resolution=req.body?.resolution;
  if (typeof resolution!=='string' || !resolution.trim() || resolution.length>500 || !/^\d+$/.test(req.params.id)) return res.status(400).json({error:'請填寫 1～500 字處理說明'});
  try {
    const row=await transaction(pool,async db=>{
      const result=(await db.query("UPDATE operational_incidents SET status='已處理',resolution=$1,resolved_at=NOW() WHERE id=$2 AND status='待處理' RETURNING *",[resolution.trim(),req.params.id])).rows[0];
      if (result) await audit(db,req.user,'結案','異常回報',result.id,resolution.trim());
      return result;
    });
    if (!row) return res.status(409).json({error:'案件不存在或已處理'});
    res.json(row);
  } catch(err) {next(err);}
});
const connections = new Map();
router.get('/events', (req,res)=>{
  const count=connections.get(req.user.sub)||0;
  if (count>=3) return res.status(429).json({error:'即時連線過多，請關閉其他分頁'});
  connections.set(req.user.sub,count+1);
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders();
  let closed=false;
  const send=type=>{
    if (!closed && !res.write(`event: ${type}\ndata: {}\n\n`)) res.end();
  };
  const unsubscribe=subscribe(send);
  let checking=false;
  const heartbeat=setInterval(async()=>{
    if (checking || closed) return;
    checking=true;
    try {
      jwt.verify(req.headers.authorization.slice(7),process.env.JWT_SECRET);
      const user=(await pool.query('SELECT active,role FROM users WHERE id=$1',[req.user.sub])).rows[0];
      if (!user?.active || !['admin','dispatcher'].includes(user.role)) {send('expired');res.end();}
      else send('heartbeat');
    } catch {send('expired');res.end();}
    finally {checking=false;}
  },20000);
  const cleanup=()=>{
    if (closed) return;
    closed=true;clearInterval(heartbeat);unsubscribe();
    const remaining=(connections.get(req.user.sub)||1)-1;
    if (remaining) connections.set(req.user.sub,remaining); else connections.delete(req.user.sub);
  };
  req.on('close',cleanup);res.on('close',cleanup);
});
module.exports=router;
