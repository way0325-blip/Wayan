const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const vm=require('node:vm');
function files(dir) {return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(dir+'/'+d.name):[dir+'/'+d.name]);}
let failed=false,count=0;
for(const file of [...files('server'),...files('public'),...files('scripts')].filter(n=>/\.(js|cjs)$/.test(n))) {
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.status!==0) failed=true;count++;
}
for(const [,script] of fs.readFileSync('public/index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  try {new vm.Script(script,{filename:'public/index.html'});} catch(err) {console.error(err);failed=true;}
  count++;
}
console.log(`Syntax checks: ${count}; ${failed?'FAILED':'PASS'}`);
process.exitCode=failed?1:0;
