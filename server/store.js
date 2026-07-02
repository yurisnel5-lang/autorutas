// store.js
// Almacén simple basado en un archivo JSON. No requiere dependencias externas
// ni un motor de base de datos: perfecto para una PYME con volumen moderado
// de facturas/choferes por día. Escritura atómica (archivo temporal + rename)
// para evitar corrupción si el proceso se reinicia a mitad de una escritura.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// En producción (Render, Railway, etc.) conviene apuntar DATA_DIR a un disco
// persistente (ej. /var/data) para que la configuración y el historial no se
// pierdan al reiniciar o redesplegar el servicio. Si no se define, usa una
// carpeta local (perfecto para correrlo en una sola computadora).
const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function defaultState() {
  return {
    config: {
      businessName: 'Mi Negocio',
      originAddress: '', // punto de partida de las rutas (dirección del negocio/almacén)
      dailyRunTime: '06:00', // hora local en la que corre la automatización diaria
      googleMapsApiKey: '',
      qbo: {
        clientId: '',
        clientSecret: '',
        environment: 'sandbox', // 'sandbox' | 'production'
        realmId: '',
        accessToken: '',
        refreshToken: '',
        tokenExpiresAt: 0,
        connected: false,
        redirectUri: '' // se autocompleta con la URL pública del servidor
      },
      zoneRule: {
        // La app es genérica para cualquier compañía de entregas/ciudad, no solo Miami.
        // "divider" es la dirección/calle que se usa como línea divisoria Norte/Sur
        // (se geocodifica una vez y se compara la latitud de cada factura contra ella).
        // Por defecto viene con un ejemplo de Miami (Flagler St), pero cada negocio
        // debe configurar la calle divisoria de SU propia ciudad en Ajustes.
        divider: 'Flagler St, Miami, FL',
        // Heurística opcional y gratuita: si las direcciones ya incluyen el cuadrante
        // en el texto (NW/NE/SW/SE, típico de Miami y otras ciudades en cuadrícula),
        // se usa eso primero y se evita geocodificar. Se puede desactivar si el
        // negocio no usa ese formato de direcciones.
        useQuadrantHeuristic: true,
        zipNorth: [], // opcional: lista de códigos postales forzados a Norte
        zipSouth: []  // opcional: lista de códigos postales forzados a Sur
      },
      demoMode: true, // mientras QBO no esté conectado, usar datos de ejemplo
      adminPasswordHash: '' // se define en el primer arranque
    },
    drivers: [], // { id, name, phone, zoneDefault: 'norte'|'sur'|null, token }
    dailyRoutes: {}, // fecha (YYYY-MM-DD) -> { norte: {...}, sur: {...} }
    driverLocations: {}, // driverId -> { lat, lng, updatedAt }
    invoiceHistory: [], // registro de invoices importadas (para auditoría)
    sessions: {} // sessionId -> { createdAt }
  };
}

let state = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    state = defaultState();
    save();
    return state;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    state = JSON.parse(raw);
    // fusiona con defaults por si se agregaron campos nuevos en una actualización
    state = deepMerge(defaultState(), state);
  } catch (err) {
    console.error('No se pudo leer data/db.json, se crea uno nuevo. Detalle:', err.message);
    state = defaultState();
    save();
  }
  return state;
}

function deepMerge(base, override) {
  if (Array.isArray(base)) return override !== undefined ? override : base;
  if (typeof base === 'object' && base !== null) {
    const out = { ...base };
    for (const key of Object.keys(override || {})) {
      out[key] = typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])
        ? deepMerge(base[key], override[key])
        : (override[key] !== undefined ? override[key] : base[key]);
    }
    return out;
  }
  return override !== undefined ? override : base;
}

function save() {
  ensureDataDir();
  const tmp = DB_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function get() {
  if (!state) load();
  return state;
}

function update(mutatorFn) {
  if (!state) load();
  mutatorFn(state);
  save();
  return state;
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { load, save, get, update, newId, newToken, DATA_DIR, DB_FILE };

