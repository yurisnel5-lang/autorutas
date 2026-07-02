// auth.js
// Autenticación mínima para el panel de administrador (sin dependencias externas).
// - Contraseña de admin con hash (scrypt) guardada en el store.
// - Sesión simple: id aleatorio guardado en el store + cookie httpOnly.
// Los choferes NO usan esta autenticación: cada uno tiene un link único con un
// token (ver drivers.token) que abren en su teléfono.

const crypto = require('crypto');
const store = require('./store');

const SESSION_COOKIE = 'autorutas_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function createSession() {
  const id = crypto.randomBytes(24).toString('hex');
  store.update((s) => {
    s.sessions[id] = { createdAt: Date.now() };
  });
  return id;
}

function isValidSession(id) {
  if (!id) return false;
  const { sessions } = store.get();
  const session = sessions[id];
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    store.update((s) => { delete s.sessions[id]; });
    return false;
  }
  return true;
}

function destroySession(id) {
  store.update((s) => { delete s.sessions[id]; });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (!isValidSession(sid)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No autenticado' }));
    return false;
  }
  return true;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  isValidSession,
  destroySession,
  parseCookies,
  requireAuth
};

