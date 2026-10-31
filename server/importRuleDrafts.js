const {transaction,audit}=require('./transaction');
// Private contract content is supplied locally, never bundled into the public repository.
async function importRuleDrafts(pool,catalog){
  if(!Array.isArray(catalog)||catalog.length>500)throw Error('Invalid draft catalog');
  return transaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(870035)');let imported=0;
    for(const r of catalog){
      if(!/^[A-Z0-9_-]{1,40}$/.test(r.ruleCode)||!r.title||r.title.length>100||!r.terms||r.terms.length>4000||!r.source||r.source.length>1000||!Number.isFinite(Number(r.points))||Number(r.points)<0||Number(r.points)>10000)throw Error('Invalid draft entry');
      const result=await db.query(`INSERT INTO penalty_rules(rule_code,version,title,terms,source,points,proposed_amount,effective_date,created_by) VALUES($1,1,$2,$3,$4,$5,$6,NULL,'本機PDF匯入') ON CONFLICT(rule_code,version) DO NOTHING RETURNING id`,[r.ruleCode,r.title,r.terms,r.source,r.points,r.proposedAmount??null]);
      if(result.rowCount){const id=result.rows[0].id;await db.query("INSERT INTO penalty_rule_history(rule_id,actor,action,note) VALUES($1,'本機PDF匯入','建立草稿','人工讀取掃描PDF；待主管核對條款、適用範圍與生效日')",[id]);await audit(db,{username:'本機PDF匯入',role:'admin'},'匯入草稿','罰款規則',id,r.ruleCode);imported++;}
    }return imported;
  });
}
module.exports={importRuleDrafts};
