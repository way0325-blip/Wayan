const express=require('express');const {pool:rawPool}=require('../db');const {requireAuth,requireRole}=require('../auth');const {todayInTaipei}=require('../dates');
const {transactionalRouter}=require('../transactionalRouter');const {assignment,reportTotal,queueShopeeNotification,number}=require('../shopeeCheckins');
const router=express.Router(),{pool}=transactionalRouter(router,rawPool,870033);
router.use(requireAuth,requireRole('admin','dispatcher'));
const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
router.get('/',async(req,res,next)=>{try{
  const day=req.query.date||todayInTaipei();if(!validDay(day))return res.status(400).json({error:'日期無效'});
  // One SQL statement provides a coherent snapshot of all assignments and fleet totals.
  const data=(await pool.query(`WITH assignments AS (
    SELECT a.*,r.service_date,r.origin,r.destination,r.vehicle_type,f.name AS fleet_name,f.status AS fleet_status,g.group_id IS NOT NULL AS group_bound
    FROM shopee_assignments a JOIN shopee_routes r ON r.id=a.route_id JOIN partner_fleets f ON f.id=a.fleet_id LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id WHERE r.service_date=$1
  ), latest AS (SELECT DISTINCT ON(fleet_id) * FROM shopee_fleet_reports WHERE service_date=$1 ORDER BY fleet_id,id DESC),
  fleets AS (SELECT a.fleet_id,a.fleet_name,SUM(a.requested_trucks)::int AS requested,SUM(a.confirmed_trucks)::int AS confirmed,
    SUM(a.requested_trucks) FILTER(WHERE a.status='待回覆') AS pending,COALESCE(l.reported_total,0)::int AS reported,l.source,l.created_at AS reported_at,l.reported_by
    FROM assignments a LEFT JOIN latest l ON l.fleet_id=a.fleet_id GROUP BY a.fleet_id,a.fleet_name,l.reported_total,l.source,l.created_at,l.reported_by)
  SELECT (SELECT COALESCE(json_agg(a ORDER BY fleet_name,id),'[]'::json) FROM assignments a) AS items,
    (SELECT COALESCE(json_agg(f ORDER BY fleet_name),'[]'::json) FROM fleets f) AS fleets,
    (SELECT COALESCE(SUM(required_trucks),0)::int FROM shopee_routes WHERE service_date=$1) AS required,
    (SELECT count(*)::int FROM delivery_trips WHERE service_date=$1 AND demand_route_id IS NOT NULL AND driver_id IS NOT NULL AND fleet_id IS NULL AND status<>'已取消') AS own`,[day])).rows[0];
  res.set('Cache-Control','no-store').json({...data,date:day,items:data.items.map(a=>({...a,number:number(a.id)})),updatedAt:new Date().toISOString()});
}catch(e){next(e);}});
router.get('/fleets/:id/reports',async(req,res,next)=>{try{
  const day=req.query.date||todayInTaipei();if(!validDay(day))return res.status(400).json({error:'日期無效'});
  res.set('Cache-Control','no-store').json((await pool.query('SELECT * FROM shopee_fleet_reports WHERE fleet_id=$1 AND service_date=$2 ORDER BY id DESC LIMIT 500',[req.params.id,day])).rows);
}catch(e){next(e);}});
router.post('/fleets/:id/reports',async(req,res,next)=>{try{
  const day=req.body?.serviceDate;if(!validDay(day))return res.status(400).json({error:'日期無效'});
  const r=await reportTotal(pool,req.params.id,day,req.body||{},req.user);res.status(r.status||200).json(r);
}catch(e){next(e);}});
router.post('/:id/notify',async(req,res,next)=>{try{
  if(!/^\d{1,9}$/.test(req.params.id))return res.status(400).json({error:'任務編號錯誤'});
  const a=await assignment(pool,req.params.id);if(!a)return res.status(404).json({error:'任務不存在'});
  const r=await queueShopeeNotification(pool,a,req.user);res.status(r.status||200).json(r);
}catch(e){next(e);}});
module.exports=router;
