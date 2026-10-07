import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createMockSupabase } from '../scripts/hosted-test-mock.mjs';

test('synthetic signup, OTP attempts/expiry/cooldown, recovery privacy and PKCE linking', async () => {
  let clock=Date.now(); const server=createMockSupabase({now:()=>clock,outboxFile:null});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,body,token)=>fetch(base+'/auth/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  const email='new-account@example.test',password='Synthetic-password-12!';
  try {
    assert.equal((await call('signup',{email,password})).status,200);
    assert.equal((await call('token?grant_type=password',{email,password})).status,400);
    assert.equal((await call('resend',{email,type:'signup'})).status,429);
    const code=server.outbox.at(-1).token;
    assert.equal((await call('verify',{email,type:'email',token:code==='000000'?'111111':'000000'})).status,403);
    const verified=await (await call('verify',{email,type:'email',token:code})).json(); assert.ok(verified.access_token);
    clock+=60001;
    const known=await call('recover',{email}),missing=await call('recover',{email:'missing@example.test'});
    assert.equal(known.status,missing.status);assert.deepEqual(await known.json(),await missing.json());
    const expired=server.outbox.at(-1).token;clock+=600001;
    assert.equal((await call('verify',{email,type:'recovery',token:expired})).status,403);
    await call('recover',{email});
    const recovery=await(await call('verify',{email,type:'recovery',token:server.outbox.at(-1).token})).json();
    const updated=await fetch(base+'/auth/v1/user',{method:'PUT',headers:{Authorization:`Bearer ${recovery.access_token}`},body:JSON.stringify({password:'Changed-synthetic-12!'})});assert.equal(updated.status,200);
    await call('logout',{},recovery.access_token);
    assert.equal((await call('token?grant_type=refresh_token',{refresh_token:verified.refresh_token})).status,400);
    assert.equal((await call('token?grant_type=password',{email,password})).status,400);
    const verifier='synthetic-pkce-verifier-'.repeat(3),challenge=createHash('sha256').update(verifier).digest('base64url');
    const params=new URLSearchParams({provider:'google',redirect_to:'http://127.0.0.1:3001/auth/callback?next=//evil.example',code_challenge:challenge,code_challenge_method:'s256',login_hint:email});
    const authorize=await fetch(base+'/auth/v1/authorize?'+params,{redirect:'manual'});assert.equal(authorize.status,302);
    const auth_code=new URL(authorize.headers.get('location')).searchParams.get('code');
    const linked=await(await call('token?grant_type=pkce',{auth_code,code_verifier:verifier})).json(); assert.equal(linked.user.id,verified.user.id);
    assert.equal((await call('token?grant_type=pkce',{auth_code,code_verifier:verifier})).status,400);
    params.set('redirect_to','https://evil.example/auth/callback');assert.equal((await fetch(base+'/auth/v1/authorize?'+params,{redirect:'manual'})).status,400);
    clock+=60001; await call('recover',{email});
    for(let n=0;n<5;n++) await call('verify',{email,type:'recovery',token:'wrong'});
    assert.equal((await call('verify',{email,type:'recovery',token:server.outbox.at(-1).token})).status,403);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
