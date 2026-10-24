// admin/lib/auth.js
// No login when running on your own computer (the server only listens on localhost).
// Set ADMIN_PASSWORD when the admin runs on a public host and it asks for it.

const crypto = require('crypto');

const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = crypto.createHash('sha256').update(`ae-admin:${PASSWORD}:${process.env.SESSION_SECRET || ''}`).digest();
const COOKIE = 'ae_admin';
const MAX_AGE_S = 60 * 60 * 24 * 30;

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

function token() {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
  return `${exp}.${sign(exp)}`;
}

function valid(tok) {
  const [exp, sig] = String(tok || '').split('.');
  if (!exp || !sig) return false;
  const good = sign(exp);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  return Number(exp) > Date.now() / 1000;
}

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

const enabled = () => !!PASSWORD;
const isAuthed = (req) => !enabled() || valid(readCookie(req));

function login(req, res) {
  const given = String((req.body && req.body.password) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  if (!enabled() || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong password.' });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
}

function logout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
}

// Protects /api/* (except login/me).
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Please log in.', login: true });
}

module.exports = { enabled, isAuthed, login, logout, requireAuth };
