// app.js — página del chofer (sin frameworks). Muestra su ruta del día y
// comparte su ubicación GPS mientras la página esté abierta en su teléfono.

const params = new URLSearchParams(location.search);
const token = params.get('token');

let watchId = null;
let sharing = false;

function $(sel) { return document.querySelector(sel); }

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => { el.className = 'toast ' + type; }, 3000);
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
  return data;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function load() {
  if (!token) { $('#invalidScreen').style.display = 'flex'; return; }
  let data;
  try {
    data = await api('/api/driver/route?token=' + encodeURIComponent(token));
  } catch (err) {
    $('#invalidScreen').style.display = 'flex';
    return;
  }
  $('#driverApp').style.display = 'block';
  $('#driverName').textContent = data.driver.name;
  $('#driverZone').textContent = data.zone ? `Ruta de hoy: ${data.zone.toUpperCase()}` : 'Sin ruta asignada hoy';

  if (!data.route || !data.route.stops || !data.route.stops.length) {
    $('#noRoute').style.display = 'block';
    $('#routeSummary').style.display = 'none';
    $('#stopsList').innerHTML = '';
    return;
  }

  $('#noRoute').style.display = 'none';
  $('#routeSummary').style.display = 'flex';
  $('#stopsCount').textContent = `${data.route.stops.length} paradas`;
  if (data.route.mapsLink) {
    $('#navLink').href = data.route.mapsLink;
    $('#navLink').style.display = 'inline-block';
  } else {
    $('#navLink').style.display = 'none';
  }

  $('#stopsList').innerHTML = data.route.stops.map((s) => stopHtml(s, data.date, data.zone)).join('');

  $('#stopsList').querySelectorAll('.mark-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api('/api/driver/stop-status', {
          method: 'POST',
          body: JSON.stringify({ token, date: data.date, zone: data.zone, stopId: btn.dataset.id, status: btn.dataset.status })
        });
        toast('Estado actualizado', 'success');
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function stopHtml(s, date, zone) {
  const statusClass = s.status === 'entregado' ? 'delivered' : s.status === 'no_entregado' ? 'failed' : '';
  const singleNavUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.address)}&travelmode=driving`;
  return `<li class="d-stop ${statusClass}">
    <div class="d-stop-top">
      <div class="d-stop-order">${s.order ?? '·'}</div>
      <div>
        <div class="d-stop-customer">${escapeHtml(s.customerName)}</div>
        <div class="d-stop-address">${escapeHtml(s.address)}</div>
        <div class="d-stop-amount">$${Number(s.totalAmt || 0).toFixed(2)} · #${escapeHtml(String(s.docNumber))} · <b>${escapeHtml(s.status || 'pendiente')}</b></div>
      </div>
    </div>
    <div class="d-stop-actions">
      <a class="btn-secondary" style="text-align:center; text-decoration:none; flex:1; padding:10px 8px; border-radius:10px; font-size:13px" href="${singleNavUrl}" target="_blank">🧭 Ir aquí</a>
      <button class="btn-primary mark-btn" data-id="${s.id}" data-status="entregado">✔ Entregado</button>
      <button class="btn-danger mark-btn" data-id="${s.id}" data-status="no_entregado">✖ No entregado</button>
    </div>
  </li>`;
}

$('#shareLocBtn').addEventListener('click', () => {
  if (sharing) { stopSharing(); return; }
  startSharing();
});

function startSharing() {
  if (!navigator.geolocation) { toast('Este navegador no soporta geolocalización', 'error'); return; }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      sendLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => { toast('No se pudo obtener tu ubicación: ' + err.message, 'error'); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  sharing = true;
  $('#shareLocBtn').textContent = '🟢 Compartiendo ubicación';
  $('#shareLocBtn').classList.add('active');
  $('#locStatus').textContent = 'Tu ubicación se está enviando mientras esta página siga abierta.';
}

function stopSharing() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  sharing = false;
  $('#shareLocBtn').textContent = '📍 Compartir ubicación';
  $('#shareLocBtn').classList.remove('active');
  $('#locStatus').textContent = 'Ubicación en pausa.';
}

let lastSent = 0;
function sendLocation(lat, lng) {
  const now = Date.now();
  if (now - lastSent < 8000) return; // limita el envío a cada ~8s
  lastSent = now;
  api('/api/driver/location', { method: 'POST', body: JSON.stringify({ token, lat, lng }) }).catch(() => {});
  $('#locStatus').textContent = 'Última actualización: ' + new Date().toLocaleTimeString('es-ES');
}

load();
setInterval(load, 30000); // refresca la ruta cada 30s por si el admin reasigna algo

