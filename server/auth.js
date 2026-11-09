import { createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
export function createAuth({ password, secret, production }) {
  const cookieName = 'bnts_teacher';
  const passwordHash = scryptSync(password, 'bnts-teacher-password-v1', 64);
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  const pack = value => { const data = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${data}.${sign(data)}`; };
  const unpack = token => {
    if (!token || token.length > 4000) return null;
    try { const [value, signature] = token.split('.'); const expected = sign(value); if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; const result = JSON.parse(Buffer.from(value, 'base64url').toString()); return result.exp > Date.now() ? result : null; } catch { return null; }
  };
  const options = { httpOnly: true, secure: production, sameSite: 'lax', path: '/' };
  const check = (req, res, next) => {
    const session = unpack(req.cookies[cookieName]);
    if (!session || session.kind !== 'teacher') return res.status(401).json({ error: 'Please sign in to the teacher console.' });
    req.session = session;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-CSRF-Token') !== session.csrf) return res.status(403).json({ error: 'Session check failed. Refresh this page.' });
    next();
  };
  return {
    pack, unpack, check,
    login(req, res) {
      const input = req.body?.password;
      if (typeof input !== 'string' || input.length > 256 || !timingSafeEqual(scryptSync(input, 'bnts-teacher-password-v1', 64), passwordHash)) return res.status(401).json({ error: 'That password is not correct.' });
      const csrf = randomBytes(24).toString('hex');
      res.cookie(cookieName, pack({ kind: 'teacher', csrf, exp: Date.now() + 8 * 3600000 }), { ...options, maxAge: 8 * 3600000 });
      res.json({ csrf });
    },
    logout(req, res) { res.clearCookie(cookieName, options); res.json({ ok: true }); },
    oauthCookieOptions: { ...options, maxAge: 600000 },
  };
}
