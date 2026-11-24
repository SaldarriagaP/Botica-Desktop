// Comprobantes (ticket 80 mm) y reporte de caja imprimibles.
import { api } from '../../api.js';
import { h, soles, fechaHora, imprimir, toast, MEDIOS, COMPROBANTES } from '../core/utils.js';

let empresa = { nombre: 'FARMACIA SOLIDARIA', local: '' };
export function configurarEmpresa(datos) { empresa = { ...empresa, ...datos }; }

const fila = (a, b, clase = '') => `<tr class="${clase}"><td>${a}</td><td class="der">${b}</td></tr>`;

export function ticketHtml(v) {
  const tipo = COMPROBANTES[v.tipo_comprobante] || 'Comprobante';
  const titulo = v.tipo_comprobante === 'ticket' ? 'TICKET DE VENTA' : `${tipo.toUpperCase()} DE VENTA ELECTRÓNICA`;
  const items = (v.items || []).map((i) => `
    <tr><td colspan="2">${h(i.nombre)}</td></tr>
    <tr><td>${i.cantidad} ${i.modo === 'fraccion' ? 'und' : 'caj'} x ${Number(i.precio).toFixed(2)}</td><td class="der">${Number(i.subtotal ?? i.precio * i.cantidad).toFixed(2)}</td></tr>`).join('');
  const pago = [];
  if (v.medio_pago === 'efectivo') {
    pago.push(fila('Efectivo', soles(v.monto_recibido || v.total)));
    if (v.vuelto > 0) pago.push(fila('Vuelto', soles(v.vuelto)));
  } else if (v.medio_pago === 'multipago') {
    pago.push(fila('Efectivo', soles(v.pago_efectivo)), fila('Tarjeta', soles(v.pago_tarjeta)));
  } else {
    pago.push(fila(h(MEDIOS[v.medio_pago] || v.medio_pago), soles(v.total)));
  }
  if (v.referencia_pago) pago.push(fila('Ref.', h(v.referencia_pago)));

  return `<div class="ticket">
    <h1>${h(empresa.nombre)}</h1>
    ${empresa.local ? `<div class="centro">${h(empresa.local)}</div>` : ''}
    <hr><h2>${titulo}</h2><div class="centro"><strong>${h(v.comprobante)}</strong></div><hr>
    <div>Fecha: ${fechaHora(v.fecha)}</div>
    <div>Cajero: ${h(v.usuario || '')}</div>
    ${v.tipo_comprobante !== 'ticket' ? `<div>Cliente: ${h(v.cliente_nombre || 'Cliente no registrado')}</div>
      ${v.cliente_doc ? `<div>${v.tipo_comprobante === 'factura' ? 'RUC' : 'DNI'}: ${h(v.cliente_doc)}</div>` : ''}
      ${v.cliente_direccion ? `<div>Dir.: ${h(v.cliente_direccion)}</div>` : ''}` : ''}
    <hr><table>${items}</table><hr>
    <table>
      ${fila('OP. GRAVADAS', soles(v.op_gravada))}
      ${fila('OP. EXONERADAS', soles(v.op_exonerada))}
      ${fila('IGV (18%)', soles(v.igv))}
      ${fila('TOTAL', soles(v.total), 'total')}
    </table><hr>
    <table>${pago.join('')}</table><hr>
    <div class="centro">${v.sincronizado ? '' : 'Emitido en modo local. '}Gracias por su compra</div>
  </div>`;
}

export async function imprimirVenta(id) {
  const r = await api(`/api/ventas/${id}`, { cargando: 'Preparando comprobante...' });
  if (!r.ok) return toast(r.error || 'No se pudo cargar la venta', 'error');
  imprimir(ticketHtml(r.venta));
}

export function reporteCajaHtml(c) {
  const r = c.resumen || { porMedio: [], ventas: 0, total: 0, efectivo: 0, tarjeta: 0 };
  const esperado = c.monto_esperado ?? c.efectivo_esperado;
  const tarjetaEsperada = c.tarjeta_esperada ?? r.tarjeta;
  return `<div class="reporte">
    <h1>${h(empresa.nombre)}</h1>
    <h2>REPORTE DE CAJA N° ${c.id}</h2>
    <div class="centro">${h(c.local_nombre || empresa.local)}</div><hr>
    <table>
      ${fila('Responsable', h(c.usuario))}
      ${fila('Apertura', fechaHora(c.opened_at))}
      ${fila('Cierre', c.closed_at ? fechaHora(c.closed_at) : 'Caja abierta')}
      ${fila('Monto de apertura', soles(c.monto_apertura))}
      ${fila('Ventas registradas', r.ventas)}
      ${fila('Total vendido', soles(r.total), 'total')}
    </table>
    <h2 style="margin-top:12px">Ventas por medio de pago</h2>
    <table><tr><th>Medio</th><th class="der">Ventas</th><th class="der">Total</th></tr>
      ${r.porMedio.map((m) => `<tr><td>${h(MEDIOS[m.medio_pago] || m.medio_pago)}</td><td class="der">${m.ventas}</td><td class="der">${soles(m.total)}</td></tr>`).join('') || '<tr><td colspan="3">Sin ventas</td></tr>'}
    </table>
    <h2 style="margin-top:12px">Arqueo</h2>
    <table>
      ${fila('Efectivo esperado', soles(esperado))}
      ${c.closed_at ? fila('Efectivo declarado', soles(c.monto_cierre)) : ''}
      ${c.closed_at ? fila('Diferencia efectivo', soles(c.diferencia)) : ''}
      ${fila('Tarjeta esperada', soles(tarjetaEsperada))}
      ${c.closed_at && c.tarjeta_declarada !== null && c.tarjeta_declarada !== undefined ? fila('Tarjeta declarada', soles(c.tarjeta_declarada)) : ''}
    </table>
    ${c.observacion ? `<p><strong>Observación:</strong> ${h(c.observacion)}</p>` : ''}
    <p style="margin-top:40px;text-align:center">______________________________<br>Firma del responsable</p>
  </div>`;
}

export async function imprimirCaja(id) {
  const r = await api(`/api/caja/${id}`, { cargando: 'Preparando reporte de caja...' });
  if (!r.ok) return toast(r.error || 'No se pudo cargar la caja', 'error');
  imprimir(reporteCajaHtml(r.caja));
}
