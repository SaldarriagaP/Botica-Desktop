// Interfaz principal. Requiere api.js (Sesion, api, escapeHtml).

let usuario = null;
const h = escapeHtml;
const $ = (id) => document.getElementById(id);

const postJson = (url, body = {}) => api(url, { method: 'POST', body });
const putJson = (url, body = {}) => api(url, { method: 'PUT', body });
const puede = (permiso) => !!usuario && usuario.permisos.includes(permiso);
const soles = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '');

function mensaje(id, res, textoOk) {
  const el = $(id);
  el.className = res.ok ? 'ok-msg' : 'error-msg';
  el.textContent = res.ok ? textoOk : res.error;
}

function limpiarMensaje(id) {
  $(id).textContent = '';
  $(id).className = '';
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function badgeEstado(activo) {
  return activo ? '<span class="badge badge-activo">Activo</span>' : '<span class="badge badge-inactivo">Inactivo</span>';
}

function renderPaginador(contenedor, r, alCambiar) {
  const el = $(contenedor);
  if (!r || r.total === 0) { el.innerHTML = '<span class="muted">Sin resultados</span>'; return; }
  el.innerHTML = `
    <span class="muted">${r.total} registro(s) · página ${r.pagina} de ${r.paginas}</span>
    <button type="button" class="secundario" data-pag="${r.pagina - 1}" ${r.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <button type="button" class="secundario" data-pag="${r.pagina + 1}" ${r.pagina >= r.paginas ? 'disabled' : ''}>Siguiente ›</button>`;
  el.querySelectorAll('[data-pag]').forEach((b) => b.addEventListener('click', () => alCambiar(Number(b.dataset.pag))));
}

// --- Dialogos ---
document.querySelectorAll('dialog [data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// --- Sesion ---
$('btnLogout').addEventListener('click', async () => {
  await postJson('/api/auth/logout');
  Sesion.limpiar();
  window.location.replace('login.html?motivo=logout');
});

$('btnMiPassword').addEventListener('click', () => {
  $('miPasswordForm').reset();
  limpiarMensaje('mpMsg');
  $('dlgMiPassword').showModal();
});

$('miPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('mpNueva').value !== $('mpNueva2').value) {
    return mensaje('mpMsg', { ok: false, error: 'Las contraseñas nuevas no coinciden' });
  }
  const res = await postJson('/api/auth/cambiar-password', { actual: $('mpActual').value, nueva: $('mpNueva').value });
  mensaje('mpMsg', res, 'Contraseña actualizada. Tus otras sesiones se cerraron.');
  if (res.ok) setTimeout(() => $('dlgMiPassword').close(), 1200);
});

// --- Tabs ---
function mostrarTab(nombre) {
  const btn = document.querySelector(`#tabs button[data-tab="${nombre}"]`);
  if (!btn) return;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
  document.querySelectorAll('.tab').forEach((t) => (t.style.display = 'none'));
  btn.classList.add('activo');
  $('tab-' + nombre).style.display = 'block';
  $('pageTitle').textContent = btn.textContent.trim();
}

document.querySelectorAll('#tabs button').forEach((btn) => btn.addEventListener('click', () => mostrarTab(btn.dataset.tab)));

// =====================================================================
// CATALOGO
// =====================================================================
const catEstado = { pagina: 1, marcas: [], categorias: [], lista: [], pedido: 0 };

function mostrarSubtab(nombre) {
  document.querySelectorAll('#catalogoSubtabs button').forEach((b) => b.classList.toggle('activo', b.dataset.sub === nombre));
  document.querySelectorAll('#tab-catalogo [data-subpanel]').forEach((p) => (p.style.display = p.dataset.subpanel === nombre ? 'block' : 'none'));
}

document.querySelectorAll('#catalogoSubtabs button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.sub === 'nuevo') limpiarFormProducto();
    mostrarSubtab(b.dataset.sub);
  })
);

function opciones(lista, { vacio } = {}) {
  return (vacio ? `<option value="">${h(vacio)}</option>` : '') + lista.map((x) => `<option value="${x.id}">${h(x.name)}</option>`).join('');
}

