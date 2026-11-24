// Resumen para la pantalla de inicio. Cada bloque se incluye solo si el rol
// tiene permiso para verlo (el auditor no ve caja operable, almacen no ve
// ventas, etc.).

const { db } = require('./db');
const config = require('./config');
const permisos = require('./permisos');
const caja = require('./caja');
const sync = require('./sync');
const catalogo = require('./catalogo');

const round2 = (n) => Math.round(n * 100) / 100;

// Inicio del dia en hora local de la terminal, en ISO (las fechas se guardan en UTC).
function inicioDelDia(ahora = new Date()) {
  const d = new Date(ahora);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function obtener(user) {
  const puede = (p) => permisos.tiene(user.type, p);
  const r = { generado: new Date().toISOString() };

  const turno = caja.estado();
  r.caja = turno
    ? { abierta: true, usuario: turno.usuario, opened_at: turno.opened_at, ventas: turno.resumen.ventas, total: turno.resumen.total, efectivo_esperado: turno.efectivo_esperado }
    : { abierta: false };

  if (puede('ventas.ver')) {
    const desde = inicioDelDia();
    const hoy = db.prepare('SELECT COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total FROM sales WHERE fecha >= ?').get(desde);
    r.ventasHoy = { ventas: hoy.ventas, total: round2(hoy.total), ticketPromedio: hoy.ventas ? round2(hoy.total / hoy.ventas) : 0 };
    r.ultimasVentas = db.prepare(
      `SELECT id, fecha, total, serie, correlativo, cliente_nombre, medio_pago, sincronizado, usuario, tipo_comprobante
       FROM sales ORDER BY id DESC LIMIT 6`
    ).all().map((v) => ({ ...v, comprobante: v.serie && v.correlativo ? `${v.serie}-${String(v.correlativo).padStart(8, '0')}` : `#${v.id}` }));
  }

  if (puede('catalogo.ver')) {
    const c = db.prepare(
      `SELECT COUNT(*) AS activos,
              SUM(CASE WHEN COALESCE(s.stock, 0) <= 0 THEN 1 ELSE 0 END) AS sinStock,
              SUM(CASE WHEN COALESCE(s.stock_minimo, 0) > 0 AND COALESCE(s.stock, 0) <= s.stock_minimo THEN 1 ELSE 0 END) AS stockBajo
       FROM products p LEFT JOIN product_stock s ON s.product_id = p.id AND s.local_id = ?
       WHERE p.status = 1`
    ).get(config.localId);
    r.catalogo = { activos: c.activos, sinStock: c.sinStock || 0, stockBajo: c.stockBajo || 0 };
    r.stockBajo = catalogo.listar({ stock: 'bajo', soloActivos: true, porPagina: 6 }).items
      .map((p) => ({ id: p.id, name: p.name, stock: p.stock_detalle.texto, minimo: p.stock_minimo }));
  }

  if (puede('clientes.ver')) {
    r.clientes = { activos: db.prepare('SELECT COUNT(*) AS n FROM customers WHERE status = 1').get().n };
  }

  const s = sync.estado();
  r.sync = { pendientes: s.pendientes, lastSyncAt: s.lastSyncAt, conectado: s.conectado, enCurso: s.enCurso, automatica: s.automatica };
  return r;
}

module.exports = { obtener, inicioDelDia };
