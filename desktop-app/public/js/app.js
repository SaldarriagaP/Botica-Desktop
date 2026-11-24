// Interfaz principal de la terminal. Misma estructura visual que el sistema
// web (header, menu lateral, hero, tarjetas KPI, paneles y modales).

import { Sesion, api } from '../api.js';
import {
  $, h, postJson, putJson, soles, numero, fechaHora,
  mensaje, limpiarMensaje, debounce, badgeEstado, renderPaginador, paginarLocal,
  confirmar, toast, filaCargando, filaVacia, botonCargando, MEDIOS, COMPROBANTES,
} from './core/utils.js';
import { initVentas, refrescarVentas } from './controllers/ventas.js';
import { initCaja, cargarCaja } from './controllers/caja.js';
import { initSync, cargarSyncEstado } from './controllers/sync.js';
import { initHistorial, cargarHistorial, initCajas, cargarCajas } from './controllers/reportes.js';

let usuario = null;
const puede = (permiso) => !!usuario && usuario.permisos.includes(permiso);
let tabActual = null;

// =====================================================================
// VISTAS CARGADAS BAJO DEMANDA (views/*.html)
// =====================================================================
const VISTAS = {
  ventas: { init: initVentas, refrescar: refrescarVentas },
  caja: { init: initCaja, refrescar: cargarCaja },
  sync: { init: initSync, refrescar: cargarSyncEstado },
  historial: { init: initHistorial, refrescar: cargarHistorial },
  cajas: { init: initCajas, refrescar: cargarCajas },
};

async function cargarVista(nombre) {
  const contenedor = document.querySelector(`[data-vista="${nombre}"]`);
  const vista = VISTAS[nombre];
  if (contenedor.dataset.cargada === '1') return vista.refrescar();
  const html = await fetch(`views/${nombre}.html`).then((r) => r.text());
  contenedor.innerHTML = html;
  contenedor.dataset.cargada = '1';
  contenedor.querySelectorAll('[data-permiso]').forEach((el) => { if (!puede(el.dataset.permiso)) el.remove(); });
  return vista.init({ puede, usuario, ir: mostrarTab });
}

// =====================================================================
// NAVEGACION (menu lateral como menu.blade.php)
// =====================================================================
const contenedor = $('container');

async function mostrarTab(nombre) {
  const link = document.querySelector(`#nav-accordion a[data-tab="${nombre}"]`);
  if (!link) return;
  tabActual = nombre;

  document.querySelectorAll('#nav-accordion a.active, #nav-accordion li.active').forEach((el) => el.classList.remove('active'));
  link.classList.add('active');
  const li = link.closest('li');
  li.classList.add('active');
  const padre = li.closest('li.sub-menu');
  if (padre) {
    padre.classList.add('active', 'abierto');
    padre.querySelector(':scope > a').classList.add('active');
  }

  document.querySelectorAll('.tab').forEach((t) => { t.hidden = true; });
  $(`tab-${nombre}`).hidden = false;
  document.title = `Panel - ${link.textContent.trim()}`;

  // Punto de venta a pantalla completa, como el modulo de ventas del web.
  contenedor.classList.toggle('ventas-pos-page', nombre === 'ventas');
  contenedor.classList.remove('sidebar-abierto');
  window.scrollTo(0, 0);

  if (VISTAS[nombre]) await cargarVista(nombre);
  else await (REFRESCAR[nombre] || (() => {}))();
}

const REFRESCAR = {
  inicio: () => cargarInicio(),
  productos: () => Promise.all([cargarProdKpis(), cargarCatalogo()]),
  categorias: () => cargarMaestros().then(() => renderMaestro('categorias')),
  laboratorios: () => cargarMaestros().then(() => renderMaestro('marcas')),
  clientes: () => Promise.all([cargarCliKpis(), cargarClientes()]),
  usuarios: () => cargarUsuarios(),
};

document.querySelectorAll('#nav-accordion a[data-tab]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  mostrarTab(a.dataset.tab);
}));
document.querySelectorAll('#nav-accordion li.sub-menu > a').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  a.parentElement.classList.toggle('abierto');
}));

$('btnToggleSidebar').addEventListener('click', () => {
  if (contenedor.classList.contains('ventas-pos-page')) contenedor.classList.toggle('sidebar-abierto');
  else contenedor.classList.toggle('sidebar-closed');
});

// Enlaces internos: <x data-ir="productos">
document.addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) { e.preventDefault(); mostrarTab(ir.dataset.ir); }
});

// Atajo global: F2 = punto de venta
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2' && puede('ventas.registrar') && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    mostrarTab('ventas').then(() => { const b = $('ventaBuscar'); if (b) b.focus(); });
  }
});

// =====================================================================
// DIALOGOS, MENU DE USUARIO Y SESION
// =====================================================================
document.addEventListener('click', (e) => {
  const cerrar = e.target.closest('[data-cerrar]');
  if (cerrar) cerrar.closest('dialog').close();
});
// Clic en el fondo oscuro cierra el modal (como Bootstrap).
document.querySelectorAll('dialog.botica-panel-modal').forEach((d) => d.addEventListener('mousedown', (e) => {
  if (e.target === d) d.close();
}));

$('btnMenuUsuario').addEventListener('click', (e) => {
  e.preventDefault();
  $('menuUsuario').classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menuUsuario')) $('menuUsuario').classList.remove('open');
});

$('btnLogout').addEventListener('click', async (e) => {
  e.preventDefault();
  const ok = await confirmar({ titulo: '¿Cerrar sesión?', texto: 'Tendrás que ingresar de nuevo tu usuario y clave.', aceptar: 'Cerrar sesión' });
  if (!ok) return;
  await postJson('/api/auth/logout', {}, { cargando: 'Cerrando sesión...' });
  Sesion.limpiar();
  window.location.replace('login.html?motivo=logout');
});

$('btnMiPassword').addEventListener('click', (e) => {
  e.preventDefault();
  $('menuUsuario').classList.remove('open');
  $('miPasswordForm').reset();
  limpiarMensaje('mpMsg');
  $('dlgMiPassword').showModal();
});

$('miPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('mpNueva').value !== $('mpNueva2').value) {
    return mensaje('mpMsg', { ok: false, error: 'Las claves nuevas no coinciden' });
  }
  const res = await postJson('/api/auth/cambiar-password', { actual: $('mpActual').value, nueva: $('mpNueva').value }, { cargando: 'Guardando clave...' });
  mensaje('mpMsg', res, 'Clave actualizada. Tus otras sesiones se cerraron.');
  if (res.ok) setTimeout(() => $('dlgMiPassword').close(), 1200);
});

