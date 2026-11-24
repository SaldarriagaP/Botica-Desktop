// Apertura y cierre de caja con el aspecto de aperturaCierre del web
// (verde al abrir, rojo al cerrar).
import { api } from '../../api.js';
import { $, h, soles, fechaHora, mensaje, limpiarMensaje, postJson, toast, confirmar, botonCargando, MEDIOS } from '../core/utils.js';
import { imprimirCaja, imprimirVenta } from './comprobante.js';

let ctx = { puede: () => false, usuario: null, ir: () => {} };
let turno = null;

const r2 = (n) => Math.round(n * 100) / 100;

function pintarDiferencia(el, valor) {
  if (valor === null) { el.textContent = '—'; el.className = ''; return; }
  el.textContent = `${valor > 0 ? '+' : ''}${soles(valor)}`;
  el.className = valor === 0 ? 'cuadra' : valor < 0 ? 'falta' : 'sobra';
}

function actualizarArqueo() {
  if (!turno) return;
  const ef = $('cajaEfectivo').value;
  const tj = $('cajaTarjeta').value;
  const difEf = ef === '' ? null : r2(Number(ef) - turno.efectivo_esperado);
  const difTj = tj === '' ? null : r2(Number(tj) - turno.resumen.tarjeta);
  pintarDiferencia($('cajaDifEfectivo'), difEf);
  pintarDiferencia($('cajaDifTarjeta'), difTj);
  $('cajaObsCampo').hidden = !((difEf !== null && difEf !== 0) || (difTj !== null && difTj !== 0));
}

export async function cargarCaja() {
  const ahora = new Date();
  $('cajaFecha').textContent = ahora.toLocaleDateString('es-PE');
  $('cajaHora').textContent = ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  $('cajaUsuario').textContent = (ctx.usuario.nombre || '').toUpperCase();

  turno = await api('/api/caja/estado', { cargando: 'Consultando caja...' });
  if (turno && turno.ok === false) turno = null;
  const abierta = !!(turno && turno.id);
  const operar = ctx.puede('caja.operar');

  $('tab-caja').classList.toggle('modo-cierre', abierta);
  $('cajaHeroIcono').className = `fa ${abierta ? 'fa-lock' : 'fa-unlock'}`;
  $('cajaTitulo').textContent = abierta ? 'Cierre de caja' : 'Apertura de caja';
  $('cajaSubtitulo').textContent = abierta
    ? 'Cuenta el efectivo y los vouchers del turno y declara los montos para cerrar.'
    : 'Registra el monto inicial para comenzar las ventas del turno.';
  $('cajaOperacion').textContent = abierta ? 'Cierre' : 'Apertura';
  $('cajaAperturaFila').hidden = !abierta;
  if (abierta) $('cajaAbiertaDesde').textContent = `${fechaHora(turno.opened_at)} · ${turno.usuario}`;
  const irVentas = $('cajaIrVentas');
  if (irVentas) irVentas.hidden = !abierta;

  $('cajaPanelApertura').hidden = abierta || !operar;
  $('cajaPanelCierre').hidden = !abierta || !operar;
  limpiarMensaje('cajaAbrirMsg');
  limpiarMensaje('cajaCerrarMsg');

  if (abierta) {
    const r = turno.resumen;
    $('cajaResApertura').textContent = soles(turno.monto_apertura);
    $('cajaResEfectivo').textContent = soles(r.efectivo);
    $('cajaResTarjeta').textContent = soles(r.tarjeta);
    $('cajaResVentas').textContent = String(r.ventas);
    $('cajaResEsperado').textContent = soles(turno.efectivo_esperado);
    actualizarArqueo();
    cargarVentasTurno();
  } else {
    $('cajaTurnoPanel').hidden = true;
    if (operar) setTimeout(() => $('cajaMontoApertura').focus(), 0);
  }
}

