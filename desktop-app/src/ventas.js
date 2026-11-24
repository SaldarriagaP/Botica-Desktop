// Modulo: Ventas (punto de venta de la sucursal).
//
// - Se vende por presentacion completa (modo "unidad", ej. la caja) o por
//   unidad suelta (modo "fraccion") si el producto se fracciona.
// - Precio, IGV y stock se leen SIEMPRE de la BD, nunca de lo que mande la
//   ventana. Los precios del catalogo ya incluyen IGV.
// - Comprobante con serie propia de la sucursal (locals.serie S19 -> B019 /
//   F019) y correlativo asignado dentro de la misma transaccion que descuenta
//   el stock: o se registra todo o nada.
// - Reglas SUNAT: la factura exige un cliente con RUC; una boleta de S/ 700
//   o mas exige identificar al cliente con documento. El ticket (como en el
//   web) no lleva datos del cliente.
// - Pago como en el web: efectivo (exacto o con vuelto), tarjeta (con codigo
//   de referencia del voucher) o multipago (parte efectivo, resto tarjeta).
// - El cliente puede venir ya registrado (clienteId) o escrito en caja
//   (documento + nombre): si no existe se registra en la misma transaccion.

const { db } = require('./db');
const config = require('./config');
const caja = require('./caja');
const catalogo = require('./catalogo');
const clientes = require('./clientes');

const IGV = 0.18;
const MEDIOS_PAGO = ['efectivo', 'tarjeta', 'multipago', 'yape', 'plin', 'transferencia'];
const TIPOS_COMPROBANTE = { boleta: 'B', factura: 'F', ticket: 'T' };
const BOLETA_MONTO_IDENTIFICADO = 700;
const MAX_LINEAS = 100;
const RUC = '6';
const DNI = '1';
const SIN_DOC = '0';
const texto = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

const round2 = (n) => Math.round(n * 100) / 100;

// Serie de 4 caracteres segun SUNAT: letra + 3 digitos de la sucursal.
function serieDe(tipo) {
  const local = db.prepare('SELECT serie FROM locals WHERE id = ?').get(config.localId);
  const digitos = String((local && local.serie) || '').replace(/\D/g, '') || String(config.localId);
  return TIPOS_COMPROBANTE[tipo] + digitos.padStart(3, '0').slice(-3);
}

function siguienteCorrelativo(tipo) {
  const serie = serieDe(tipo);
  db.prepare('INSERT OR IGNORE INTO series (serie, tipo, ultimo) VALUES (?, ?, 0)').run(serie, tipo);
  db.prepare('UPDATE series SET ultimo = ultimo + 1 WHERE serie = ?').run(serie);
  const { ultimo } = db.prepare('SELECT ultimo FROM series WHERE serie = ?').get(serie);
  return { serie, correlativo: ultimo };
}

function formatearComprobante(serie, correlativo) {
  return serie && correlativo ? `${serie}-${String(correlativo).padStart(8, '0')}` : '';
}

// Desglose de IGV: los precios incluyen impuesto solo si el producto esta
// afecto (status_igv = 1); el resto es operacion exonerada.
function desglosar(lineas) {
  const gravado = round2(lineas.filter((l) => l.afectoIgv).reduce((a, l) => a + l.subtotal, 0));
  const exonerado = round2(lineas.filter((l) => !l.afectoIgv).reduce((a, l) => a + l.subtotal, 0));
  const opGravada = round2(gravado / (1 + IGV));
  return { opGravada, opExonerada: exonerado, igv: round2(gravado - opGravada), total: round2(gravado + exonerado) };
}

function prepararLineas(items) {
  if (!Array.isArray(items) || !items.length) return { error: 'La venta no tiene productos' };
  if (items.length > MAX_LINEAS) return { error: `Una venta admite como máximo ${MAX_LINEAS} líneas` };

  const lineas = [];
  for (const it of items) {
    const cantidad = Number(it && it.cantidad);
    const modo = it && it.modo === 'fraccion' ? 'fraccion' : 'unidad';
    if (!it || !it.productId || !Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 100000) {
      return { error: 'Hay un producto con cantidad inválida en la venta (debe ser un entero mayor que 0)' };
    }
    const p = catalogo.obtener(it.productId);
    if (!p || !p.status) return { error: `El producto ya no está disponible (id ${it.productId})` };
    if (modo === 'fraccion' && !p.se_fracciona) return { error: `"${p.name}" no se vende por unidad suelta` };

    const precio = modo === 'fraccion' ? p.precio_fraccion : p.precio_unidad;
    if (!(precio > 0)) return { error: `"${p.name}" no tiene precio de venta asignado` };

    lineas.push({
      productId: p.id,
      nombre: p.name,
      modo,
      cantidad,
      precio,
      subtotal: round2(precio * cantidad),
      afectoIgv: p.status_igv === 1,
      fracciones: modo === 'fraccion' ? cantidad : cantidad * p.fraccion,
      fraccion: p.fraccion,
    });
  }
  return { lineas };
}

