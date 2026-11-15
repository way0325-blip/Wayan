const {isValidDateKey}=require('./dates');
function parse(text,year){
 const lines=String(text||'').normalize('NFKC').split(/\r?\n/),rows=[];let date='',deadline='';const issues=[];
 for(const line of lines){
  const due=line.match(/(?:於|截止[:：]?)\s*(\d{1,2})\/(\d{1,2})[^\d]*(\d{1,2}):(\d{2})/);if(due)deadline=year+'-'+due[1].padStart(2,'0')+'-'+due[2].padStart(2,'0')+'T'+due[3].padStart(2,'0')+':'+due[4]+':00+08:00';
  const d=line.match(/^\s*(\d{1,2})\/(\d{1,2})(?:\s|[（(]|$)/);if(d){date=year+'-'+d[1].padStart(2,'0')+'-'+d[2].padStart(2,'0');if(!isValidDateKey(date)){issues.push('日期不正確');date='';}}
  const m=line.match(/(\d{1,2}):(\d{2})\s*(.*?)\s*[*×xX]\s*(\d+)\s*(?:台|車)/);if(!m)continue;
  const time=m[1].padStart(2,'0')+':'+m[2],count=Number(m[4]),name=m[3].trim();if(!/(爆送|爆量|追加|支援)/.test(name))continue;
  if(!date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||count<1||count>100){issues.push('需求日期、時段或車數待核對');continue;}
  rows.push({date,time,count,name,business:/WH\s*NDD|黑箱|WB|WD|WC/i.test(name)?'black':/NDD|橘箱/i.test(name)?'orange':'pending'});
 }
 if(deadline&&(!isValidDateKey(deadline.slice(0,10))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(deadline.slice(11,16)))){issues.push('截止時間待核對');deadline='';}
 return {rows,deadline,issues};
}
module.exports={parse};
