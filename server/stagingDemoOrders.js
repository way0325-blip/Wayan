const {transaction,audit}=require('./transaction');
const {assertStagingDatabase}=require('./stagingSafety');
async function setupStagingDemo(pool,env=process.env){
 const requestId=env.STAGING_DEMO_ORDER_REQUEST_ID,date=env.STAGING_DEMO_ORDER_DATE;
 if(!requestId&&!date)return {status:'disabled'};
 assertStagingDatabase(env);
 if(!requestId||!date)throw new Error('STAGING_DEMO_CONFIG_INVALID');
 return transaction(pool,async db=>{await db.query('SELECT pg_advisory_xact_lock(870033)');const actor={username:'使用者授權測試資料初始化',role:'admin'};const r=await require('./deliveryDispatch').simulate(db,{requestId,date},actor,(actor,...args)=>audit(db,actor,...args));return {status:r.duplicate?'existing':'created',date:r.date,prefix:r.prefix,routes:r.routes,trips:r.trips,orders:r.orders};});
}
module.exports={setupStagingDemo};
