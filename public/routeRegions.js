(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WayanRouteRegions=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const regions=Object.freeze({'01':'雙北','02':'桃園','03':'桃園','04':'新竹','05':'苗栗','06':'宜蘭','07':'瑞芳、深坑','08':'台中'});
 function classify(value){const raw=String(value??'');if(!raw.trim())return {regionCode:'',region:'未填'};const parts=raw.trim().split('-');if(parts.length<3||!parts.every(v=>/^[A-Za-z0-9]+$/.test(v))||!/^\d{2}$/.test(parts[1]))return {regionCode:'',region:'待確認'};return {regionCode:parts[1],region:regions[parts[1]]||'待確認'};}
 function project(records){return records.map(r=>({...r,...classify(r.routeCode)}));}
 return {regions,classify,project};
});