// Devuelve { cliente } (registrado), { snapshot } (datos escritos en caja que
// se guardan solo en la venta) o { nuevo } (se registrara al confirmar).
function resolverCliente(tipoComprobante, clienteId, datos, puedeCrearCliente) {
  if (tipoComprobante === 'ticket') return {};
  if (clienteId !== undefined && clienteId !== null && clienteId !== '') {
    const c = clientes.obtener(clienteId);
    if (!c) return { error: 'El cliente seleccionado no existe' };
    if (!c.status) return { error: `El cliente "${c.name}" está inactivo` };
    return { cliente: c };
  }
  const d = datos && typeof datos === 'object' ? datos : {};
  const documento = texto(String(d.documento ?? ''), 11).toUpperCase();
  const nombre = texto(d.nombre, 255).toUpperCase();
  const direccion = texto(d.direccion, 200);
  if (!documento) return nombre ? { snapshot: { code: '', name: nombre, address: direccion } } : {};

  const existente = clientes.buscarPorDocumento(documento);
  if (existente) {
    if (!existente.status) return { error: `El cliente "${existente.name}" está inactivo` };
    return { cliente: existente };
  }
  const tipoDocumento = documento.length === 11 ? RUC : DNI;
  if (tipoComprobante === 'factura' && tipoDocumento !== RUC) return { error: 'La factura requiere un RUC de 11 dígitos' };
  if (!nombre) {
    return { error: tipoDocumento === RUC ? 'Escribe la razón social del cliente' : 'Escribe el nombre del cliente' };
  }
  const nuevo = { tipoDocumento, code: documento, name: nombre, address: direccion };
  const error = clientes.validarDatos(nuevo);
  if (error) return { error };
  return puedeCrearCliente
    ? { nuevo }
    : { snapshot: { code: documento, name: nombre, address: direccion, tipo_documento: tipoDocumento } };
}

// Reparte lo cobrado entre efectivo y tarjeta segun el medio de pago.
function resolverPago(medioPago, total, { montoRecibido, montoEfectivo, referencia }) {
  const ref = texto(referencia, 40);
  const monto = (v) => (v === null || v === undefined || v === '' ? null : round2(Number(v)));

  if (medioPago === 'efectivo') {
    let recibido = total;
    const m = monto(montoRecibido);
    if (m !== null) {
      if (!Number.isFinite(m) || m < 0) return { error: 'El monto recibido no es válido' };
      if (m < total) return { error: `El monto recibido (S/ ${m.toFixed(2)}) es menor que el total (S/ ${total.toFixed(2)})` };
      recibido = m;
    }
    return { recibido, vuelto: round2(recibido - total), pagoEfectivo: total, pagoTarjeta: 0, referencia: '' };
  }
  if (medioPago === 'tarjeta') {
    return { recibido: total, vuelto: 0, pagoEfectivo: 0, pagoTarjeta: total, referencia: ref };
  }
  if (medioPago === 'multipago') {
    const ef = monto(montoEfectivo);
    if (ef === null || !Number.isFinite(ef) || ef <= 0 || ef >= total) {
      return { error: `En multipago el efectivo debe ser mayor que 0 y menor que el total (S/ ${total.toFixed(2)})` };
    }
    return { recibido: total, vuelto: 0, pagoEfectivo: ef, pagoTarjeta: round2(total - ef), referencia: ref };
  }
  // Otros medios electronicos (yape, plin, transferencia).
  return { recibido: total, vuelto: 0, pagoEfectivo: 0, pagoTarjeta: 0, referencia: ref };
}

