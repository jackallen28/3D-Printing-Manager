const encoder = new TextEncoder();
const keyCache = new WeakMap();
const saltCache = new WeakMap();
const accessKeyCache = new Map();
const COOKIE_NAME = "bnts_teacher";
const DAY = 24 * 60 * 60 * 1000;
export const AUDIT_RETENTION_MS = 30 * DAY;

export function failure(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function b64(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function unb64(text) {
  return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A random value stored once in the private database. */
async function storedSecret(env, name) {
  await env.DB.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES (?,?)")
    .bind(name, b64(crypto.getRandomValues(new Uint8Array(48))))
    .run();
  return (await env.DB.prepare("SELECT value FROM app_meta WHERE key=?").bind(name).first()).value;
}
async function key(env) {
  const cache = keyCache.get(env.DB);
  if (cache?.password === env.TEACHER_PASSWORD) return cache.promise;
  // Persist a random signing key in the private database: staff only set a password.
  const promise = storedSecret(env, "signing_secret").then((secret) =>
    crypto.subtle.importKey(
      "raw",
      encoder.encode(secret + ":" + env.TEACHER_PASSWORD),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    ),
  );
  keyCache.set(env.DB, { password: env.TEACHER_PASSWORD, promise });
  return promise;
}
export async function sign(env, value) {
  const data = b64(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign("HMAC", await key(env), encoder.encode(data));
  return data + "." + b64(new Uint8Array(signature));
}
export async function verify(env, token, kind) {
  if (typeof token !== "string" || token.length > 4000) return null;
  try {
    const parts = token.split(".");
    if (
      parts.length !== 2 ||
      !(await crypto.subtle.verify("HMAC", await key(env), unb64(parts[1]), encoder.encode(parts[0])))
    )
      return null;
    const value = JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    return value.kind === kind && value.exp > Date.now() ? value : null;
  } catch {
    return null;
  }
}
export async function passwordMatches(env, supplied) {
  if (typeof supplied !== "string" || supplied.length > 256) return false;
  const k = await key(env);
  const [actual, expected] = await Promise.all(
    [supplied, env.TEACHER_PASSWORD].map((text) => crypto.subtle.sign("HMAC", k, encoder.encode("password:" + text))),
  );
  const a = new Uint8Array(actual),
    b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) failure("Open the BNTS site to submit this request.", 403);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site")
    failure("Open the BNTS site to submit this request.", 403);
}

// Sessions -------------------------------------------------------------------

/** On HTTPS the __Host- prefix stops other subdomains from setting or overriding the session cookie. */
export const cookieName = (request) => (new URL(request.url).protocol === "https:" ? "__Host-" : "") + COOKIE_NAME;
function readCookie(request, name) {
  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export function newSession(extra = {}) {
  const now = Date.now();
  return {
    kind: "teacher",
    id: crypto.randomUUID(),
    csrf: crypto.randomUUID() + crypto.randomUUID(),
    iat: now,
    exp: now + 8 * 3600000,
    ...extra,
  };
}
export async function teacherSession(env, request) {
  const session = await verify(env, readCookie(request, cookieName(request)), "teacher");
  if (!session) failure("Please sign in to the teacher console.", 401);
  // One query checks both a single sign-out and "sign out everywhere".
  const state = await env.DB.prepare(
    "SELECT (SELECT 1 FROM revoked_sessions WHERE id=?) AS revoked, (SELECT value FROM app_meta WHERE key='sessions_valid_after') AS after",
  )
    .bind(session.id)
    .first();
  if (state?.revoked || (state?.after && (session.iat || 0) < JSON.parse(state.after)))
    failure("Please sign in to the teacher console.", 401);
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    sameOrigin(request);
    if (request.headers.get("X-CSRF-Token") !== session.csrf) failure("Session check failed. Refresh this page.", 403);
  }
  return session;
}
export function sessionCookie(request, token, clear = false) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request)}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 8 * 3600}${secure}`;
}

// Networks and rate limits -----------------------------------------------------

/**
 * The network a request comes from. IPv6 is grouped by /64, because one home or school
 * connection usually controls a whole /64 and could otherwise rotate addresses freely.
 */
export function networkOf(ip) {
  if (!ip || !ip.includes(":")) return ip || "local";
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is really an IPv4 address.
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [],
    right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return (
    groups
      .slice(0, 4)
      .map((group) => group.replace(/^0+(?=.)/, ""))
      .join(":") + "::/64"
  );
}
/** A salted, one-way key for the request's network. Raw IP addresses are never stored. */
export async function clientKey(env, request) {
  let salt = saltCache.get(env.DB);
  if (!salt) {
    salt = storedSecret(env, "network_salt").then((value) =>
      crypto.subtle.importKey("raw", encoder.encode(value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    );
    saltCache.set(env.DB, salt);
  }
  const network = networkOf(request.headers.get("CF-Connecting-IP"));
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", await salt, encoder.encode(network)))).slice(0, 22);
}
/** Adds `amount` to a fixed-window counter and rejects the request once it goes over `limit`. */
export async function rateLimit(env, key, limit, windowSeconds, { amount = 1, message } = {}) {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const value = await env.DB.prepare(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+excluded.count RETURNING count",
  )
    .bind(key + ":" + window, amount, (window + 1) * windowSeconds * 1000)
    .first();
  if (value.count > limit) failure(message || "Too many requests. Please wait before trying again.", 429);
}
// Failed sign-ins ---------------------------------------------------------------
// Only failures count, so a teacher who signs in correctly is never slowed down.
// With a 12+ character password, 200 guesses an hour site-wide makes guessing hopeless.
// Failures are kept in one-minute buckets and the last 15 (or 60) are added up. Unlike fixed
// 15-minute blocks, there is no boundary an attacker can straddle to get extra guesses.
export const LOGIN_LIMITS = { perNetwork: 5, networkMinutes: 15, global: 200, globalMinutes: 60 };
const LOCKED = "Too many incorrect passwords. Wait 15 minutes, then try again.";
const minuteNow = () => Math.floor(Date.now() / 60000);
async function recentFailures(env, key, minutes) {
  const now = minuteNow();
  const keys = Array.from({ length: minutes }, (_, i) => `${key}:m${now - i}`);
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(count),0) AS n FROM rate_limits WHERE key IN (${keys.map(() => "?").join(",")})`,
  )
    .bind(...keys)
    .first();
  return row.n;
}
export async function checkLoginAllowed(env, network) {
  const [mine, everyone] = await Promise.all([
    recentFailures(env, "login-fail:" + network, LOGIN_LIMITS.networkMinutes),
    recentFailures(env, "login-fail:global", LOGIN_LIMITS.globalMinutes),
  ]);
  if (mine >= LOGIN_LIMITS.perNetwork || everyone >= LOGIN_LIMITS.global) failure(LOCKED, 429);
}
export async function recordLoginFailure(env, network) {
  const now = minuteNow();
  await env.DB.batch(
    [
      ["login-fail:" + network, LOGIN_LIMITS.networkMinutes],
      ["login-fail:global", LOGIN_LIMITS.globalMinutes],
    ].map(([name, minutes]) =>
      env.DB.prepare(
        "INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      ).bind(`${name}:m${now}`, (now + minutes + 1) * 60000),
    ),
  );
  // A short pause slows scripted guessing without bothering a person who mistyped.
  await sleep(400);
}

// Cloudflare Access ---------------------------------------------------------------
// When ACCESS_TEAM_DOMAIN and ACCESS_AUD are set, every staff page and staff API call must carry a
// valid Cloudflare Access token. This also protects the workers.dev address, which Access rules on a
// custom domain do not cover.

export function accessSettings(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const aud = String(env.ACCESS_AUD || "").trim();
  return { team, aud, enabled: !!(team || aud) };
}
async function accessKey(team, kid, refresh = false) {
  let cached = accessKeyCache.get(team);
  if (!cached || refresh || cached.expires < Date.now()) {
    const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!response.ok) failure("Cloudflare Access could not be checked. Try again shortly.", 503);
    const { keys = [] } = await response.json();
    cached = { keys, expires: Date.now() + 10 * 60 * 1000 };
    accessKeyCache.set(team, cached);
  }
  const jwk = cached.keys.find((k) => k.kid === kid);
  if (!jwk) return refresh ? null : accessKey(team, kid, true);
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
/** Returns the signed-in Access identity, null when Access is not configured, or throws. */
export async function requireAccess(env, request) {
  const { team, aud, enabled } = accessSettings(env);
  if (!enabled) return null;
  if (!team || !aud)
    failure("Cloudflare Access is only partly set up. Add both ACCESS_TEAM_DOMAIN and ACCESS_AUD.", 503);
  const denied = () => failure("Sign in with your school account to open the staff pages.", 403);
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || readCookie(request, "CF_Authorization");
  if (!token || token.length > 8000) denied();
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) denied();
  let head, claims;
  try {
    head = JSON.parse(new TextDecoder().decode(unb64(header)));
    claims = JSON.parse(new TextDecoder().decode(unb64(payload)));
  } catch {
    denied();
  }
  if (head.alg !== "RS256" || typeof head.kid !== "string") denied();
  const publicKey = await accessKey(team, head.kid);
  if (
    !publicKey ||
    !(await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      unb64(signature),
      encoder.encode(header + "." + payload),
    ))
  )
    denied();
  const now = Date.now() / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !audiences.includes(aud) ||
    claims.iss !== `https://${team}` ||
    !(claims.exp > now) ||
    (claims.nbf && claims.nbf > now + 60)
  )
    denied();
  return { email: typeof claims.email === "string" ? claims.email.slice(0, 200) : "" };
}

// Activity log ----------------------------------------------------------------------

/** Records a staff or security event. Kept for 30 days; shown to teachers in Settings. */
export async function audit(env, request, event, detail = "") {
  const source = request ? (await clientKey(env, request)).slice(0, 6) : "";
  await env.DB.prepare("INSERT INTO audit_log(at,event,detail,source) VALUES (?,?,?,?)")
    .bind(Date.now(), event, String(detail).slice(0, 200), source)
    .run();
}
export async function recentActivity(env, limit = 25) {
  const { results } = await env.DB.prepare(
    "SELECT at,event,detail,source FROM audit_log ORDER BY at DESC, id DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return results.map((row) => ({ ...row, at: new Date(row.at).toISOString() }));
}
