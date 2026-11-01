const reserved=new Set(['車隊群組綁定','車隊任務','任務','蝦皮任務','蝦皮報到','蝦皮承接','蝦皮拒絕','承接','拒絕','到站','完成','延誤','貨損','車輛異常']);
async function keywordReply(db,text){
  if(text.length>30)return null;
  return (await db.query('SELECT reply FROM line_keyword_replies WHERE keyword=$1 AND enabled=TRUE',[text])).rows[0]?.reply??null;
}
module.exports={reserved,keywordReply};
