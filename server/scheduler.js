// scheduler.js
// Programador diario sin dependencias externas (sin node-cron). Calcula los
// milisegundos hasta la próxima "dailyRunTime" configurada (hora local del
// servidor) y usa setTimeout; al ejecutarse, se reprograma para el día
// siguiente. Así, una vez configurados los parámetros necesarios (QuickBooks,
// Google Maps, origen, choferes por defecto), TODO el proceso corre solo,
// todos los días, sin intervención manual.

const store = require('./store');
const { runDailyImport } = require('./pipeline');

let timer = null;

function msUntilNextRun(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const { config } = store.get();
  const delay = msUntilNextRun(config.dailyRunTime || '06:00');
  timer = setTimeout(async () => {
    try {
      console.log(`[scheduler] Ejecutando importación automática diaria (${new Date().toISOString()})`);
      await runDailyImport();
      console.log('[scheduler] Importación y optimización de rutas completada.');
    } catch (err) {
      console.error('[scheduler] Error en la ejecución automática diaria:', err.message);
    } finally {
      scheduleNext(); // reprograma para el día siguiente
    }
  }, delay);
  const mins = Math.round(delay / 60000);
  console.log(`[scheduler] Próxima ejecución automática en ${mins} minutos (hora configurada: ${config.dailyRunTime}).`);
}

function reschedule() {
  scheduleNext();
}

module.exports = { scheduleNext, reschedule };

