// zones.js
// Clasifica cada factura como "norte" o "sur".
//
// Regla principal (rápida, sin costo de API): en Miami las direcciones incluyen
// el cuadrante en el propio nombre de la calle, tomando la Flagler St como la
// línea base que separa Norte/Sur:
//   NW (Northwest) y NE (Northeast)  -> Norte
//   SW (Southwest) y SE (Southeast)  -> Sur
//
// Reglas de respaldo, en este orden:
//   1. Código postal forzado manualmente en la configuración (zipNorth/zipSouth).
//   2. Geocodificar la dirección y comparar su latitud con la latitud de Flagler St.
//   3. Si todo falla, se marca como "sin-zona" para revisión manual del admin.

const store = require('./store');
const { geocodeAddress, getFlaglerLatitude } = require('./geocode');

const QUADRANT_REGEX = /\b(N\.?W\.?|N\.?E\.?|S\.?W\.?|S\.?E\.?)\b/i;

function quadrantFromAddress(address) {
  const match = address.match(QUADRANT_REGEX);
  if (!match) return null;
  const token = match[1].replace(/\./g, '').toUpperCase();
  if (token === 'NW' || token === 'NE') return 'norte';
  if (token === 'SW' || token === 'SE') return 'sur';
  return null;
}

function zoneFromZip(postalCode) {
  if (!postalCode) return null;
  const { config } = store.get();
  const zip = String(postalCode).trim();
  if (config.zoneRule.zipNorth.includes(zip)) return 'norte';
  if (config.zoneRule.zipSouth.includes(zip)) return 'sur';
  return null;
}

async function classifyInvoice(invoice) {
  // 1. código postal forzado manualmente
  const byZip = zoneFromZip(invoice.postalCode);
  if (byZip) return { ...invoice, zone: byZip, zoneMethod: 'codigo_postal' };

  // 2. patrón de cuadrante Miami (NW/NE/SW/SE) directamente en el texto
  const byQuadrant = quadrantFromAddress(invoice.address);
  if (byQuadrant) return { ...invoice, zone: byQuadrant, zoneMethod: 'cuadrante_direccion' };

  // 3. respaldo: geocodificar y comparar latitud contra Flagler St
  try {
    const [loc, flaglerLat] = await Promise.all([
      geocodeAddress(invoice.address),
      getFlaglerLatitude()
    ]);
    const zone = loc.lat >= flaglerLat ? 'norte' : 'sur';
    return { ...invoice, zone, zoneMethod: 'geocodificacion', lat: loc.lat, lng: loc.lng };
  } catch (err) {
    return { ...invoice, zone: 'sin-zona', zoneMethod: 'error', zoneError: err.message };
  }
}

async function classifyInvoices(invoices) {
  const results = [];
  for (const inv of invoices) {
    // secuencial para no exceder límites de la API de geocodificación
    results.push(await classifyInvoice(inv));
  }
  return results;
}

module.exports = { classifyInvoice, classifyInvoices, quadrantFromAddress };

