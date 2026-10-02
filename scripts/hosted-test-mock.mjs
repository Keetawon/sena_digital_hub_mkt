// Loopback-only Supabase Auth/Storage protocol double; never calls a hosted service.
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { IDENTITIES, SIMULATION_PASSWORD, SIMULATION_STORAGE_KEY, syntheticAssets } from './hosted-test-fixtures.mjs';

const ORIGIN = 'http://127.0.0.1:54329';
const ADMIN_ORIGIN = 'http://127.0.0.1:3001';
export function createMockSupabase({ now = Date.now } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'h1-local-only', alg: 'RS256', use: 'sig' };
  const refreshTokens = new Map(), reusedRefreshTokens = new Map();
  const objects = new Map(syntheticAssets().map(a => [a.storage_path, { bytes: a.bytes, type: a.mime_type }]));
  const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  function session(user, previous) {
    if (previous) refreshTokens.delete(previous);
    const timestamp = Math.floor(now() / 1000), refresh = randomBytes(32).toString('base64url');
    const input = `${b64({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })}.${b64({ sub: user.id, iss: `${ORIGIN}/auth/v1`, aud: 'authenticated', iat: timestamp, exp: timestamp + 3600, email: user.email, role: 'authenticated', app_metadata: user.app_metadata, user_metadata: {} })}`;
    refreshTokens.set(refresh, user);
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
      return IDENTITIES.find(u => u.id === data.sub) ?? null;
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
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return reply(204);
    try {
      const url = new URL(req.url, ORIGIN), path = url.pathname;
      if (path === '/health') return reply(200, { environment: 'local-simulation' });
      if (path === '/auth/v1/.well-known/jwks.json') return reply(200, { keys: [jwk] });
      if (path === '/auth/v1/user' && req.method === 'GET') {
        const user = actor(req.headers.authorization);
        return user ? reply(200, user) : reply(401, { code: 'bad_jwt', message: 'Invalid simulation session' });
      }
      if (path === '/auth/v1/logout' && req.method === 'POST') {
        const user = actor(req.headers.authorization);
        if (!user) return reply(401, { code: 'bad_jwt' });
        for (const [token, u] of refreshTokens) if (u.id === user.id) refreshTokens.delete(token);
        for (const [token, entry] of reusedRefreshTokens) if (entry.session.user.id === user.id) reusedRefreshTokens.delete(token);
        return reply(204);
      }
      let size = 0; const chunks = [];
      for await (const data of req) { size += data.length; if (size > 11 * 1024 * 1024) return reply(413, { error: 'too_large' }); chunks.push(data); }
      const bytes = Buffer.concat(chunks);
      if (path === '/auth/v1/token' && req.method === 'POST') {
        const body = JSON.parse(bytes.toString()), grant = url.searchParams.get('grant_type');
        const reused = grant === 'refresh_token' ? reusedRefreshTokens.get(body.refresh_token) : null;
        if (reused && reused.until >= now()) return reply(200, reused.session);
        const user = grant === 'password' ? IDENTITIES.find(u => u.email === body.email && body.password === SIMULATION_PASSWORD) : grant === 'refresh_token' ? refreshTokens.get(body.refresh_token) : null;
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
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMockSupabase();
  server.listen(54329, '127.0.0.1', () => console.log('Local Auth/Storage simulation ready on loopback:54329; no hosted connection.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
