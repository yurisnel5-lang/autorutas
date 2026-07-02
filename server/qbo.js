// qbo.js
// Integración con QuickBooks Online usando únicamente `fetch` (incluido en Node).
// No depende de paquetes externos (evita problemas de instalación/red).
//
// Flujo:
//  1. El admin llena un formulario (Client ID, Client Secret, entorno) -> guardamos en store.
//  2. El admin pulsa "Conectar con QuickBooks" -> lo mandamos a buildAuthorizeUrl().
//  3. Intuit redirige de vuelta a /api/qbo/callback?code=...&realmId=...
//  4. exchangeCodeForTokens() guarda access/refresh token en store.
//  5. fetchInvoicesForDate() se usa cada día para traer las facturas.

const store = require('./store');

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SCOPE = 'com.intuit.quickbooks.accounting';

function apiBase(environment) {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function buildAuthorizeUrl(redirectUri, state) {
  const { config } = store.get();
  const params = new URLSearchParams({
    client_id: config.qbo.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

async function exchangeCodeForTokens({ code, realmId, redirectUri }) {
  const { config } = store.get();
  const basic = Buffer.from(`${config.qbo.clientId}:${config.qbo.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString()
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error('Error al intercambiar el código de QuickBooks: ' + JSON.stringify(data));
  }
  store.update((s) => {
    s.config.qbo.realmId = realmId;
    s.config.qbo.accessToken = data.access_token;
    s.config.qbo.refreshToken = data.refresh_token;
    s.config.qbo.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    s.config.qbo.connected = true;
    s.config.demoMode = false;
  });
  return data;
}

async function refreshTokens() {
  const { config } = store.get();
  if (!config.qbo.refreshToken) throw new Error('No hay refresh token de QuickBooks guardado.');
  const basic = Buffer.from(`${config.qbo.clientId}:${config.qbo.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.qbo.refreshToken
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString()
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error('Error al refrescar el token de QuickBooks: ' + JSON.stringify(data));
  }
  store.update((s) => {
    s.config.qbo.accessToken = data.access_token;
    s.config.qbo.refreshToken = data.refresh_token || s.config.qbo.refreshToken;
    s.config.qbo.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  });
  return data;
}

async function ensureValidToken() {
  const { config } = store.get();
  if (!config.qbo.connected) throw new Error('QuickBooks no está conectado todavía.');
  if (Date.now() >= config.qbo.tokenExpiresAt) {
    await refreshTokens();
  }
  return store.get().config.qbo.accessToken;
}

// Construye la dirección de envío (o de facturación como respaldo) en un solo string.
function addressFromInvoice(invoice) {
  const addr = invoice.ShipAddr || invoice.BillAddr;
  if (!addr) return null;
  const parts = [addr.Line1, addr.Line2, addr.City, addr.CountrySubDivisionCode, addr.PostalCode]
    .filter(Boolean);
  return parts.join(', ');
}

async function fetchInvoicesForDate(dateStr) {
  const { config } = store.get();
  const token = await ensureValidToken();
  const query = `SELECT * FROM Invoice WHERE TxnDate = '${dateStr}' MAXRESULTS 200`;
  const url = `${apiBase(config.qbo.environment)}/v3/company/${config.qbo.realmId}/query?query=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error('Error al consultar invoices en QuickBooks: ' + JSON.stringify(data));
  }
  const invoices = (data.QueryResponse && data.QueryResponse.Invoice) || [];
  return invoices.map((inv) => ({
    id: inv.Id,
    docNumber: inv.DocNumber || inv.Id,
    customerName: inv.CustomerRef ? inv.CustomerRef.name : 'Cliente',
    totalAmt: inv.TotalAmt || 0,
    address: addressFromInvoice(inv),
    postalCode: (inv.ShipAddr || inv.BillAddr || {}).PostalCode || ''
  })).filter((inv) => inv.address); // descarta facturas sin dirección utilizable
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
  ensureValidToken,
  fetchInvoicesForDate,
  apiBase
};

