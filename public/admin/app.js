// app.js — lógica del panel de administrador (sin frameworks, JS puro).

const state = {
  config: null,
  drivers: [],
  todayRoute: null,
  map: null,
  markers: {},
  editingDriverId: null
};

// ---------------- utilidades ----------------

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => { el.className = 'toast ' + type; }, 3200);
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin'
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
  return data;
}

// ---------------- autenticación ----------------

async function boot() {
  const session = await api('/api/session');
  if (!session.authenticated) {
    $('#authScreen').style.display = 'flex';
    if (!session.adminPasswordConfigured) {
      $('#authTitle').textContent = 'Crea tu contraseña de administrador';
      $('#authSubtitle').textContent = 'Es la primera vez que abres AutoRutas. Define una contraseña para proteger el panel.';
      $('#authSubmit').textContent = 'Crear y entrar';
    }
    return;
  }
  $('#app').style.display = 'flex';
  await initApp();
}

$('#authSubmit').addEventListener('click', async () => {
  const password = $('#authPassword').value;
  const session = await api('/api/session');
  try {
    if (!session.adminPasswordConfigured) {
      await api('/api/setup-admin', { method: 'POST', body: JSON.stringify({ password }) });
    } else {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    }
    location.reload();
  } catch (err) {
    $('#authError').textContent = err.message;
  }
});
$('#authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#authSubmit').click(); });

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

// ---------------- navegación por pestañas ----------------

$all('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    $all('.nav-item').forEach((b) => b.classList.remove('active'));
    $all('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---------------- inicialización general ----------------

async function initApp() {
  await loadConfig();
  await loadDrivers();
  await loadTodayRoute();
  await loadHistory();
  loadGoogleMapsIfNeeded();
  setInterval(loadDriverLocations, 5000);
  loadDriverLocations();
}

// ---------------- configuración ----------------

async function loadConfig() {
  const cfg = await api('/api/config');
  state.config = cfg;
  $('#sidebarBusinessName').textContent = cfg.businessName || 'AutoRutas';
  $('#demoBadge').style.display = cfg.demoMode ? 'inline-flex' : 'none';

  $('#cfgBusinessName').value = cfg.businessName || '';
  $('#cfgRunTime').value = cfg.dailyRunTime || '06:00';
  $('#cfgOrigin').value = cfg.originAddress || '';
  $('#cfgMapsKey').value = cfg.googleMapsApiKey || '';
  $('#cfgDemoMode').checked = !!cfg.demoMode;

  $('#cfgQboClientId').value = cfg.qbo.clientId || '';
  $('#cfgQboEnv').value = cfg.qbo.environment || 'sandbox';
  $('#qboStatus').innerHTML = cfg.qbo.connected
    ? '<span class="pill pill-ok">✔ Conectado a QuickBooks (' + cfg.qbo.environment + ')</span>'
    : '<span class="pill pill-warn">No conectado — usando modo demo</span>';

  $('#cfgDivider').value = cfg.zoneRule.divider || '';
  $('#cfgQuadrant').checked = !!cfg.zoneRule.useQuadrantHeuristic;
  $('#cfgZipNorte').value = (cfg.zoneRule.zipNorth || []).join(', ');
  $('#cfgZipSur').value = (cfg.zoneRule.zipSouth || []).join(', ');
}

$('#saveBusinessBtn').addEventListener('click', async () => {
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify({
      businessName: $('#cfgBusinessName').value,
      dailyRunTime: $('#cfgRunTime').value,
      originAddress: $('#cfgOrigin').value
    }) });
    toast('Datos del negocio guardados', 'success');
    await loadConfig();
  } catch (err) { toast(err.message, 'error'); }
});

$('#saveMapsBtn').addEventListener('click', async () => {
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify({ googleMapsApiKey: $('#cfgMapsKey').value }) });
    toast('API key de Google Maps guardada', 'success');
    await loadConfig();
    loadGoogleMapsIfNeeded(true);
  } catch (err) { toast(err.message, 'error'); }
});

$('#saveQboBtn').addEventListener('click', async () => {
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify({
      demoMode: $('#cfgDemoMode').checked,
      qbo: {
        clientId: $('#cfgQboClientId').value,
        clientSecret: $('#cfgQboClientSecret').value,
        environment: $('#cfgQboEnv').value
      }
    }) });
    toast('Datos de QuickBooks guardados', 'success');
    $('#cfgQboClientSecret').value = '';
    await loadConfig();
  } catch (err) { toast(err.message, 'error'); }
});

