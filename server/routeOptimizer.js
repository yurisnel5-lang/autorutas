// routeOptimizer.js
// Ordena las paradas de una ruta (una zona: norte o sur) usando la API de
// Direcciones de Google con optimización de waypoints (resuelve un TSP
// aproximado). Devuelve el orden óptimo + un link de Google Maps listo para
// que el chofer navegue parada por parada desde su teléfono.

const store = require('./store');

const MAX_WAYPOINTS = 23; // límite práctico de la API estándar de Directions (23 + origen/destino)

async function optimizeStops(stops) {
  // stops: [{ address, ... }]
  const { config } = store.get();
  if (!config.googleMapsApiKey) throw new Error('Falta configurar la API key de Google Maps.');
  if (!config.originAddress) throw new Error('Falta configurar la dirección de origen del negocio en Ajustes.');
  if (!stops.length) return { stops: [], mapsLink: '', distanceMeters: 0, durationSeconds: 0, truncated: false };

  const truncated = stops.length > MAX_WAYPOINTS;
  const usable = truncated ? stops.slice(0, MAX_WAYPOINTS) : stops;

  const origin = config.originAddress;
  const waypointsParam = 'optimize:true|' + usable.map((s) => encodeURIComponent(s.address)).join('|');

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(origin)}&waypoints=${waypointsParam}&key=${config.googleMapsApiKey}`;

  const resp = await fetch(url);
  const raw = await resp.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`No se pudo contactar la API de Google Directions (HTTP ${resp.status}). Verifica conectividad de red del servidor y la API key.`);
  }
  if (data.status !== 'OK' || !data.routes || !data.routes.length) {
    throw new Error(`No se pudo optimizar la ruta (status: ${data.status}: ${data.error_message || ''})`);
  }

  const route = data.routes[0];
  const order = route.waypoint_order; // índices en el orden óptimo
  const orderedStops = order.map((i, idx) => ({ ...usable[i], order: idx + 1 }));

  const distanceMeters = route.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
  const durationSeconds = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);

  const mapsLink = buildNavigationLink(origin, orderedStops);

  return { stops: orderedStops, mapsLink, distanceMeters, durationSeconds, truncated };
}

function buildNavigationLink(origin, orderedStops) {
  // Enlace de Google Maps que el chofer puede abrir directamente en su teléfono
  // para navegar parada por parada (última parada = destino, resto = waypoints).
  if (!orderedStops.length) return '';
  const last = orderedStops[orderedStops.length - 1];
  const middle = orderedStops.slice(0, -1);
  const params = new URLSearchParams({
    api: '1',
    origin,
    destination: last.address,
    travelmode: 'driving'
  });
  if (middle.length) params.set('waypoints', middle.map((s) => s.address).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

module.exports = { optimizeStops, buildNavigationLink, MAX_WAYPOINTS };

