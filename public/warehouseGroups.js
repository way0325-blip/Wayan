(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WayanWarehouseGroups=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const mapping={'N-SOC':'北','C-SOC':'中','S-SOC':'南'};
 function classify(value){const raw=String(value??'').trim(),code=raw.toUpperCase();return {raw,code,key:mapping[code]?code:'other',label:mapping[code]||'其他／待核對'};}
 function groups(records){return [...Object.entries(mapping).map(([key,label])=>({key,label,count:0})),{key:'other',label:'其他／待核對',count:0}].map(g=>({...g,count:records.filter(r=>classify(r.warehouse).key===g.key).length}));}
 const matches=(record,key)=>!key||classify(record.warehouse).key===key;
 return {mapping,classify,groups,matches};
});
