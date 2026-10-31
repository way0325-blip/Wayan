const { assertStagingDatabase } = require('../stagingSafety');
const url = assertStagingDatabase(process.env,true);
process.env.DATABASE_URL = url.href;
// Never inherit real messaging credentials into automated tests (dotenv will not replace empty values).
process.env.LINE_CHANNEL_SECRET='';
process.env.LINE_CHANNEL_ACCESS_TOKEN='';
process.env.CRON_SECRET='';
// Each suite explicitly awaits reset before schema initialisation.
async function resetDatabase() {
  const {pool}=require('../db');
  const actual=(await pool.query('SELECT current_database() AS name')).rows[0].name;
  if(actual!=='wayan-staging-db') throw new Error('拒絕清除非 staging 資料庫');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
}
module.exports={resetDatabase};
