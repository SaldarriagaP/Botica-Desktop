// Modulo: Sincronizacion con el servidor central.
//
// Es la razon de ser de la terminal: cuando se cae internet se sigue
// vendiendo en local y, apenas vuelve la conexion, las ventas pendientes se
// suben solas (sincronizacion automatica cada N segundos) o con el boton
// "Sincronizar ahora".
//
// Garantias:
// - Una venta solo se marca como sincronizada si el central respondio 2xx
//   con { ok: true }. Ante cualquier error queda pendiente, con el numero de
//   intentos y el ultimo error, y se reintenta en la siguiente sincronizacion.
// - Cada peticion tiene timeout: sin internet la app no se queda colgada.
// - Los precios del central solo se aplican a productos enlazados por
//   central_id (nunca por coincidencia de id local).
// - No se ejecutan dos sincronizaciones a la vez.

const http = require('http');
const https = require('https');
const config = require('./config');
const { db, getState, setState } = require('./db');

const TIMEOUT_MS = 8000;
// Sin ventas pendientes basta refrescar precios de vez en cuando.
const REFRESCO_PRECIOS_MS = 30 * 60 * 1000;
let enCurso = false;
let temporizador = null;
const conexion = { conectado: null, ultimoIntento: null, ultimoError: null };

const centralUrl = () => String(config.centralUrl || '').replace(/\/+$/, '');

function pedirJson(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const cliente = url.startsWith('https:') ? https : http;
    const datos = body !== undefined ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (datos) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(datos);
    }
    const req = cliente.request(url, { method, headers, timeout: TIMEOUT_MS }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => {
        let json = null;
        try { json = texto ? JSON.parse(texto) : {}; } catch { /* respuesta no JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}

const exito = (r) => r.status >= 200 && r.status < 300 && r.json && r.json.ok !== false;

async function traerPrecios(resultado) {
  const r = await pedirJson(`${centralUrl()}/api/productos`);
  if (!exito(r) || !Array.isArray(r.json)) throw new Error(`El central respondió ${r.status} al pedir el catálogo`);

  const upd = db.prepare(
    'UPDATE products SET precio_unidad = ?, updated_at = ? WHERE central_id = ? AND precio_unidad <> ?'
  );
  const ahora = new Date().toISOString();
  db.transaction(() => {
    for (const p of r.json) {
      const precio = Number(p && p.precio);
      const id = Number(p && p.id);
      if (!Number.isInteger(id) || !Number.isFinite(precio) || precio <= 0 || precio > 100000) {
        resultado.productosIgnorados++;
        continue;
      }
      const redondeado = Math.round(precio * 100) / 100;
      resultado.productosActualizados += upd.run(redondeado, ahora, id, redondeado).changes;
    }
  })();
}

async function subirVentas(resultado) {
  const pendientes = db.prepare('SELECT * FROM sales WHERE sincronizado = 0 ORDER BY id').all();
  const marcarOk = db.prepare('UPDATE sales SET sincronizado = 1, sync_error = NULL, sync_intentos = sync_intentos + 1 WHERE id = ?');
  const marcarError = db.prepare('UPDATE sales SET sync_error = ?, sync_intentos = sync_intentos + 1 WHERE id = ?');

  for (const venta of pendientes) {
    let items = [];
    try { items = JSON.parse(venta.items_json); } catch { /* se envia vacio y el central lo rechaza */ }
    const { items_json: _omit, ...cabecera } = venta;
    let r;
    try {
      r = await pedirJson(`${centralUrl()}/api/ventas`, { method: 'POST', body: { ...cabecera, items } });
    } catch (err) {
      marcarError.run(`Sin conexión: ${err.message}`, venta.id);
      throw err; // sin red no tiene sentido seguir con las demas
    }
    if (exito(r)) {
      marcarOk.run(venta.id);
      resultado.ventasSubidas++;
    } else {
      const motivo = (r.json && r.json.error) || `HTTP ${r.status}`;
      marcarError.run(String(motivo).slice(0, 300), venta.id);
      resultado.ventasRechazadas++;
    }
  }
}

async function sincronizar() {
  if (enCurso) return { ok: false, error: 'Ya hay una sincronización en curso' };
  enCurso = true;
  const resultado = { ok: true, productosActualizados: 0, productosIgnorados: 0, ventasSubidas: 0, ventasRechazadas: 0, error: null };
  try {
    await traerPrecios(resultado);
    await subirVentas(resultado);
    setState('last_sync_at', new Date().toISOString());
    if (resultado.ventasRechazadas) {
      resultado.ok = false;
      resultado.error = `${resultado.ventasRechazadas} venta(s) rechazada(s) por el central; quedan pendientes`;
    }
    conexion.conectado = true;
    conexion.ultimoError = resultado.error;
  } catch (err) {
    resultado.ok = false;
    resultado.error = `Sin conexión con el servidor central (${err.message})`;
    conexion.conectado = false;
    conexion.ultimoError = resultado.error;
  } finally {
    enCurso = false;
    conexion.ultimoIntento = new Date().toISOString();
  }
  resultado.pendientes = pendientes();
  return resultado;
}

// Sincronizacion automatica: si hay ventas pendientes lo intenta en cada
// ciclo (asi se suben solas en cuanto vuelve internet); si no, solo refresca
// precios cada 30 minutos. Nunca lanza errores: el siguiente ciclo reintenta.
async function cicloAutomatico() {
  if (enCurso) return;
  const ultima = Date.parse(getState('last_sync_at') || '') || 0;
  if (pendientes() === 0 && Date.now() - ultima < REFRESCO_PRECIOS_MS) return;
  try { await sincronizar(); } catch { /* se reintenta en el siguiente ciclo */ }
}

function iniciarAutomatica(segundos = (config.sync && config.sync.automaticoSegundos) || 0) {
  detenerAutomatica();
  const s = Number(segundos);
  if (!Number.isFinite(s) || s <= 0) return false;
  temporizador = setInterval(cicloAutomatico, Math.max(s, 15) * 1000);
  temporizador.unref();
  setTimeout(cicloAutomatico, 5000).unref(); // primer intento al arrancar
  return true;
}

function detenerAutomatica() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}

function pendientes() {
  return db.prepare('SELECT COUNT(*) AS n FROM sales WHERE sincronizado = 0').get().n;
}

function estado() {
  const ultimoError = db.prepare(
    'SELECT sync_error FROM sales WHERE sincronizado = 0 AND sync_error IS NOT NULL ORDER BY id DESC LIMIT 1'
  ).get();
  return {
    lastSyncAt: getState('last_sync_at'),
    pendientes: pendientes(),
    ultimoError: ultimoError ? ultimoError.sync_error : null,
    centralUrl: centralUrl(),
    enCurso,
    automatica: !!temporizador,
    intervaloSegundos: (config.sync && config.sync.automaticoSegundos) || 0,
    conectado: conexion.conectado,
    ultimoIntento: conexion.ultimoIntento,
  };
}

module.exports = {
  sincronizar, estado, pendientes, iniciarAutomatica, detenerAutomatica, cicloAutomatico,
  lastSyncAt: () => getState('last_sync_at'),
};
