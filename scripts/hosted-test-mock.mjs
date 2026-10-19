// Loopback-only Supabase Auth/Storage protocol double; never calls a hosted service.
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, randomInt, randomUUID, createHash, sign, verify } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDENTITIES, SIMULATION_PASSWORD, SIMULATION_STORAGE_KEY, syntheticAssets } from './hosted-test-fixtures.mjs';
import { createR2Double } from './hosted-test-r2.mjs';

const ORIGIN = 'http://127.0.0.1:54329';
const ADMIN_ORIGIN = 'http://127.0.0.1:3001';
export function createMockSupabase({ now = Date.now, outboxFile = '.local/hosted-test-simulation/auth-outbox.json', onIdentity = async () => {} } = {}) {
  const r2 = createR2Double();
  const users = structuredClone(IDENTITIES).map(u => ({ ...u, email_confirmed_at: u.created_at }));
  const passwords = new Map(users.map(u => [u.id, SIMULATION_PASSWORD]));
  const codes = new Map(), oauth = new Map(), revoked = new Set(), sessions = new Map(), cooldowns = new Map();
  const outbox = [];
  const synthetic = email => typeof email === 'string' && /^[a-z0-9._+-]+@example\.test$/i.test(email);
  const generic = { message: 'If eligible, a code will be sent.' };
  async function sendCode(email, type) {
    const key = `${type}:${email}`, previous = cooldowns.get(key);
    if (previous !== undefined && now() - previous < 60000) return false;
    cooldowns.set(key, now());
    const user = users.find(u => u.email === email);
    if (user) {
      const token = String(randomInt(0,1000000)).padStart(6,'0');
      codes.set(key, { token, expires: now() + 600000, attempts: 0 });
      outbox.push({ email, type, token, sent_at: now(), expires_at: now()+600000 });
      if (outboxFile) { await mkdir(dirname(outboxFile),{recursive:true}); await writeFile(outboxFile,JSON.stringify(outbox,null,2),{mode:0o600}); }
    }
    return true;
  }
  function newUser(email, provider) {
    const user = { id: randomUUID(), email, aud:'authenticated', role:'authenticated', app_metadata:{provider,providers:[provider]}, user_metadata:{full_name:provider==='google'?'Synthetic Google User':'ผู้สมัคร สมมติ'}, created_at:new Date(now()).toISOString() };
    users.push(user); return user;
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'h1-local-only', alg: 'RS256', use: 'sig' };
  const refreshTokens = new Map(), reusedRefreshTokens = new Map();
  const objects = new Map(syntheticAssets().map(a => [a.storage_path, { bytes: a.bytes, type: a.mime_type }]));
  const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  function session(user, previous) {
    const sid = previous && sessions.get(previous) || randomUUID();
    if (previous) refreshTokens.delete(previous);
    const timestamp = Math.floor(now() / 1000), refresh = randomBytes(32).toString('base64url');
    const input = `${b64({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })}.${b64({ sub: user.id, session_id:sid, is_anonymous:false, iss: `${ORIGIN}/auth/v1`, aud: 'authenticated', iat: timestamp, exp: timestamp + 3600, email: user.email, role: 'authenticated', app_metadata: user.app_metadata, user_metadata: user.user_metadata })}`;
    refreshTokens.set(refresh, user);
    sessions.set(refresh,sid);
    const result = { access_token: `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`, token_type: 'bearer', expires_in: 3600, expires_at: timestamp + 3600, refresh_token: refresh, user };
    // Supabase's SSR/client refresh reuse window: https://supabase.com/docs/guides/auth/sessions
    if (previous) reusedRefreshTokens.set(previous, { session: result, until: now() + 10000 });
    return result;
  }
  function actor(header) {
    try {
      const token = header?.replace(/^Bearer /i, ''), [h, p, signature] = token.split('.');
      if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(signature, 'base64url'))) return null;
      const data = JSON.parse(Buffer.from(p, 'base64url'));
      if (data.iss !== `${ORIGIN}/auth/v1` || data.aud !== 'authenticated' || data.exp <= now() / 1000) return null;
      if (revoked.has(data.session_id)) return null;
      return users.find(u => u.id === data.sub) ?? null;
    } catch { return null; }
  }
  const server = createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(data === undefined ? undefined : JSON.stringify(data));
    };
    if (req.headers.origin === ADMIN_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', ADMIN_ORIGIN);
      res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    }
    if (req.method === 'OPTIONS') return reply(204);
    try {
      const url = new URL(req.url, ORIGIN), path = url.pathname;
      if (path === '/health') return reply(200, { environment: 'local-simulation' });
      if (path === '/auth/v1/authorize' && req.method === 'GET') {
        const redirect = new URL(url.searchParams.get('redirect_to'));
        const email = url.searchParams.get('login_hint') || 'google-new@example.test';
        if (redirect.origin !== ADMIN_ORIGIN || redirect.pathname !== '/auth/callback' || !synthetic(email) || url.searchParams.get('provider') !== 'google' || url.searchParams.get('code_challenge_method')?.toLowerCase() !== 's256' || !url.searchParams.get('code_challenge')) return reply(400,{error:'invalid_oauth_request'});
        const user = users.find(u => u.email === email && u.email_confirmed_at) || newUser(email,'google');
        user.email_confirmed_at ||= new Date(now()).toISOString();
        user.app_metadata.providers = [...new Set([...user.app_metadata.providers,'google'])];
        await onIdentity(user);
        const code = randomBytes(24).toString('base64url');
        oauth.set(code,{user,challenge:url.searchParams.get('code_challenge'),expires:now()+60000});
        redirect.searchParams.set('code',code); res.writeHead(302,{Location:redirect.href}); return res.end();
      }
      if (path === '/auth/v1/.well-known/jwks.json') return reply(200, { keys: [jwk] });
      if (path === '/auth/v1/user' && req.method === 'GET') {
        const user = actor(req.headers.authorization);
        return user ? reply(200, user) : reply(401, { code: 'bad_jwt', message: 'Invalid simulation session' });
      }
      if (path === '/auth/v1/logout' && req.method === 'POST') {
        const user = actor(req.headers.authorization);
        if (!user) return reply(401, { code: 'bad_jwt' });
        for (const [token, u] of refreshTokens) if (u.id === user.id) { revoked.add(sessions.get(token)); refreshTokens.delete(token); }
        for (const [token, entry] of reusedRefreshTokens) if (entry.session.user.id === user.id) reusedRefreshTokens.delete(token);
        return reply(204);
      }
      let size = 0; const chunks = [];
      for await (const data of req) { size += data.length; if (size > 11 * 1024 * 1024) return reply(413, { error: 'too_large' }); chunks.push(data); }
      const bytes = Buffer.concat(chunks);
      if (path.startsWith('/r2/')) return r2(req,res,url,bytes);
      if (path === '/auth/v1/signup' && req.method === 'POST') {
        const body=JSON.parse(bytes); const email=body.email?.toLowerCase();
        if (!synthetic(email) || typeof body.password !== 'string' || body.password.length<12) return reply(422,{message:'Synthetic email and 12 character password required'});
        let user=users.find(u=>u.email===email);
        if (!user) { user=newUser(email,'email'); passwords.set(user.id,body.password); }
        await onIdentity(user);
        if (!user.email_confirmed_at && !await sendCode(email,'email')) return reply(429,{message:'Resend cooldown'});
        return reply(200,{...user,identities:[]});
      }
      if (['/auth/v1/recover','/auth/v1/resend'].includes(path) && req.method === 'POST') {
        const body=JSON.parse(bytes), email=body.email?.toLowerCase();
        if (!synthetic(email)) return reply(200,generic);
        const allowed=await sendCode(email,path.endsWith('recover')?'recovery':'email');
        return reply(allowed?200:429,allowed?generic:{message:'Resend cooldown'});
      }
      if (path === '/auth/v1/verify' && req.method === 'POST') {
        const body=JSON.parse(bytes), key=`${body.type}:${body.email?.toLowerCase()}`, code=codes.get(key);
        if (!code || code.expires<=now() || ++code.attempts>5 || code.token!==body.token) return reply(403,{code:'otp_expired',message:'Invalid or expired code'});
        codes.delete(key); const user=users.find(u=>u.email===body.email.toLowerCase()); user.email_confirmed_at ||= new Date(now()).toISOString();
        await onIdentity(user);
        return reply(200,session(user));
      }
      if (path === '/auth/v1/user' && req.method === 'PUT') {
        const user=actor(req.headers.authorization), body=JSON.parse(bytes);
        if (!user) return reply(401,{message:'Invalid session'});
        if (typeof body.password!=='string' || body.password.length<12) return reply(422,{message:'Password too short'});
        passwords.set(user.id,body.password); return reply(200,user);
      }
      if (path === '/auth/v1/token' && req.method === 'POST') {
        const body = JSON.parse(bytes.toString()), grant = url.searchParams.get('grant_type');
        if (grant === 'pkce') {
          const entry=oauth.get(body.auth_code); oauth.delete(body.auth_code);
          if (!entry || entry.expires<=now() || createHash('sha256').update(body.code_verifier||'').digest('base64url')!==entry.challenge) return reply(400,{message:'Invalid PKCE'});
          return reply(200,session(entry.user));
        }
        const reused = grant === 'refresh_token' ? reusedRefreshTokens.get(body.refresh_token) : null;
        if (reused && reused.until >= now()) return reply(200, reused.session);
        const user = grant === 'password' ? users.find(u => u.email === body.email?.toLowerCase() && u.email_confirmed_at && body.password === passwords.get(u.id)) : grant === 'refresh_token' ? refreshTokens.get(body.refresh_token) : null;
        return user ? reply(200, session(user, body.refresh_token)) : reply(400, { error: 'invalid_grant', error_description: 'Invalid simulation credentials' });
      }
      if (path.startsWith('/storage/v1/')) {
        if (req.headers.authorization !== `Bearer ${SIMULATION_STORAGE_KEY}` || req.headers.apikey !== SIMULATION_STORAGE_KEY) return reply(403, { error: 'Access denied' });
        if (path === '/storage/v1/bucket/hub-test-assets' && req.method === 'GET') return reply(200, { id: 'hub-test-assets', name: 'hub-test-assets', public: false });
        const match = path.match(/^\/storage\/v1\/object\/(?:authenticated\/)?hub-test-assets\/([a-f0-9]{64}\.(?:png|jpg|webp|svg|pdf))$/);
        if (match && req.method === 'POST') {
          if (objects.has(match[1])) return reply(409, { statusCode: '409', error: 'Duplicate' });
          objects.set(match[1], { bytes, type: req.headers['content-type'] });
          return reply(200, { Key: `hub-test-assets/${match[1]}` });
        }
        if (match && req.method === 'GET' && objects.has(match[1])) {
          const object = objects.get(match[1]);
          res.writeHead(200, { 'Content-Type': object.type, 'Content-Length': object.bytes.length, 'Cache-Control': 'no-store' });
          return res.end(object.bytes);
        }
      }
      return reply(404, { error: 'Not found' });
    } catch { return reply(400, { error: 'Invalid simulation request' }); }
  });
  server.outbox = outbox;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMockSupabase();
  server.listen(54329, '127.0.0.1', () => console.log('Local Auth/Storage simulation ready on loopback:54329; no hosted connection.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
