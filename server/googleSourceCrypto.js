const crypto=require('node:crypto');
function key(env=process.env){const secret=env.WAYAN_GOOGLE_SOURCE_TOKEN_KEY||env.JWT_SECRET;if(typeof secret!=='string'||secret.length<32)throw Object.assign(Error('測試環境授權加密金鑰尚未設定'),{status:409});return Buffer.from(crypto.hkdfSync('sha256',Buffer.from(secret),'wayan-staging-google-source','oauth-token-encryption-v1',32));}
function encrypt(value,env){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(env),iv),data=Buffer.concat([c.update(String(value),'utf8'),c.final()]);return ['v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');}
function decrypt(value,env){const [version,iv,tag,data]=String(value).split('.');if(version!=='v1'||!iv||!tag||!data)throw Error('INVALID_ENCRYPTED_TOKEN');const c=crypto.createDecipheriv('aes-256-gcm',key(env),Buffer.from(iv,'base64url'));c.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([c.update(Buffer.from(data,'base64url')),c.final()]).toString('utf8');}
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
module.exports={key,encrypt,decrypt,hash};
