(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.WayanDispatchWindow=value;})(typeof window==='object'?window:globalThis,()=>{
 const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 const plus=(d,n)=>{if(!valid(d))throw Error('派車日期無效');const date=new Date(d+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);};
 function bounds(day){return {date:day,nextDate:plus(day,1),start:day+'T12:00',end:plus(day,1)+'T08:00'};}
 function anchor(now=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value])),day=p.year+'-'+p.month+'-'+p.day;return Number(p.hour)<12?plus(day,-1):day;}
 function includes(row,day){if(!valid(row.service_date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.departure_time||''))return false;const b=bounds(day),value=row.service_date+'T'+row.departure_time;return value>=b.start&&value<=b.end;}
 return {valid,plus,bounds,anchor,includes,query:day=>'date='+encodeURIComponent(day)+'&window=noon'};
});
