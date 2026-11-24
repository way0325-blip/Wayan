const ExcelJS=require('exceljs');
const fail=message=>{throw Object.assign(new Error(message),{status:422});};
function inspectZip(buffer){
 if(buffer.length>4*1024*1024||buffer.length<22)fail('Excel檔案上限4MB，請使用.xlsx格式');
 let e=-1;for(let p=buffer.length-22;p>=Math.max(0,buffer.length-65557);p--)if(buffer.readUInt32LE(p)===0x06054b50){e=p;break;}
 if(e<0||buffer.readUInt16LE(e+4)||buffer.readUInt16LE(e+6))fail('不支援分割或損毀的Excel檔案');
 const count=buffer.readUInt16LE(e+10),size=buffer.readUInt32LE(e+12);let p=buffer.readUInt32LE(e+16),total=0;const end=p+size;
 if(count>1000||count===65535||end>e)fail('Excel檔案結構過大');
 for(let i=0;i<count;i++){
  if(p+46>end||buffer.readUInt32LE(p)!==0x02014b50)fail('Excel檔案結構不正確');
  const flags=buffer.readUInt16LE(p+8),method=buffer.readUInt16LE(p+10),n=buffer.readUInt32LE(p+24),len=buffer.readUInt16LE(p+28),extra=buffer.readUInt16LE(p+30),comment=buffer.readUInt16LE(p+32);
  if(p+46+len+extra+comment>end||flags&1||![0,8].includes(method)||n===0xffffffff)fail('不支援加密或特殊壓縮的Excel檔案');
  const name=buffer.subarray(p+46,p+46+len).toString('utf8');if(/vbaProject|externalLinks|\.bin$|(^|\/)\.\.(\/|$)/i.test(name))fail('不接受巨集、外部活頁簿連結或不安全檔案');
  total+=n;if(total>32*1024*1024)fail('Excel解壓後過大，請拆分檔案');p+=46+len+extra+comment;
 }
 if(p!==end)fail('Excel檔案目錄不正確');
}
function value(cell){let v=cell.value;if(v===null||v===undefined)return '';if(v&&typeof v==='object'&&('formula' in v||'sharedFormula' in v))fail('檔案含公式，請先貼上為值再匯入，避免使用未更新的計算結果');if(v instanceof Date)return /h.*m/i.test(cell.numFmt||'')&&!/[dy]/i.test(cell.numFmt||'')?v.toISOString().slice(11,16):v.toISOString().slice(0,10);if(typeof v==='number'&&/^0+$/.test(cell.numFmt||''))return String(v).padStart(cell.numFmt.length,'0');if(typeof v==='number'&&/h.*m/i.test(cell.numFmt||'')){const minutes=Math.round((v%1)*1440)%1440;return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}if(typeof v==='object')v=v.richText?v.richText.map(x=>x.text).join(''):v.text??'';const text=String(v);if(text.length>4000)fail('單一儲存格超過4000字');return text;}
async function read(buffer,sheetName){inspectZip(buffer);const book=new ExcelJS.Workbook();try{await book.xlsx.load(buffer);}catch{fail('無法解析Excel檔案，請確認為未加密的.xlsx格式');}const sheets=book.worksheets.filter(s=>s.state!=='veryHidden').map(s=>s.name),sheet=sheetName?book.getWorksheet(sheetName):book.worksheets[0];if(!sheet)fail('找不到指定工作表');if(sheet.rowCount>10001||sheet.columnCount>64||sheet.rowCount*sheet.columnCount>300000)fail('工作表超過10000筆、64欄或30萬格，請拆分');const rows=[];for(let i=1;i<=sheet.rowCount;i++){const row=[];for(let j=1;j<=sheet.columnCount;j++)row.push(value(sheet.getCell(i,j)));rows.push(row);}return {sheets,sheetName:sheet.name,rows};}
async function write(rows,sheetName='資料'){if(!Array.isArray(rows)||rows.length>10001||rows.some(r=>!Array.isArray(r)||r.length>64||r.some(v=>v!==null&&typeof v==='object'||String(v??'').length>4000))||rows.reduce((n,r)=>n+r.length,0)>300000)fail('匯出資料超過限制或格式錯誤');const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(String(sheetName).replace(/[\[\]*?:/\\]/g,'').slice(0,31)||'資料');for(const r of rows)sheet.addRow(r.map(v=>v===null||v===undefined?'':typeof v==='number'?v:String(v)));sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>{c.width=22;});return book.xlsx.writeBuffer();}
module.exports={inspectZip,value,read,write};
