import { api, escapeHtml } from '../../api.js';

// DOM
export const $ = (id) => document.getElementById(id);
export const h = escapeHtml;

// Peticiones
export const postJson = (url, body = {}) => api(url, { method: 'POST', body });
export const putJson = (url, body = {}) => api(url, { method: 'PUT', body });

// Formateadores
export const soles = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
export const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '');

// Mensajes
export function mensaje(id, res, textoOk = 'Operación exitosa') {
  const el = $(id);
  if (!el) return;
  el.className = res.ok ? 'ok-msg' : 'error-msg';
  el.textContent = res.ok ? textoOk : res.error;
}

export function limpiarMensaje(id) {
  const el = $(id);
  if (!el) return;
  el.textContent = '';
  el.className = '';
}

// Utilidades
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function badgeEstado(activo) {
  return activo ? '<span class="badge badge-activo">Activo</span>' : '<span class="badge badge-inactivo">Inactivo</span>';
}

export function renderPaginador(contenedor, r, alCambiar) {
  const el = $(contenedor);
  if (!r || r.total === 0) { el.innerHTML = '<span class="muted">Sin resultados</span>'; return; }
  el.innerHTML = `
    <span class="muted">${r.total} registro(s) · página ${r.pagina} de ${r.paginas}</span>
    <button type="button" class="secundario" data-pag="${r.pagina - 1}" ${r.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <button type="button" class="secundario" data-pag="${r.pagina + 1}" ${r.pagina >= r.paginas ? 'disabled' : ''}>Siguiente ›</button>`;
  el.querySelectorAll('[data-pag]').forEach((b) => b.addEventListener('click', () => alCambiar(Number(b.dataset.pag))));
}