function registrar({
  items,
  clienteId = null,
  tipoComprobante = 'boleta',
  medioPago = 'efectivo',
  montoRecibido = null,
  montoEfectivo = null,
  referencia = '',
  cliente: datosCliente = null,
  puedeCrearCliente = false,
  usuario,
  userId,
} = {}) {
  if (!usuario) return { ok: false, error: 'Falta el usuario que registra la venta' };
  if (!TIPOS_COMPROBANTE[tipoComprobante]) return { ok: false, error: 'Tipo de comprobante inválido' };
  if (!MEDIOS_PAGO.includes(medioPago)) return { ok: false, error: 'Medio de pago inválido' };

  const turno = caja.estado();
  if (!turno) return { ok: false, error: 'Abre la caja antes de vender' };

  const { lineas, error } = prepararLineas(items);
  if (error) return { ok: false, error };

  const rc = resolverCliente(tipoComprobante, clienteId, datosCliente, puedeCrearCliente);
  if (rc.error) return { ok: false, error: rc.error };
  // Datos del cliente tal como iran impresos (registrado, nuevo o escrito).
  const datos = rc.cliente
    || (rc.nuevo && { code: rc.nuevo.code, name: rc.nuevo.name, address: rc.nuevo.address, tipo_documento: rc.nuevo.tipoDocumento })
    || rc.snapshot || null;
  const tipoDocCliente = datos ? (datos.tipo_documento || (datos.code ? DNI : SIN_DOC)) : SIN_DOC;

  const montos = desglosar(lineas);

  if (tipoComprobante === 'factura' && (!datos || tipoDocCliente !== RUC)) {
    return { ok: false, error: 'La factura requiere un cliente con RUC. Escribe el RUC y la razón social.' };
  }
  if (tipoComprobante === 'boleta' && montos.total >= BOLETA_MONTO_IDENTIFICADO
      && (!datos || !datos.code || tipoDocCliente === SIN_DOC)) {
    return { ok: false, error: `Una boleta de S/ ${BOLETA_MONTO_IDENTIFICADO} o más debe identificar al cliente con su documento` };
  }

  const pago = resolverPago(medioPago, montos.total, { montoRecibido, montoEfectivo, referencia });
  if (pago.error) return { ok: false, error: pago.error };
  const { recibido, vuelto } = pago;

  // Si el mismo producto aparece en varias lineas, se valida el total.
  const porProducto = new Map();
  for (const l of lineas) porProducto.set(l.productId, (porProducto.get(l.productId) || 0) + l.fracciones);

  const transaccion = db.transaction(() => {
    for (const [productId, fracciones] of porProducto) {
      const p = catalogo.obtener(productId);
      if (p.stock < fracciones) {
        return { ok: false, error: `Stock insuficiente de "${p.name}" (disponible: ${p.stock_detalle.texto})` };
      }
    }

    let clienteId = rc.cliente ? rc.cliente.id : null;
    if (rc.nuevo) {
      const creado = clientes.crear(rc.nuevo, { id: userId || null });
      if (!creado.ok) throw new VentaRechazada(creado.error);
      clienteId = creado.id;
    }

    const { serie, correlativo } = siguienteCorrelativo(tipoComprobante);
    const info = db.prepare(
      `INSERT INTO sales (fecha, cliente_id, usuario, user_id, local_id, caja_id, items_json, total,
         tipo_comprobante, serie, correlativo, cliente_doc, cliente_nombre, cliente_direccion, medio_pago,
         op_gravada, op_exonerada, igv, monto_recibido, vuelto, pago_efectivo, pago_tarjeta, referencia_pago)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      new Date().toISOString(), clienteId, usuario, userId || null, config.localId, turno.id,
      JSON.stringify(lineas), montos.total, tipoComprobante, serie, correlativo,
      datos ? datos.code || '' : '', datos ? datos.name || '' : '', datos ? datos.address || '' : '', medioPago,
      montos.opGravada, montos.opExonerada, montos.igv, recibido, vuelto,
      pago.pagoEfectivo, pago.pagoTarjeta, pago.referencia
    );
    const ventaId = Number(info.lastInsertRowid);

    for (const l of lineas) {
      catalogo.moverStock(l.productId, -l.fracciones, 'venta', {
        referencia: `venta:${ventaId}`,
        motivo: formatearComprobante(serie, correlativo),
        userId: userId || null,
      });
    }
    return {
      ok: true,
      id: ventaId,
      comprobante: formatearComprobante(serie, correlativo),
      total: montos.total,
      igv: montos.igv,
      vuelto,
    };
  });
  try {
    return transaccion();
  } catch (err) {
    if (err instanceof VentaRechazada) return { ok: false, error: err.message };
    throw err;
  }
}

class VentaRechazada extends Error {}

function presentar(v) {
  if (!v) return null;
  let items = [];
  try { items = JSON.parse(v.items_json); } catch { /* venta antigua con JSON danado */ }
  const { items_json: _omit, ...resto } = v;
  return { ...resto, comprobante: formatearComprobante(v.serie, v.correlativo), items };
}

// Filtros: turno, vendedor y ultimas N horas ("Mis ventas" del web: 24 h).
function listar({ cajaId, userId, horas, limite = 200 } = {}) {
  const n = Math.min(Math.max(parseInt(limite, 10) || 200, 1), 500);
  const where = [];
  const params = [];
  if (cajaId) { where.push('caja_id = ?'); params.push(Number(cajaId)); }
  if (userId) { where.push('user_id = ?'); params.push(Number(userId)); }
  const horasAtras = Number(horas);
  if (Number.isFinite(horasAtras) && horasAtras > 0) {
    where.push('fecha >= ?');
    params.push(new Date(Date.now() - horasAtras * 3600 * 1000).toISOString());
  }
  const sql = `SELECT * FROM sales ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, n).map(presentar);
}

function obtener(id) {
  return presentar(db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id)));
}

module.exports = {
  registrar, listar, obtener, desglosar, serieDe, formatearComprobante,
  MEDIOS_PAGO, BOLETA_MONTO_IDENTIFICADO,
};
