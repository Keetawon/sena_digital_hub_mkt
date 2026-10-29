import assert from 'node:assert/strict';
import {test} from 'node:test';
import {credentialFindings} from '../scripts/credential-scan.mjs';
import {PROVIDER_KEY_NAMES,WORKER_SECRET_NAMES,scrubProviderKeys} from '../scripts/provider-keys.mjs';

test('provider and worker variables are scrubbed, while non-secret model configuration stays',()=>{
 const names=[...PROVIDER_KEY_NAMES,...WORKER_SECRET_NAMES],env=Object.fromEntries(names.map(n=>[n,'synthetic-not-a-credential']));
 env.HUB_MEDIA_MODEL='synthetic-model';scrubProviderKeys(env);assert.deepEqual(env,{HUB_MEDIA_MODEL:'synthetic-model'});
});
test('every worker/provider name is checked without emitting a credential value',()=>{
 for(const name of [...PROVIDER_KEY_NAMES,...WORKER_SECRET_NAMES]){
  const value='Q'.repeat(43),result=credentialFindings(`${name}="${value}"`);
  assert.ok(result.some(r=>r.variable===name));assert.ok(!JSON.stringify(result).includes(value));
  assert.ok(credentialFindings(name,{browser:true}).some(r=>r.kind==='worker_or_provider_variable_in_browser'));
 }
 assert.deepEqual(credentialFindings('const variable = process.env.HUB_MEDIA_OPENAI_API_KEY;'),[]);
 assert.deepEqual(credentialFindings('access_key_id="H1_'+ 'LOCAL_FIXTURE'.repeat(2)+'"'),[]);
 assert.ok(credentialFindings('access_key_id="'+'a'.repeat(32)+'"').some(r=>r.variable==='access_key_id'));
});