// Tarjeta KPI del web (dashboard-card).
function kpi({ icono, color = '', titulo, valor, detalle = '', primaria = false, ir = '' }) {
  return `<div class="dashboard-card${primaria ? ' dashboard-card-primary' : ''}${ir ? ' clicable' : ''}"${ir ? ` data-ir="${ir}"` : ''}>
    <div class="dashboard-card-icon${color ? ` dashboard-card-icon-${color}` : ''}"><i class="fa ${icono}"></i></div>
    <span>${h(titulo)}</span><strong>${valor}</strong>${detalle ? `<small>${detalle}</small>` : ''}
  </div>`;
}

// =====================================================================
// PANEL (inicio) Y ESTADO DE LA TERMINAL
// =====================================================================
function pintarEstado(r) {
  const chipCaja = $('chipCaja');
  chipCaja.hidden = !(puede('ventas.ver') || puede('caja.operar'));
  chipCaja.className = `chip-estado ${r.caja.abierta ? 'ok' : ''}`;
  chipCaja.querySelector('span').textContent = r.caja.abierta ? 'Caja abierta' : 'Caja cerrada';

  const n = r.sync.pendientes;
  const chipSync = $('chipSync');
  chipSync.className = `chip-estado ${r.sync.enCurso ? 'girando' : n ? 'alerta' : 'ok'}`;
  chipSync.querySelector('i').className = r.sync.enCurso ? 'fa fa-refresh' : 'fa fa-circle';
  chipSync.querySelector('span').textContent = r.sync.enCurso ? 'Sincronizando...' : n ? `${n} por subir` : 'Todo sincronizado';
  $('menuSyncContador').textContent = n ? String(n) : '';

  const chipCon = $('chipConexion');
  const con = r.sync.conectado;
  chipCon.className = `chip-estado ${con === true ? 'ok' : con === false ? 'error' : ''}`;
  chipCon.querySelector('span').textContent = con === true ? 'En línea' : con === false ? 'Sin conexión' : 'Central';
  chipCon.title = con === false
    ? 'Sin conexión con el servidor central: puedes seguir vendiendo, las ventas se subirán solas al volver internet.'
    : 'Conexión con el servidor central';
}

async function actualizarEstado() {
  const r = await api('/api/resumen', { silencioso: true });
  if (!r || !r.caja) return null;
  pintarEstado(r);
  return r;
}

async function cargarInicio() {
  const r = await actualizarEstado();
  if (!r) return;
  $('inicioSaludo').textContent = `Hola, ${(usuario.firstname || usuario.nombre || '').split(' ')[0].toUpperCase()}`;
  $('inicioFecha').textContent = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  $('inicioLocal').textContent = usuario.localNombre || 'Sucursal';
  $('inicioModo').textContent = r.sync.conectado === false ? 'Trabajando sin conexión' : 'Acceso directo al trabajo diario';

  const tarjetas = [];
  if (r.ventasHoy) {
    tarjetas.push(kpi({ icono: 'fa-shopping-cart', titulo: 'Ventas de hoy', valor: numero(r.ventasHoy.ventas), detalle: `${soles(r.ventasHoy.total)} acumulado`, primaria: true, ir: 'historial' }));
  }
  if (puede('ventas.ver') || puede('caja.operar')) {
    tarjetas.push(kpi({
      icono: 'fa-archive', color: 'blue', titulo: 'Caja', valor: r.caja.abierta ? 'Abierta' : 'Cerrada', ir: 'caja',
      detalle: r.caja.abierta ? `Efectivo esperado ${soles(r.caja.efectivo_esperado)}` : 'Ábrela para empezar a vender',
    }));
  }
  if (r.catalogo) {
    tarjetas.push(kpi({ icono: 'fa-exclamation-triangle', color: 'amber', titulo: 'Stock bajo', valor: numero(r.catalogo.stockBajo), detalle: `${numero(r.catalogo.sinStock)} productos sin stock`, ir: 'productos' }));
  }
  tarjetas.push(kpi({
    icono: 'fa-cloud-upload', color: 'red', titulo: 'Ventas por sincronizar', valor: numero(r.sync.pendientes), ir: 'sync',
    detalle: r.sync.lastSyncAt ? `Última sincronización ${fechaHora(r.sync.lastSyncAt)}` : 'Aún no se sincroniza',
  }));
  $('inicioKpis').innerHTML = tarjetas.map((t) => `<div class="col-lg-3 col-md-6 col-sm-6">${t}</div>`).join('');

  $('inicioVentasPanel').hidden = !r.ultimasVentas;
  if (r.ultimasVentas) {
    $('inicioVentas').innerHTML = r.ultimasVentas.length
      ? r.ultimasVentas.map((v) => `<tr>
          <td><strong>${h(v.comprobante)}</strong></td>
          <td>${h(v.cliente_nombre || 'Clientes Varios')}</td>
          <td>${h(v.usuario || '')}</td>
          <td>${fechaHora(v.fecha)}</td>
          <td class="text-right">${soles(v.total)}</td>
          <td class="text-center">${v.sincronizado ? '<i class="fa fa-check text-success" title="Subida al central"></i>' : '<span class="label label-pendiente">pendiente</span>'}</td>
        </tr>`).join('')
      : filaVacia(6, 'Todavía no hay ventas registradas.');
  }

  const salud = [['Productos activos', r.catalogo && r.catalogo.activos], ['Clientes registrados', r.clientes && r.clientes.activos]];
  if (r.catalogo) salud.push(['Productos con stock bajo', r.catalogo.stockBajo, r.catalogo.stockBajo > 0]);
  salud.push(['Ventas por sincronizar', r.sync.pendientes, r.sync.pendientes > 0]);
  $('inicioSalud').innerHTML = salud.filter((s) => s[1] !== undefined && s[1] !== null)
    .map(([t, v, alerta]) => `<div class="dashboard-health-item${alerta ? ' alerta' : ''}"><span>${h(t)}</span><strong>${numero(v)}</strong></div>`).join('');

  const tareas = [];
  if (r.sync.conectado === false) tareas.push(['fa-exclamation-triangle', 'Sin conexión con el central: sigue vendiendo aquí, las ventas se subirán solas cuando vuelva internet.']);
  if (puede('caja.operar') && !r.caja.abierta) tareas.push(['fa-angle-right', 'Abre la caja para empezar a registrar ventas.']);
  if (r.sync.pendientes) tareas.push(['fa-angle-right', `Hay ${r.sync.pendientes} venta(s) pendientes de subir al sistema central.`]);
  if (r.catalogo && r.catalogo.stockBajo) tareas.push(['fa-angle-right', `Revisa ${r.catalogo.stockBajo} producto(s) con stock bajo el mínimo.`]);
  if (puede('caja.operar') && r.caja.abierta) tareas.push(['fa-angle-right', 'Cierra la caja al terminar el turno declarando efectivo y tarjeta.']);
  if (!tareas.length) tareas.push(['fa-check', 'Todo en orden. No hay pendientes.']);
  $('inicioTareas').innerHTML = tareas.map(([i, t]) => `<li><i class="fa ${i}"></i> <span>${h(t)}</span></li>`).join('');
}

