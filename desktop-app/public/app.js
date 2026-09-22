const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
if (!usuario) window.location.href = 'login.html';
document.getElementById('usuarioActual').textContent = usuario ? `${usuario.nombre} (${usuario.rol})` : '';

const esAdmin = usuario && usuario.rol === 'admin';
if (!esAdmin) {
  document.querySelectorAll('.solo-admin').forEach((el) => (el.style.display = 'none'));
}

document.getElementById('btnLogout').addEventListener('click', () => {
  localStorage.removeItem('usuario');
  window.location.href = 'login.html';
});

function conActor(body = {}) {
  return { ...body, actorUsername: usuario.username };
}

async function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

async function putJson(url, body) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

// --- Tabs ---
document.querySelectorAll('#tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    document.querySelectorAll('.tab').forEach((t) => (t.style.display = 'none'));
    btn.classList.add('activo');
    document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
    document.getElementById('pageTitle').textContent = btn.textContent.trim();
  });
});

// --- Caja ---
async function cargarCaja() {
  const estado = await fetch('/api/caja/estado').then((r) => r.json());
  const abrirForm = document.getElementById('cajaAbrirForm');
  const cerrarForm = document.getElementById('cajaCerrarForm');
  const info = document.getElementById('cajaEstado');
  if (estado) {
    info.textContent = `Caja abierta por ${estado.usuario} con S/ ${estado.monto_apertura}`;
    abrirForm.style.display = 'none';
    cerrarForm.style.display = 'block';
  } else {
    info.textContent = 'No hay caja abierta.';
    abrirForm.style.display = 'block';
    cerrarForm.style.display = 'none';
  }
}

document.getElementById('btnAbrirCaja').addEventListener('click', async () => {
  const msg = document.getElementById('cajaMsg');
  const monto = Number(document.getElementById('montoApertura').value || 0);
  const res = await postJson('/api/caja/abrir', { usuario: usuario.nombre, monto });
  msg.className = res.ok ? 'ok-msg' : 'error-msg';
  msg.textContent = res.ok ? 'Caja abierta' : res.error;
  if (res.ok) document.getElementById('montoApertura').value = '';
  cargarCaja();
});

document.getElementById('btnCerrarCaja').addEventListener('click', async () => {
  const msg = document.getElementById('cajaMsg');
  const monto = Number(document.getElementById('montoCierre').value || 0);
  const res = await postJson('/api/caja/cerrar', { monto });
  msg.className = res.ok ? 'ok-msg' : 'error-msg';
  msg.textContent = res.ok ? 'Caja cerrada' : res.error;
  if (res.ok) document.getElementById('montoCierre').value = '';
  cargarCaja();
});

// --- Ventas ---
let productos = [];
let itemsVenta = [];

async function cargarProductosVenta() {
  productos = await fetch('/api/productos?soloActivos=1').then((r) => r.json());
  const select = document.getElementById('ventaProducto');
  select.innerHTML = productos.map((p) => `<option value="${p.id}">${p.nombre} (S/ ${p.precio})</option>`).join('');
}

document.getElementById('btnAgregarItem').addEventListener('click', () => {
  const productId = Number(document.getElementById('ventaProducto').value);
  const cantidad = Number(document.getElementById('ventaCantidad').value || 1);
  const producto = productos.find((p) => p.id === productId);
  if (!producto) return;
  itemsVenta.push({ productId, nombre: producto.nombre, precio: producto.precio, cantidad });
  renderVenta();
});

function renderVenta() {
  const tbody = document.querySelector('#ventaTabla tbody');
  tbody.innerHTML = itemsVenta
    .map((it) => `<tr><td>${it.nombre}</td><td>${it.cantidad}</td><td>${it.precio}</td><td>${(it.precio * it.cantidad).toFixed(2)}</td></tr>`)
    .join('');
  const total = itemsVenta.reduce((acc, it) => acc + it.precio * it.cantidad, 0);
  document.getElementById('ventaTotal').textContent = total.toFixed(2);
}

document.getElementById('btnRegistrarVenta').addEventListener('click', async () => {
  const msg = document.getElementById('ventaMsg');
  const res = await postJson('/api/ventas', { items: itemsVenta, usuario: usuario.nombre });

  if (!res.ok) {
    msg.textContent = res.error;
    return;
  }
  msg.textContent = `Venta registrada (S/ ${res.total.toFixed(2)})`;
  itemsVenta = [];
  renderVenta();
  cargarProductosVenta();
  cargarProductosCatalogo();
});

// --- Clientes ---
function badgeEstado(estado) {
  return estado ? '<span class="badge badge-activo">Activo</span>' : '<span class="badge badge-inactivo">Inactivo</span>';
}

