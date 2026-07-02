// geocode.js
// Wrapper mínimo sobre la API de Geocodificación de Google, con caché en memoria
// (y persistida en el store) para no volver a geocodificar la misma dirección.

const store = require('./store');

const cache = new Map(); // direccion -> {lat, lng}

async function geocodeAddress(address) {
  if (cache.has(address)) return cache.get(address);
  const { config } = store.get();
  if (!config.googleMapsApiKey) {
    throw new Error('Falta configurar la API key de Google Maps.');
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${config.googleMapsApiKey}`;
  const resp = await fetch(url);
  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`No se pudo contactar la API de Google Geocoding (HTTP ${resp.status}). Verifica conectividad de red del servidor y la API key.`);
  }
  if (data.status !== 'OK' || !data.results || !data.results.length) {
    throw new Error(`No se pudo geocodificar "${address}" (status: ${data.status})`);
  }
  const loc = data.results[0].geometry.location; // { lat, lng }
  cache.set(address, loc);
  return loc;
}

let flaglerLat = null;
async function getFlaglerLatitude() {
  if (flaglerLat !== null) return flaglerLat;
  const { config } = store.get();
  const divider = config.zoneRule.divider || 'Flagler St, Miami, FL';
  const loc = await geocodeAddress(divider);
  flaglerLat = loc.lat;
  return flaglerLat;
}

module.exports = { geocodeAddress, getFlaglerLatitude };