$('chipCaja').addEventListener('click', () => mostrarTab('caja'));
$('chipSync').addEventListener('click', () => mostrarTab('sync'));
$('chipConexion').addEventListener('click', () => mostrarTab('sync'));

document.addEventListener('caja-cambio', actualizarEstado);
document.addEventListener('venta-registrada', actualizarEstado);
document.addEventListener('sync-completada', () => {
  actualizarEstado();
  if (tabActual === 'productos') cargarCatalogo();
});

// =====================================================================
// PRODUCTOS
// =====================================================================
const catEstado = { pagina: 1, marcas: [], categorias: [], lista: [], pedido: 0, maestrosCargados: false };

function opciones(lista, { vacio } = {}) {
  return (vacio ? `<option value="">${h(vacio)}</option>` : '') + lista.map((x) => `<option value="${x.id}">${h(x.name)}</option>`).join('');
}

async function cargarMaestros({ forzar = false } = {}) {
  if (catEstado.maestrosCargados && !forzar) return;
  const [marcas, categorias] = await Promise.all([api('/api/marcas', { silencioso: true }), api('/api/categorias', { silencioso: true })]);
  if (!Array.isArray(marcas) || !Array.isArray(categorias)) return;
  catEstado.marcas = marcas;
  catEstado.categorias = categorias;
  catEstado.maestrosCargados = true;

  for (const [id, lista, vacio] of [
    ['catFiltroCategoria', categorias, 'Todas las categorías'], ['catFiltroMarca', marcas, 'Todos los laboratorios'],
    ['pMarca', marcas, 'Seleccione'], ['pCategoria', categorias, 'Seleccione'],
  ]) {
    const actual = $(id).value;
    $(id).innerHTML = opciones(lista, { vacio });
    $(id).value = actual;
  }
}

async function cargarProdKpis() {
  const e = await api('/api/productos/estadisticas', { silencioso: true });
  if (!e || e.total === undefined) return;
  $('prodKpis').innerHTML = [
    kpi({ icono: 'fa-medkit', titulo: 'Productos registrados', valor: numero(e.total), detalle: 'Catalogo total disponible.', primaria: true }),
    kpi({ icono: 'fa-check-circle', color: 'blue', titulo: 'Activos', valor: numero(e.activos), detalle: 'Productos habilitados para uso.' }),
    kpi({ icono: 'fa-money', color: 'amber', titulo: 'Con precio', valor: numero(e.conPrecio), detalle: 'Con precio de venta asignado.' }),
    kpi({ icono: 'fa-ban', color: 'red', titulo: 'Inactivos', valor: numero(e.inactivos), detalle: 'Productos deshabilitados.' }),
  ].join('');
}

async function cargarCatalogo(pagina = catEstado.pagina) {
  const params = new URLSearchParams({
    q: $('catBuscar').value,
    categoria: $('catFiltroCategoria').value,
    marca: $('catFiltroMarca').value,
    stock: $('catFiltroStock').value,
    soloActivos: $('catSoloActivos').checked ? '1' : '0',
    pagina,
    porPagina: $('catPorPagina').value,
  });
  const pedido = ++catEstado.pedido;
  const tbody = document.querySelector('#catalogoTabla tbody');
  filaCargando(tbody, 12, 'Cargando productos...');
  const r = await api('/api/productos?' + params, { cargando: 'Cargando productos...' });
  if (pedido !== catEstado.pedido) return; // llego una respuesta mas nueva
  if (!r || !Array.isArray(r.items)) return;
  catEstado.pagina = r.pagina;
  catEstado.lista = r.items;

  const gestionar = puede('catalogo.gestionar');
  const stock = puede('catalogo.stock');
  const kardex = puede('catalogo.kardex');
  const sol = (n) => `S/. ${Number(n || 0).toFixed(2)}`;

  tbody.innerHTML = r.items.length ? r.items.map((p) => `
    <tr class="${p.stock_bajo ? 'stock-bajo' : ''}">
      <td>${p.id}</td>
      <td><strong>${h(p.name)}</strong></td>
      <td>${h(p.composicion)}</td>
      <td>${h(p.presentacion)}</td>
      <td>${h(p.brand_name)}<small>${h(p.category_name || '')}</small></td>
      <td>${h(p.codigo_barras)}</td>
      <td>${p.se_fracciona ? p.fraccion : 1}</td>
      <td class="num">${sol(p.precio_unidad)}</td>
      <td class="num">${sol(p.se_fracciona ? p.precio_fraccion : 0)}</td>
      <td>${h(p.stock_detalle.texto)}${p.stock_bajo ? ` <span class="label label-warning" title="Mínimo: ${p.stock_minimo}">bajo</span>` : ''}</td>
      <td>${badgeEstado(p.status)}${p.status_igv ? '' : ' <span class="label label-neutro" title="Inafecto al IGV">s/IGV</span>'}</td>
      <td class="celda-acciones">
        ${gestionar ? `<button type="button" class="btn btn-primary btn-xs" data-editar="${p.id}" title="Editar producto"><i class="fa fa-pencil"></i></button>` : ''}
        ${kardex ? `<button type="button" class="btn btn-warning btn-xs" data-kardex="${p.id}" title="Historial (kardex)"><i class="fa fa-search-plus"></i></button>` : ''}
        ${stock ? `<button type="button" class="btn btn-info btn-xs" data-stock="${p.id}" title="Ajustar stock"><i class="fa fa-cubes"></i></button>` : ''}
        ${gestionar ? `<button type="button" class="btn ${p.status ? 'btn-danger' : 'btn-success'} btn-xs" data-estado="${p.id}" data-valor="${p.status ? 0 : 1}" title="${p.status ? 'Desactivar' : 'Activar'}"><i class="fa ${p.status ? 'fa-ban' : 'fa-check'}"></i></button>` : ''}
      </td>
    </tr>`).join('') : filaVacia(12, 'Ningún producto coincide con la búsqueda.', 'fa-search');

  renderPaginador('catPaginador', r, cargarCatalogo);
}

