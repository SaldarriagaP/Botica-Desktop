// Punto de venta con el mismo flujo que el modulo de ventas del web:
// buscar -> cantidades por caja / fraccion -> carrito -> cliente y pago.
// Los precios mostrados son referenciales: el servidor recalcula precio,
// IGV y stock al registrar.
import { api } from '../../api.js';
import {
  $, h, soles, numero, fechaHora, debounce, mensaje, limpiarMensaje, postJson, toast, alerta, confirmar,
  botonCargando, MEDIOS, COMPROBANTES,
} from '../core/utils.js';
import { imprimirVenta, configurarEmpresa } from './comprobante.js';

const IGV = 0.18;
const r2 = (n) => Math.round(n * 100) / 100;
const BOLETA_MONTO_IDENTIFICADO = 700;

let resultados = [];
const carrito = new Map(); // productId -> { p, cajas, fracciones }
let cajaAbierta = false;
let busquedaToken = 0;
let ctx = { puede: () => false, usuario: null, ir: () => {} };

const fracciona = (p) => !!p.se_fracciona && p.fraccion > 1;
const unidadesPorCaja = (p) => Math.max(1, Number(p.fraccion) || 1);

// ---------------------------------------------------------------------
// Busqueda de productos
// ---------------------------------------------------------------------
function estadoBusqueda(icono, titulo, texto) {
  const el = $('ventasProductStatus');
  el.hidden = false;
  el.innerHTML = `<i class="fa ${icono}"></i><strong>${h(titulo)}</strong><span>${h(texto)}</span>`;
}

async function buscarProductos({ agregarUnico = false } = {}) {
  const q = $('ventaBuscar').value.trim();
  const tbody = $('div_productos');
  if (q.length < 3 && !/^\d+$/.test(q)) {
    resultados = [];
    tbody.innerHTML = '';
    estadoBusqueda('fa-search', 'Busca un producto para comenzar', 'Puedes usar su codigo, nombre o composicion.');
    return;
  }
  const token = ++busquedaToken;
  estadoBusqueda('fa-spinner fa-spin', 'Buscando productos...', `Coincidencias para "${q}"`);
  const r = await api('/api/productos?' + new URLSearchParams({ q, soloActivos: '1', porPagina: 40 }), { silencioso: true });
  if (token !== busquedaToken) return; // llego una busqueda mas nueva
  resultados = (r && r.items) || [];
  renderResultados();
  if (agregarUnico && resultados.length === 1) agregarDesdeFila(resultados[0].id);
}

