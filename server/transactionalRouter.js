const { AsyncLocalStorage } = require('node:async_hooks');
const { transaction, audit } = require('./transaction');

// Keep validation reads, writes and audit in one committed transaction, before sending HTTP success.
function transactionalRouter(router, rawPool, lockKey) {
  const context = new AsyncLocalStorage();
  const current = () => context.getStore() || rawPool;
  const pool = { query: (...args) => current().query(...args) };
  for (const method of ['post','put','patch','delete']) {
    const register = router[method].bind(router);
    router[method] = (path,...handlers) => {
      const handler = handlers.pop();
      return register(path,...handlers,async(req,res,next)=>{
        try {
          const response = await transaction(rawPool,async db=>{
            await db.query('SELECT pg_advisory_xact_lock($1)',[lockKey]);
            return context.run(db,async()=>{
              let output;
              const buffered = {
                statusCode:200,
                status(code){this.statusCode=code;return this;},
                json(data){output={status:this.statusCode,data,json:true};return this;},
                send(data){output={status:this.statusCode,data,json:false};return this;},
              };
              await handler(req,buffered,err=>{throw err;});
              if (!output) throw new Error('Missing transaction response');
              return output;
            });
          });
          res.status(response.status);
          if(response.json) res.json(response.data);else res.send(response.data);
        } catch(err) {next(err);}
      });
    };
  }
  return {
    pool,
    withTransaction:fn => context.getStore() ? fn(context.getStore()) : transaction(rawPool,fn),
    logAction:(req,action,entity,id,detail)=>audit(current(),req.user,action,entity,id,detail),
  };
}
module.exports = { transactionalRouter };