$('catBuscar').addEventListener('input', debounce(() => cargarCatalogo(1), 300));
['catFiltroCategoria', 'catFiltroMarca', 'catFiltroStock', 'catSoloActivos', 'catPorPagina']
  .forEach((id) => $(id).addEventListener('change', () => cargarCatalogo(1)));

document.querySelector('#catalogoTabla tbody').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const p = catEstado.lista.find((x) => x.id === Number(b.dataset.editar || b.dataset.stock || b.dataset.kardex || b.dataset.estado));
  if (!p) return;
  if (b.dataset.editar) abrirProducto(p);
  if (b.dataset.stock) abrirAjusteStock(p);
  if (b.dataset.kardex) abrirKardex(p, 1);
  if (b.dataset.estado) {
    const activar = b.dataset.valor === '1';
    const ok = await confirmar({
      titulo: activar ? '¿Activar producto?' : '¿Desactivar producto?',
      texto: activar ? `"${p.name}" volverá a estar disponible para la venta.` : `"${p.name}" dejará de aparecer en el punto de venta. Su stock y kardex se conservan.`,
      aceptar: activar ? 'Sí, activar' : 'Sí, desactivar',
      peligro: !activar,
    });
    if (!ok) return;
    const res = await postJson(`/api/productos/${p.id}/estado`, { estado: Number(b.dataset.valor) });
    toast(res.ok ? (activar ? 'Producto activado' : 'Producto desactivado') : res.error, res.ok ? 'ok' : 'error');
    cargarCatalogo();
    cargarProdKpis();
  }
});

// --- Modal de producto (crear / editar), campos como _formProducto del web ---
const radio = (nombre) => document.querySelector(`input[name="${nombre}"]:checked`).value;
const marcarRadio = (nombre, valor) => {
  const el = document.querySelector(`input[name="${nombre}"][value="${valor}"]`);
  if (el) el.checked = true;
};

function actualizarCamposFraccion() {
  const fr = radio('pFracciona') === '1';
  document.querySelectorAll('.campo-fraccion').forEach((el) => { el.hidden = !fr; });
}
document.querySelectorAll('input[name="pFracciona"]').forEach((r) => r.addEventListener('change', actualizarCamposFraccion));

let productoEditando = null;

async function abrirProducto(p = null) {
  await cargarMaestros();
  productoEditando = p;
  $('productoForm').reset();
  limpiarMensaje('productoMsg');
  $('productoAviso').hidden = true;
  $('productoId').value = p ? p.id : '';
  $('productoFormTitulo').textContent = p ? 'Editar Producto' : 'Nuevo Producto';
  $('btnGuardarProducto').innerHTML = `<i class="fa fa-check"></i> ${p ? 'Guardar cambios' : 'Crear'}`;
  $('pStockMinimoCampo').hidden = !!p; // al editar, el minimo se cambia desde "Ajustar stock"
  if (p) {
    $('pNombre').value = p.name;
    $('pMarca').value = p.brand;
    $('pCategoria').value = p.category || '';
    $('pComposicion').value = p.composicion;
    $('pPresentacion').value = p.presentacion;
    $('pFormaFarm').value = p.forma_farm;
    $('pBarras').value = p.codigo_barras;
    $('pPrecioCompra').value = p.precio_compra;
    $('pPrecioUnidad').value = p.precio_unidad;
    marcarRadio('pFracciona', p.se_fracciona ? 1 : 0);
    if (p.se_fracciona) { $('pFraccion').value = p.fraccion; $('pPrecioFraccion').value = p.precio_fraccion; }
    marcarRadio('pIgv', p.status_igv ? 1 : 0);
    marcarRadio('pEstado', p.status ? 1 : 0);
  }
  actualizarCamposFraccion();
  $('dlgProducto').showModal();
  $('pNombre').focus();
}

$('btnNuevoProducto').addEventListener('click', () => abrirProducto());

$('productoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('productoId').value;
  const fracciona = radio('pFracciona') === '1';
  const datos = {
    name: $('pNombre').value,
    brand: Number($('pMarca').value),
    category: Number($('pCategoria').value),
    composicion: $('pComposicion').value,
    presentacion: $('pPresentacion').value,
    forma_farm: $('pFormaFarm').value,
    codigo_barras: $('pBarras').value,
    precio_compra: $('pPrecioCompra').value,
    precio_unidad: $('pPrecioUnidad').value,
    se_fracciona: fracciona ? 1 : 0,
    fraccion: fracciona ? $('pFraccion').value : '',
    precio_fraccion: fracciona ? $('pPrecioFraccion').value : '',
    status_igv: Number(radio('pIgv')),
    stock_minimo: $('pStockMinimo').value,
  };
  const estado = Number(radio('pEstado'));
  const restaurar = botonCargando($('btnGuardarProducto'), 'Guardando...');
  const res = id ? await putJson(`/api/productos/${id}`, datos, { cargando: 'Guardando producto...' }) : await postJson('/api/productos', datos, { cargando: 'Creando producto...' });
  const productoId = id || res.id;
  // El estado se cambia por su propia ruta (como el boton activar/desactivar).
  if (res.ok && productoId && estado !== (productoEditando ? productoEditando.status : 1)) {
    await postJson(`/api/productos/${productoId}/estado`, { estado });
  }
  restaurar();
  if (!res.ok) return mensaje('productoMsg', res);
  $('dlgProducto').close();
  const avisos = res.advertencias && res.advertencias.length ? `\n${res.advertencias.join(' ')}` : '';
  toast(id ? 'Producto actualizado' : 'Producto creado. Registra su stock inicial con el botón de stock.');
  if (avisos) toast(avisos.trim(), 'info');
  cargarCatalogo();
  cargarProdKpis();
});

// --- Ajuste de stock ---
let productoStock = null;

function abrirAjusteStock(p) {
  productoStock = p;
  $('stockForm').reset();
  limpiarMensaje('stockMsg');
  $('sProductoId').value = p.id;
  $('sProductoNombre').textContent = p.name;
  $('sStockActual').textContent = `Stock actual: ${p.stock_detalle.texto}${p.se_fracciona ? ` (caja x ${p.fraccion})` : ''}`;
  $('sSueltasCampo').hidden = !p.se_fracciona;
  $('sCajasLabel').textContent = p.se_fracciona ? `Cajas (x ${p.fraccion})` : 'Unidades';
  $('sMinimo').value = p.stock_minimo;
  $('dlgStock').showModal();
}

