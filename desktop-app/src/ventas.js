// Modulo 3: Ventas (punto de venta basico)
// Se vende por presentacion completa (modo "unidad", ej. la caja) o por
// unidad suelta (modo "fraccion") si el producto se fracciona.
// TODO (Iteracion 3): IGV, medios de pago, boleta/factura, cliente en la venta.

const { db } = require('./db');
const caja = require('./caja');
const catalogo = require('./catalogo');

function registrar({ items, clienteId, usuario, userId }) {
  if (!caja.estado()) return { ok: false, error: 'Abre la caja antes de vender' };
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'La venta no tiene productos' };
  if (!usuario) return { ok: false, error: 'Falta el usuario que registra la venta' };

  // Precio y stock se leen de la BD, nunca de lo que mande la ventana.
  const lineas = [];
  for (const it of items) {
    const cantidad = Number(it && it.cantidad);
    const modo = it && it.modo === 'fraccion' ? 'fraccion' : 'unidad';
    if (!it || !it.productId || !Number.isInteger(cantidad) || cantidad <= 0) {
      return { ok: false, error: 'Hay un producto con cantidad inválida en la venta (debe ser un entero mayor que 0)' };
    }
    const p = catalogo.obtener(it.productId);
    if (!p || !p.status) return { ok: false, error: `El producto ya no está disponible (id ${it.productId})` };
    if (modo === 'fraccion' && !p.se_fracciona) return { ok: false, error: `"${p.name}" no se vende por unidad suelta` };

    const precio = modo === 'fraccion' ? p.precio_fraccion : p.precio_unidad;
    if (!(precio > 0)) return { ok: false, error: `"${p.name}" no tiene precio de venta asignado` };

    lineas.push({
      productId: p.id,
      nombre: p.name,
      modo,
      cantidad,
      precio,
      fracciones: modo === 'fraccion' ? cantidad : cantidad * p.fraccion,
      fraccion: p.fraccion,
    });
  }

  // Si el mismo producto aparece en varias lineas, se valida el total.
  const porProducto = new Map();
  for (const l of lineas) porProducto.set(l.productId, (porProducto.get(l.productId) || 0) + l.fracciones);

  const total = Math.round(lineas.reduce((acc, l) => acc + l.precio * l.cantidad, 0) * 100) / 100;

  return db.transaction(() => {
    for (const [productId, fracciones] of porProducto) {
      const p = catalogo.obtener(productId);
      if (p.stock < fracciones) {
        return { ok: false, error: `Stock insuficiente de "${p.name}" (disponible: ${p.stock_detalle.texto})` };
      }
    }

    const info = db.prepare(
      'INSERT INTO sales (fecha, cliente_id, usuario, items_json, total) VALUES (?,?,?,?,?)'
    ).run(new Date().toISOString(), clienteId || null, usuario, JSON.stringify(lineas), total);
    const ventaId = Number(info.lastInsertRowid);

    for (const l of lineas) {
      catalogo.moverStock(l.productId, -l.fracciones, 'venta', { referencia: `venta:${ventaId}`, userId: userId || null });
    }
    return { ok: true, id: ventaId, total };
  })();
}

function listar() {
  return db.prepare('SELECT * FROM sales ORDER BY id DESC LIMIT 200').all();
}

module.exports = { registrar, listar };
