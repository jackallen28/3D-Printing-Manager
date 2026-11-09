const encoder = new TextEncoder();
const keyCache = new WeakMap();
export const COOKIE = 'bnts_teacher';
export function failure(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function b64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
function unb64(text) { return Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0)); }
async function key(env) {
  const cache = keyCache.get(env.DB);
  if (cache?.password === env.TEACHER_PASSWORD) return cache.promise;
  const promise = (async () => {
    // Persist a random signing key in the private database: staff only set a password.
    await env.DB.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES (?,?)').bind('signing_secret', b64(crypto.getRandomValues(new Uint8Array(48)))).run();
    const stored = await env.DB.prepare('SELECT value FROM app_meta WHERE key=?').bind('signing_secret').first();
    return crypto.subtle.importKey('raw', encoder.encode(stored.value + ':' + env.TEACHER_PASSWORD), { name:'HMAC', hash:'SHA-256' }, false, ['sign','verify']);
  })();
  keyCache.set(env.DB, { password:env.TEACHER_PASSWORD, promise });
  return promise;
}
export async function sign(env, value) {
  const data = b64(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await key(env), encoder.encode(data));
  return data + '.' + b64(new Uint8Array(signature));
}
export async function verify(env, token, kind) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await key(env), unb64(parts[1]), encoder.encode(parts[0]))) return null;
    const value = JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    return value.kind === kind && value.exp > Date.now() ? value : null;
  } catch { return null; }
}
export async function passwordMatches(env, supplied) {
  if (typeof supplied !== 'string' || supplied.length > 256) return false;
  const k = await key(env);
  const [actual, expected] = await Promise.all([supplied, env.TEACHER_PASSWORD].map(text => crypto.subtle.sign('HMAC', k, encoder.encode('password:' + text))));
  const a = new Uint8Array(actual), b = new Uint8Array(expected); let difference = 0;
  for (let i=0;i<a.length;i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) failure('Open the BNTS site to submit this request.', 403);
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') failure('Open the BNTS site to submit this request.', 403);
}
export async function teacherSession(env, request) {
  const cookie = request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  const session = await verify(env, cookie, 'teacher');
  if (!session || await env.DB.prepare('SELECT id FROM revoked_sessions WHERE id=?').bind(session.id).first()) failure('Please sign in to the teacher console.',401);
  if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
    sameOrigin(request);
    if (request.headers.get('X-CSRF-Token') !== session.csrf) failure('Session check failed. Refresh this page.',403);
  }
  return session;
}
export function sessionCookie(request, token, clear=false) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${clear?'':token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:8*3600}${secure}`;
}
export async function rateLimit(env, key, limit, windowSeconds) {
  const window = Math.floor(Date.now()/1000/windowSeconds);
  const value = await env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key+':'+window, (window+1)*windowSeconds*1000).first();
  if (value.count > limit) failure('Too many requests. Please wait before trying again.',429);
}
export async function clientKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(ip))));
}