async function cargarClientes(busqueda = '') {
  const lista = await fetch('/api/clientes?q=' + encodeURIComponent(busqueda)).then((r) => r.json());
  const tbody = document.querySelector('#clienteTabla tbody');
  tbody.innerHTML = lista
    .map(
      (c) => `<tr>
        <td>${c.nombre}</td>
        <td>${c.tipo_documento || ''} ${c.documento || ''}</td>
        <td>${c.telefono || ''}</td>
        <td>${c.direccion || ''}</td>
        <td>${badgeEstado(c.estado)}</td>
        ${
          esAdmin
            ? `<td>
                <button class="secundario" data-editar-cliente="${c.id}">Editar</button>
                <button class="${c.estado ? 'peligro' : ''}" data-toggle-cliente="${c.id}" data-estado="${c.estado ? 0 : 1}">
                  ${c.estado ? 'Desactivar' : 'Activar'}
                </button>
              </td>`
            : ''
        }
      </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-editar-cliente]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cliente = lista.find((c) => c.id === Number(btn.dataset.editarCliente));
      if (!cliente) return;
      document.getElementById('clienteId').value = cliente.id;
      document.getElementById('clienteNombre').value = cliente.nombre;
      document.getElementById('clienteTipoDoc').value = cliente.tipo_documento || 'DNI';
      document.getElementById('clienteDocumento').value = cliente.documento || '';
      document.getElementById('clienteTelefono').value = cliente.telefono || '';
      document.getElementById('clienteDireccion').value = cliente.direccion || '';
      document.getElementById('btnGuardarCliente').textContent = 'Guardar cambios';
      document.getElementById('btnCancelarClienteEdit').style.display = 'inline-block';
    });
  });

  tbody.querySelectorAll('[data-toggle-cliente]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await postJson(`/api/clientes/${btn.dataset.toggleCliente}/estado`, conActor({ estado: Number(btn.dataset.estado) }));
      cargarClientes(document.getElementById('clienteBusqueda').value);
    });
  });
}

document.getElementById('clienteBusqueda').addEventListener('input', (e) => cargarClientes(e.target.value));

function limpiarFormCliente() {
  document.getElementById('clienteId').value = '';
  document.getElementById('clienteForm').reset();
  document.getElementById('btnGuardarCliente').textContent = 'Guardar cliente';
  document.getElementById('btnCancelarClienteEdit').style.display = 'none';
}

document.getElementById('btnCancelarClienteEdit').addEventListener('click', limpiarFormCliente);

document.getElementById('clienteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('clienteMsg');
  const id = document.getElementById('clienteId').value;
  const datos = {
    nombre: document.getElementById('clienteNombre').value.trim(),
    tipoDocumento: document.getElementById('clienteTipoDoc').value,
    documento: document.getElementById('clienteDocumento').value.trim(),
    telefono: document.getElementById('clienteTelefono').value.trim(),
    direccion: document.getElementById('clienteDireccion').value.trim(),
  };

  const res = id
    ? await putJson(`/api/clientes/${id}`, conActor(datos))
    : await postJson('/api/clientes', datos);

  msg.className = res.ok ? 'ok-msg' : 'error-msg';
  msg.textContent = res.ok ? 'Cliente guardado' : res.error;
  if (res.ok) {
    limpiarFormCliente();
    cargarClientes();
  }
});

// --- Catalogo ---
async function cargarProductosCatalogo(busqueda = '') {
  const lista = await fetch('/api/productos?q=' + encodeURIComponent(busqueda)).then((r) => r.json());
  const tbody = document.querySelector('#catalogoTabla tbody');
  tbody.innerHTML = lista
    .map((p) => {
      const stockBajo = p.stock_minimo > 0 && p.stock <= p.stock_minimo;
      return `<tr class="${stockBajo ? 'stock-bajo' : ''}">
        <td>${p.nombre}</td>
        <td>${p.categoria || ''}</td>
        <td>${p.marca || ''}</td>
        <td>S/ ${p.precio}</td>
        <td>${p.stock}${stockBajo ? ' ⚠' : ''}</td>
        <td>${badgeEstado(p.estado)}</td>
        ${
          esAdmin
            ? `<td>
                <button class="secundario" data-editar-producto="${p.id}">Editar</button>
                <button class="${p.estado ? 'peligro' : ''}" data-toggle-producto="${p.id}" data-estado="${p.estado ? 0 : 1}">
                  ${p.estado ? 'Desactivar' : 'Activar'}
                </button>
              </td>`
            : ''
        }
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('[data-editar-producto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const producto = lista.find((p) => p.id === Number(btn.dataset.editarProducto));
      if (!producto) return;
      document.getElementById('productoId').value = producto.id;
      document.getElementById('productoNombre').value = producto.nombre;
      document.getElementById('productoCategoria').value = producto.categoria || '';
      document.getElementById('productoMarca').value = producto.marca || '';
      document.getElementById('productoPrecio').value = producto.precio;
      document.getElementById('productoStock').value = producto.stock;
      document.getElementById('productoStockMinimo').value = producto.stock_minimo || 0;
      document.getElementById('productoCodigoBarras').value = producto.codigo_barras || '';
      document.getElementById('btnGuardarProducto').textContent = 'Guardar cambios';
      document.getElementById('btnCancelarProductoEdit').style.display = 'inline-block';
    });
  });

  tbody.querySelectorAll('[data-toggle-producto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await postJson(`/api/productos/${btn.dataset.toggleProducto}/estado`, conActor({ estado: Number(btn.dataset.estado) }));
      cargarProductosCatalogo(document.getElementById('catalogoBusqueda').value);
      cargarProductosVenta();
    });
  });
}