$('stockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('sProductoId').value;
  const cajas = Number($('sCajas').value || 0);
  const sueltas = Number($('sSueltas').value || 0);
  const cambiaMinimo = Number($('sMinimo').value) !== productoStock.stock_minimo;

  if (cambiaMinimo) {
    const rm = await postJson(`/api/productos/${id}/stock-minimo`, { stockMinimo: Number($('sMinimo').value) });
    if (!rm.ok) return mensaje('stockMsg', rm);
    productoStock.stock_minimo = Number($('sMinimo').value);
  }
  if (cajas || sueltas || $('sMotivo').value.trim()) {
    const res = await postJson(`/api/productos/${id}/ajuste-stock`, { tipo: $('sTipo').value, cajas, sueltas, motivo: $('sMotivo').value }, { cargando: 'Registrando ajuste...' });
    mensaje('stockMsg', res, res.ok ? `Ajuste registrado. Nuevo stock: ${res.stock_detalle.texto}` : '');
    if (!res.ok) return;
    $('sStockActual').textContent = `Stock actual: ${res.stock_detalle.texto}`;
    $('sCajas').value = 0; $('sSueltas').value = 0; $('sMotivo').value = '';
  } else if (cambiaMinimo) {
    mensaje('stockMsg', { ok: true }, 'Stock mínimo actualizado');
  } else {
    mensaje('stockMsg', { ok: false, error: 'Indica una cantidad y el motivo del ajuste' });
  }
  cargarCatalogo();
});

// --- Kardex (historial del producto) ---
const NOMBRE_MOV = {
  inicial: 'Stock inicial', carga_central: 'Carga desde el central', ajuste_entrada: 'Ajuste de entrada',
  ajuste_salida: 'Ajuste de salida', venta: 'Venta',
};

async function abrirKardex(p, pagina) {
  const r = await api(`/api/productos/${p.id}/kardex?pagina=${pagina}&porPagina=15`, { cargando: 'Cargando historial...' });
  if (!r.ok) return toast(r.error || 'No se pudo cargar el kardex', 'error');
  $('kTitulo').textContent = p.name;
  document.querySelector('#kardexTabla tbody').innerHTML = r.items.map((k) => `
    <tr>
      <td>${fechaHora(k.created_at)}</td>
      <td>${h(NOMBRE_MOV[k.tipo] || k.tipo)}${k.usuario ? `<small>${h(k.usuario)}</small>` : ''}</td>
      <td class="num ${k.cantidad >= 0 ? 'kardex-pos' : 'kardex-neg'}">${k.cantidad > 0 ? '+' : ''}${h(k.cantidad_detalle.texto)}</td>
      <td class="num">${h(k.saldo_detalle.texto)}</td>
      <td>${h(k.motivo)}${k.referencia ? `<small>${h(k.referencia)}</small>` : ''}</td>
    </tr>`).join('') || filaVacia(5, 'Sin movimientos');
  renderPaginador('kPaginador', r, (pag) => abrirKardex(p, pag));
  if (!$('dlgKardex').open) $('dlgKardex').showModal();
}

// =====================================================================
// CATEGORIAS Y LABORATORIOS (maestros)
// =====================================================================
const MAESTROS = {
  categorias: { lista: () => catEstado.categorias, tabla: 'categoriasTabla', pie: 'categoriasPaginador', kpis: 'catKpis', icono: 'fa-tag', singular: 'categoria', titulo: 'Categorias', pagina: 1 },
  marcas: { lista: () => catEstado.marcas, tabla: 'marcasTabla', pie: 'marcasPaginador', kpis: 'marKpis', icono: 'fa-flask', singular: 'laboratorio', titulo: 'Laboratorios', pagina: 1 },
};

function renderMaestro(ruta, pagina = MAESTROS[ruta].pagina) {
  const m = MAESTROS[ruta];
  const todos = m.lista();
  const filtro = document.querySelector(`[data-maestro-buscar="${ruta}"]`).value.trim().toUpperCase();
  const porPagina = Number(document.querySelector(`[data-maestro-por-pagina="${ruta}"]`).value);
  const lista = filtro ? todos.filter((x) => x.name.includes(filtro)) : todos;
  const r = paginarLocal(lista, pagina, porPagina);
  m.pagina = r.pagina;

  const conProductos = todos.filter((x) => x.productos > 0).length;
  const vinculados = todos.reduce((a, x) => a + x.productos, 0);
  $(m.kpis).innerHTML = [
    kpi({ icono: m.icono, titulo: `${m.titulo} registradas`.replace('Laboratorios registradas', 'Laboratorios registrados'), valor: numero(todos.length), detalle: 'Clasificaciones disponibles.', primaria: true }),
    kpi({ icono: 'fa-check-circle', color: 'blue', titulo: 'Con productos', valor: numero(conProductos), detalle: 'Vinculados al catalogo.' }),
    kpi({ icono: 'fa-medkit', color: 'amber', titulo: 'Productos vinculados', valor: numero(vinculados), detalle: 'Total de relaciones registradas.' }),
  ].join('');

  const gestionar = puede('catalogo.gestionar');
  $(m.tabla).innerHTML = r.items.length ? r.items.map((x) => `
    <tr>
      <td><span class="icono-maestro"><i class="fa ${m.icono}"></i></span><strong>${h(x.name)}</strong></td>
      <td class="text-center"><span class="pill-contador">${numero(x.productos)}</span></td>
      <td>${fechaHora(x.created_at)}</td>
      <td>${fechaHora(x.updated_at)}</td>
      <td>${gestionar ? `<button type="button" class="btn btn-info btn-xs" data-renombrar="${x.id}" data-ruta="${ruta}" title="Editar"><i class="fa fa-pencil"></i></button>` : ''}</td>
    </tr>`).join('') : filaVacia(5, 'Sin resultados', 'fa-search');
  renderPaginador(m.pie, r, (p) => renderMaestro(ruta, p));
}

document.querySelectorAll('[data-maestro-buscar]').forEach((el) => el.addEventListener('input', debounce(() => renderMaestro(el.dataset.maestroBuscar, 1), 150)));
document.querySelectorAll('[data-maestro-por-pagina]').forEach((el) => el.addEventListener('change', () => renderMaestro(el.dataset.maestroPorPagina, 1)));

