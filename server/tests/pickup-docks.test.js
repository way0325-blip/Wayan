const test=require('node:test'),assert=require('node:assert/strict');
const {dock}=require('../../public/weeklyRouteFormat');
test('confirmed pickup docks include A B C Changrong and retain D T mappings',()=>{
 for(const code of ['A','B12','C-3'])assert.equal(dock(code).pickupId,'CHANGRONG');
 assert.equal(dock('D2').pickupId,'GUOJI');assert.equal(dock('T-8').pickupId,'SHUIYUAN');
 assert.equal(dock('E1'),null);assert.equal(dock('AB1'),null);
});
