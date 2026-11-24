const assert = require('node:assert/strict');
const {createHmac} = require('node:crypto');
const {test} = require('node:test');
const express = require('express');

test('preview verifies the dedicated bot and replies only to the allowed private tester', async () => {
  const id = 'U' + 'a'.repeat(32);
  const tester = 'U' + 'b'.repeat(32);
  const secret = 'synthetic-test-secret';
  Object.assign(process.env, {WAYAN_LINE_TEST_SECRET:secret, WAYAN_LINE_TEST_TOKEN:'old-bot',
    WAYAN_LINE_TEST_BOT_ID:id, WAYAN_LINE_TEST_REPLY_USER_ID:tester});
  const app = express();
  app.use('/api/line', require('../routes/previewLineWebhook'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const realFetch = global.fetch;
  let replies = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith('/info')) {
      return Response.json({userId:id,basicId:options.headers.Authorization.endsWith('old-bot')?'@028orjoz':'@synthetic'});
    }
    assert.ok(url.endsWith('/message/reply'));
    replies++;
    return Response.json({});
  };
  const event = {type:'message',source:{type:'user',userId:tester},message:{type:'text',text:'驗收測試'},replyToken:'example'};
  async function send(events, {destination=id, sign=true}={}) {
    const body=JSON.stringify({destination,events});
    return (await realFetch('http://127.0.0.1:'+server.address().port+'/api/line/webhook', {
      method:'POST',body,headers:{'Content-Type':'application/json',
        'X-Line-Signature':sign?createHmac('sha256',secret).update(body).digest('base64'):'bad'},
    })).status;
  }
  try {
    assert.equal(await send([]),503);
    process.env.WAYAN_LINE_TEST_TOKEN='synthetic-bot';
    assert.equal(await send([], {sign:false}),401);
    assert.equal(await send([], {destination:tester}),400);
    assert.equal(await send([]),200);
    assert.equal(await send([{...event,source:{type:'group',userId:tester}},{...event,deliveryContext:{isRedelivery:true}}]),200);
    assert.equal(replies,0);
    assert.equal(await send([event]),200);
    assert.equal(replies,1);
  } finally {
    global.fetch=realFetch;
    server.close();
  }
});