async function cargarMaestros() {
  const [marcas, categorias] = await Promise.all([api('/api/marcas'), api('/api/categorias')]);
  catEstado.marcas = marcas;
  catEstado.categorias = categorias;

  const filtroCat = $('catFiltroCategoria').value;
  const filtroMarca = $('catFiltroMarca').value;
  $('catFiltroCategoria').innerHTML = opciones(categorias, { vacio: 'Todas las categorías' });
  $('catFiltroMarca').innerHTML = opciones(marcas, { vacio: 'Todos los laboratorios' });
  $('catFiltroCategoria').value = filtroCat;
  $('catFiltroMarca').value = filtroMarca;

  const selMarca = $('pMarca').value;
  const selCat = $('pCategoria').value;
  $('pMarca').innerHTML = opciones(marcas, { vacio: 'Selecciona...' });
  $('pCategoria').innerHTML = opciones(categorias, { vacio: 'Selecciona...' });
  $('pMarca').value = selMarca;
  $('pCategoria').value = selCat;

  renderMaestros();
}

async function cargarCatalogo(pagina = catEstado.pagina) {
  const params = new URLSearchParams({
    q: $('catBuscar').value,
    categoria: $('catFiltroCategoria').value,
    marca: $('catFiltroMarca').value,
    stock: $('catFiltroStock').value,
    soloActivos: $('catSoloActivos').checked ? '1' : '0',
    pagina,
    porPagina: 20,
  });
  const pedido = ++catEstado.pedido;
  const r = await api('/api/productos?' + params);
  if (pedido !== catEstado.pedido) return; // llego una respuesta mas nueva
  catEstado.pagina = r.pagina;
  catEstado.lista = r.items;

  const gestionar = puede('catalogo.gestionar');
  const stock = puede('catalogo.stock');
  const kardex = puede('catalogo.kardex');

  document.querySelector('#catalogoTabla tbody').innerHTML = r.items.map((p) => `
    <tr class="${p.stock_bajo ? 'stock-bajo' : ''}">
      <td><strong>${h(p.name)}</strong><small>${h(p.composicion)}${p.presentacion ? ' · ' + h(p.presentacion) : ''}${p.codigo_barras ? ' · ' + h(p.codigo_barras) : ''}</small></td>
      <td>${h(p.brand_name)}<small>${h(p.category_name || '-')}</small></td>
      <td class="num">${soles(p.precio_unidad)}</td>
      <td class="num">${p.se_fracciona ? soles(p.precio_fraccion) + `<small>x${p.fraccion} und</small>` : '<span class="muted">—</span>'}</td>
      <td>${h(p.stock_detalle.texto)}${p.stock_bajo ? ' <span class="badge badge-alerta" title="Mínimo: ' + p.stock_minimo + '">bajo</span>' : ''}</td>
      <td>${badgeEstado(p.status)}${p.status_igv ? '' : ' <span class="badge badge-neutro">Sin IGV</span>'}</td>
      <td class="acciones">
        ${gestionar ? `<button class="secundario" data-editar="${p.id}">Editar</button>` : ''}
        ${stock ? `<button class="secundario" data-stock="${p.id}">Stock</button>` : ''}
        ${kardex ? `<button class="secundario" data-kardex="${p.id}">Kardex</button>` : ''}
        ${gestionar ? `<button class="${p.status ? 'peligro' : ''}" data-estado="${p.id}" data-valor="${p.status ? 0 : 1}">${p.status ? 'Desactivar' : 'Activar'}</button>` : ''}
      </td>
    </tr>`).join('');

  renderPaginador('catPaginador', r, cargarCatalogo);
}

const buscarCatalogo = debounce(() => cargarCatalogo(1));
$('catBuscar').addEventListener('input', buscarCatalogo);
['catFiltroCategoria', 'catFiltroMarca', 'catFiltroStock', 'catSoloActivos'].forEach((id) => $(id).addEventListener('change', () => cargarCatalogo(1)));

