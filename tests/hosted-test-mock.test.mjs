import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { once } from 'node:events';
import { createMockSupabase } from '../scripts/hosted-test-mock.mjs';
import { IDENTITIES, SIMULATION_PASSWORD, SIMULATION_STORAGE_KEY, syntheticAssets } from '../scripts/hosted-test-fixtures.mjs';

test('local Auth double signs seven roles, rotates refresh tokens and keeps asset objects private', async () => {
  let clock=Date.now(); const server = createMockSupabase({now:()=>clock}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, options) => fetch(origin + path, options);
  const signin = (email, password=SIMULATION_PASSWORD) => call('/auth/v1/token?grant_type=password', { method:'POST', body:JSON.stringify({ email,password }) });
  try {
    const jwks = await (await call('/auth/v1/.well-known/jwks.json')).json();
    const key = createPublicKey({ key:jwks.keys[0], format:'jwk' });
    let session;
    for (const expected of IDENTITIES) {
      const response = await signin(expected.email); assert.equal(response.status,200); session=await response.json();
      const [h,p,s] = session.access_token.split('.');
      assert.equal(verify('RSA-SHA256',Buffer.from(`${h}.${p}`),key,Buffer.from(s,'base64url')),true);
      const claims=JSON.parse(Buffer.from(p,'base64url')); assert.deepEqual(claims.app_metadata,expected.app_metadata);
      assert.equal(claims.sub,expected.id); assert.equal(claims.aud,'authenticated');
      const user=await (await call('/auth/v1/user',{headers:{Authorization:`Bearer ${session.access_token}`}})).json(); assert.equal(user.id,expected.id);
    }
    assert.equal((await signin(IDENTITIES[0].email,'wrong')).status,400);
    assert.equal((await call('/auth/v1/user',{headers:{Authorization:'Bearer forged'}})).status,401);
    const refresh=()=>call('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});
    const first=await(await refresh()).json(), repeated=await(await refresh()).json();
    assert.equal(first.refresh_token,repeated.refresh_token);clock+=11000;assert.equal((await refresh()).status,400);
    const headers={Authorization:`Bearer ${SIMULATION_STORAGE_KEY}`,apikey:SIMULATION_STORAGE_KEY};
    const bucket=await(await call('/storage/v1/bucket/hub-test-assets',{headers})).json(); assert.equal(bucket.public,false);
    for(const asset of syntheticAssets()) {
      const path=`/storage/v1/object/authenticated/hub-test-assets/${asset.storage_path}`;
      assert.equal((await call(path)).status,403);
      const response=await call(path,{headers});assert.equal(response.status,200);
      const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.checksum);
      assert.equal((await call(`/storage/v1/object/hub-test-assets/${asset.storage_path}`,{method:'POST',headers,body:asset.bytes})).status,409);
    }
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
