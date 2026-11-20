(function(root){
const today=(now=new Date())=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
function valid(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<'1900-01-01'||s>'9999-12-31')return false;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;}
function classify(expiry,day=today()){
 if(!valid(day))throw Error('提醒基準日期無效');if(!expiry)return {status:'未提供',remindOn:'',days:null};if(!valid(expiry))return {status:'待核對',remindOn:'',days:null};
 const [y,m,d]=expiry.split('-').map(Number),last=new Date(Date.UTC(y,m-1,0)).getUTCDate(),remindOn=new Date(Date.UTC(y,m-2,Math.min(d,last))).toISOString().slice(0,10),days=Math.round((Date.parse(expiry+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
 return {status:days<0?'已逾期':days===0?'今日到期':day>=remindOn?'一個月內到期':'正常',remindOn,days};
}
const api={today,valid,classify};if(typeof module==='object')module.exports=api;else root.WayanLicenseReminders=api;
})(typeof window==='object'?window:globalThis);
