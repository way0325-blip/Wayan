const crypto=require('node:crypto');
const {REGIONS,normalizeCity}=require('./deliveryRegions');
const {isValidDateKey}=require('./dates');
const routing=require('../public/deliveryRouting');
const SOURCE_ID='12nj_N2zUrNHnYi0krf1kgorfqtJpz6y6MrMvAJ0WXSc';
const SPECS=Object.freeze({
 drivers:{name:'司機資料',sheetId:196637400,columns:[2,3,5,6,7,8,9,10,11,14],end:2098},
 parking:{name:'園區停車場清冊',sheetId:481811313,columns:[0,1,2,3,4],end:1000},
 vehicles:{name:'S-SOC車輛名單',sheetId:1504866403,columns:[0,1,2,3],end:1000},
 cars:{name:'汽車造冊名單',sheetId:1909462096,columns:[0,1,2,3,4],end:1000},
 NB:{name:'北倉-店配路線規劃表',sheetId:946527726,columns:[1,2,4,5,6,7,8,9],end:585},
 FN:{name:'北倉- NDD路線規劃表',sheetId:900699516,columns:[1,2,4,5,6,7,8,9],end:1300},
 WB:{name:'北倉-WH NDD路線規劃表',sheetId:1820354237,columns:[1,2,4,5,6,7,8,9],end:3396},
});
const HEADERS={drivers:{2:'中文姓名',3:'車輛類型',5:'駕照類型',6:'駕照到期日',7:'手機號碼',8:'倉別',9:'狀態',10:'司機編號',11:'員工ID',14:'廠區安全規範 繳交'},parking:{0:'供應商',1:'營業貨車_車牌',2:'營業貨車_車型',3:'自用車_車牌',4:'自用車_車主司機編號'},vehicles:{0:'車牌號碼',1:'車型',2:'司機姓名',3:'司機編號'},cars:{0:'登錄日期',1:'車類型',2:'車牌號碼 (不須加"-")',3:'聯絡電話 (不須加"-")',4:'使否提交長榮'}};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=v=>v==null?'':String(v).trim();
const plate=v=>text(v).toUpperCase().replace(/[\s-]/g,'');
function location(address){const city=normalizeCity(address.slice(0,3));return {city,district:REGIONS[city]?.find(d=>address.startsWith(address.slice(0,3)+d))||''};}
function parse(kind,rows){
 const spec=SPECS[kind];if(!spec||!Array.isArray(rows)||rows.length>4000)throw new Error('來源種類或筆數無效');
 const issues=[],records=[],keys=new Map();let current,previousRow=1;
 const issue=(row,message)=>issues.push({row,message});
 for(const row of rows){
  if(!Number.isInteger(row?.sourceRow)||row.sourceRow<2||row.sourceRow>spec.end||!row.cells||typeof row.cells!=='object')throw new Error('來源列格式錯誤');
  if(row.sourceRow<=previousRow)throw new Error('來源列須依原始列號遞增且不可重複');previousRow=row.sourceRow;
  const c={};for(const col of spec.columns){const v=row.cells[col];if(v!=null&&(!['string','number','boolean'].includes(typeof v)||String(v).length>500))throw new Error('來源欄位超出限制');c[col]=text(v);}
  if(Object.values(c).every(v=>!v||v==='FALSE')){current=null;continue;}
  if(['NB','FN','WB'].includes(kind)){
   if(c[1]){
    const route=routing.classify(c[1]);
    if(!route||route.code[0]!==kind[0]){issue(row.sourceRow,'路線前綴與分頁不符');current=null;continue;}
    current={key:route.code,sourceRow:row.sourceRow,routeCode:route.code,boxType:route.boxType,serviceType:route.serviceType,vehicleType:c[2],timeWindow:c[4],dock:c[5],stops:[],problems:[]};
    if(keys.has(current.key)){current.problems.push('路線編號重複區塊');keys.get(current.key).problems.push('路線編號重複區塊');}else keys.set(current.key,current);
    records.push(current);
   }
   if(!current){issue(row.sourceRow,'缺少所屬路線，未跨空白區塊沿用');continue;}
   const sequence=Number(c[6]);
   if(!/^\d+$/.test(c[6])||sequence<1||sequence>200||!c[7]||!c[8]){current.problems.push(`第${row.sourceRow}列缺少有效順序、門市或地址`);continue;}
   const loc=location(c[8]);
   if(!loc.district)current.problems.push(`第${row.sourceRow}列不在新竹以北配送範圍或地址待核對`);
   current.stops.push({sequence,name:c[7],address:c[8],...loc,note:c[9],sourceRow:row.sourceRow});
   continue;
  }
  let record;
  if(kind==='drivers'){
   if(row.sourceRow===2||c[2]==='蝦小編')continue;
   const license=c[6].replace(/\//g,'-');
   record={key:c[10]||`ROW-${row.sourceRow}`,name:c[2],externalDriverId:c[10],employeeId:c[11],phone:c[7],vehicleType:c[3],licenseType:c[5],license:isValidDateKey(license)?license:'',warehouse:c[8],sourceStatus:c[9],safetySubmitted:c[14],sourceRow:row.sourceRow,problems:[]};
   if(!record.name||!record.externalDriverId)record.problems.push('缺少姓名或司機編號');
   if(!record.license)record.problems.push('證照期限待核對');
  }else if(kind==='parking'){
   if(c[1])records.push({key:'COMMERCIAL-'+plate(c[1]),plate:c[1],plateKey:plate(c[1]),vehicleType:c[2],supplier:c[0],use:'營業貨車',sourceRow:row.sourceRow,problems:[]});
   if(c[3])records.push({key:'PRIVATE-'+plate(c[3]),plate:c[3],plateKey:plate(c[3]),externalDriverId:c[4],supplier:c[0],use:'自用車',sourceRow:row.sourceRow,problems:[]});
   if(!c[1]&&!c[3])issue(row.sourceRow,'未填車牌，保留於來源未匯入');
   continue;
  }else if(kind==='vehicles')record={key:plate(c[0]),plate:c[0],plateKey:plate(c[0]),vehicleType:c[1],driverName:c[2],externalDriverId:c[3],sourceRow:row.sourceRow,problems:[]};
  else {if(!c[2])continue;record={key:plate(c[2]),plate:c[2],plateKey:plate(c[2]),vehicleType:c[1],phone:c[3],registeredOn:c[0],submitted:c[4],sourceRow:row.sourceRow,problems:[]};}
  if(!record.key){issue(row.sourceRow,'缺少識別編號');continue;}
  records.push(record);
 }
 const duplicates=new Map();
 for(const record of records){
  if(['NB','FN','WB'].includes(kind)){
   record.stops.sort((a,b)=>a.sequence-b.sequence);
   if(!record.stops.length||record.stops.some((s,i)=>s.sequence!==i+1))record.problems.push('停靠順序須從1連續且不可重複');
  }else {
   if(record.plateKey&&!/^[A-Z0-9]{4,12}$/.test(record.plateKey))record.problems.push('車牌格式待核對');
   if(duplicates.has(record.key)){record.problems.push('來源識別編號重複');duplicates.get(record.key).problems.push('來源識別編號重複');}else duplicates.set(record.key,record);
  }
  record.problems=[...new Set(record.problems)];
 }
 const digest=hash({kind,records,issues});
 return {kind,sheetId:spec.sheetId,sheetName:spec.name,records,issues,digest,count:records.length,blocked:records.filter(r=>r.problems.length).length};
}
// Read only the pinned workbook and permitted columns. Password/account/identity-number columns are never requested.
async function readSource(kind,env=process.env,fetcher=fetch){
 const spec=SPECS[kind];if(!spec)throw new Error('來源種類無效');
 const email=env.WAYAN_GOOGLE_CLIENT_EMAIL,key=env.WAYAN_GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)throw new Error('尚未設定測試 Google 讀取授權');
 const now=Math.floor(Date.now()/1000),payload=[{alg:'RS256',typ:'JWT'},{iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const assertion=payload+'.'+crypto.sign('RSA-SHA256',Buffer.from(payload),key).toString('base64url');
 const auth=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 if(!auth.ok)throw new Error('Google 讀取授權失敗');const token=(await auth.json()).access_token;if(!token)throw new Error('Google 讀取授權失敗');
 const get=async suffix=>{const r=await fetcher('https://sheets.googleapis.com/v4/spreadsheets/'+SOURCE_ID+suffix,{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error(r.status===403||r.status===404?'請將來源試算表以檢視者分享給測試服務帳戶':'Google 來源讀取失敗');return r.json();};
 const meta=await get('?fields=sheets.properties');
 if(!meta.sheets?.some(s=>s.properties.sheetId===spec.sheetId&&s.properties.title===spec.name))throw new Error('來源分頁名稱或ID變更，請重新核對');
 const headerParams=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});
 for(const col of spec.columns){const letter=String.fromCharCode(65+col);headerParams.append('ranges',`'${spec.name}'!${letter}1:${letter}1`);}
 const headers=await get('/values:batchGet?'+headerParams);
 const normalizeHeader=v=>text(v).replace(/\s+/g,'');
 for(let i=0;i<spec.columns.length;i++){
  const col=spec.columns[i],actual=normalizeHeader(headers.valueRanges?.[i]?.values?.[0]?.[0]),expected=HEADERS[kind]?.[col];
  if(expected&&actual!==normalizeHeader(expected))throw new Error('來源欄位標題變更，停止讀取資料，請重新核對');
  if(!HEADERS[kind]&&((col===1&&!actual.startsWith('路線編號'))||(col===7&&actual!=='門市名稱')||(col===8&&actual!=='門市地址')))throw new Error('來源路線欄位標題變更，停止讀取資料');
 }
 const params=new URLSearchParams({valueRenderOption:'FORMATTED_VALUE'});
 for(const col of spec.columns){const letter=String.fromCharCode(65+col);params.append('ranges',`'${spec.name}'!${letter}1:${letter}${spec.end}`);}
 const result=await get('/values:batchGet?'+params),rows=[];
 for(let index=0;index<spec.columns.length;index++)for(let i=1;i<(result.valueRanges?.[index]?.values?.length||0);i++){rows[i]??={sourceRow:i+1,cells:{}};rows[i].cells[spec.columns[index]]=result.valueRanges[index].values[i]?.[0]??'';}
 return rows.filter(Boolean);
}
module.exports={SOURCE_ID,SPECS,parse,readSource,hash,plate};
