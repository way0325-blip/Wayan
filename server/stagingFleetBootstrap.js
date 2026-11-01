const crypto=require('node:crypto');
const {assertStagingDatabase}=require('./stagingSafety');
const {transaction,audit}=require('./transaction');
const {enqueueSheet,codeHash}=require('./fleetOperations');
const bad=()=>Object.assign(new Error('Invalid staging fleet setup'),{code:'STAGING_FLEET_SETUP_INVALID'});
function config(env){
 const name=env.STAGING_SETUP_FLEET_NAME,code=env.STAGING_SETUP_GROUP_CODE,expiry=env.STAGING_SETUP_CODE_EXPIRES_AT;
 if(!name&&!code&&!expiry)return null;
 assertStagingDatabase(env);
 if(typeof name!=='string'||!name.trim()||name.trim().length>100||!/^[A-Za-z0-9_-]{22}$/.test(code||''))throw bad();
 const time=Date.parse(expiry||'');if(!Number.isFinite(time)||time>Date.now()+15*60000)throw bad();
 return {name:name.trim(),hash:codeHash(code),expiresAt:new Date(time),expired:time<=Date.now()};
}
async function setupStagingFleet(pool,env=process.env){
 const c=config(env);if(!c)return {status:'disabled'};if(c.expired)return {status:'expired'};
 return transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(870033)');
  const matches=(await db.query('SELECT * FROM partner_fleets WHERE name=$1 FOR UPDATE',[c.name])).rows;
  if(matches.length>1)return {status:'ambiguous-fleet'};
  const actor={username:'測試環境一次性設定',role:'admin'};let fleet=matches[0];
  if(!fleet){fleet=(await db.query('INSERT INTO partner_fleets(id,name) VALUES($1,$2) RETURNING *',['F'+crypto.randomUUID(),c.name])).rows[0];await audit(db,actor,'建立測試車隊','夥伴車隊',fleet.id,c.name);await enqueueSheet(db,'fleets',fleet.id);}
  if(fleet.status!=='啟用')return {status:'fleet-disabled',fleetId:fleet.id};
  if((await db.query('SELECT 1 FROM line_fleet_groups WHERE fleet_id=$1',[fleet.id])).rowCount)return {status:'already-bound',fleetId:fleet.id};
  const existing=(await db.query('SELECT *,expires_at>NOW() AS active FROM fleet_group_codes WHERE fleet_id=$1 FOR UPDATE',[fleet.id])).rows[0];
  if(existing?.active)return {status:existing.code_hash===c.hash?'ready':'another-code-active',fleetId:fleet.id,expiresAt:existing.expires_at};
  await db.query(`INSERT INTO fleet_group_codes(code_hash,fleet_id,expires_at,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(fleet_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by`,[c.hash,fleet.id,c.expiresAt,actor.username]);
  await audit(db,actor,'建立一次性群組綁定碼','夥伴車隊',fleet.id,'使用既有群組綁定流程；不覆寫有效綁定碼或既有綁定');
  return {status:'ready',fleetId:fleet.id,expiresAt:c.expiresAt};
 });
}
module.exports={setupStagingFleet,config};