function renderResultados() {
  const tbody = $('div_productos');
  if (!resultados.length) {
    tbody.innerHTML = '';
    estadoBusqueda('fa-exclamation-circle', 'Sin resultados', 'No hay productos activos que coincidan con la búsqueda.');
    return;
  }
  $('ventasProductStatus').hidden = true;
  tbody.innerHTML = resultados.map((p) => {
    const sinStock = p.stock <= 0;
    const fr = fracciona(p);
    const cajas = fr ? p.stock_detalle.cajas : p.stock;
    const sueltas = fr ? p.stock_detalle.sueltas : 0;
    return `<tr class="ventas-catalog-row${sinStock ? ' ventas-product-no-stock is-out' : ''}${resultados.length === 1 ? ' ventas-catalog-row-unica' : ''}" data-id="${p.id}">
      <td><span class="ventas-catalog-code">${p.id}</span></td>
      <td class="ventas-catalog-product"><strong>${h(p.name)}</strong>
        <small>${h(p.presentacion || '')} - ${h(p.composicion || 'Sin composición')}</small>
        <span class="ventas-catalog-brand">${h(p.brand_name || 'Sin marca')}</span></td>
      <td><span class="ventas-catalog-stock${cajas <= 0 ? ' is-zero' : ''}">${cajas}</span></td>
      <td><span class="ventas-catalog-stock${sueltas <= 0 ? ' is-zero' : ''}">${sueltas}</span></td>
      <td><span class="ventas-catalog-fraction ${fr ? 'is-enabled' : 'is-disabled'}">${fr ? `X${p.fraccion}` : 'No fraccionable'}</span></td>
      <td class="ventas-catalog-prices"><span class="ventas-price-item"><strong>S/ ${Number(p.precio_unidad).toFixed(2)}</strong></span><span class="ventas-price-separator">/</span><span class="ventas-price-item"><strong>S/ ${Number(fr ? p.precio_fraccion : 0).toFixed(2)}</strong></span></td>
      <td><input class="form-control input-sm ventas-qty-input" min="0" type="number" value="0" data-campo="cajas" ${sinStock ? 'disabled' : ''} /></td>
      <td><input class="form-control input-sm ventas-qty-input" min="0" type="number" value="0" data-campo="fracciones" ${fr && !sinStock ? '' : 'disabled'} /></td>
      <td class="ventas-catalog-actions"><div class="ventas-actions-cell">
        <button type="button" class="btn btn-primary btn-sm" data-accion="agregar" title="Agregar al carrito"${sinStock ? ' disabled' : ''}><i class="fa fa-plus"></i></button>
        <button type="button" class="btn btn-danger btn-sm" data-accion="quitar" title="Quitar del carrito"${carrito.has(p.id) ? '' : ' disabled'}><i class="fa fa-minus"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

// ---------------------------------------------------------------------
// Carrito
// ---------------------------------------------------------------------
function validarCantidad(p, cajas, fracciones) {
  if (!Number.isInteger(cajas) || !Number.isInteger(fracciones) || cajas < 0 || fracciones < 0) return 'Las cantidades deben ser números enteros';
  if (fracciones > 0 && !fracciona(p)) return `"${p.name}" no se vende por fracción`;
  if (cajas > 0 && !(p.precio_unidad > 0)) return `"${p.name}" no tiene precio de venta asignado`;
  if (fracciones > 0 && !(p.precio_fraccion > 0)) return `"${p.name}" no tiene precio por fracción`;
  const requerido = cajas * unidadesPorCaja(p) + fracciones;
  if (requerido > p.stock) return `Stock insuficiente de "${p.name}" (disponible: ${p.stock_detalle.texto})`;
  return null;
}

function cambiarCarrito(p, cajas, fracciones) {
  const error = validarCantidad(p, cajas, fracciones);
  if (error) { toast(error, 'error'); return false; }
  if (!cajas && !fracciones) carrito.delete(p.id);
  else carrito.set(p.id, { p, cajas, fracciones });
  renderCarrito();
  return true;
}

function agregarDesdeFila(id) {
  const p = resultados.find((x) => x.id === id);
  if (!p) return;
  const fila = document.querySelector(`#div_productos tr[data-id="${id}"]`);
  let cajas = Number(fila.querySelector('[data-campo="cajas"]').value || 0);
  let fracciones = Number(fila.querySelector('[data-campo="fracciones"]').value || 0);
  if (!cajas && !fracciones) cajas = 1; // "+" sin cantidad = una caja / unidad
  const actual = carrito.get(id) || { cajas: 0, fracciones: 0 };
  if (cambiarCarrito(p, actual.cajas + cajas, actual.fracciones + fracciones)) {
    toast(`${p.name} agregado al carrito`, 'info');
    fila.querySelectorAll('input').forEach((i) => { i.value = 0; });
    fila.querySelector('[data-accion="quitar"]').disabled = false;
    destacarBurbuja();
    $('ventaBuscar').select();
  }
}

function totales() {
  let gravado = 0;
  let exonerado = 0;
  let cantidad = 0;
  for (const { p, cajas, fracciones } of carrito.values()) {
    const sub = cajas * p.precio_unidad + fracciones * (p.precio_fraccion || 0);
    if (p.status_igv) gravado += sub; else exonerado += sub;
    cantidad += cajas + fracciones;
  }
  gravado = r2(gravado);
  exonerado = r2(exonerado);
  const base = r2(gravado / (1 + IGV));
  return { base, igv: r2(gravado - base), exonerado, total: r2(gravado + exonerado), cantidad };
}

function renderCarrito() {
  const t = totales();
  const lineas = [...carrito.values()];
  $('carritoShell').classList.toggle('is-empty', !lineas.length);
  $('div_carrito').innerHTML = lineas.length ? `
    <table class="table table-striped table-hover ventas-cart-table">
      <thead><tr><th>Producto</th><th class="text-center">Cajas</th><th class="text-center">Fracciones</th><th class="text-right">P. Caja</th><th class="text-right">P. Frac</th><th class="text-right">Subtotal</th><th></th></tr></thead>
      <tbody>${lineas.map(({ p, cajas, fracciones }) => `
        <tr data-id="${p.id}">
          <td><strong>${h(p.name)}</strong><small class="d-block text-muted">${h(p.presentacion || '')}${p.status_igv ? '' : ' · Exonerado'}</small></td>
          <td class="text-center"><span class="ventas-cart-qty">
            <button type="button" class="btn btn-default btn-xs" data-mod="cajas" data-delta="-1"><i class="fa fa-minus"></i></button>
            <b>${cajas}</b>
            <button type="button" class="btn btn-default btn-xs" data-mod="cajas" data-delta="1"><i class="fa fa-plus"></i></button></span></td>
          <td class="text-center">${fracciona(p) ? `<span class="ventas-cart-qty">
            <button type="button" class="btn btn-default btn-xs" data-mod="fracciones" data-delta="-1"><i class="fa fa-minus"></i></button>
            <b>${fracciones}</b>
            <button type="button" class="btn btn-default btn-xs" data-mod="fracciones" data-delta="1"><i class="fa fa-plus"></i></button></span>` : '<span class="text-muted">—</span>'}</td>
          <td class="text-right">${soles(p.precio_unidad)}</td>
          <td class="text-right">${fracciona(p) ? soles(p.precio_fraccion) : '—'}</td>
          <td class="text-right"><strong>${soles(cajas * p.precio_unidad + fracciones * (p.precio_fraccion || 0))}</strong></td>
          <td class="text-center"><button type="button" class="btn btn-danger btn-xs" data-eliminar title="Quitar"><i class="fa fa-trash-o"></i></button></td>
        </tr>`).join('')}
      </tbody>
      <tfoot class="ventas-cart-totales">
        <tr><td colspan="5" class="text-right">OP. GRAVADAS</td><td class="text-right">${soles(t.base)}</td><td></td></tr>
        <tr><td colspan="5" class="text-right">IGV (18%)</td><td class="text-right">${soles(t.igv)}</td><td></td></tr>
        <tr><td colspan="5" class="text-right">OP. EXONERADAS</td><td class="text-right">${soles(t.exonerado)}</td><td></td></tr>
        <tr class="total"><td colspan="5" class="text-right">TOTAL</td><td class="text-right">${soles(t.total)}</td><td></td></tr>
      </tfoot>
    </table>`
    : '<div class="ventas-cart-empty"><i class="fa fa-shopping-cart"></i><strong>Carrito vacio</strong><span>Agrega productos desde la tabla para preparar la venta.</span></div>';

  // Resumen flotante
  const n = lineas.length;
  $('ventasCartBubble').classList.toggle('has-items', n > 0);
  if (!n) $('ventasCartBubble').classList.remove('is-open');
  $('ventasCartBubbleBadge').textContent = String(n);
  $('ventasCartBubbleBadge').classList.toggle('is-empty', !n);
  $('ventasResumenItems').textContent = n ? `${n} producto${n === 1 ? '' : 's'} en el carrito` : 'Carrito vacio';
  $('ventasResumenEstado').textContent = n ? 'Revisa el carrito o finaliza la venta.' : 'Agrega productos para continuar con la venta.';
  $('ventasResumenTotal').textContent = soles(t.total);
  $('btnFinalizarVenta').disabled = !n;
  $('btnCarritoFinalizar').disabled = !n;
  if ($('dlgCheckout').open) actualizarPago();
}

function destacarBurbuja() {
  const b = $('btnBurbujaCarrito');
  b.classList.add('ventas-cart-bubble-pulse');
  setTimeout(() => b.classList.remove('ventas-cart-bubble-pulse'), 700);
}

// ---------------------------------------------------------------------
// Cliente y pago
// ---------------------------------------------------------------------
const valorRadio = (nombre) => document.querySelector(`#dlgCheckout input[name="${nombre}"]:checked`).value;
function marcarRadio(nombre, valor) {
  const input = document.querySelector(`#dlgCheckout input[name="${nombre}"][value="${valor}"]`);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function sincronizarGrupos() {
  document.querySelectorAll('#dlgCheckout .modal-choice-group label, #dlgCheckout .ventas-cash-options label').forEach((l) => {
    const activo = l.querySelector('input').checked;
    l.classList.toggle('active', activo);
    l.classList.toggle('is-selected', activo);
  });
}

function actualizarTipo() {
  const tipo = valorRadio('tipo');
  $('divPersona').hidden = tipo !== 'boleta';
  $('divEmpresa').hidden = tipo !== 'factura';
  $('divTicket').hidden = tipo !== 'ticket';
  $('clienteEstado').textContent = '';
}

function actualizarPago() {
  const total = totales().total;
  $('checkoutTotal').textContent = soles(total);
  const medio = valorRadio('tipoPago');
  $('pagoEfectivoInfo').hidden = medio !== 'efectivo';
  $('multipago').hidden = medio !== 'multipago';
  $('mcodtarjeta').hidden = medio === 'efectivo';

  const exacto = valorRadio('modoEfectivo') === 'exacto';
  const recibido = $('efectivoRecibido');
  recibido.readOnly = exacto;
  if (exacto) recibido.value = total.toFixed(2);
  const vuelto = !exacto && Number(recibido.value) > total ? Number(recibido.value) - total : 0;
  $('ventasVuelto').textContent = soles(vuelto);

  const ef = Number($('efectivoom').value || 0);
  $('tarjetam').value = ef > 0 && ef < total ? (total - ef).toFixed(2) : '';
  sincronizarGrupos();
}

// Al escribir un documento completo se buscan los datos del cliente.
async function buscarClientePorDocumento(input, nombre, direccion, largo) {
  const doc = input.value.trim();
  $('clienteEstado').textContent = '';
  if (doc.length !== largo) return;
  const r = await api(`/api/clientes/documento/${encodeURIComponent(doc)}`, { silencioso: true });
  if (input.value.trim() !== doc) return;
  if (r.ok) {
    nombre.value = r.cliente.name || '';
    if (direccion && r.cliente.address) direccion.value = r.cliente.address;
    $('clienteEstado').innerHTML = r.cliente.status
      ? '<i class="fa fa-check-circle text-success"></i> Cliente registrado'
      : '<i class="fa fa-exclamation-circle text-danger"></i> Cliente inactivo';
  } else {
    $('clienteEstado').innerHTML = ctx.puede('clientes.crear')
      ? '<i class="fa fa-info-circle"></i> Cliente nuevo: se registrará al generar la venta'
      : '<i class="fa fa-info-circle"></i> Cliente no registrado: sus datos solo quedarán en el comprobante';
  }
}

function abrirCheckout() {
  if (!carrito.size) return toast('Agrega productos al carrito', 'error');
  if (!cajaAbierta) return alerta('Caja cerrada', 'Abre la caja antes de registrar ventas.', 'peligro');
  $('dlgCarrito').close();
  limpiarMensaje('checkoutMsg');
  $('ventasCartBubble').classList.remove('is-open');
  actualizarTipo();
  actualizarPago();
  if (!$('dlgCheckout').open) $('dlgCheckout').showModal();
  const tipo = valorRadio('tipo');
  (tipo === 'factura' ? $('RUC') : tipo === 'boleta' ? $('DNI') : $('generaVenta')).focus();
}

function datosVenta() {
  const tipo = valorRadio('tipo');
  const medio = valorRadio('tipoPago');
  const total = totales().total;
  const items = [];
  for (const { p, cajas, fracciones } of carrito.values()) {
    if (cajas) items.push({ productId: p.id, cantidad: cajas, modo: 'unidad' });
    if (fracciones) items.push({ productId: p.id, cantidad: fracciones, modo: 'fraccion' });
  }
  let cliente = null;
  if (tipo === 'boleta' && ($('DNI').value.trim() || $('nameDNI').value.trim())) {
    cliente = { documento: $('DNI').value.trim(), nombre: $('nameDNI').value.trim() };
  }
  if (tipo === 'factura') {
    cliente = { documento: $('RUC').value.trim(), nombre: $('nameRUC').value.trim(), direccion: $('address').value.trim() };
  }
  const datos = { items, cliente, tipoComprobante: tipo, medioPago: medio, referencia: $('codtarjeta').value.trim() };
  if (medio === 'efectivo') datos.montoRecibido = valorRadio('modoEfectivo') === 'exacto' ? total : Number($('efectivoRecibido').value);
  if (medio === 'multipago') datos.montoEfectivo = Number($('efectivoom').value || 0);
  return datos;
}

function validarCheckout(d) {
  const total = totales().total;
  if (d.tipoComprobante === 'boleta' && d.cliente && d.cliente.documento && !/^\d{8}$/.test(d.cliente.documento)) return 'El DNI debe tener 8 dígitos';
  if (d.tipoComprobante === 'boleta' && total >= BOLETA_MONTO_IDENTIFICADO && !(d.cliente && d.cliente.documento)) {
    return `Una boleta de S/ ${BOLETA_MONTO_IDENTIFICADO} o más debe identificar al cliente con su DNI`;
  }
  if (d.tipoComprobante === 'factura') {
    if (!/^\d{11}$/.test(d.cliente.documento)) return 'El RUC debe tener 11 dígitos';
    if (!d.cliente.nombre) return 'Escribe la razón social del cliente';
  }
  if (d.medioPago === 'efectivo' && !(d.montoRecibido >= total)) return `El efectivo recibido debe cubrir el total (${soles(total)})`;
  if (d.medioPago === 'multipago' && !(d.montoEfectivo > 0 && d.montoEfectivo < total)) {
    return `En multipago el efectivo debe ser mayor que 0 y menor que el total (${soles(total)})`;
  }
  return null;
}

let registrando = false;
async function generarVenta() {
  if (registrando) return; // evita doble registro por doble clic / doble Ctrl+Enter
  const d = datosVenta();
  const error = validarCheckout(d);
  if (error) return mensaje('checkoutMsg', { ok: false, error });
  registrando = true;
  const restaurar = botonCargando($('generaVenta'), 'Registrando venta...');
  const res = await postJson('/api/ventas', d, { cargando: 'Registrando venta...' });
  restaurar();
  registrando = false;
  if (!res.ok) return mensaje('checkoutMsg', res);

  $('dlgCheckout').close();
  limpiarVenta();
  document.dispatchEvent(new CustomEvent('venta-registrada'));
  toast(`Venta ${res.comprobante} registrada · ${soles(res.total)}${res.vuelto > 0 ? ` · Vuelto ${soles(res.vuelto)}` : ''}`);
  imprimirVenta(res.id);
  buscarProductos();
  $('ventaBuscar').focus();
}

function limpiarVenta() {
  carrito.clear();
  $('checkoutForm').reset();
  marcarRadio('tipo', 'boleta');
  marcarRadio('tipoPago', 'efectivo');
  marcarRadio('modoEfectivo', 'exacto');
  $('clienteEstado').textContent = '';
  renderCarrito();
}

// ---------------------------------------------------------------------
// Mis ventas (ultimas 24 horas del usuario en sesion)
// ---------------------------------------------------------------------
async function cargarMisVentas() {
  const cont = $('misVentasContenido');
  cont.innerHTML = '<div class="ventas-modal-loading"><i class="fa fa-spinner fa-spin"></i><span>Cargando tus ventas...</span></div>';
  const lista = await api('/api/ventas?mias=1&horas=24&limite=300', { silencioso: true });
  if (!Array.isArray(lista)) {
    cont.innerHTML = `<div class="alert alert-danger">${h(lista.error || 'No se pudieron cargar tus ventas')}</div>`;
    return;
  }
  if (!lista.length) {
    cont.innerHTML = '<div class="mis-ventas-vacio"><i class="fa fa-inbox"></i><strong>Sin ventas en las últimas 24 horas</strong><span>Las ventas que registres aparecerán aquí.</span></div>';
    return;
  }
  const total = r2(lista.reduce((a, v) => a + v.total, 0));
  const efectivo = r2(lista.reduce((a, v) => a + (v.pago_efectivo || 0), 0));
  const tarjeta = r2(lista.reduce((a, v) => a + (v.pago_tarjeta || 0), 0));
  cont.innerHTML = `
    <div class="mis-ventas-resumen">
      <div><span>Ventas</span><strong>${numero(lista.length)}</strong></div>
      <div><span>Total vendido</span><strong>${soles(total)}</strong></div>
      <div><span>Efectivo</span><strong>${soles(efectivo)}</strong></div>
      <div><span>Tarjeta</span><strong>${soles(tarjeta)}</strong></div>
    </div>
    <div class="mis-ventas-tabla-contenedor">
      <table class="table table-hover mis-ventas-tabla">
        <thead><tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th class="text-right">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>${lista.map((v) => `<tr>
          <td><strong>${h(v.comprobante)}</strong><small class="d-block">${h(COMPROBANTES[v.tipo_comprobante] || '')}</small></td>
          <td>${fechaHora(v.fecha)}</td>
          <td>${h(v.cliente_nombre || 'Clientes Varios')}${v.cliente_doc ? `<small class="d-block">${h(v.cliente_doc)}</small>` : ''}</td>
          <td>${h(MEDIOS[v.medio_pago] || v.medio_pago)}</td>
          <td class="text-right mis-ventas-total">${soles(v.total)}</td>
          <td><span class="mis-ventas-estado ${v.sincronizado ? 'is-paid' : 'is-pending'}">${v.sincronizado ? 'Sincronizada' : 'Por subir'}</span></td>
          <td><button type="button" class="btn btn-default btn-xs" data-reimprimir="${v.id}" title="Reimprimir"><i class="fa fa-print"></i></button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------
// Estado (caja / conexion) y arranque
// ---------------------------------------------------------------------
export async function refrescarVentas() {
  const [estado, sync] = await Promise.all([
    api('/api/caja/estado', { silencioso: true }),
    api('/api/sync/estado', { silencioso: true }),
  ]);
  cajaAbierta = !!(estado && estado.id);
  $('ventaSinCaja').hidden = cajaAbierta || !ctx.puede('ventas.registrar');
  $('ventaModoOffline').hidden = !(sync && sync.conectado === false);
  setTimeout(() => { if ($('ventaBuscar') && !document.querySelector('dialog[open]')) $('ventaBuscar').focus(); }, 0);
}

export function initVentas(opciones = {}) {
  ctx = { ...ctx, ...opciones };
  const u = ctx.usuario || {};
  $('ventaVendedor').textContent = (u.nombre || '').toUpperCase();
  $('ventaLocal').textContent = u.localNombre || 'Sucursal';
  $('misVentasUsuario').textContent = (u.nombre || '').toUpperCase();
  configurarEmpresa({ local: u.localNombre || '' });

  // Busqueda
  $('ventaBuscar').addEventListener('input', debounce(() => buscarProductos(), 250));
  $('ventaBuscar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); buscarProductos({ agregarUnico: true }); }
    if (e.key === 'ArrowDown') {
      const primero = document.querySelector('#div_productos input:not([disabled])');
      if (primero) { e.preventDefault(); primero.focus(); primero.select(); }
    }
  });
  $('btnBuscarProducto').addEventListener('click', () => buscarProductos({ agregarUnico: true }));

  const tbody = $('div_productos');
  tbody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const id = Number(b.closest('tr').dataset.id);
    if (b.dataset.accion === 'agregar') agregarDesdeFila(id);
    if (b.dataset.accion === 'quitar' && carrito.has(id)) {
      carrito.delete(id);
      b.disabled = true;
      renderCarrito();
      toast('Producto quitado del carrito', 'info');
    }
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.ventas-qty-input') && !e.ctrlKey) {
      e.preventDefault();
      agregarDesdeFila(Number(e.target.closest('tr').dataset.id));
    }
  });
  tbody.addEventListener('focusin', (e) => { if (e.target.matches('.ventas-qty-input')) e.target.select(); });

  // Carrito
  $('div_carrito').addEventListener('click', (e) => {
    const fila = e.target.closest('tr[data-id]');
    if (!fila) return;
    const linea = carrito.get(Number(fila.dataset.id));
    if (!linea) return;
    const mod = e.target.closest('[data-mod]');
    if (mod) {
      const delta = Number(mod.dataset.delta);
      const cajas = linea.cajas + (mod.dataset.mod === 'cajas' ? delta : 0);
      const fracciones = linea.fracciones + (mod.dataset.mod === 'fracciones' ? delta : 0);
      if (cajas >= 0 && fracciones >= 0) cambiarCarrito(linea.p, cajas, fracciones);
    }
    if (e.target.closest('[data-eliminar]')) { carrito.delete(linea.p.id); renderCarrito(); renderResultados(); }
  });
  $('btnVaciarCarrito').addEventListener('click', async () => {
    if (!carrito.size) return;
    const ok = await confirmar({ titulo: '¿Vaciar carrito?', texto: 'Se quitarán todos los productos de la venta actual.', aceptar: 'Sí, vaciar', peligro: true });
    if (!ok) return;
    carrito.clear();
    renderCarrito();
    renderResultados();
  });
  const verCarrito = () => { $('ventasCartBubble').classList.remove('is-open'); $('dlgCarrito').showModal(); };
  $('btnVerCarrito').addEventListener('click', verCarrito);
  $('btnBurbujaCarrito').addEventListener('click', () => $('ventasCartBubble').classList.toggle('is-open'));
  $('btnFinalizarVenta').addEventListener('click', abrirCheckout);
  $('btnCarritoFinalizar').addEventListener('click', abrirCheckout);

  // Checkout
  $('dlgCheckout').addEventListener('change', (e) => {
    if (e.target.name === 'tipo') actualizarTipo();
    if (e.target.name === 'modoEfectivo' && e.target.value === 'vuelto') {
      $('efectivoRecibido').readOnly = false;
      $('efectivoRecibido').value = '';
      setTimeout(() => $('efectivoRecibido').focus(), 0);
    }
    actualizarPago();
  });
  $('efectivoRecibido').addEventListener('input', actualizarPago);
  $('efectivoom').addEventListener('input', actualizarPago);
  $('DNI').addEventListener('input', () => buscarClientePorDocumento($('DNI'), $('nameDNI'), null, 8));
  $('RUC').addEventListener('input', () => buscarClientePorDocumento($('RUC'), $('nameRUC'), $('address'), 11));
  $('checkoutForm').addEventListener('submit', (e) => { e.preventDefault(); generarVenta(); });
  $('btnVentaRapida').addEventListener('click', () => {
    marcarRadio('tipo', 'ticket');
    marcarRadio('tipoPago', 'efectivo');
    marcarRadio('modoEfectivo', 'exacto');
    actualizarTipo();
    actualizarPago();
    generarVenta();
  });

  // Mis ventas
  $('btnMisVentas').addEventListener('click', () => { $('dlgMisVentas').showModal(); cargarMisVentas(); });
  $('btnMisVentasActualizar').addEventListener('click', cargarMisVentas);
  $('misVentasContenido').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reimprimir]');
    if (b) imprimirVenta(Number(b.dataset.reimprimir));
  });

  // Atajos: Ctrl+Enter finaliza / confirma, Ctrl+Shift+Enter muestra el carrito.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.key === 'Enter') || $('tab-ventas').hidden) return;
    e.preventDefault();
    if (e.shiftKey) { if (!document.querySelector('dialog[open]')) verCarrito(); return; }
    if ($('dlgCheckout').open) generarVenta();
    else if (!document.querySelector('dialog[open]') || $('dlgCarrito').open) abrirCheckout();
  });

  renderCarrito();
  return refrescarVentas();
}
