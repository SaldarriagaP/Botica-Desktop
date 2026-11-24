// Historial de ventas y de cajas (con reimpresion de comprobantes/reportes).
import { api } from '../../api.js';
import { $, h, soles, numero, fechaHora, debounce, paginarLocal, renderPaginador, filaCargando, filaVacia, MEDIOS, COMPROBANTES } from '../core/utils.js';
import { imprimirVenta, imprimirCaja } from './comprobante.js';

const POR_PAGINA = 15;

function kpi(icono, color, titulo, valor, detalle, primaria = false) {
  return `<div class="dashboard-card${primaria ? ' dashboard-card-primary' : ''}">
    <div class="dashboard-card-icon${color ? ` dashboard-card-icon-${color}` : ''}"><i class="fa ${icono}"></i></div>
    <span>${h(titulo)}</span><strong>${valor}</strong><small>${h(detalle)}</small></div>`;
}

// ---------------- Historial de ventas ----------------
let ventas = [];
let paginaVentas = 1;

export async function cargarHistorial() {
  filaCargando('#histTabla tbody', 8, 'Cargando ventas...');
  const horas = $('histHoras').value;
  const lista = await api(`/api/ventas?limite=500${horas ? `&horas=${horas}` : ''}`, { cargando: 'Cargando ventas...' });
  if (!Array.isArray(lista)) return;
  ventas = lista;
  const total = ventas.reduce((a, v) => a + v.total, 0);
  const pendientes = ventas.filter((v) => !v.sincronizado).length;
  $('histKpis').innerHTML = [
    kpi('fa-shopping-cart', '', 'Ventas', numero(ventas.length), 'En el periodo seleccionado.', true),
    kpi('fa-money', 'blue', 'Total vendido', soles(total), 'Suma de comprobantes.'),
    kpi('fa-ticket', 'amber', 'Ticket promedio', soles(ventas.length ? total / ventas.length : 0), 'Por venta.'),
    kpi('fa-cloud-upload', 'red', 'Por sincronizar', numero(pendientes), 'Se suben solas al volver internet.'),
  ].join('');
  renderHistorial(1);
}

function renderHistorial(pagina = paginaVentas) {
  const f = $('histBuscar').value.trim().toUpperCase();
  let lista = $('histPendientes').checked ? ventas.filter((v) => !v.sincronizado) : ventas;
  if (f) lista = lista.filter((v) => `${v.comprobante} ${v.cliente_nombre || ''} ${v.cliente_doc || ''} ${v.usuario || ''}`.toUpperCase().includes(f));
  const r = paginarLocal(lista, pagina, POR_PAGINA);
  paginaVentas = r.pagina;
  document.querySelector('#histTabla tbody').innerHTML = r.items.length ? r.items.map((v) => `<tr>
    <td><strong>${h(v.comprobante)}</strong><small>${h(COMPROBANTES[v.tipo_comprobante] || '')}</small></td>
    <td>${fechaHora(v.fecha)}</td>
    <td>${h(v.cliente_nombre || 'Clientes Varios')}${v.cliente_doc ? `<small>${h(v.cliente_doc)}</small>` : ''}</td>
    <td>${h(v.usuario || '')}</td>
    <td>${h(MEDIOS[v.medio_pago] || v.medio_pago)}</td>
    <td class="text-right"><strong>${soles(v.total)}</strong></td>
    <td>${v.sincronizado ? '<span class="label label-success">sincronizada</span>' : `<span class="label label-pendiente" title="${h(v.sync_error || 'Pendiente de subir al central')}">por subir</span>`}</td>
    <td class="celda-acciones">
      <button type="button" class="btn btn-warning btn-xs" data-ver="${v.id}" title="Ver detalle"><i class="fa fa-search-plus"></i></button>
      <button type="button" class="btn btn-primary btn-xs" data-imprimir="${v.id}" title="Reimprimir"><i class="fa fa-print"></i></button>
    </td></tr>`).join('') : filaVacia(8, 'No hay ventas para mostrar', 'fa-inbox');
  renderPaginador('histPaginador', r, renderHistorial);
}

