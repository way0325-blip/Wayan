(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WayanServiceDay=api;})(typeof window==='object'?window:globalThis,()=>{
 function taipeiDay(now=new Date()){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const value=type=>parts.find(p=>p.type===type).value;return `${value('year')}-${value('month')}-${value('day')}`;}
 function createFollower({read,write,busy=()=>false,now=()=>new Date()}){let following=!read()||read()===taipeiDay(now());return {get following(){return following;},manual(date){following=date===taipeiDay(now());},pause(){following=false;},tick(){if(!following||busy())return false;const day=taipeiDay(now());if(read()===day)return false;write(day);return true;},today(){if(busy())return false;following=true;write(taipeiDay(now()));return true;}};}
 return {taipeiDay,createFollower};
});