$('#connectQboBtn').addEventListener('click', async () => {
  try {
    const { authorizeUrl } = await api('/api/qbo/connect', { method: 'POST' });
    window.open(authorizeUrl, '_blank');
    toast('Autoriza el acceso en la ventana de QuickBooks que se abrió, luego vuelve aquí y recarga.', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

$('#disconnectQboBtn').addEventListener('click', async () => {
  await api('/api/qbo/disconnect', { method: 'POST' });
  toast('QuickBooks desconectado. Volviendo a modo demo.', 'success');
  await loadConfig();
});

$('#saveZoneBtn').addEventListener('click', async () => {
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify({
      zoneRule: {
        divider: $('#cfgDivider').value,
        useQuadrantHeuristic: $('#cfgQuadrant').checked,
        zipNorth: $('#cfgZipNorte').value.split(',').map((s) => s.trim()).filter(Boolean),
        zipSouth: $('#cfgZipSur').value.split(',').map((s) => s.trim()).filter(Boolean)
      }
    }) });
    toast('Reglas de zona guardadas', 'success');
    await loadConfig();
  } catch (err) { toast(err.message, 'error'); }
});

// ---------------- choferes ----------------

async function loadDrivers() {
  state.drivers = await api('/api/drivers');
  renderDriversTable();
  fillAssignSelects();
}

function renderDriversTable() {
  const tbody = $('#driversTable tbody');
  tbody.innerHTML = '';
  state.drivers.forEach((d) => {
    const tr = document.createElement('tr');
    const zoneLabel = d.zoneDefault === 'norte' ? '<span class="pill pill-norte">Norte</span>'
      : d.zoneDefault === 'sur' ? '<span class="pill pill-sur">Sur</span>'
      : '<span class="pill pill-off">Sin definir</span>';
    tr.innerHTML = `
      <td>${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.phone || '—')}</td>
      <td>${zoneLabel}</td>
      <td id="loc-${d.id}">—</td>
      <td><button class="btn-secondary copy-link-btn" data-id="${d.id}">📋 Copiar link</button></td>
      <td>
        <button class="btn-secondary edit-driver-btn" data-id="${d.id}">Editar</button>
        <button class="btn-danger delete-driver-btn" data-id="${d.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
  });

  $all('.copy-link-btn').forEach((b) => b.addEventListener('click', async () => {
    const { url } = await api(`/api/drivers/${b.dataset.id}/link`);
    await navigator.clipboard.writeText(url).catch(() => {});
    toast('Link copiado: ' + url, 'success');
  }));
  $all('.edit-driver-btn').forEach((b) => b.addEventListener('click', () => openDriverModal(b.dataset.id)));
  $all('.delete-driver-btn').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este chofer?')) return;
    await api(`/api/drivers/${b.dataset.id}`, { method: 'DELETE' });
    await loadDrivers();
    toast('Chofer eliminado', 'success');
  }));
}

function fillAssignSelects() {
  ['assignNorte', 'assignSur'].forEach((selId, i) => {
    const zone = i === 0 ? 'norte' : 'sur';
    const sel = $('#' + selId);
    const current = sel.value;
    sel.innerHTML = '<option value="">Sin asignar</option>' +
      state.drivers.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}${d.zoneDefault === zone ? ' (predeterminado)' : ''}</option>`).join('');
    if (current) sel.value = current;
  });
}

$('#addDriverBtn').addEventListener('click', () => openDriverModal(null));
$('#driverModalCancel').addEventListener('click', closeDriverModal);

function openDriverModal(id) {
  state.editingDriverId = id;
  const driver = state.drivers.find((d) => d.id === id);
  $('#driverModalTitle').textContent = driver ? 'Editar chofer' : 'Agregar chofer';
  $('#driverName').value = driver ? driver.name : '';
  $('#driverPhone').value = driver ? driver.phone : '';
  $('#driverZone').value = driver ? (driver.zoneDefault || '') : '';
  $('#driverModal').style.display = 'flex';
}
function closeDriverModal() { $('#driverModal').style.display = 'none'; }

