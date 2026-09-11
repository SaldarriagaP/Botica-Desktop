// Modulo 6: Sincronizacion con el servidor central
// Por ahora es manual (boton "Sincronizar") y bien simple: trae el catalogo
// y sube las ventas pendientes. Falta: reintentos, manejo de conflictos,
// sincronizacion automatica en segundo plano.

const http = require('http');
const { db, getState, setState } = require('./db');

const CENTRAL_URL = process.env.CENTRAL_URL || 'http://localhost:4000';

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function sincronizar() {
  const resultado = { ok: true, productosActualizados: 0, ventasSubidas: 0, error: null };

  try {
    const productos = await fetchJson(`${CENTRAL_URL}/api/productos`);
    for (const p of productos) {
      db.prepare('UPDATE products SET precio = ? WHERE id = ?').run(p.precio, p.id);
      resultado.productosActualizados++;
    }

    const pendientes = db.prepare('SELECT * FROM sales WHERE sincronizado = 0').all();
    for (const venta of pendientes) {
      await fetchJson(`${CENTRAL_URL}/api/ventas`, { method: 'POST', body: venta });
      db.prepare('UPDATE sales SET sincronizado = 1 WHERE id = ?').run(venta.id);
      resultado.ventasSubidas++;
    }

    setState('last_sync_at', new Date().toISOString());
  } catch (err) {
    resultado.ok = false;
    resultado.error = 'Sin conexion con el servidor central';
  }

  return resultado;
}

module.exports = { sincronizar, lastSyncAt: () => getState('last_sync_at') };
