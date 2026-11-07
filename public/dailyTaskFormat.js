(function(root){
const keys=['serviceDate','routeCode','pickupPointId','departureTime','quantity'];
function parse(text){
 text=String(text).replace(/^\uFEFF/,'');if(text.length>300000)throw Error('檔案最多300KB');
 if(text.trim().startsWith('[')){const rows=JSON.parse(text);if(!Array.isArray(rows))throw Error('JSON須為陣列');return rows;}
 const separator=text.split(/\r?\n/)[0].includes('\t')?'\t':',';let rows=[],row=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else if(!quote&&cell)throw Error('引號格式錯誤');else quote=!quote;}else if(c===separator&&!quote){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quote)throw Error('引號未結束');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(keys.some((k,i)=>rows[0]?.[i]?.trim()!==k)||rows[0]?.length!==5)throw Error('請使用每日任務範本的五個欄位');
 return rows.slice(1).map(r=>{if(r.length!==5)throw Error('資料欄位數不符');return Object.fromEntries(keys.map((k,i)=>[k,r[i].trim()]));});
}
const api={keys,parse};if(typeof module==='object')module.exports=api;else root.WayanDailyTaskFormat=api;
})(typeof window==='object'?window:globalThis);