document.querySelector('#catalogoTabla tbody').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const p = catEstado.lista.find((x) => x.id === Number(b.dataset.editar || b.dataset.stock || b.dataset.kardex || b.dataset.estado));
  if (!p) return;
  if (b.dataset.editar) editarProducto(p);
  if (b.dataset.stock) abrirAjusteStock(p);
  if (b.dataset.kardex) abrirKardex(p, 1);
  if (b.dataset.estado) {
    await postJson(`/api/productos/${p.id}/estado`, { estado: Number(b.dataset.valor) });
    cargarCatalogo();
  }
});

// --- Formulario de producto ---
function actualizarCamposFraccion() {
  const fr = $('pSeFracciona').checked;
  $('pFraccion').disabled = !fr;
  $('pPrecioFraccion').disabled = !fr;
  if (!fr) { $('pFraccion').value = ''; $('pPrecioFraccion').value = ''; }
}
$('pSeFracciona').addEventListener('change', actualizarCamposFraccion);

function limpiarFormProducto() {
  $('productoForm').reset();
  $('productoId').value = '';
  $('productoFormTitulo').textContent = 'Nuevo producto';
  $('pStockMinimoCampo').style.display = '';
  $('productoAviso').textContent = '';
  limpiarMensaje('productoMsg');
  actualizarCamposFraccion();
}

function editarProducto(p) {
  limpiarFormProducto();
  $('productoId').value = p.id;
  $('productoFormTitulo').textContent = `Editar: ${p.name}`;
  $('pNombre').value = p.name;
  $('pMarca').value = p.brand;
  $('pCategoria').value = p.category || '';
  $('pComposicion').value = p.composicion;
  $('pPresentacion').value = p.presentacion;
  $('pFormaFarm').value = p.forma_farm;
  $('pBarras').value = p.codigo_barras;
  $('pPrecioCompra').value = p.precio_compra;
  $('pPrecioUnidad').value = p.precio_unidad;
  $('pSeFracciona').checked = !!p.se_fracciona;
  actualizarCamposFraccion();
  if (p.se_fracciona) { $('pFraccion').value = p.fraccion; $('pPrecioFraccion').value = p.precio_fraccion; }
  $('pIgv').checked = !!p.status_igv;
  $('pStockMinimoCampo').style.display = 'none'; // el minimo se edita desde "Stock"
  mostrarSubtab('nuevo');
}

$('btnCancelarProducto').addEventListener('click', () => { limpiarFormProducto(); mostrarSubtab('productos'); });

$('productoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('productoId').value;
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
    se_fracciona: $('pSeFracciona').checked ? 1 : 0,
    fraccion: $('pFraccion').value,
    precio_fraccion: $('pPrecioFraccion').value,
    status_igv: $('pIgv').checked ? 1 : 0,
    stock_minimo: $('pStockMinimo').value,
  };
  const res = id ? await putJson(`/api/productos/${id}`, datos) : await postJson('/api/productos', datos);
  mensaje('productoMsg', res, id ? 'Producto actualizado' : 'Producto creado');
  $('productoAviso').textContent = res.ok && res.advertencias && res.advertencias.length ? '⚠ ' + res.advertencias.join(' ') : '';
  if (res.ok) {
    if (!id) {
      const aviso = $('productoAviso').textContent;
      limpiarFormProducto();
      $('productoAviso').textContent = aviso;
      mensaje('productoMsg', res, `Producto creado. Registra su stock inicial con el botón "Stock".`);
    }
    cargarCatalogo();
  }
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
  $('sSueltasCampo').style.display = p.se_fracciona ? '' : 'none';
  $('sCajasCampo').firstChild.textContent = p.se_fracciona ? `Cajas (x ${p.fraccion})` : 'Unidades';
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
    const res = await postJson(`/api/productos/${id}/ajuste-stock`, { tipo: $('sTipo').value, cajas, sueltas, motivo: $('sMotivo').value });
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

// --- Kardex ---
const NOMBRE_MOV = {
  inicial: 'Stock inicial', carga_central: 'Carga desde el central', ajuste_entrada: 'Ajuste de entrada',
  ajuste_salida: 'Ajuste de salida', venta: 'Venta',
};

