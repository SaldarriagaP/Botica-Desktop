// Modulo 3: Ventas (punto de venta basico)
// Se vende por presentacion completa (modo "unidad", ej. la caja) o por
// unidad suelta (modo "fraccion") si el producto se fracciona.
// TODO (Iteracion 3): IGV, medios de pago, boleta/factura, cliente en la venta.

const { db } = require('./db');
const caja = require('./caja');
const catalogo = require('./catalogo');

const IGV = 0.18;
const MEDIOS_PAGO = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'credito'];
const SERIE_POR_TIPO = { boleta: 'B001', factura: 'F001' };

function round2(n) { return Math.round(n * 100) / 100; }

// Los precios del catálogo YA incluyen IGV.
function desglosarIGV(totalConIGV) {
  const base = round2(totalConIGV / (1 + IGV));
  const igv = round2(totalConIGV - base);
  return { base, igv };
}

function siguienteCorrelativo(serie) {
  const row = db.prepare('SELECT ultimo FROM series WHERE serie = ?').get(serie);
  if (!row) throw new Error(`Serie no configurada: ${serie}`);
  const siguiente = row.ultimo + 1;
  db.prepare('UPDATE series SET ultimo = ? WHERE serie = ?').run(siguiente, serie);
  return siguiente;
}

function formatearComprobante(serie, correlativo) {
  return `${serie}-${String(correlativo).padStart(8, '0')}`;
}

function registrar({
  items,
  clienteId,
  clienteDoc,
  clienteNombre,
  tipoComprobante = 'boleta',
  medioPago = 'efectivo',
  montoRecibido = null,
  descuento = 0,
  usuario,
  userId,
}) {
  // ---- Validaciones de cabecera ----
  if (!caja.estado()) return { ok: false, error: 'Abre la caja antes de vender' };
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'La venta no tiene productos' };
  if (!usuario) return { ok: false, error: 'Falta el usuario que registra la venta' };

    if (!SERIE_POR_TIPO[tipoComprobante]) return { ok: false, error: 'Tipo de comprobante inválido' };
  if (!MEDIOS_PAGO.includes(medioPago)) return { ok: false, error: 'Medio de pago inválido' };

  // Factura exige RUC
  if (tipoComprobante === 'factura') {
    if (!clienteDoc || !/^\d{11}$/.test(String(clienteDoc))) {
      return { ok: false, error: 'La factura requiere RUC de 11 dígitos' };
    }
    if (!clienteNombre) return { ok: false, error: 'La factura requiere razón social del cliente' };
  }
  // Boleta con DNI opcional, pero si viene debe ser válido
  if (tipoComprobante === 'boleta' && clienteDoc && !/^\d{8}$/.test(String(clienteDoc))) {
    return { ok: false, error: 'El DNI debe tener 8 dígitos' };
  }

  const desc = Number(descuento) || 0;
  if (desc < 0) return { ok: false, error: 'El descuento no puede ser negativo' };
  
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
