const express=require('express');
const {isConfigured,verifySignature}=require('../line');
const {receiveEvents}=require('../lineWorkflow');
const router=express.Router();
router.post('/webhook',express.raw({type:'*/*',limit:'2mb'}),async(req,res)=>{
  if (!isConfigured()) return res.status(503).json({error:'LINE 測試頻道尚未設定'});
  if (!verifySignature(req.body,req.headers['x-line-signature'])) return res.status(401).json({error:'簽章驗證失敗'});
  let payload;
  try {payload=JSON.parse(req.body.toString('utf8'));} catch {return res.status(400).json({error:'JSON 格式錯誤'});}
  if (!Array.isArray(payload.events) || payload.events.length>100 || payload.events.some(e=>!e || typeof e!=='object')) return res.status(400).json({error:'事件格式錯誤'});
  try {
    // Acknowledge only after business transactions are durable; 503 permits safe LINE redelivery.
    await receiveEvents(payload.events);
    res.status(200).end();
  } catch {res.status(503).json({error:'事件處理失敗，請重送'});}
});
module.exports=router;