function abrirMaestro(ruta, item = null) {
  const m = MAESTROS[ruta];
  limpiarMensaje('mMsg');
  $('mId').value = item ? item.id : '';
  $('mRuta').value = ruta;
  $('mTitulo').textContent = item ? `Editar ${m.singular}` : `Nuevo ${m.singular}`.replace('Nuevo categoria', 'Nueva categoria');
  $('mEtiqueta').textContent = ruta === 'marcas' ? 'Nombre del laboratorio' : 'Nombre de la categoria';
  $('mNombre').value = item ? item.name : '';
  $('dlgMaestro').showModal();
  $('mNombre').focus();
}

document.querySelectorAll('[data-nuevo-maestro]').forEach((b) => b.addEventListener('click', () => abrirMaestro(b.dataset.nuevoMaestro)));
for (const ruta of Object.keys(MAESTROS)) {
  $(MAESTROS[ruta].tabla).addEventListener('click', (e) => {
    const b = e.target.closest('[data-renombrar]');
    if (b) abrirMaestro(ruta, MAESTROS[ruta].lista().find((x) => x.id === Number(b.dataset.renombrar)));
  });
}

$('maestroForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ruta = $('mRuta').value;
  const id = $('mId').value;
  const res = id
    ? await putJson(`/api/${ruta}/${id}`, { name: $('mNombre').value })
    : await postJson(`/api/${ruta}`, { name: $('mNombre').value });
  if (!res.ok) return mensaje('mMsg', res);
  $('dlgMaestro').close();
  toast(id ? 'Nombre actualizado' : 'Registro creado');
  await cargarMaestros({ forzar: true });
  renderMaestro(ruta);
});

// =====================================================================
// CLIENTES
// =====================================================================
const cliEstado = { pagina: 1, lista: [], pedido: 0 };
const REGLA_DOC = { 0: 0, 1: 8, 4: 11, 6: 11, 7: 11 };

async function cargarCliKpis() {
  const e = await api('/api/clientes/estadisticas', { silencioso: true });
  if (!e || e.total === undefined) return;
  $('cliKpis').innerHTML = [
    kpi({ icono: 'fa-list', titulo: 'Registros', valor: numero(e.total), detalle: 'Clientes registrados en la sucursal.', primaria: true }),
    kpi({ icono: 'fa-user', color: 'blue', titulo: 'Personas', valor: numero(e.personas), detalle: 'Clientes naturales.' }),
    kpi({ icono: 'fa-sitemap', color: 'amber', titulo: 'Empresas', valor: numero(e.empresas), detalle: 'Clientes jurídicos.' }),
    kpi({ icono: 'fa-cloud-upload', color: 'red', titulo: 'Por sincronizar', valor: numero(e.porSincronizar), detalle: 'Altas o cambios aún no enviados.' }),
  ].join('');
}

async function cargarClientes(pagina = cliEstado.pagina) {
  const params = new URLSearchParams({ q: $('cliBuscar').value, soloActivos: $('cliSoloActivos').checked ? '1' : '0', pagina, porPagina: $('cliPorPagina').value });
  const pedido = ++cliEstado.pedido;
  const tbody = document.querySelector('#clienteTabla tbody');
  filaCargando(tbody, 8, 'Cargando clientes...');
  const r = await api('/api/clientes?' + params, { cargando: 'Cargando clientes...' });
  if (pedido !== cliEstado.pedido || !r || !Array.isArray(r.items)) return;
  cliEstado.pagina = r.pagina;
  cliEstado.lista = r.items;
  const editar = puede('clientes.editar');
  const estado = puede('clientes.estado');

  tbody.innerHTML = r.items.length ? r.items.map((c) => `
    <tr>
      <td>${c.id}</td>
      <td>${h(c.type_name)}</td>
      <td><strong>${h(c.name || '(sin nombre)')}</strong>${c.address ? `<small>${h(c.address)}</small>` : ''}</td>
      <td>${h(c.code || '—')}<small>${h(c.tipo_documento_nombre)}</small></td>
      <td>${h(c.phone)}${c.email ? `<small>${h(c.email)}</small>` : ''}</td>
      <td>${fechaHora(c.created_at)}</td>
      <td>${badgeEstado(c.status)}${c.sync_pendiente ? ' <span class="label label-pendiente" title="Aún no se sube al sistema central">por subir</span>' : ''}</td>
      <td class="celda-acciones">
        ${editar ? `<button type="button" class="btn btn-primary btn-xs" data-editar="${c.id}" title="Editar"><i class="fa fa-pencil"></i></button>` : ''}
        ${estado ? `<button type="button" class="btn ${c.status ? 'btn-danger' : 'btn-success'} btn-xs" data-estado="${c.id}" data-valor="${c.status ? 0 : 1}" title="${c.status ? 'Desactivar' : 'Activar'}"><i class="fa ${c.status ? 'fa-ban' : 'fa-check'}"></i></button>` : ''}
      </td>
    </tr>`).join('') : filaVacia(8, 'Ningún cliente coincide con la búsqueda.', 'fa-search');
  renderPaginador('cliPaginador', r, cargarClientes);
}

$('cliBuscar').addEventListener('input', debounce(() => cargarClientes(1), 300));
$('cliSoloActivos').addEventListener('change', () => cargarClientes(1));
$('cliPorPagina').addEventListener('change', () => cargarClientes(1));

document.querySelector('#clienteTabla tbody').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const c = cliEstado.lista.find((x) => x.id === Number(b.dataset.editar || b.dataset.estado));
  if (!c) return;
  if (b.dataset.editar) abrirCliente(c);
  if (b.dataset.estado) {
    const activar = b.dataset.valor === '1';
    const ok = await confirmar({
      titulo: activar ? '¿Activar cliente?' : '¿Desactivar cliente?',
      texto: activar ? `${c.name} podrá volver a usarse en ventas.` : `${c.name} no podrá usarse en nuevas ventas. Su historial se conserva.`,
      aceptar: activar ? 'Sí, activar' : 'Sí, desactivar',
      peligro: !activar,
    });
    if (!ok) return;
    const res = await postJson(`/api/clientes/${c.id}/estado`, { estado: Number(b.dataset.valor) });
    toast(res.ok ? (activar ? 'Cliente activado' : 'Cliente desactivado') : res.error, res.ok ? 'ok' : 'error');
    cargarClientes();
  }
});