async function abrirKardex(p, pagina) {
  const r = await api(`/api/productos/${p.id}/kardex?pagina=${pagina}&porPagina=15`);
  if (!r.ok) return;
  $('kTitulo').textContent = `Kardex · ${p.name}`;
  document.querySelector('#kardexTabla tbody').innerHTML = r.items.map((k) => `
    <tr>
      <td>${h(fecha(k.created_at))}</td>
      <td>${h(NOMBRE_MOV[k.tipo] || k.tipo)}${k.usuario ? `<small>${h(k.usuario)}</small>` : ''}</td>
      <td class="num ${k.cantidad >= 0 ? 'kardex-pos' : 'kardex-neg'}">${k.cantidad > 0 ? '+' : ''}${h(k.cantidad_detalle.texto)}</td>
      <td class="num">${h(k.saldo_detalle.texto)}</td>
      <td>${h(k.motivo)}${k.referencia ? `<small>${h(k.referencia)}</small>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">Sin movimientos</td></tr>';
  renderPaginador('kPaginador', r, (pag) => abrirKardex(p, pag));
  if (!$('dlgKardex').open) $('dlgKardex').showModal();
}

// --- Marcas y categorias ---
function renderMaestros() {
  const pintar = (lista, filtro, ulId, ruta) => {
    const f = filtro.trim().toUpperCase();
    $(ulId).innerHTML = lista.filter((x) => !f || x.name.includes(f)).slice(0, 300).map((x) => `
      <li><span>${h(x.name)} <span class="muted">(${x.productos})</span></span>
      <button type="button" class="secundario" data-renombrar="${x.id}" data-ruta="${ruta}" data-nombre="${h(x.name)}">Renombrar</button></li>`).join('');
  };
  pintar(catEstado.marcas, $('marcaBuscar').value, 'marcaLista', 'marcas');
  pintar(catEstado.categorias, $('categoriaBuscar').value, 'categoriaLista', 'categorias');
}

$('marcaBuscar').addEventListener('input', renderMaestros);
$('categoriaBuscar').addEventListener('input', renderMaestros);

for (const [form, input, msg, ruta, etiqueta] of [
  ['marcaForm', 'marcaNombre', 'marcaMsg', 'marcas', 'Marca agregada'],
  ['categoriaForm', 'categoriaNombre', 'categoriaMsg', 'categorias', 'Categoría agregada'],
]) {
  $(form).addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await postJson(`/api/${ruta}`, { name: $(input).value });
    mensaje(msg, res, etiqueta);
    if (res.ok) { $(input).value = ''; cargarMaestros(); }
  });
}

document.querySelector('#tab-catalogo .maestros').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-renombrar]');
  if (!b) return;
  limpiarMensaje('rnMsg');
  $('rnId').value = b.dataset.renombrar;
  $('rnRuta').value = b.dataset.ruta;
  $('rnTitulo').textContent = b.dataset.ruta === 'marcas' ? 'Renombrar marca' : 'Renombrar categoría';
  $('rnNombre').value = b.dataset.nombre;
  $('dlgRenombrar').showModal();
});

$('renombrarForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await putJson(`/api/${$('rnRuta').value}/${$('rnId').value}`, { name: $('rnNombre').value });
  mensaje('rnMsg', res, 'Nombre actualizado');
  if (res.ok) {
    cargarMaestros();
    cargarCatalogo();
    setTimeout(() => $('dlgRenombrar').close(), 500);
  }
});

// =====================================================================
// CLIENTES
// =====================================================================
const cliEstado = { pagina: 1, lista: [], pedido: 0 };
const REGLA_DOC = { '0': 0, '1': 8, '4': 11, '6': 11, '7': 11 };

