// Estado de la sincronizacion automatica con el sistema central.
import { api } from '../../api.js';
import { $, h, numero, fechaHora, mensaje, postJson, toast, botonCargando } from '../core/utils.js';

let temporizador = null;

export async function cargarSyncEstado() {
  const e = await api('/api/sync/estado', { silencioso: true });
  if (!e || e.pendientes === undefined) return;
  const kpi = (icono, color, titulo, valor, detalle, primaria) => `<div class="dashboard-card${primaria ? ' dashboard-card-primary' : ''}">
    <div class="dashboard-card-icon${color ? ` dashboard-card-icon-${color}` : ''}"><i class="fa ${icono}"></i></div>
    <span>${titulo}</span><strong>${valor}</strong><small>${h(detalle)}</small></div>`;
  $('syncKpis').innerHTML = [
    kpi('fa-cloud-upload', '', 'Ventas por subir', numero(e.pendientes), 'Guardadas en esta terminal.', true),
    kpi('fa-signal', 'blue', 'Conexión', e.conectado === false ? 'Sin conexión' : e.conectado ? 'En línea' : 'Sin verificar', e.ultimoIntento ? `Último intento ${fechaHora(e.ultimoIntento)}` : 'Aún no se intenta'),
    kpi('fa-clock-o', 'amber', 'Última sincronización', e.lastSyncAt ? fechaHora(e.lastSyncAt) : 'Nunca', 'Subida de ventas y precios.'),
    kpi('fa-refresh', 'red', 'Automática', e.automatica ? `Cada ${e.intervaloSegundos} s` : 'Desactivada', 'Reintenta sola al volver internet.'),
  ].join('');

  const clase = e.enCurso ? 'alerta' : e.conectado === false ? 'error' : e.pendientes ? 'alerta' : 'ok';
  const icono = e.enCurso ? 'fa-refresh fa-spin' : e.conectado === false ? 'fa-plug' : e.pendientes ? 'fa-cloud-upload' : 'fa-check-circle';
  const texto = e.enCurso ? 'Sincronizando...'
    : e.conectado === false ? 'Sin conexión con el central. Puedes seguir vendiendo; las ventas se subirán solas.'
      : e.pendientes ? `${e.pendientes} venta(s) esperando subir al central.` : 'Todo sincronizado.';
  $('syncEstado').className = `sync-estado-grande ${clase}`;
  $('syncEstado').innerHTML = `<i class="fa ${icono}"></i><div><strong>${h(texto)}</strong>
    <small class="d-block text-muted">Servidor central: ${h(e.centralUrl || '')}</small>
    ${e.ultimoError ? `<small class="d-block text-danger">${h(e.ultimoError)}</small>` : ''}</div>`;
}

export function initSync() {
  const boton = $('btnSincronizar');
  if (boton) {
    boton.addEventListener('click', async () => {
      const restaurar = botonCargando(boton, 'Sincronizando...');
      const r = await postJson('/api/sync', {}, { cargando: 'Sincronizando con el central...', tiempoLimite: 120000 });
      restaurar();
      mensaje('syncMsg', r, `Listo: ${r.ventasSubidas || 0} venta(s) subidas y ${r.productosActualizados || 0} precio(s) actualizados.`);
      if (r.ok) toast('Sincronización completada');
      document.dispatchEvent(new CustomEvent('sync-completada'));
      cargarSyncEstado();
    });
  }
  // Mientras la vista esta visible se refresca el estado sola.
  clearInterval(temporizador);
  temporizador = setInterval(() => { if (!$('tab-sync').hidden) cargarSyncEstado(); }, 10000);
  return cargarSyncEstado();
}
