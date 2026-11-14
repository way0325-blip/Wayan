const router=require('express').Router(),{pool}=require('../db'),{requireAuth,requireRole}=require('../auth');
router.use(requireAuth,requireRole('admin'),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/routes',async(req,res,next)=>{try{res.json(await require('../routeSourceRefresh').status(pool));}catch(e){next(e);}});
router.post('/routes',async(req,res,next)=>{try{const r=await require('../routeSourceRefresh').refresh(req.user);r.fleets=await require('../realFleetRegistry').sync(req.user);res.json(r);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});res.status(422).json({error:'無法更新來源路線，請核對公司來源的檢視授權與欄位；未改動歷史車趟'});}});
router.post('/fleets',async(req,res,next)=>{try{res.json(await require('../realFleetRegistry').sync(req.user));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
module.exports=router;
