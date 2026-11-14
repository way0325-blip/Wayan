const {SOURCE_ID,SPECS,parse,readSource}=require('./sourceCatalog');
const {transaction,audit}=require('./transaction');
const {assertStagingDatabase}=require('./stagingSafety');
// Initial read-only source import, requested for this staging workspace. Existing versions
// are never refreshed implicitly; subsequent updates use administrator preview/confirmation.
async function bootstrapSourceCatalog(pool,env=process.env,reader=readSource){
 if(env.WAYAN_ENV!=='staging'||!env.WAYAN_GOOGLE_CLIENT_EMAIL||!env.WAYAN_GOOGLE_PRIVATE_KEY)return [];
 assertStagingDatabase(env);
 const results=[];
 for(const kind of Object.keys(SPECS)){
  if((await pool.query('SELECT 1 FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 LIMIT 1',[SOURCE_ID,kind])).rowCount)continue;
  try{
   const parsed=parse(kind,await reader(kind,env));
   await transaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(870045)');
    if((await db.query('SELECT 1 FROM source_catalog_batches WHERE source_id=$1 AND kind=$2 LIMIT 1',[SOURCE_ID,kind])).rowCount)return;
    const result=await db.query('INSERT INTO source_catalog_batches(source_id,kind,sheet_id,sheet_name,digest,records,issues,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[SOURCE_ID,kind,parsed.sheetId,parsed.sheetName,parsed.digest,JSON.stringify(parsed.records),JSON.stringify(parsed.issues),'來源初始化']);
    await audit(db,{username:'來源初始化',role:'system'},'首次匯入來源名冊','來源資料',result.rows[0].id,`${kind} ${parsed.count}筆；未修改自有派車資源或發送LINE`);
   });
   results.push({kind,count:parsed.count,blocked:parsed.blocked});
  }catch{results.push({kind,status:'failed'});}
 }
 return results;
}
module.exports={bootstrapSourceCatalog};