$('#driverModalSave').addEventListener('click', async () => {
  const payload = {
    name: $('#driverName').value.trim(),
    phone: $('#driverPhone').value.trim(),
    zoneDefault: $('#driverZone').value || null
  };
  if (!payload.name) return toast('El nombre es obligatorio', 'error');
  try {
    if (state.editingDriverId) {
      await api(`/api/drivers/${state.editingDriverId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/drivers', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeDriverModal();
    await loadDrivers();
    toast('Chofer guardado', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

// ---------------- rutas de hoy ----------------

async function loadTodayRoute() {
  const data = await api('/api/routes/today');
  state.todayRoute = data;
  renderRoutes(data);
}

$('#runNowBtn').addEventListener('click', async () => {
  const btn = $('#runNowBtn');
  btn.disabled = true;
  btn.textContent = 'Ejecutando…';
  try {
    const data = await api('/api/routes/run-now', { method: 'POST' });
    state.todayRoute = data;
    renderRoutes(data);
    toast('Importación y optimización completadas', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Ejecutar importación ahora';
  }
});

function renderRoutes(data) {
  const zones = data.zones || {};
  const norte = zones.norte || { stops: [] };
  const sur = zones.sur || { stops: [] };
  const sinZona = data.sinZona || [];

  $('#statTotal').textContent = data.totalInvoices ?? 0;
  $('#statNorte').textContent = norte.stops.length;
  $('#statSur').textContent = sur.stops.length;
  $('#statSinZona').textContent = sinZona.length;

  renderZoneCard('stopsNorte', norte, 'assignNorte', 'mapsLinkNorte', 'routeNorteMeta');
  renderZoneCard('stopsSur', sur, 'assignSur', 'mapsLinkSur', 'routeSurMeta');

  $('#sinZonaCard').style.display = sinZona.length ? 'block' : 'none';
  $('#stopsSinZona').innerHTML = sinZona.map((s) => stopHtml(s)).join('');
}

function renderZoneCard(listId, zoneData, selectId, linkId, metaId) {
  $('#' + listId).innerHTML = (zoneData.stops || []).map((s) => stopHtml(s)).join('') || '<p class="muted">Sin paradas para hoy.</p>';
  const sel = $('#' + selectId);
  if (zoneData.driverId) sel.value = zoneData.driverId; else sel.value = '';
  const link = $('#' + linkId);
  if (zoneData.mapsLink) { link.style.display = 'block'; link.href = zoneData.mapsLink; }
  else { link.style.display = 'none'; }
  const km = zoneData.distanceMeters ? (zoneData.distanceMeters / 1000).toFixed(1) + ' km' : '';
  const min = zoneData.durationSeconds ? Math.round(zoneData.durationSeconds / 60) + ' min' : '';
  $('#' + metaId).textContent = zoneData.error ? '⚠ ' + zoneData.error : [km, min].filter(Boolean).join(' · ');
}

function stopHtml(s) {
  return `<li class="stop-item">
    <div class="stop-order">${s.order ?? '·'}</div>
    <div class="stop-body">
      <div class="stop-customer">${escapeHtml(s.customerName)} <span class="muted">#${escapeHtml(String(s.docNumber))}</span></div>
      <div class="stop-address">${escapeHtml(s.address)}</div>
      <div class="stop-amount">$${Number(s.totalAmt || 0).toFixed(2)} · estado: ${escapeHtml(s.status || 'pendiente')}</div>
    </div>
  </li>`;
}

['assignNorte', 'assignSur'].forEach((id, i) => {
  const zone = i === 0 ? 'norte' : 'sur';
  $('#' + id).addEventListener('change', async (e) => {
    try {
      const date = state.todayRoute.date;
      await api(`/api/routes/${date}/${zone}/assign`, { method: 'POST', body: JSON.stringify({ driverId: e.target.value || null }) });
      toast('Chofer asignado', 'success');
      await loadTodayRoute();
    } catch (err) { toast(err.message, 'error'); }
  });
});

// ---------------- historial ----------------

async function loadHistory() {
  const rows = await api('/api/invoice-history');
  const tbody = $('#historyTable tbody');
  tbody.innerHTML = rows.map((r) => `<tr><td>${r.date}</td><td>${r.count}</td><td>${new Date(r.importedAt).toLocaleTimeString('es-ES')}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">Todavía no hay importaciones registradas.</td></tr>';
}

// ---------------- mapa en vivo ----------------

function loadGoogleMapsIfNeeded(force) {
  if (!state.config.googleMapsApiKey) return;
  if (window.google && window.google.maps && !force) { initMap(); return; }
  const existing = document.getElementById('gmaps-script');
  if (existing) existing.remove();
  const script = document.createElement('script');
  script.id = 'gmaps-script';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${state.config.googleMapsApiKey}`;
  script.onload = initMap;
  script.onerror = () => toast('No se pudo cargar Google Maps. Revisa tu API key.', 'error');
  document.head.appendChild(script);
}

function initMap() {
  const center = { lat: 25.7617, lng: -80.1918 }; // Miami por defecto; se recentra al primer chofer visto
  state.map = new google.maps.Map($('#map'), { center, zoom: 11, mapId: undefined });
}

async function loadDriverLocations() {
  if (!state.config) return;
  let list;
  try { list = await api('/api/drivers/locations'); } catch { return; }
  list.forEach((d) => {
    const cell = document.getElementById('loc-' + d.id);
    if (cell) {
      cell.textContent = d.location ? `hace ${Math.round((Date.now() - d.location.updatedAt) / 1000)}s` : '—';
    }
    if (!state.map || !d.location) return;
    const pos = { lat: d.location.lat, lng: d.location.lng };
    if (state.markers[d.id]) {
      state.markers[d.id].setPosition(pos);
    } else {
      state.markers[d.id] = new google.maps.Marker({
        position: pos,
        map: state.map,
        label: d.name.slice(0, 1).toUpperCase(),
        title: d.name
      });
    }
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

boot();

