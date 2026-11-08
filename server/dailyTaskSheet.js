const crypto=require('node:crypto');
async function read(url,env=process.env,fetcher=fetch){
 let u;try{u=new URL(url);}catch{throw new Error('請提供Google Sheets網址');}
 const match=u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/),gid=new URLSearchParams(u.hash.slice(1)).get('gid')||u.searchParams.get('gid');
 if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||u.username||u.password||u.port||!match||!/^\d{1,12}$/.test(gid||''))throw new Error('請提供含gid分頁編號的Google Sheets網址');
 const email=env.WAYAN_GOOGLE_CLIENT_EMAIL,key=env.WAYAN_GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)throw new Error('尚未設定測試 Google 讀取授權');
 const now=Math.floor(Date.now()/1000),payload=[{alg:'RS256',typ:'JWT'},{iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const assertion=payload+'.'+crypto.sign('RSA-SHA256',Buffer.from(payload),key).toString('base64url');
 const auth=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 if(!auth.ok)throw new Error('Google 讀取授權失敗');const token=(await auth.json()).access_token;if(!token)throw new Error('Google 讀取授權失敗');

 const get=async suffix=>{const r=await fetcher('https://sheets.googleapis.com/v4/spreadsheets/'+match[1]+suffix,{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('無法讀取每日任務試算表，請確認檢視者授權');return r.json();};
 const meta=await get('?fields=sheets.properties'),sheet=meta.sheets?.find(s=>String(s.properties.sheetId)===gid)?.properties;if(!sheet)throw new Error('找不到指定分頁');
 const title="'"+sheet.title.replace(/'/g,"''")+"'",data=await get('/values/'+encodeURIComponent(title+'!A1:E102')+'?valueRenderOption=FORMATTED_VALUE'),values=data.values||[];
 const keys=['serviceDate','routeCode','pickupPointId','departureTime'];if(keys.some((k,i)=>values[0]?.[i]!==k))throw new Error('A至D欄標題須為serviceDate,routeCode,pickupPointId,departureTime');
 if(values.length>101)throw new Error('每日匯入最多100條路線，請拆分分頁');
 return values.slice(1).filter(r=>r.some(v=>String(v).trim())).map(row=>Object.fromEntries(keys.map((k,i)=>[k,row[i]??''])));
}
module.exports={read};