async function cargarClientes(pagina = cliEstado.pagina) {
  const params = new URLSearchParams({ q: $('cliBuscar').value, soloActivos: $('cliSoloActivos').checked ? '1' : '0', pagina, porPagina: 20 });
  const pedido = ++cliEstado.pedido;
  const r = await api('/api/clientes?' + params);
  if (pedido !== cliEstado.pedido) return;
  cliEstado.pagina = r.pagina;
  cliEstado.lista = r.items;
  const editar = puede('clientes.editar');
  const estado = puede('clientes.estado');

  document.querySelector('#clienteTabla tbody').innerHTML = r.items.map((c) => `
    <tr>
      <td><strong>${h(c.name || '(sin nombre)')}</strong>${c.address ? `<small>${h(c.address)}</small>` : ''}</td>
      <td>${h(c.tipo_documento_nombre)}<small>${h(c.code || '—')}</small></td>
      <td><span class="badge ${c.type === 2 ? 'badge-info' : 'badge-neutro'}">${h(c.type_name)}</span></td>
      <td>${h(c.phone)}${c.email ? `<small>${h(c.email)}</small>` : ''}</td>
      <td>${badgeEstado(c.status)}${c.sync_pendiente ? ' <span class="badge badge-alerta" title="Aún no se sube al sistema central">por sincronizar</span>' : ''}</td>
      <td class="acciones">
        ${editar ? `<button class="secundario" data-editar="${c.id}">Editar</button>` : ''}
        ${estado ? `<button class="${c.status ? 'peligro' : ''}" data-estado="${c.id}" data-valor="${c.status ? 0 : 1}">${c.status ? 'Desactivar' : 'Activar'}</button>` : ''}
      </td>
    </tr>`).join('');
  renderPaginador('cliPaginador', r, cargarClientes);
}

$('cliBuscar').addEventListener('input', debounce(() => cargarClientes(1)));
$('cliSoloActivos').addEventListener('change', () => cargarClientes(1));

document.querySelector('#clienteTabla tbody').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const c = cliEstado.lista.find((x) => x.id === Number(b.dataset.editar || b.dataset.estado));
  if (!c) return;
  if (b.dataset.editar) abrirCliente(c);
  if (b.dataset.estado) {
    await postJson(`/api/clientes/${c.id}/estado`, { estado: Number(b.dataset.valor) });
    cargarClientes();
  }
});

function ajustarCampoDocumento() {
  const tipo = $('cTipoDoc').value;
  $('cCode').disabled = tipo === '0';
  if (tipo === '0') $('cCode').value = '';
  $('cCode').maxLength = REGLA_DOC[tipo] || 11;
  $('cCode').placeholder = { '1': '8 dígitos', '6': '11 dígitos', '4': '8 a 11 caracteres', '7': '6 a 11 caracteres' }[tipo] || '';
}

function abrirCliente(c = null) {
  $('clienteForm').reset();
  limpiarMensaje('clienteMsg');
  $('cDocAviso').textContent = '';
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
  $('cDocAviso').textContent = '';
  const code = $('cCode').value.trim();
  if (!code) return;
  const r = await api(`/api/clientes/documento/${encodeURIComponent(code)}`);
  if (r.ok && String(r.cliente.id) !== $('clienteId').value) {
    $('cDocAviso').textContent = `Este documento ya está registrado: ${r.cliente.name}.`;
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
  const res = id ? await putJson(`/api/clientes/${id}`, datos) : await postJson('/api/clientes', datos);
  mensaje('clienteMsg', res, 'Cliente guardado');
  if (res.ok) {
    setTimeout(() => $('dlgCliente').close(), 600);
    cargarClientes();
  }
});

// =====================================================================
// USUARIOS
// =====================================================================
let usuariosLista = [];

async function cargarOpcionesUsuario() {
  const [tipos, locales] = await Promise.all([api('/api/user-types'), api('/api/locales')]);
  $('uTipo').innerHTML = tipos.map((t) => `<option value="${t.id}">${h(t.name.charAt(0).toUpperCase() + t.name.slice(1))}</option>`).join('');
  $('uLocal').innerHTML = locales.map((l) => `<option value="${l.id}">${h(l.name)}</option>`).join('');
}

