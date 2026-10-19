// Loopback-only S3 double. These exported values are deliberately fictional.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { syntheticAssets } from './hosted-test-fixtures.mjs';

export const R2_SIMULATION = { endpoint_url:'http://127.0.0.1:54329/r2', bucket:'h1-synthetic-content',
  access_key_id:'H1_SYNTHETIC_ACCESS_ONLY', secret_access_key:'H1-synthetic-secret-not-valid' };
const hash = value => createHash('sha256').update(value).digest('hex');
const mac = (key, value) => createHmac('sha256', key).update(value).digest();

export function createR2Double() {
  const objects = new Map(syntheticAssets().flatMap(a => [['originals/'+a.storage_path,{bytes:a.bytes,type:a.mime_type}],
    ['knowledge/'+a.checksum,{bytes:a.bytes,type:'application/octet-stream'}]]));
  return (req,res,url,bytes) => {
    const fail = (status,code) => {res.writeHead(status,{'Content-Type':'application/xml','Cache-Control':'no-store'});res.end(`<Error><Code>${code}</Code></Error>`);};
    const match = req.headers.authorization?.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/auto\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/);
    if (!match || match[1]!==R2_SIMULATION.access_key_id || url.search || !['HEAD','GET','PUT'].includes(req.method)) return fail(403,'AccessDenied');
    const [, ,date,signed,signature] = match;
    const names=signed.split(';'), digest=req.headers['x-amz-content-sha256'];
    if (!names.includes('host') || !names.includes('x-amz-date') || names.some(n=>!req.headers[n])
      || digest!==hash(bytes) && digest!=='UNSIGNED-PAYLOAD') return fail(403,'SignatureDoesNotMatch');
    const canonical=[req.method,url.pathname,'',names.map(n=>`${n}:${req.headers[n].trim().replace(/\s+/g,' ')}\n`).join(''),signed,digest].join('\n');
    const scope=`${date}/auto/s3/aws4_request`;
    const key=mac(mac(mac(mac('AWS4'+R2_SIMULATION.secret_access_key,date),'auto'),'s3'),'aws4_request');
    const expected=mac(key,`AWS4-HMAC-SHA256\n${req.headers['x-amz-date']}\n${scope}\n${hash(canonical)}`);
    if (!timingSafeEqual(expected,Buffer.from(signature,'hex'))) return fail(403,'SignatureDoesNotMatch');
    const base='/r2/'+R2_SIMULATION.bucket;
    if (url.pathname===base && req.method==='HEAD') {res.writeHead(200);return res.end();}
    const objectKey=url.pathname.startsWith(base+'/')?url.pathname.slice(base.length+1):'';
    if (!/^(?:originals\/[a-f0-9]{64}\.(?:jpg|png|webp|svg|pdf)|knowledge\/[a-f0-9]{64})$/.test(objectKey)) return fail(404,'NoSuchKey');
    if (req.method==='PUT') {
      if (req.headers['if-none-match']!=='*') return fail(403,'AccessDenied');
      if (objects.has(objectKey)) return fail(412,'PreconditionFailed');
      objects.set(objectKey,{bytes,type:req.headers['content-type']});res.writeHead(200,{ETag:`"${hash(bytes)}"`});return res.end();
    }
    const object=objects.get(objectKey);
    if (!object || req.method!=='GET') return fail(404,'NoSuchKey');
    res.writeHead(200,{'Content-Type':object.type,'Content-Length':object.bytes.length,'Cache-Control':'no-store'});res.end(object.bytes);
  };
}
