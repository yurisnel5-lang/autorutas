// pipeline.js
// Orquesta el proceso diario completo:
//   1) Importar las facturas del día (QuickBooks real o datos demo)
//   2) Clasificarlas en zona Norte / Sur
//   3) Optimizar el orden de las paradas de cada zona (Google Maps)
//   4) Asignar automáticamente al chofer predeterminado de cada zona
//   5) Guardar el resultado para que el admin y los choferes lo vean

const store = require('./store');
const qbo = require('./qbo');
const { demoInvoicesForDate } = require('./demoData');
const { classifyInvoices } = require('./zones');
const { optimizeStops } = require('./routeOptimizer');

function todayStr(tz) {
  // Fecha local en formato YYYY-MM-DD
  const now = new Date();
  return now.toLocaleDateString('sv-SE'); // 'sv-SE' produce formato ISO YYYY-MM-DD
}

function findDefaultDriver(zone) {
  const { drivers } = store.get();
  return drivers.find((d) => d.zoneDefault === zone) || null;
}

async function runDailyImport(dateStr) {
  const date = dateStr || todayStr();
  const { config } = store.get();

  let invoices;
  if (config.demoMode || !config.qbo.connected) {
    invoices = demoInvoicesForDate(date);
  } else {
    invoices = await qbo.fetchInvoicesForDate(date);
  }

  const classified = await classifyInvoices(invoices);

  const byZone = { norte: [], sur: [], 'sin-zona': [] };
  for (const inv of classified) {
    (byZone[inv.zone] || byZone['sin-zona']).push(inv);
  }

  const result = {
    date,
    computedAt: new Date().toISOString(),
    totalInvoices: classified.length,
    zones: {}
  };

  for (const zone of ['norte', 'sur']) {
    const stops = byZone[zone];
    const driver = findDefaultDriver(zone);
    if (!stops.length) {
      result.zones[zone] = { stops: [], mapsLink: '', driverId: driver ? driver.id : null, distanceMeters: 0, durationSeconds: 0 };
      continue;
    }
    let optimized;
    try {
      optimized = await optimizeStops(stops);
    } catch (err) {
      // Si falla la optimización (p.ej. falta la API key), igual guardamos las
      // paradas sin optimizar para que el admin pueda revisarlas manualmente.
      optimized = { stops: stops.map((s, i) => ({ ...s, order: i + 1 })), mapsLink: '', distanceMeters: 0, durationSeconds: 0, error: err.message };
    }
    result.zones[zone] = {
      stops: optimized.stops.map((s) => ({ ...s, status: 'pendiente' })),
      mapsLink: optimized.mapsLink,
      distanceMeters: optimized.distanceMeters,
      durationSeconds: optimized.durationSeconds,
      truncated: !!optimized.truncated,
      error: optimized.error || null,
      driverId: driver ? driver.id : null
    };
  }
  result.sinZona = byZone['sin-zona'];

  store.update((s) => {
    s.dailyRoutes[date] = result;
    s.invoiceHistory.push({ date, importedAt: result.computedAt, count: classified.length });
    if (s.invoiceHistory.length > 500) s.invoiceHistory = s.invoiceHistory.slice(-500);
  });

  return result;
}

module.exports = { runDailyImport, todayStr, findDefaultDriver };