function verVenta(v) {
  $('vdTitulo').textContent = `${COMPROBANTES[v.tipo_comprobante] || ''} ${v.comprobante}`;
  $('vdImprimir').dataset.id = v.id;
  $('vdCuerpo').innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <div class="col-sm-6"><strong>Cliente:</strong> ${h(v.cliente_nombre || 'Clientes Varios')} ${v.cliente_doc ? `(${h(v.cliente_doc)})` : ''}<br><strong>Cajero:</strong> ${h(v.usuario || '')}</div>
      <div class="col-sm-6"><strong>Fecha:</strong> ${fechaHora(v.fecha)}<br><strong>Pago:</strong> ${h(MEDIOS[v.medio_pago] || v.medio_pago)}${v.referencia_pago ? ` · Ref. ${h(v.referencia_pago)}` : ''}</div>
    </div>
    <table class="table table-striped">
      <thead><tr><th>Producto</th><th>Tipo</th><th class="text-right">Cant.</th><th class="text-right">Precio</th><th class="text-right">Subtotal</th></tr></thead>
      <tbody>${(v.items || []).map((i) => `<tr><td>${h(i.nombre)}</td><td>${i.modo === 'fraccion' ? 'Fracción' : 'Caja'}</td><td class="text-right">${i.cantidad}</td><td class="text-right">${soles(i.precio)}</td><td class="text-right">${soles(i.subtotal ?? i.precio * i.cantidad)}</td></tr>`).join('')}</tbody>
      <tfoot class="ventas-cart-totales">
        <tr><td colspan="4" class="text-right">OP. GRAVADAS</td><td class="text-right">${soles(v.op_gravada)}</td></tr>
        <tr><td colspan="4" class="text-right">IGV (18%)</td><td class="text-right">${soles(v.igv)}</td></tr>
        <tr><td colspan="4" class="text-right">OP. EXONERADAS</td><td class="text-right">${soles(v.op_exonerada)}</td></tr>
        <tr class="total"><td colspan="4" class="text-right">TOTAL</td><td class="text-right">${soles(v.total)}</td></tr>
      </tfoot>
    </table>
    ${v.sync_error ? `<div class="alert alert-warning"><i class="fa fa-exclamation-triangle"></i> ${h(v.sync_error)}</div>` : ''}`;
  $('dlgVentaDetalle').showModal();
}

export function initHistorial() {
  $('histHoras').addEventListener('change', cargarHistorial);
  $('histPendientes').addEventListener('change', () => renderHistorial(1));
  $('histBuscar').addEventListener('input', debounce(() => renderHistorial(1), 150));
  document.querySelector('#histTabla tbody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.imprimir) imprimirVenta(Number(b.dataset.imprimir));
    if (b.dataset.ver) verVenta(ventas.find((v) => v.id === Number(b.dataset.ver)));
  });
  $('vdImprimir').addEventListener('click', () => imprimirVenta(Number($('vdImprimir').dataset.id)));
  return cargarHistorial();
}

// ---------------- Historial de cajas ----------------
let cajas = [];

export async function cargarCajas() {
  filaCargando('#cajasTabla tbody', 10, 'Cargando cajas...');
  const lista = await api('/api/caja/historial?limite=200', { cargando: 'Cargando cajas...' });
  if (!Array.isArray(lista)) return;
  cajas = lista;
  const cerradas = cajas.filter((c) => !c.abierta);
  const descuadres = cerradas.filter((c) => c.diferencia || (c.tarjeta_declarada ?? 0) !== (c.tarjeta_esperada ?? 0)).length;
  $('cajasKpis').innerHTML = [
    kpi('fa-archive', '', 'Turnos registrados', numero(cajas.length), 'Aperturas de caja.', true),
    kpi('fa-unlock', 'blue', 'Caja abierta', cajas.some((c) => c.abierta) ? 'Sí' : 'No', 'Estado actual.'),
    kpi('fa-money', 'amber', 'Total vendido', soles(cajas.reduce((a, c) => a + c.resumen.total, 0)), 'En los turnos listados.'),
    kpi('fa-exclamation-triangle', 'red', 'Con descuadre', numero(descuadres), 'Cierres con diferencia.'),
  ].join('');
  renderCajas(1);
}

function renderCajas(pagina) {
  const r = paginarLocal(cajas, pagina, POR_PAGINA);
  document.querySelector('#cajasTabla tbody').innerHTML = r.items.length ? r.items.map((c) => {
    const dif = c.diferencia || 0;
    return `<tr>
      <td>${c.id}</td><td><strong>${h(c.usuario)}</strong></td>
      <td>${fechaHora(c.opened_at)}<small>${soles(c.monto_apertura)}</small></td>
      <td>${c.closed_at ? `${fechaHora(c.closed_at)}<small>${soles(c.monto_cierre)}</small>` : '—'}</td>
      <td class="text-right">${c.resumen.ventas}</td>
      <td class="text-right"><strong>${soles(c.resumen.total)}</strong></td>
      <td class="text-right">${c.abierta ? '—' : soles(c.monto_esperado)}</td>
      <td class="text-right ${dif < 0 ? 'text-danger' : dif > 0 ? 'text-primary' : ''}">${c.abierta ? '—' : soles(dif)}</td>
      <td>${c.abierta ? '<span class="label label-success">abierta</span>' : '<span class="label label-default">cerrada</span>'}</td>
      <td><button type="button" class="btn btn-primary btn-xs" data-imprimir="${c.id}" title="Imprimir reporte"><i class="fa fa-print"></i></button></td>
    </tr>`;
  }).join('') : filaVacia(10, 'Todavía no hay cajas registradas', 'fa-inbox');
  renderPaginador('cajasPaginador', r, renderCajas);
}

export function initCajas() {
  document.querySelector('#cajasTabla tbody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-imprimir]');
    if (b) imprimirCaja(Number(b.dataset.imprimir));
  });
  return cargarCajas();
}
