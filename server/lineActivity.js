const crypto=require('node:crypto');
const isBinding=text=>/^\s*(?:車隊群組綁定|綁定)\s/.test(text);
async function recordActivity(db,event,id){
  const group=event.source?.groupId;if(event.source?.type!=='group'||typeof group!=='string')return;
  if(event.type==='unsend'&&typeof event.unsend?.messageId==='string'){
    await db.query('INSERT INTO line_unsent_messages(group_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[group,event.unsend.messageId]);
    await db.query("UPDATE fleet_line_activity SET content='此訊息已收回',hidden=TRUE WHERE group_id=$1 AND message_id=$2",[group,event.unsend.messageId]);
    // Remove the original text and generated reply from the retained webhook inbox too.
    await db.query(`UPDATE line_events SET payload=jsonb_set(payload,'{message,text}','"[訊息已收回]"'::jsonb),reply_text=NULL
      WHERE payload->'source'->>'groupId'=$1 AND payload->'message'->>'id'=$2`,[group,event.unsend.messageId]);return;
  }
  if(!['message','join','leave'].includes(event.type))return;
  const fleet=(await db.query('SELECT fleet_id FROM line_fleet_groups WHERE group_id=$1',[group])).rows[0];if(!fleet)return;
  if(event.message?.id&&(await db.query('SELECT 1 FROM line_unsent_messages WHERE group_id=$1 AND message_id=$2',[group,event.message.id])).rowCount){event.message.text='[訊息已收回]';return {skip:true};}
  const text=event.message?.type==='text'?String(event.message.text||''):'';if(isBinding(text))return;
  const label=event.source.userId?'成員-'+crypto.createHash('sha256').update(group+event.source.userId).digest('hex').slice(0,8):'LINE系統';
  const types={image:'圖片',video:'影片',audio:'語音',file:'檔案',sticker:'貼圖',location:'位置'};
  const content=event.type==='join'?'Bot加入群組':event.type==='leave'?'Bot離開群組':text||`[${types[event.message?.type]||'非文字'}訊息；尚未擷取附件內容]`;
  await db.query(`INSERT INTO fleet_line_activity(event_id,fleet_id,group_id,message_id,event_type,message_type,content,sender_label)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[id,fleet.fleet_id,group,event.message?.id||null,event.type,event.message?.type||null,content.slice(0,5000),label]);
}
module.exports={recordActivity};