function ajustarCampoDocumento() {
  const tipo = $('cTipoDoc').value;
  $('cCode').disabled = tipo === '0';
  if (tipo === '0') $('cCode').value = '';
  $('cCode').maxLength = REGLA_DOC[tipo] || 11;
  $('cCode').placeholder = { 1: '8 dígitos', 6: '11 dígitos', 4: '8 a 11 caracteres', 7: '6 a 11 caracteres' }[tipo] || '';
}

function abrirCliente(c = null) {
  $('clienteForm').reset();
  limpiarMensaje('clienteMsg');
  $('cDocAviso').hidden = true;
  $('clienteId').value = c ? c.id : '';
  $('dlgClienteTitulo').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  $('cTipoDoc').value = c ? c.tipo_documento : '1';
  $('cCode').value = c ? c.code : '';
  $('cNombre').value = c ? c.name : '';
  $('cDireccion').value = c ? c.address : '';
  $('cTelefono').value = c ? c.phone : '';
  $('cEmail').value = c ? c.email : '';
  ajustarCampoDocumento();
  $('dlgCliente').showModal();
  (c ? $('cNombre') : $('cCode')).focus();
}

$('btnNuevoCliente').addEventListener('click', () => abrirCliente());
$('cTipoDoc').addEventListener('change', ajustarCampoDocumento);

// Al terminar de escribir el documento avisa si el cliente ya existe.
$('cCode').addEventListener('change', async () => {
  $('cDocAviso').hidden = true;
  const code = $('cCode').value.trim();
  if (!code) return;
  const r = await api(`/api/clientes/documento/${encodeURIComponent(code)}`, { silencioso: true });
  if (r.ok && String(r.cliente.id) !== $('clienteId').value) {
    $('cDocAviso').textContent = `Este documento ya está registrado: ${r.cliente.name}.`;
    $('cDocAviso').hidden = false;
  }
});

$('clienteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('clienteId').value;
  const datos = {
    tipoDocumento: $('cTipoDoc').value,
    code: $('cCode').value,
    name: $('cNombre').value,
    address: $('cDireccion').value,
    phone: $('cTelefono').value,
    email: $('cEmail').value,
  };
  const restaurar = botonCargando($('btnGuardarCliente'), 'Guardando...');
  const res = id ? await putJson(`/api/clientes/${id}`, datos) : await postJson('/api/clientes', datos);
  restaurar();
  if (!res.ok) return mensaje('clienteMsg', res);
  $('dlgCliente').close();
  toast(id ? 'Cliente actualizado' : 'Cliente registrado');
  if (tabActual === 'clientes') { cargarClientes(); cargarCliKpis(); }
  if (res.cliente) document.dispatchEvent(new CustomEvent('cliente-guardado', { detail: res.cliente }));
});

// =====================================================================
// USUARIOS
// =====================================================================
const usuEstado = { lista: [], pagina: 1, opcionesCargadas: false };

async function cargarOpcionesUsuario() {
  if (usuEstado.opcionesCargadas) return;
  const [tipos, locales] = await Promise.all([api('/api/user-types', { silencioso: true }), api('/api/locales', { silencioso: true })]);
  if (!Array.isArray(tipos) || !Array.isArray(locales)) return;
  $('uTipo').innerHTML = tipos.map((t) => `<option value="${t.id}">${h(t.name.charAt(0).toUpperCase() + t.name.slice(1))}</option>`).join('');
  $('uLocal').innerHTML = locales.map((l) => `<option value="${l.id}">${h(l.name)}</option>`).join('');
  usuEstado.opcionesCargadas = true;
}

async function cargarUsuarios() {
  filaCargando('#usuarioTabla tbody', 8, 'Cargando usuarios...');
  const lista = await api('/api/usuarios', { cargando: 'Cargando usuarios...' });
  if (!Array.isArray(lista)) return;
  usuEstado.lista = lista;
  const activos = lista.filter((u) => u.status).length;
  $('usuKpis').innerHTML = [
    kpi({ icono: 'fa-users', titulo: 'Usuarios registrados', valor: numero(lista.length), detalle: 'Cuentas disponibles en la terminal.', primaria: true }),
    kpi({ icono: 'fa-check-circle', color: 'blue', titulo: 'Activos', valor: numero(activos), detalle: 'Usuarios habilitados para ingresar.' }),
    kpi({ icono: 'fa-ban', color: 'red', titulo: 'Inactivos', valor: numero(lista.length - activos), detalle: 'Cuentas deshabilitadas.' }),
    kpi({ icono: 'fa-map-marker', color: 'amber', titulo: 'Locales asignados', valor: numero(new Set(lista.map((u) => u.local).filter(Boolean)).size), detalle: 'Locales con usuarios vinculados.' }),
  ].join('');
  renderUsuarios(1);
}

function renderUsuarios(pagina = usuEstado.pagina) {
  const f = $('usuBuscar').value.trim().toUpperCase();
  const lista = f
    ? usuEstado.lista.filter((u) => `${u.username} ${u.nombre} ${u.dni} ${u.localNombre || ''}`.toUpperCase().includes(f))
    : usuEstado.lista;
  const r = paginarLocal(lista, pagina, Number($('usuPorPagina').value));
  usuEstado.pagina = r.pagina;
  document.querySelector('#usuarioTabla tbody').innerHTML = r.items.length ? r.items.map((u) => `
    <tr>
      <td>${h(u.dni || '—')}</td>
      <td><strong>${h(u.username)}</strong>${u.resetPass ? '<small>debe cambiar su clave</small>' : ''}</td>
      <td>${h(u.rol)}</td>
      <td>${h(u.nombre)}${u.email ? `<small>${h(u.email)}</small>` : ''}</td>
      <td>${badgeEstado(u.status)}${u.bloqueado ? ' <span class="label label-warning">bloqueado</span>' : ''}</td>
      <td>${fechaHora(u.created_at)}</td>
      <td>${h(u.localNombre || '-')}</td>
      <td class="celda-acciones">
        <button type="button" class="btn btn-primary btn-xs" data-editar="${u.id}" title="Editar"><i class="fa fa-pencil"></i></button>
        ${u.id !== usuario.id ? `<button type="button" class="btn btn-warning btn-xs" data-reset="${u.id}" title="Restablecer clave"><i class="fa fa-key"></i></button>` : ''}
        ${u.id !== usuario.id ? `<button type="button" class="btn ${u.status ? 'btn-danger' : 'btn-success'} btn-xs" data-estado="${u.id}" data-valor="${u.status ? 0 : 1}" title="${u.status ? 'Desactivar' : 'Activar'}"><i class="fa ${u.status ? 'fa-ban' : 'fa-check'}"></i></button>` : ''}
      </td>
    </tr>`).join('') : filaVacia(8, 'Sin resultados', 'fa-search');
  renderPaginador('usuPaginador', r, renderUsuarios);
}

