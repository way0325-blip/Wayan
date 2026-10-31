const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const {assertStagingDatabase}=require('../server/stagingSafety');
assertStagingDatabase(process.env,true);
let failed=false;
for(const file of fs.readdirSync('server/tests').filter(n=>n.endsWith('.test.js')).sort()) {
  const result=spawnSync(process.execPath,['--test',`server/tests/${file}`],{stdio:'inherit',env:process.env});
  if(result.status!==0) failed=true;
}
process.exitCode=failed?1:0;
