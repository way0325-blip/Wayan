const router=require('express').Router(),{pool:raw}=require('../db'),{requireAuth,requireRole}=require('../auth'),service=require('../pickupRoutes');
router.use(requireAuth,requireRole('admin','dispatcher'),(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const {pool}=require('../transactionalRouter').transactionalRouter(router,raw,870045);
const wrap=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
router.get('/',wrap(req=>service.list(raw,req.query.category)));
router.post('/preview',requireRole('admin'),wrap(req=>service.preview(pool,req.body)));
router.post('/import',requireRole('admin'),wrap(req=>service.save(pool,req.body,req.user)));
module.exports=router;
