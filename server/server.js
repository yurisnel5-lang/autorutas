// server.js
// Servidor HTTP con únicamente módulos nativos de Node (http, fs, crypto, url).
// Sin Express ni otras dependencias: así la app corre en cualquier lugar con
// solo `node server/server.js`, sin depender de `npm install` funcionando.

require('./dotenv-lite')(); // mini-loader de .env, sin dependencias externas

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const auth = require('./auth');
const qbo = require('./qbo');
const { runDailyImport, todayStr, findDefaultDriver } = require('./pipeline');
const scheduler = require('./scheduler');

store.load();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------- utilidades ----------

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Cuerpo de la petición demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, relativePath) {
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('No encontrado');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function publicConfig() {
  const { config } = store.get();
  return {
    businessName: config.businessName,
    originAddress: config.originAddress,
    dailyRunTime: config.dailyRunTime,
    googleMapsApiKeySet: !!config.googleMapsApiKey,
    googleMapsApiKey: config.googleMapsApiKey, // necesaria en el navegador para pintar el mapa
    demoMode: config.demoMode,
    zoneRule: config.zoneRule,
    qbo: {
      clientId: config.qbo.clientId,
      clientSecretSet: !!config.qbo.clientSecret,
      environment: config.qbo.environment,
      realmId: config.qbo.realmId,
      connected: config.qbo.connected
    },
    adminPasswordConfigured: !!config.adminPasswordHash
  };
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Estado efímero solo para validar el "state" del flujo OAuth de QuickBooks.
let pendingOAuthState = null;

// ---------- servidor ----------

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // ---------- API ----------
    if (pathname.startsWith('/api/')) {
      // ----- setup inicial de contraseña de admin (solo si aún no existe) -----
      if (pathname === '/api/setup-admin' && method === 'POST') {
        const { config } = store.get();
        if (config.adminPasswordHash) return sendJson(res, 400, { error: 'El administrador ya fue configurado.' });
        const body = await readJsonBody(req);
        if (!body.password || body.password.length < 6) {
          return sendJson(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres.' });
        }
        store.update((s) => { s.config.adminPasswordHash = auth.hashPassword(body.password); });
        const sid = auth.createSession();
        res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=${sid}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/login' && method === 'POST') {
        const { config } = store.get();
        const body = await readJsonBody(req);
        if (!config.adminPasswordHash) return sendJson(res, 400, { error: 'Aún no se ha configurado la contraseña de administrador.' });
        if (!auth.verifyPassword(body.password || '', config.adminPasswordHash)) {
          return sendJson(res, 401, { error: 'Contraseña incorrecta' });
        }
        const sid = auth.createSession();
        res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=${sid}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/logout' && method === 'POST') {
        const cookies = auth.parseCookies(req);
        if (cookies[auth.SESSION_COOKIE]) auth.destroySession(cookies[auth.SESSION_COOKIE]);
        res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/session' && method === 'GET') {
        const cookies = auth.parseCookies(req);
        const { config } = store.get();
        return sendJson(res, 200, {
          authenticated: auth.isValidSession(cookies[auth.SESSION_COOKIE]),
          adminPasswordConfigured: !!config.adminPasswordHash
        });
      }

      // ----- callback de OAuth de QuickBooks (Intuit redirige aquí; no requiere cookie) -----
      if (pathname === '/api/qbo/callback' && method === 'GET') {
        const code = parsedUrl.searchParams.get('code');
        const realmId = parsedUrl.searchParams.get('realmId');
        const state = parsedUrl.searchParams.get('state');
        if (!code || !realmId) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<h1>Faltan parámetros en la respuesta de QuickBooks.</h1>');
        }
        if (!pendingOAuthState || pendingOAuthState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<h1>El estado de la autorización no es válido o expiró. Intenta conectar de nuevo desde Ajustes.</h1>');
        }
        try {
          const { config } = store.get();
          await qbo.exchangeCodeForTokens({ code, realmId, redirectUri: config.qbo.redirectUri });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<h1>¡QuickBooks conectado correctamente!</h1><p>Puedes cerrar esta ventana y volver al panel de administrador.</p>');
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(`<h1>Error al conectar QuickBooks</h1><p>${err.message}</p>`);
        }
      }

      // ----- endpoints del chofer (autenticados por token, no por sesión) -----
      if (pathname === '/api/driver/route' && method === 'GET') {
        const token = parsedUrl.searchParams.get('token');
        const { drivers, dailyRoutes } = store.get();
        const driver = drivers.find((d) => d.token === token);
        if (!driver) return sendJson(res, 404, { error: 'Chofer no encontrado (link inválido).' });
        const date = parsedUrl.searchParams.get('date') || todayStr();
        const dayRoute = dailyRoutes[date];
        let zoneData = null;
        let zoneName = null;
        if (dayRoute) {
          for (const zone of ['norte', 'sur']) {
            if (dayRoute.zones[zone] && dayRoute.zones[zone].driverId === driver.id) {
              zoneData = dayRoute.zones[zone];
              zoneName = zone;
            }
          }
        }
        return sendJson(res, 200, { driver: { id: driver.id, name: driver.name, zoneDefault: driver.zoneDefault }, date, zone: zoneName, route: zoneData });
      }

      if (pathname === '/api/driver/location' && method === 'POST') {
        const body = await readJsonBody(req);
        const { drivers } = store.get();
        const driver = drivers.find((d) => d.token === body.token);
        if (!driver) return sendJson(res, 404, { error: 'Chofer no encontrado' });
        store.update((s) => {
          s.driverLocations[driver.id] = { lat: body.lat, lng: body.lng, updatedAt: Date.now() };
        });
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/driver/stop-status' && method === 'POST') {
        const body = await readJsonBody(req);
        const { drivers } = store.get();
        const driver = drivers.find((d) => d.token === body.token);
        if (!driver) return sendJson(res, 404, { error: 'Chofer no encontrado' });
        const date = body.date || todayStr();
        store.update((s) => {
          const dayRoute = s.dailyRoutes[date];
          if (!dayRoute) return;
          const zoneData = dayRoute.zones[body.zone];
          if (!zoneData) return;
          const stop = zoneData.stops.find((st) => st.id === body.stopId);
          if (stop) stop.status = body.status;
        });
        return sendJson(res, 200, { ok: true });
      }

      // ----- a partir de aquí, todo requiere sesión de administrador -----
      if (!auth.requireAuth(req, res)) return;

      if (pathname === '/api/config' && method === 'GET') {
        return sendJson(res, 200, publicConfig());
      }

      if (pathname === '/api/config' && method === 'POST') {
        const body = await readJsonBody(req);
        store.update((s) => {
          if (body.businessName !== undefined) s.config.businessName = body.businessName;
          if (body.originAddress !== undefined) s.config.originAddress = body.originAddress;
          if (body.dailyRunTime !== undefined) s.config.dailyRunTime = body.dailyRunTime;
          if (body.googleMapsApiKey) s.config.googleMapsApiKey = body.googleMapsApiKey;
          if (body.demoMode !== undefined) s.config.demoMode = !!body.demoMode;
          if (body.zoneRule) {
            s.config.zoneRule.divider = body.zoneRule.divider ?? s.config.zoneRule.divider;
            s.config.zoneRule.useQuadrantHeuristic = body.zoneRule.useQuadrantHeuristic ?? s.config.zoneRule.useQuadrantHeuristic;
            if (Array.isArray(body.zoneRule.zipNorth)) s.config.zoneRule.zipNorth = body.zoneRule.zipNorth;
            if (Array.isArray(body.zoneRule.zipSouth)) s.config.zoneRule.zipSouth = body.zoneRule.zipSouth;
          }
          if (body.qbo) {
            if (body.qbo.clientId !== undefined) s.config.qbo.clientId = body.qbo.clientId;
            if (body.qbo.clientSecret) s.config.qbo.clientSecret = body.qbo.clientSecret;
            if (body.qbo.environment) s.config.qbo.environment = body.qbo.environment;
          }
        });
        scheduler.reschedule();
        return sendJson(res, 200, publicConfig());
      }

      // ----- conexión manual con QuickBooks (formulario -> botón "Conectar") -----
      if (pathname === '/api/qbo/connect' && method === 'POST') {
        const { config } = store.get();
        if (!config.qbo.clientId || !config.qbo.clientSecret) {
          return sendJson(res, 400, { error: 'Primero guarda el Client ID y Client Secret de tu app de Intuit Developer.' });
        }
        const redirectUri = `${baseUrl(req)}/api/qbo/callback`;
        store.update((s) => { s.config.qbo.redirectUri = redirectUri; });
        pendingOAuthState = crypto.randomBytes(12).toString('hex');
        const url = qbo.buildAuthorizeUrl(redirectUri, pendingOAuthState);
        return sendJson(res, 200, { authorizeUrl: url });
      }

      if (pathname === '/api/qbo/disconnect' && method === 'POST') {
        store.update((s) => {
          s.config.qbo.connected = false;
          s.config.qbo.accessToken = '';
          s.config.qbo.refreshToken = '';
          s.config.demoMode = true;
        });
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/drivers' && method === 'GET') {
        const { drivers } = store.get();
        return sendJson(res, 200, drivers.map((d) => ({ ...d })));
      }

      if (pathname === '/api/drivers' && method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.name) return sendJson(res, 400, { error: 'El chofer necesita un nombre.' });
        const driver = {
          id: store.newId(),
          name: body.name,
          phone: body.phone || '',
          zoneDefault: body.zoneDefault || null, // 'norte' | 'sur' | null
          token: store.newToken()
        };
        store.update((s) => { s.drivers.push(driver); });
        return sendJson(res, 200, driver);
      }

      const driverMatch = pathname.match(/^\/api\/drivers\/([a-f0-9]+)$/);
      if (driverMatch && method === 'PUT') {
        const body = await readJsonBody(req);
        let updated = null;
        store.update((s) => {
          const d = s.drivers.find((x) => x.id === driverMatch[1]);
          if (!d) return;
          if (body.name !== undefined) d.name = body.name;
          if (body.phone !== undefined) d.phone = body.phone;
          if (body.zoneDefault !== undefined) d.zoneDefault = body.zoneDefault;
          updated = d;
        });
        if (!updated) return sendJson(res, 404, { error: 'Chofer no encontrado' });
        return sendJson(res, 200, updated);
      }

      if (driverMatch && method === 'DELETE') {
        store.update((s) => { s.drivers = s.drivers.filter((x) => x.id !== driverMatch[1]); });
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/drivers/locations' && method === 'GET') {
        const { driverLocations, drivers } = store.get();
        const out = drivers.map((d) => ({
          id: d.id,
          name: d.name,
          zoneDefault: d.zoneDefault,
          location: driverLocations[d.id] || null
        }));
        return sendJson(res, 200, out);
      }

      if (pathname.match(/^\/api\/drivers\/[a-f0-9]+\/link$/) && method === 'GET') {
        const id = pathname.split('/')[3];
        const { drivers } = store.get();
        const driver = drivers.find((d) => d.id === id);
        if (!driver) return sendJson(res, 404, { error: 'No encontrado' });
        return sendJson(res, 200, { url: `${baseUrl(req)}/driver/index.html?token=${driver.token}` });
      }

      if (pathname === '/api/routes/run-now' && method === 'POST') {
        try {
          const result = await runDailyImport();
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 500, { error: err.message });
        }
      }

      const routeMatch = pathname.match(/^\/api\/routes\/(\d{4}-\d{2}-\d{2})$/);
      if (routeMatch && method === 'GET') {
        const { dailyRoutes } = store.get();
        const data = dailyRoutes[routeMatch[1]];
        if (!data) return sendJson(res, 404, { error: 'No hay ruta calculada para esa fecha todavía.' });
        return sendJson(res, 200, data);
      }

      if (pathname === '/api/routes/today' && method === 'GET') {
        const { dailyRoutes } = store.get();
        const data = dailyRoutes[todayStr()];
        return sendJson(res, 200, data || { date: todayStr(), zones: {}, totalInvoices: 0 });
      }

      const assignMatch = pathname.match(/^\/api\/routes\/(\d{4}-\d{2}-\d{2})\/(norte|sur)\/assign$/);
      if (assignMatch && method === 'POST') {
        const body = await readJsonBody(req);
        let ok = false;
        store.update((s) => {
          const dayRoute = s.dailyRoutes[assignMatch[1]];
          if (!dayRoute || !dayRoute.zones[assignMatch[2]]) return;
          dayRoute.zones[assignMatch[2]].driverId = body.driverId || null;
          ok = true;
        });
        if (!ok) return sendJson(res, 404, { error: 'Ruta no encontrada' });
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/invoice-history' && method === 'GET') {
        const { invoiceHistory } = store.get();
        return sendJson(res, 200, invoiceHistory.slice(-60).reverse());
      }

      return sendJson(res, 404, { error: 'Ruta de API no encontrada' });
    }

    // ---------- archivos estáticos ----------
    if (pathname === '/' || pathname === '') {
      res.writeHead(302, { Location: '/admin/index.html' });
      return res.end();
    }
    if (pathname.startsWith('/admin') || pathname.startsWith('/driver')) {
      const rel = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
      return serveStatic(req, res, rel);
    }
    if (pathname === '/shared.css') {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('No encontrado');
  } catch (err) {
    console.error('Error no controlado:', err);
    sendJson(res, 500, { error: 'Error interno del servidor', detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`AutoRutas escuchando en http://localhost:${PORT}`);
  scheduler.scheduleNext();
});

module.exports = server;

