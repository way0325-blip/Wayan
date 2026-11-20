// Official NLSC county/town snapshot, fetched 2026-11-08. Administrative selection does not imply carrier service coverage.
// https://data.gov.tw/dataset/102011 ; https://api.nlsc.gov.tw/other/ListCounty
const REGIONS=require('./deliveryRegions.json');
const normalizeCity=v=>String(v??'').replace(/^台(?=[北中南東])/,'臺');
module.exports={REGIONS,normalizeCity};
