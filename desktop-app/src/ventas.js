// Modulo 3: Ventas (punto de venta)
// TODO: metodos de pago mixtos, IGV, boleta/factura, impresion de ticket

const { db } = require('./db');
const caja = require('./caja');
const catalogo = require('./catalogo');

function registrar({ items, clienteId, usuario }) {
  if (!caja.estado()) return { ok: false, error: 'Abre la caja antes de vender' };
  if (!items || !items.length) return { ok: false, error: 'La venta no tiene productos' };

  const total = items.reduce((acc, it) => acc + it.precio * it.cantidad, 0);

  const info = db.prepare(
    'INSERT INTO sales (fecha, cliente_id, usuario, items_json, total) VALUES (?,?,?,?,?)'
  ).run(new Date().toISOString(), clienteId || null, usuario, JSON.stringify(items), total);

  for (const it of items) catalogo.descontarStock(it.productId, it.cantidad);

  return { ok: true, id: info.lastInsertRowid, total };
}

function listar() {
  return db.prepare('SELECT * FROM sales ORDER BY id DESC').all();
}

module.exports = { registrar, listar };