document.getElementById('catalogoBusqueda').addEventListener('input', (e) => cargarProductosCatalogo(e.target.value));

function limpiarFormProducto() {
  document.getElementById('productoId').value = '';
  document.getElementById('productoForm').reset();
  document.getElementById('btnGuardarProducto').textContent = 'Guardar producto';
  document.getElementById('btnCancelarProductoEdit').style.display = 'none';
}

document.getElementById('btnCancelarProductoEdit').addEventListener('click', limpiarFormProducto);

document.getElementById('productoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('productoMsg');
  const id = document.getElementById('productoId').value;
  const datos = conActor({
    nombre: document.getElementById('productoNombre').value.trim(),
    categoria: document.getElementById('productoCategoria').value.trim(),
    marca: document.getElementById('productoMarca').value.trim(),
    precio: Number(document.getElementById('productoPrecio').value),
    stock: Number(document.getElementById('productoStock').value),
    stockMinimo: Number(document.getElementById('productoStockMinimo').value || 0),
    codigoBarras: document.getElementById('productoCodigoBarras').value.trim(),
  });

  const res = id ? await putJson(`/api/productos/${id}`, datos) : await postJson('/api/productos', datos);

  msg.className = res.ok ? 'ok-msg' : 'error-msg';
  msg.textContent = res.ok ? 'Producto guardado' : res.error;
  if (res.ok) {
    limpiarFormProducto();
    cargarProductosCatalogo();
    cargarProductosVenta();
  }
});

// --- Usuarios (solo admin) ---
async function cargarUsuarios() {
  if (!esAdmin) return;
  const lista = await fetch('/api/usuarios?actorUsername=' + encodeURIComponent(usuario.username)).then((r) => r.json());
  const tbody = document.querySelector('#usuarioTabla tbody');
  tbody.innerHTML = lista
    .map(
      (u) => `<tr>
        <td>${u.username}</td>
        <td>${u.nombre}</td>
        <td>${u.email || ''}</td>
        <td>${u.rol}</td>
        <td>${badgeEstado(u.estado)}</td>
        <td>
          <button class="${u.estado ? 'peligro' : ''}" data-toggle-usuario="${u.id}" data-estado="${u.estado ? 0 : 1}"
            ${u.username === usuario.username ? 'disabled title="No puedes desactivarte a ti mismo"' : ''}>
            ${u.estado ? 'Desactivar' : 'Activar'}
          </button>
        </td>
      </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-toggle-usuario]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await postJson(`/api/usuarios/${btn.dataset.toggleUsuario}/estado`, conActor({ estado: Number(btn.dataset.estado) }));
      cargarUsuarios();
    });
  });
}

if (esAdmin) {
  document.getElementById('usuarioForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('usuarioMsg');
    const res = await postJson(
      '/api/usuarios',
      conActor({
        username: document.getElementById('usuarioUsername').value.trim(),
        password: document.getElementById('usuarioPassword').value,
        nombre: document.getElementById('usuarioNombre').value.trim(),
        email: document.getElementById('usuarioEmail').value.trim(),
        rol: document.getElementById('usuarioRol').value,
      })
    );
    msg.className = res.ok ? 'ok-msg' : 'error-msg';
    msg.textContent = res.ok ? 'Usuario creado' : res.error;
    if (res.ok) {
      document.getElementById('usuarioForm').reset();
      cargarUsuarios();
    }
  });
}

// --- Sync ---
async function cargarSyncEstado() {
  const estado = await fetch('/api/sync/estado').then((r) => r.json());
  document.getElementById('lastSync').textContent = estado.lastSyncAt || 'nunca';
}

document.getElementById('btnSincronizar').addEventListener('click', async () => {
  const msg = document.getElementById('syncMsg');
  msg.textContent = 'Sincronizando...';
  const res = await postJson('/api/sync', {});
  msg.textContent = res.ok
    ? `OK: ${res.productosActualizados} productos, ${res.ventasSubidas} ventas subidas`
    : `Error: ${res.error}`;
  cargarSyncEstado();
  cargarProductosCatalogo();
  cargarProductosVenta();
});

// --- Inicio ---
cargarCaja();
cargarProductosVenta();
cargarClientes();
cargarProductosCatalogo();
cargarUsuarios();
cargarSyncEstado();