async function cargarUsuarios() {
  usuariosLista = await api('/api/usuarios');
  document.querySelector('#usuarioTabla tbody').innerHTML = usuariosLista.map((u) => `
    <tr>
      <td><strong>${h(u.username)}</strong>${u.resetPass ? '<small>debe cambiar su contraseña</small>' : ''}</td>
      <td>${h(u.nombre)}${u.email ? `<small>${h(u.email)}</small>` : ''}</td>
      <td>${h(u.dni || '—')}</td>
      <td>${h(u.rol)}</td>
      <td>${h(u.localNombre || '-')}</td>
      <td>${badgeEstado(u.status)}${u.bloqueado ? ' <span class="badge badge-alerta">bloqueado</span>' : ''}</td>
      <td class="acciones">
        <button class="secundario" data-editar="${u.id}">Editar</button>
        ${u.id !== usuario.id ? `<button class="secundario" data-reset="${u.id}">Contraseña</button>` : ''}
        ${u.id !== usuario.id ? `<button class="${u.status ? 'peligro' : ''}" data-estado="${u.id}" data-valor="${u.status ? 0 : 1}">${u.status ? 'Desactivar' : 'Activar'}</button>` : ''}
      </td>
    </tr>`).join('');
}

document.querySelector('#usuarioTabla tbody').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const u = usuariosLista.find((x) => x.id === Number(b.dataset.editar || b.dataset.reset || b.dataset.estado));
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
    const res = await postJson(`/api/usuarios/${u.id}/estado`, { estado: Number(b.dataset.valor) });
    mensaje('usuarioMsg', res, 'Estado actualizado');
    cargarUsuarios();
  }
});

function abrirUsuario(u = null) {
  $('usuarioForm').reset();
  limpiarMensaje('uMsg');
  $('uId').value = u ? u.id : '';
  $('dlgUsuarioTitulo').textContent = u ? `Editar ${u.username}` : 'Nuevo usuario';
  $('uUsername').value = u ? u.username : '';
  $('uUsername').disabled = !!u;
  $('uPasswordCampo').style.display = u ? 'none' : '';
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
    ? await putJson(`/api/usuarios/${id}`, datos)
    : await postJson('/api/usuarios', { ...datos, username: $('uUsername').value, password: $('uPassword').value });
  mensaje('uMsg', res, 'Usuario guardado');
  if (res.ok) { setTimeout(() => $('dlgUsuario').close(), 600); cargarUsuarios(); }
});

$('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await postJson(`/api/usuarios/${$('rId').value}/restablecer-password`, { password: $('rPassword').value });
  mensaje('rMsg', res, 'Contraseña restablecida. El usuario deberá cambiarla al entrar.');
  if (res.ok) { cargarUsuarios(); setTimeout(() => $('dlgReset').close(), 1500); }
});

// =====================================================================
// CAJA, VENTAS Y SINCRONIZACION (fuera del foco de esta entrega)
// =====================================================================
async function cargarCaja() {
  const estado = await api('/api/caja/estado');
  $('cajaEstado').textContent = estado ? `Caja abierta por ${estado.usuario} con S/ ${estado.monto_apertura}` : 'No hay caja abierta.';
  $('cajaAbrirForm').style.display = estado ? 'none' : 'block';
  $('cajaCerrarForm').style.display = estado ? 'block' : 'none';
  return estado;
}

$('btnAbrirCaja').addEventListener('click', async () => {
  const res = await postJson('/api/caja/abrir', { monto: Number($('montoApertura').value || 0) });
  mensaje('cajaMsg', res, 'Caja abierta');
  if (res.ok) $('montoApertura').value = '';
  cargarCaja();
});

$('btnCerrarCaja').addEventListener('click', async () => {
  const res = await postJson('/api/caja/cerrar', { monto: Number($('montoCierre').value || 0) });
  mensaje('cajaMsg', res, 'Caja cerrada');
  if (res.ok) $('montoCierre').value = '';
  cargarCaja();
});

let productosVenta = [];
let itemsVenta = [];

async function buscarProductosVenta() {
  const r = await api('/api/productos?' + new URLSearchParams({ q: $('ventaBuscar').value, soloActivos: '1', porPagina: 30 }));
  productosVenta = r.items;
  $('ventaProducto').innerHTML = productosVenta.map((p) =>
    `<option value="${p.id}">${h(p.name)} · ${soles(p.precio_unidad)} · stock ${h(p.stock_detalle.texto)}</option>`).join('');
}
$('ventaBuscar').addEventListener('input', debounce(buscarProductosVenta));

