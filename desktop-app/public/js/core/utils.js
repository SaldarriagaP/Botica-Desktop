import { api, escapeHtml, iniciarCarga } from '../../api.js';

export { iniciarCarga };

// DOM
export const $ = (id) => document.getElementById(id);
export const h = escapeHtml;

// Peticiones (POST/PUT muestran "Procesando..." si demoran)
export const postJson = (url, body = {}, opciones = {}) => api(url, { method: 'POST', body, ...opciones });
export const putJson = (url, body = {}, opciones = {}) => api(url, { method: 'PUT', body, ...opciones });

// Formateadores (mismo formato que el web: "S/ 12.50")
export const soles = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
export const numero = (n) => Number(n || 0).toLocaleString('es-PE');
export const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fechaHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Mensajes dentro de formularios
export function mensaje(id, res, textoOk = 'Operación exitosa') {
  const el = $(id);
  if (!el) return;
  el.className = res.ok ? 'msg-ok' : 'msg-error';
  el.innerHTML = `<i class="fa ${res.ok ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i><span>${h(res.ok ? textoOk : res.error)}</span>`;
}

export function limpiarMensaje(id) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = '';
  el.className = '';
}

// Utilidades
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Etiquetas como en las tablas del web ("activo" / "inactivo").
export function badgeEstado(activo) {
  return activo ? '<span class="label label-success">activo</span>' : '<span class="label label-danger">inactivo</span>';
}

// Fila de "cargando" para tablas mientras llega la respuesta.
export function filaCargando(tbody, columnas, texto = 'Cargando...') {
  const el = typeof tbody === 'string' ? document.querySelector(tbody) : tbody;
  if (el && !el.children.length) {
    el.innerHTML = `<tr class="cargando-tabla"><td colspan="${columnas}"><i class="fa fa-spinner fa-spin"></i> ${h(texto)}</td></tr>`;
  }
}

export function filaVacia(columnas, texto, icono = 'fa-inbox') {
  return `<tr class="fila-vacia"><td colspan="${columnas}"><i class="fa ${icono}"></i>${h(texto)}</td></tr>`;
}

// Boton en estado "procesando" con rueda girando; devuelve la funcion que lo restaura.
export function botonCargando(boton, texto = 'Procesando...') {
  if (!boton) return () => {};
  const original = boton.innerHTML;
  boton.disabled = true;
  boton.innerHTML = `<i class="fa fa-spinner fa-spin"></i> ${h(texto)}`;
  return () => { boton.disabled = false; boton.innerHTML = original; };
}

// Pie de tabla como el de DataTables del web: "Mostrando registros del X al Y
// de un total de Z registros" + paginacion "Anterior / 1 2 3 / Siguiente".
export function renderPaginador(contenedor, r, alCambiar) {
  const el = $(contenedor);
  if (!el) return;
  if (!r || !r.total) { el.innerHTML = '<span class="info">Mostrando registros del 0 al 0 de un total de 0 registros</span>'; return; }
  const desde = (r.pagina - 1) * r.porPagina + 1;
  const hasta = Math.min(r.pagina * r.porPagina, r.total);
  const paginas = [];
  const ini = Math.max(1, Math.min(r.pagina - 2, r.paginas - 4));
  for (let p = ini; p <= Math.min(r.paginas, ini + 4); p++) paginas.push(p);
  el.innerHTML = `
    <span class="info">Mostrando registros del ${numero(desde)} al ${numero(hasta)} de un total de ${numero(r.total)} registros</span>
    <ul class="pagination pagination-sm">
      <li class="page-item ${r.pagina <= 1 ? 'disabled' : ''}"><a class="page-link" data-pag="${r.pagina - 1}">&larr; Anterior</a></li>
      ${paginas.map((p) => `<li class="page-item ${p === r.pagina ? 'active' : ''}"><a class="page-link" data-pag="${p}">${p}</a></li>`).join('')}
      <li class="page-item ${r.pagina >= r.paginas ? 'disabled' : ''}"><a class="page-link" data-pag="${r.pagina + 1}">Siguiente &rarr;</a></li>
    </ul>`;
  el.querySelectorAll('[data-pag]').forEach((a) => a.addEventListener('click', () => {
    const p = Number(a.dataset.pag);
    if (p >= 1 && p <= r.paginas && p !== r.pagina) alCambiar(p);
  }));
}

// Pagina una lista que ya esta en memoria (maestros, usuarios).
export function paginarLocal(lista, pagina, porPagina) {
  const total = lista.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  return { items: lista.slice((p - 1) * porPagina, p * porPagina), total, pagina: p, paginas, porPagina };
}

// Dialogo de confirmacion con el aspecto de SweetAlert2 (como el web).
// Devuelve una promesa que resuelve true si el usuario acepta.
export function confirmar({ titulo = '¿Confirmar?', texto = '', aceptar = 'Confirmar', cancelar = 'Cancelar', peligro = false, icono } = {}) {
  const dlg = $('dlgConfirmar');
  if (!dlg) return Promise.resolve(window.confirm(texto || titulo));
  const tipo = icono || (peligro ? 'peligro' : 'aviso');
  $('cfIcono').className = `swal-icono ${tipo}`;
  $('cfIcono').innerHTML = `<i class="fa ${{ exito: 'fa-check', info: 'fa-info', peligro: 'fa-exclamation', aviso: 'fa-question' }[tipo] || 'fa-question'}"></i>`;
  $('cfTitulo').textContent = titulo;
  $('cfTexto').textContent = texto;
  $('cfAceptar').textContent = aceptar;
  $('cfAceptar').className = `btn ${peligro ? 'btn-danger' : 'btn-primary'}`;
  $('cfCancelar').textContent = cancelar;
  $('cfCancelar').hidden = !cancelar;
  dlg.returnValue = '';
  dlg.showModal();
  $('cfAceptar').focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'si'), { once: true });
  });
}

// Aviso modal de exito o error (como boticaSuccess / boticaAlert del web).
export function alerta(titulo, texto = '', tipo = 'exito') {
  return confirmar({ titulo, texto, aceptar: 'Aceptar', cancelar: '', icono: tipo });
}

// Aviso flotante que desaparece solo.
export function toast(texto, tipo = 'ok') {
  const cont = $('toasts');
  if (!cont) return;
  const el = document.createElement('div');
  el.className = `toast-msg toast-${tipo}`;
  const icono = { ok: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' }[tipo] || 'fa-info-circle';
  el.innerHTML = `<i class="fa ${icono}"></i><span>${h(texto)}</span>`;
  cont.appendChild(el);
  setTimeout(() => el.classList.add('saliendo'), 3400);
  setTimeout(() => el.remove(), 3800);
}

// Imprime un HTML (comprobante o reporte) con el dialogo de impresion.
export function imprimir(html) {
  const zona = $('zonaImpresion');
  zona.innerHTML = html;
  setTimeout(() => {
    window.print();
    setTimeout(() => { zona.innerHTML = ''; }, 500);
  }, 50);
}

export const MEDIOS = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', multipago: 'Multipago', yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia',
};
export const COMPROBANTES = { boleta: 'Boleta', factura: 'Factura', ticket: 'Ticket' };
