const crypto=require('node:crypto');
const {pool}=require('./db');
const {transaction}=require('./transaction');
const {SHEETS}=require('./fleetSheetSchema');
const {taskNumber,caseNumber}=require('./fleetOperations');
const error=code=>Object.assign(new Error(code),{code});
let cachedToken;
async function targetId(){
  const row=(await pool.query("SELECT value FROM settings WHERE key='fleet_spreadsheet_id'")).rows[0];
  return row?.value||process.env.WAYAN_FLEET_SHEET_ID||'';
}
function credentialsReady(){return Boolean(process.env.WAYAN_GOOGLE_CLIENT_EMAIL && process.env.WAYAN_GOOGLE_PRIVATE_KEY);}
async function token(){
  if(!credentialsReady()) throw error('GOOGLE_NOT_CONFIGURED');
  const email=process.env.WAYAN_GOOGLE_CLIENT_EMAIL,key=process.env.WAYAN_GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n');
  const fingerprint=crypto.createHash('sha256').update(email+key).digest('hex');
  if(cachedToken?.fingerprint===fingerprint && cachedToken.until>Date.now()+120000) return cachedToken.value;
  const now=Math.floor(Date.now()/1000);
  const data=[{alg:'RS256',typ:'JWT'},{iss:email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  let signature;
  try{signature=crypto.sign('RSA-SHA256',Buffer.from(data),key).toString('base64url');}catch{throw error('GOOGLE_KEY_INVALID');}
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:data+'.'+signature})});
  if(!response.ok) throw error('GOOGLE_AUTH_FAILED');
  const result=await response.json();if(!result.access_token) throw error('GOOGLE_AUTH_FAILED');
  cachedToken={value:result.access_token,until:Date.now()+Number(result.expires_in||3600)*1000,fingerprint};return result.access_token;
}
async function google(path,options={}){
  const response=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+path,{...options,signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+await token()}});
  if(response.status===401){cachedToken=null;throw error('GOOGLE_AUTH_FAILED');}
  if(!response.ok) throw error(response.status===403?'GOOGLE_PERMISSION_DENIED':response.status===429?'GOOGLE_RATE_LIMITED':'GOOGLE_WRITE_FAILED');
  return response.json();
}
const serial=value=>value==null?'':(new Date(value).getTime()+8*3600000)/86400000+25569;
async function rowValues(key,id){
  if(key==='fleets'){
    const r=(await pool.query('SELECT f.*,g.bound_at FROM partner_fleets f LEFT JOIN line_fleet_groups g ON g.fleet_id=f.id WHERE f.id=$1',[id])).rows[0];
    if(!r) throw error('RECORD_NOT_FOUND');return [r.id,r.name,r.contact_name,r.phone,r.daily_capacity,r.status,r.bound_at?'已綁定':'未綁定',serial(new Date())];
  }
  if(key==='tasks'){
    const r=(await pool.query('SELECT t.*,f.name AS fleet_name FROM fleet_work_orders t JOIN partner_fleets f ON f.id=t.fleet_id WHERE t.id=$1',[id])).rows[0];
    if(!r) throw error('RECORD_NOT_FOUND');return [taskNumber(r.id),r.fleet_id,r.fleet_name,Date.parse(r.service_date+'T00:00:00Z')/86400000+25569,r.origin,r.destination,r.vehicle_type,r.requested_trucks,r.confirmed_trucks,r.status,r.title,serial(r.updated_at)];
  }
  if(key==='incidents'){
    const r=(await pool.query('SELECT i.*,f.name AS fleet_name FROM fleet_incidents i JOIN partner_fleets f ON f.id=i.fleet_id WHERE i.id=$1',[id])).rows[0];
    if(!r) throw error('RECORD_NOT_FOUND');return [caseNumber(r.id),r.fleet_id,r.fleet_name,taskNumber(r.task_id),serial(r.created_at),r.kind,r.severity,r.status,r.description,r.handler,r.resolution,serial(r.updated_at)];
  }
  if(key==='history'){
    const r=(await pool.query('SELECT * FROM fleet_incident_history WHERE id=$1',[id])).rows[0];
    if(!r) throw error('RECORD_NOT_FOUND');return ['H'+String(r.id).padStart(6,'0'),caseNumber(r.incident_id),serial(r.created_at),r.actor,r.action,r.previous_status||'',r.next_status,r.note];
  }
  throw error('INVALID_SHEET_KEY');
}
async function sheetRow(key,id){
  return transaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(870034)');
    const existing=(await db.query('SELECT row_number FROM fleet_sheet_rows WHERE sheet_key=$1 AND entity_id=$2',[key,id])).rows[0];
    if(existing) return existing.row_number;
    const row=(await db.query('SELECT COALESCE(MAX(row_number),1)+1 AS n FROM fleet_sheet_rows WHERE sheet_key=$1',[key])).rows[0].n;
    await db.query('INSERT INTO fleet_sheet_rows(sheet_key,entity_id,row_number) VALUES($1,$2,$3)',[key,id,row]);return row;
  });
}
async function deliverSheet(payload){
  const id=await targetId();if(!id || !credentialsReady()) throw error('GOOGLE_NOT_CONFIGURED');
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw error('GOOGLE_TARGET_INVALID');
  const spec=SHEETS[payload.key];if(!spec) throw error('INVALID_SHEET_KEY');
  const metadata=await google(id+'?fields=sheets.properties');
  const sheet=metadata.sheets?.find(s=>s.properties.title===spec.name)?.properties;
  if(!sheet) throw error('SHEET_TAB_MISSING');
  const header=await google(id+'/values/'+encodeURIComponent("'"+spec.name+"'!A1:L1"));
  if(JSON.stringify((header.values?.[0]||[]).slice(0,spec.headers.length))!==JSON.stringify(spec.headers)) throw error('SHEET_HEADERS_CHANGED');
  const row=await sheetRow(payload.key,String(payload.id)),values=await rowValues(payload.key,payload.id);
  if(row>sheet.gridProperties.rowCount){
    const length=Math.max(1000,row-sheet.gridProperties.rowCount),bounds={};
    for(const s of metadata.sheets)bounds[s.properties.title]=s.properties.title===spec.name?s.properties.gridProperties.rowCount+length:s.properties.gridProperties.rowCount;
    const end=key=>bounds[SHEETS[key].name],summary=metadata.sheets.find(s=>s.properties.title==='營運總覽')?.properties;
    if(!summary)throw error('SHEET_TAB_MISSING');
    const formulas=[
      `=COUNTIFS('車隊名冊'!F2:F${end('fleets')},"啟用")`,
      `=COUNTIFS('任務通知'!J2:J${end('tasks')},"待回覆")`,
      `=SUMIFS('任務通知'!H2:H${end('tasks')},'任務通知'!J2:J${end('tasks')},"待回覆")`,
      `=SUMIFS('任務通知'!I2:I${end('tasks')},'任務通知'!J2:J${end('tasks')},"已確認")+SUMIFS('任務通知'!I2:I${end('tasks')},'任務通知'!J2:J${end('tasks')},"執行中")`,
      `=COUNTIFS('異常案件'!A2:A${end('incidents')},"<>",'異常案件'!H2:H${end('incidents')},"<>已結案")`,
      `=COUNTIFS('異常案件'!G2:G${end('incidents')},"緊急",'異常案件'!H2:H${end('incidents')},"<>已結案")`,
    ];
    await google(id+':batchUpdate',{method:'POST',body:JSON.stringify({requests:[
      {appendDimension:{sheetId:sheet.sheetId,dimension:'ROWS',length}},
      {copyPaste:{source:{sheetId:sheet.sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:spec.headers.length},destination:{sheetId:sheet.sheetId,startRowIndex:sheet.gridProperties.rowCount,endRowIndex:sheet.gridProperties.rowCount+length,startColumnIndex:0,endColumnIndex:spec.headers.length},pasteType:'PASTE_FORMAT'}},
      {updateCells:{start:{sheetId:summary.sheetId,rowIndex:4,columnIndex:2},rows:formulas.map(formulaValue=>({values:[{userEnteredValue:{formulaValue}}]})),fields:'userEnteredValue'}},
    ]})});
  }
  const range="'"+spec.name+"'!A"+row+':'+String.fromCharCode(64+values.length)+row;
  const current=await google(id+'/values/'+encodeURIComponent(range));
  const cells=current.values?.[0]||[];
  if(cells.some(v=>v!=='' && v!=null) && String(cells[0])!==String(values[0])) throw error('SHEET_ROW_CONFLICT');
  await google(id+'/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:[
    {range,majorDimension:'ROWS',values:[values]},
    {range:"'營運總覽'!C14",values:[[serial(new Date())]]},
    {range:"'營運總覽'!C13",values:[['由 Wayan 自動同步；請依最後成功寫入時間確認資料新鮮度']]},
  ]})});
}
module.exports={deliverSheet,targetId,credentialsReady,rowValues,sheetRow};