async function cargarVentasTurno() {
  if (!ctx.puede('ventas.ver')) return;
  const lista = await api(`/api/ventas?caja=${turno.id}&limite=300`, { silencioso: true });
  if (!Array.isArray(lista)) return;
  $('cajaTurnoPanel').hidden = false;
  $('cajaTurnoContador').textContent = String(lista.length);
  $('cajaTurnoTabla').innerHTML = lista.length ? lista.map((v) => `<tr>
    <td><strong>${h(v.comprobante)}</strong></td><td>${fechaHora(v.fecha)}</td>
    <td>${h(v.cliente_nombre || 'Clientes Varios')}</td><td>${h(MEDIOS[v.medio_pago] || v.medio_pago)}</td>
    <td class="text-right">${soles(v.total)}</td>
    <td>${v.sincronizado ? '<span class="label label-success">sincronizada</span>' : '<span class="label label-pendiente">por subir</span>'}</td>
    <td><button type="button" class="btn btn-default btn-xs" data-reimprimir="${v.id}" title="Reimprimir"><i class="fa fa-print"></i></button></td>
  </tr>`).join('') : '<tr class="fila-vacia"><td colspan="7"><i class="fa fa-inbox"></i>Aún no hay ventas en este turno</td></tr>';
}

export function initCaja(opciones = {}) {
  ctx = { ...ctx, ...opciones };

  $('cajaAbrirForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = $('cajaMontoApertura').value;
    if (valor === '' || Number(valor) < 0) return mensaje('cajaAbrirMsg', { ok: false, error: 'Ingresa el monto de apertura (puede ser 0)' });
    const restaurar = botonCargando($('btnAbrirCaja'), 'Abriendo caja...');
    const res = await postJson('/api/caja/abrir', { monto: Number(valor) }, { cargando: 'Abriendo caja...' });
    restaurar();
    if (!res.ok) return mensaje('cajaAbrirMsg', res);
    $('cajaMontoApertura').value = '';
    toast(`Caja abierta con ${soles(valor)}`);
    document.dispatchEvent(new CustomEvent('caja-cambio'));
    if (ctx.puede('ventas.registrar')) ctx.ir('ventas');
    else cargarCaja();
  });

  $('cajaEfectivo').addEventListener('input', actualizarArqueo);
  $('cajaTarjeta').addEventListener('input', actualizarArqueo);

  $('cajaCerrarForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('cajaEfectivo').value === '') return mensaje('cajaCerrarMsg', { ok: false, error: 'Ingresa el efectivo contado' });
    const ok = await confirmar({
      titulo: '¿Cerrar caja?', texto: 'No se podrán registrar más ventas en este turno y se imprimirá el reporte.', aceptar: 'Sí, cerrar caja', peligro: true,
    });
    if (!ok) return;
    const restaurar = botonCargando($('btnCerrarCaja'), 'Cerrando caja...');
    const res = await postJson('/api/caja/cerrar', {
      monto: Number($('cajaEfectivo').value),
      tarjeta: $('cajaTarjeta').value === '' ? null : Number($('cajaTarjeta').value),
      observacion: $('cajaObservacion').value,
    }, { cargando: 'Cerrando caja...' });
    restaurar();
    if (!res.ok) {
      if (res.code === 'DESCUADRE') { $('cajaObsCampo').hidden = false; $('cajaObservacion').focus(); }
      return mensaje('cajaCerrarMsg', res);
    }
    $('cajaCerrarForm').reset();
    toast('Caja cerrada correctamente');
    document.dispatchEvent(new CustomEvent('caja-cambio'));
    if (ctx.puede('ventas.ver')) imprimirCaja(res.id);
    cargarCaja();
  });

  $('btnReporteUltimaCaja')?.addEventListener('click', async () => {
    const lista = await api('/api/caja/historial?limite=5', { cargando: 'Buscando última caja...' });
    const ultima = Array.isArray(lista) && (lista.find((c) => !c.abierta) || lista[0]);
    if (!ultima) return toast('Todavía no hay cajas registradas', 'info');
    imprimirCaja(ultima.id);
  });

  $('cajaTurnoTabla').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reimprimir]');
    if (b) imprimirVenta(Number(b.dataset.reimprimir));
  });

  return cargarCaja();
}
