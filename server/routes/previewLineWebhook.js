const express = require('express');
const {createHmac, timingSafeEqual} = require('node:crypto');

const router = express.Router();
const lineId = /^U[0-9a-f]{32}$/i;
let verified;

async function verifyBot(token, destination) {
  if (verified?.token === token && verified.destination === destination) return;
  const response = await fetch('https://api.line.me/v2/bot/info', {
    headers: {Authorization: 'Bearer ' + token},
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('LINE test bot identity unavailable');
  const info = await response.json();
  if (info.userId !== destination || !info.basicId || info.basicId.toLowerCase() === '@028orjoz') {
    throw new Error('LINE test bot identity mismatch');
  }
  verified = {token, destination};
}

router.post('/webhook', express.raw({type: '*/*', limit: '256kb'}), async (req, res) => {
  const {WAYAN_LINE_TEST_SECRET: secret, WAYAN_LINE_TEST_TOKEN: token,
    WAYAN_LINE_TEST_BOT_ID: destination, WAYAN_LINE_TEST_REPLY_USER_ID: tester} = process.env;
  if (!secret || !token || !lineId.test(destination || '')) return res.status(503).json({error:'測試 Bot 尚未設定'});
  if (!Buffer.isBuffer(req.body)) return res.status(400).end();
  const actual = Buffer.from(req.get('x-line-signature') || '');
  const expected = Buffer.from(createHmac('sha256', secret).update(req.body).digest('base64'));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).end();
  let body;
  try {body = JSON.parse(req.body.toString('utf8'));} catch {return res.status(400).end();}
  if (body?.destination !== destination || !Array.isArray(body.events) || body.events.length > 100) return res.status(400).end();
  try {
    await verifyBot(token, destination);
    for (const event of body.events) {
      if (!tester || !lineId.test(tester) || event?.source?.type !== 'user' || event.source.userId !== tester ||
          event.type !== 'message' || event.message?.type !== 'text' || event.message.text?.trim?.() !== '驗收測試' ||
          event.deliveryContext?.isRedelivery || !event.replyToken) continue;
      const reply = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
        body: JSON.stringify({replyToken: event.replyToken, messages: [{type:'text',text:'Wayan 新站測試連線正常。'}]}),
        signal: AbortSignal.timeout(5000),
      });
      if (!reply.ok) throw new Error('LINE test reply unavailable');
    }
    return res.status(200).end();
  } catch {
    return res.status(503).json({error:'測試 Bot 驗證或回覆未完成'});
  }
});

module.exports = router;
