const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
if (!usuario) window.location.href = 'login.html';
document.getElementById('usuarioActual').textContent = usuario ? usuario.nombre : '';

// --- Tabs ---
document.querySelectorAll('#tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    document.querySelectorAll('.tab').forEach((t) => (t.style.display = 'none'));
    btn.classList.add('activo');
    document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
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
  const monto = Number(document.getElementById('montoApertura').value || 0);
  await fetch('/api/caja/abrir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: usuario.nombre, monto }),
  });
  cargarCaja();
});

document.getElementById('btnCerrarCaja').addEventListener('click', async () => {
  const monto = Number(document.getElementById('montoCierre').value || 0);
  await fetch('/api/caja/cerrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto }),
  });
  cargarCaja();
});

// --- Ventas ---
let productos = [];
let itemsVenta = [];

async function cargarProductosVenta() {
  productos = await fetch('/api/productos').then((r) => r.json());
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
  const res = await fetch('/api/ventas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: itemsVenta, usuario: usuario.nombre }),
  }).then((r) => r.json());

  if (!res.ok) {
    msg.textContent = res.error;
    return;
  }
  msg.textContent = `Venta registrada (S/ ${res.total.toFixed(2)})`;
  itemsVenta = [];
  renderVenta();
  cargarProductosCatalogo();
});

// --- Clientes ---
async function cargarClientes(busqueda = '') {
  const clientes = await fetch('/api/clientes?q=' + encodeURIComponent(busqueda)).then((r) => r.json());
  const tbody = document.querySelector('#clienteTabla tbody');
  tbody.innerHTML = clientes.map((c) => `<tr><td>${c.nombre}</td><td>${c.documento || ''}</td><td>${c.telefono || ''}</td></tr>`).join('');
}

document.getElementById('clienteBusqueda').addEventListener('input', (e) => cargarClientes(e.target.value));

document.getElementById('btnNuevoCliente').addEventListener('click', async () => {
  const nombre = document.getElementById('nuevoClienteNombre').value.trim();
  if (!nombre) return;
  await fetch('/api/clientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre,
      documento: document.getElementById('nuevoClienteDoc').value.trim(),
      telefono: document.getElementById('nuevoClienteTel').value.trim(),
    }),
  });
  document.getElementById('nuevoClienteNombre').value = '';
  document.getElementById('nuevoClienteDoc').value = '';
  document.getElementById('nuevoClienteTel').value = '';
  cargarClientes();
});

// --- Catalogo ---
async function cargarProductosCatalogo(busqueda = '') {
  const lista = await fetch('/api/productos?q=' + encodeURIComponent(busqueda)).then((r) => r.json());
  const tbody = document.querySelector('#catalogoTabla tbody');
  tbody.innerHTML = lista.map((p) => `<tr><td>${p.nombre}</td><td>S/ ${p.precio}</td><td>${p.stock}</td></tr>`).join('');
}

document.getElementById('catalogoBusqueda').addEventListener('input', (e) => cargarProductosCatalogo(e.target.value));

// --- Sync ---
async function cargarSyncEstado() {
  const estado = await fetch('/api/sync/estado').then((r) => r.json());
  document.getElementById('lastSync').textContent = estado.lastSyncAt || 'nunca';
}

document.getElementById('btnSincronizar').addEventListener('click', async () => {
  const msg = document.getElementById('syncMsg');
  msg.textContent = 'Sincronizando...';
  const res = await fetch('/api/sync', { method: 'POST' }).then((r) => r.json());
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
cargarSyncEstado();
