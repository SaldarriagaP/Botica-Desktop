// Modulo 3: Ventas (punto de venta)
// TODO: metodos de pago mixtos, IGV, boleta/factura, impresion de ticket

const { db } = require('./db');
const caja = require('./caja');

function registrar({ items, clienteId, usuario }) {
  if (!caja.estado()) return { ok: false, error: 'Abre la caja antes de vender' };
  if (!items || !items.length) return { ok: false, error: 'La venta no tiene productos' };
  if (!usuario) return { ok: false, error: 'Falta el usuario que registra la venta' };

  // No confiamos en el precio ni el stock que manda el navegador: se
  // vuelven a leer de la BD para evitar que un cliente manipulado venda
  // a otro precio o descuente stock que ya no existe.
  const itemsValidados = [];
  for (const it of items) {
    const cantidad = Number(it.cantidad);
    if (!it.productId || !Number.isFinite(cantidad) || cantidad <= 0) {
      return { ok: false, error: 'Hay un producto con cantidad inválida en la venta' };
    }
    const producto = db.prepare('SELECT * FROM products WHERE id = ?').get(it.productId);
    if (!producto || !producto.estado) {
      return { ok: false, error: `El producto ya no está disponible (id ${it.productId})` };
    }
    if (producto.stock < cantidad) {
      return { ok: false, error: `Stock insuficiente de "${producto.nombre}" (disponible: ${producto.stock})` };
    }
    itemsValidados.push({
      productId: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      cantidad,
    });
  }

  const total = itemsValidados.reduce((acc, it) => acc + it.precio * it.cantidad, 0);

  const registrarTx = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO sales (fecha, cliente_id, usuario, items_json, total) VALUES (?,?,?,?,?)'
    ).run(new Date().toISOString(), clienteId || null, usuario, JSON.stringify(itemsValidados), total);

    for (const it of itemsValidados) {
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.cantidad, it.productId);
    }

    return info.lastInsertRowid;
  });

  const id = registrarTx();
  return { ok: true, id, total };
}

function listar() {
  return db.prepare('SELECT * FROM sales ORDER BY id DESC').all();
}

module.exports = { registrar, listar };
