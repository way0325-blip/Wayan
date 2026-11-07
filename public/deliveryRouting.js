(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WayanDeliveryRouting=api;})(typeof window==='object'?window:globalThis,()=>{
 const examples=['NB-03-484-1','NJ-01-994-1','NJ-01-997-1','FN-01-292-1','FM-01-281-1','FN-03-451-1','FN-03-455-1','WB-01-202-1','WB-03-310-1','WB-06-201-1','WB-03-400-1','WD-03-200-2','WB-07-310-1'];
 function classify(value){if(typeof value!=='string')return null;const raw=value.trim().toUpperCase(),code=raw.replace(/\s*(橘箱|黑箱)$/u,'').trim();if(!/^[NFW][A-Z0-9_-]{0,39}$/.test(code))return null;const box=code[0]==='W'?'黑箱':'橘箱';if((raw.endsWith('黑箱')||raw.endsWith('橘箱'))&&!raw.endsWith(box))return null;return {code,boxType:box,serviceType:code[0]==='N'?'店配':code[0]==='F'?'隔日到貨':'黑箱隔日到貨'};}
 return {classify,examples};
});