$('btnAgregarItem').addEventListener('click', () => {
  const p = productosVenta.find((x) => x.id === Number($('ventaProducto').value));
  if (!p) return;
  const modo = $('ventaModo').value;
  if (modo === 'fraccion' && !p.se_fracciona) {
    return mensaje('ventaMsg', { ok: false, error: `"${p.name}" no se vende por unidad suelta` });
  }
  limpiarMensaje('ventaMsg');
  itemsVenta.push({ productId: p.id, nombre: p.name, modo, cantidad: Number($('ventaCantidad').value || 1),
    precio: modo === 'fraccion' ? p.precio_fraccion : p.precio_unidad });
  renderVenta();
});

function renderVenta() {
  document.querySelector('#ventaTabla tbody').innerHTML = itemsVenta.map((it, i) => `
    <tr><td>${h(it.nombre)}</td><td>${it.modo === 'fraccion' ? 'Unidad suelta' : 'Caja / unidad'}</td>
    <td class="num">${h(it.cantidad)}</td><td class="num">${soles(it.precio)}</td><td class="num">${soles(it.precio * it.cantidad)}</td>
    <td><button class="secundario" data-quitar="${i}">Quitar</button></td></tr>`).join('');
  $('ventaTotal').textContent = itemsVenta.reduce((acc, it) => acc + it.precio * it.cantidad, 0).toFixed(2);
}

document.querySelector('#ventaTabla tbody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quitar]');
  if (b) { itemsVenta.splice(Number(b.dataset.quitar), 1); renderVenta(); }
});

$('btnRegistrarVenta').addEventListener('click', async () => {
  const res = await postJson('/api/ventas', { items: itemsVenta.map(({ productId, cantidad, modo }) => ({ productId, cantidad, modo })) });
  mensaje('ventaMsg', res, res.ok ? `Venta registrada (${soles(res.total)})` : '');
  if (!res.ok) return;
  itemsVenta = [];
  renderVenta();
  buscarProductosVenta();
  cargarCatalogo();
});

async function cargarSyncEstado() {
  const estado = await api('/api/sync/estado');
  $('lastSync').textContent = estado.lastSyncAt ? fecha(estado.lastSyncAt) : 'nunca';
}

$('btnSincronizar').addEventListener('click', async () => {
  $('syncMsg').textContent = 'Sincronizando...';
  const res = await postJson('/api/sync');
  $('syncMsg').textContent = res.ok ? `OK: ${res.productosActualizados} productos, ${res.ventasSubidas} ventas subidas` : `Error: ${res.error}`;
  cargarSyncEstado();
  cargarCatalogo();
});

// =====================================================================
// INICIO: validar la sesion contra el servidor antes de mostrar nada
// =====================================================================
async function iniciar() {
  if (!Sesion.token()) return window.location.replace('login.html');

  const me = await api('/api/auth/me');
  if (!me.ok) {
    Sesion.limpiar();
    return window.location.replace('login.html');
  }
  usuario = me.user;
  if (usuario.resetPass) return window.location.replace('cambiar-password.html');

  $('usuarioActual').textContent = `${usuario.nombre} · ${usuario.rol}`;
  $('localActual').textContent = usuario.localNombre || 'Sin sucursal asignada';
  document.querySelectorAll('[data-permiso]').forEach((el) => { if (!puede(el.dataset.permiso)) el.remove(); });

  const cajaAbierta = await cargarCaja();
  // Como en el sistema web: el vendedor va a apertura de caja si esta cerrada
  // y directo a ventas si ya esta abierta. Los demas roles, al catalogo.
  mostrarTab(usuario.type === 2 ? (cajaAbierta ? 'ventas' : 'caja') : 'catalogo');
  mostrarSubtab('productos');
  document.body.classList.remove('cargando');

  const clientesTipos = await api('/api/clientes/tipos-documento');
  $('cTipoDoc').innerHTML = clientesTipos.map((t) => `<option value="${h(t.codigo)}">${h(t.descripcion)}</option>`).join('');

  await cargarMaestros();
  cargarCatalogo(1);
  cargarClientes(1);
  buscarProductosVenta();
  cargarSyncEstado();
  if (puede('usuarios.gestionar')) {
    await cargarOpcionesUsuario();
    cargarUsuarios();
  }
}

iniciar();