$('usuBuscar').addEventListener('input', debounce(() => renderUsuarios(1), 150));
$('usuPorPagina').addEventListener('change', () => renderUsuarios(1));

document.querySelector('#usuarioTabla tbody').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const u = usuEstado.lista.find((x) => x.id === Number(b.dataset.editar || b.dataset.reset || b.dataset.estado));
  if (!u) return;
  if (b.dataset.editar) abrirUsuario(u);
  if (b.dataset.reset) {
    $('resetForm').reset();
    limpiarMensaje('rMsg');
    $('rId').value = u.id;
    $('rNombre').textContent = `${u.nombre} (${u.username})`;
    $('dlgReset').showModal();
  }
  if (b.dataset.estado) {
    const activar = b.dataset.valor === '1';
    const ok = await confirmar({
      titulo: activar ? '¿Activar usuario?' : '¿Desactivar usuario?',
      texto: activar ? `${u.username} podrá volver a iniciar sesión.` : `${u.username} no podrá iniciar sesión y sus sesiones abiertas se cerrarán de inmediato.`,
      aceptar: activar ? 'Sí, activar' : 'Sí, desactivar',
      peligro: !activar,
    });
    if (!ok) return;
    const res = await postJson(`/api/usuarios/${u.id}/estado`, { estado: Number(b.dataset.valor) });
    toast(res.ok ? (activar ? 'Usuario activado' : 'Usuario desactivado') : res.error, res.ok ? 'ok' : 'error');
    cargarUsuarios();
  }
});

async function abrirUsuario(u = null) {
  await cargarOpcionesUsuario();
  $('usuarioForm').reset();
  limpiarMensaje('uMsg');
  $('uId').value = u ? u.id : '';
  $('dlgUsuarioTitulo').textContent = u ? `Editar ${u.username}` : 'Nuevo Usuario';
  $('uUsername').value = u ? u.username : '';
  $('uUsername').disabled = !!u;
  $('uPasswordCampo').hidden = !!u;
  $('uFirstname').value = u ? u.firstname : '';
  $('uLastname').value = u ? u.lastname : '';
  $('uDni').value = u ? u.dni : '';
  $('uPhone').value = u ? u.phone : '';
  $('uEmail').value = u ? u.email : '';
  $('uTipo').value = u ? u.type : 2;
  $('uLocal').value = u ? u.local : usuario.local;
  $('dlgUsuario').showModal();
}

$('btnNuevoUsuario').addEventListener('click', () => abrirUsuario());

$('usuarioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('uId').value;
  const datos = {
    dni: $('uDni').value,
    firstname: $('uFirstname').value,
    lastname: $('uLastname').value,
    email: $('uEmail').value,
    phone: $('uPhone').value,
    type: Number($('uTipo').value),
    local: Number($('uLocal').value),
  };
  const res = id
    ? await putJson(`/api/usuarios/${id}`, datos, { cargando: 'Guardando usuario...' })
    : await postJson('/api/usuarios', { ...datos, username: $('uUsername').value, password: $('uPassword').value }, { cargando: 'Creando usuario...' });
  if (!res.ok) return mensaje('uMsg', res);
  $('dlgUsuario').close();
  toast(id ? 'Usuario actualizado' : 'Usuario creado');
  cargarUsuarios();
});

$('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await postJson(`/api/usuarios/${$('rId').value}/restablecer-password`, { password: $('rPassword').value });
  mensaje('rMsg', res, 'Clave restablecida. El usuario deberá cambiarla al entrar.');
  if (res.ok) { cargarUsuarios(); setTimeout(() => $('dlgReset').close(), 1500); }
});

// Alta rapida de cliente pedida desde otra vista.
document.addEventListener('abrir-nuevo-cliente', (e) => {
  abrirCliente();
  const { tipoDocumento, code, name } = e.detail || {};
  if (tipoDocumento) { $('cTipoDoc').value = tipoDocumento; ajustarCampoDocumento(); }
  if (code) $('cCode').value = code;
  if (name) $('cNombre').value = name;
  $('cNombre').focus();
});

// =====================================================================
// ARRANQUE: validar la sesion contra el servidor antes de mostrar nada
// =====================================================================
async function iniciar() {
  if (!Sesion.token()) return window.location.replace('login.html');

  const me = await api('/api/auth/me', { cargando: 'Validando sesión...' });
  if (!me.ok) {
    Sesion.limpiar();
    return window.location.replace('login.html');
  }
  usuario = me.user;
  if (usuario.resetPass) return window.location.replace('cambiar-password.html');

  $('usuarioActual').textContent = usuario.nombre.toUpperCase();
  $('usuarioRol').textContent = usuario.rol;
  $('usuarioLocal').textContent = usuario.localNombre || 'Sin sucursal asignada';
  $('localActual').textContent = usuario.localNombre || 'Sin sucursal asignada';

  // Lo que el rol no puede usar no se muestra (los permisos se validan igual en el servidor).
  document.querySelectorAll('[data-permiso]').forEach((el) => { if (!puede(el.dataset.permiso)) el.remove(); });
  if (!puede('usuarios.gestionar')) $('tab-usuarios').remove();
  document.querySelectorAll('#nav-accordion li.sub-menu').forEach((li) => { if (!li.querySelector('a[data-tab]')) li.remove(); });

  const tipos = await api('/api/clientes/tipos-documento', { silencioso: true });
  if (Array.isArray(tipos)) $('cTipoDoc').innerHTML = tipos.map((t) => `<option value="${h(t.codigo)}">${h(t.descripcion)}</option>`).join('');

  const r = await actualizarEstado();
  const cajaAbierta = !!(r && r.caja.abierta);
  // Como en el web: el vendedor va a apertura de caja si esta cerrada y
  // directo a ventas si ya esta abierta. Los demas roles, al panel.
  await mostrarTab(usuario.type === 2 ? (cajaAbierta ? 'ventas' : 'caja') : 'inicio');
  document.body.classList.remove('cargando-app');

  if (puede('catalogo.ver')) cargarMaestros();
  setInterval(actualizarEstado, 20 * 1000);
}

iniciar();

export { COMPROBANTES, MEDIOS };
