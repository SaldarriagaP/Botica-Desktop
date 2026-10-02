// Pruebas de permisos por rol y de gestion de contrasenas (HTTP real).

const { usarBaseTemporal, levantarServidor } = require('./helpers');
usarBaseTemporal('permisos');

const test = require('node:test');
const assert = require('node:assert/strict');

let srv;
let admin;
test.before(async () => {
  srv = await levantarServidor();
  admin = await srv.loginToken('ADMIN01', 'admin123');
  // Usuario de almacen (tipo 5) para probar permisos del catalogo.
  const r = await srv.pedir('/api/usuarios', {
    method: 'POST', token: admin,
    body: { username: 'ALMACEN1', password: 'almacen1', dni: '55667788', firstname: 'Ana', lastname: 'Almacen', type: 5 },
  });
  assert.equal(r.json.ok, true, r.texto);
});
test.after(async () => { await srv.cerrar(); });

test('/auth/me incluye los permisos del rol', async () => {
  const vend = await srv.loginToken('VEND01', 'vendedor123');
  const me = await srv.pedir('/api/auth/me', { token: vend });
  assert.ok(me.json.user.permisos.includes('clientes.crear'));
  assert.ok(!me.json.user.permisos.includes('catalogo.gestionar'));
  assert.ok(!me.json.user.permisos.includes('usuarios.gestionar'));
});

test('vendedor: registra clientes pero no los edita ni toca el catalogo', async () => {
  const vend = await srv.loginToken('VEND01', 'vendedor123');
  const creado = await srv.pedir('/api/clientes', { method: 'POST', token: vend, body: { name: 'Cliente de caja', tipoDocumento: '1', code: '47474747' } });
  assert.equal(creado.json.ok, true, creado.texto);

  const porDoc = await srv.pedir('/api/clientes/documento/47474747', { token: vend });
  assert.equal(porDoc.json.cliente.name, 'CLIENTE DE CAJA');
  assert.equal((await srv.pedir('/api/clientes/documento/11111111', { token: vend })).status, 404);

  assert.equal((await srv.pedir(`/api/clientes/${creado.json.id}`, { method: 'PUT', token: vend, body: { name: 'x' } })).status, 403);
  assert.equal((await srv.pedir(`/api/clientes/${creado.json.id}/estado`, { method: 'POST', token: vend, body: { estado: 0 } })).status, 403);
  assert.equal((await srv.pedir('/api/productos', { method: 'POST', token: vend, body: {} })).status, 403);
  assert.equal((await srv.pedir('/api/productos/101/ajuste-stock', { method: 'POST', token: vend, body: {} })).status, 403);
  assert.equal((await srv.pedir('/api/marcas', { method: 'POST', token: vend, body: { name: 'X' } })).status, 403);

  const lista = await srv.pedir('/api/productos?q=paracetamol', { token: vend });
  assert.equal(lista.status, 200);
  assert.equal(lista.json.items[0].stock_detalle.texto, '20 cajas');
});

test('almacen: gestiona catalogo y stock, pero no usuarios', async () => {
  const alm = await srv.loginToken('ALMACEN1', 'almacen1');
  const cat = await srv.pedir('/api/categorias', { method: 'POST', token: alm, body: { name: 'Vitaminas' } });
  assert.equal(cat.json.ok, true, cat.texto);
  const ajuste = await srv.pedir('/api/productos/105/ajuste-stock', {
    method: 'POST', token: alm, body: { tipo: 'entrada', cajas: 5, motivo: 'Ingreso por guía' },
  });
  assert.equal(ajuste.json.ok, true, ajuste.texto);
  assert.equal(ajuste.json.stock, 35);

  const k = await srv.pedir('/api/productos/105/kardex', { token: alm });
  assert.equal(k.json.items[0].usuario, 'Ana Almacen');
  assert.equal((await srv.pedir('/api/usuarios', { token: alm })).status, 403);
});

test('admin restablece una contrasena: el usuario debe cambiarla antes de usar el sistema', async () => {
  const vend = await srv.loginToken('VEND01', 'vendedor123');
  const r = await srv.pedir('/api/usuarios/2/restablecer-password', { method: 'POST', token: admin, body: { password: 'temporal1' } });
  assert.equal(r.json.ok, true, r.texto);

  // La sesion anterior del vendedor se cerro.
  assert.equal((await srv.pedir('/api/auth/me', { token: vend })).status, 401);

  // Entra con la temporal, pero solo puede cambiar su contrasena.
  const login = await srv.pedir('/api/auth/login', { method: 'POST', body: { username: 'VEND01', password: 'temporal1' } });
  assert.equal(login.json.user.resetPass, true);
  const t = login.json.token;
  const bloqueado = await srv.pedir('/api/productos', { token: t });
  assert.equal(bloqueado.status, 403);
  assert.equal(bloqueado.json.code, 'CAMBIO_PASSWORD');

  assert.match((await srv.pedir('/api/auth/cambiar-password', { method: 'POST', token: t, body: { actual: 'mala', nueva: 'nueva123' } })).json.error, /actual/);
  assert.match((await srv.pedir('/api/auth/cambiar-password', { method: 'POST', token: t, body: { actual: 'temporal1', nueva: 'temporal1' } })).json.error, /distinta/);
  assert.match((await srv.pedir('/api/auth/cambiar-password', { method: 'POST', token: t, body: { actual: 'temporal1', nueva: '123' } })).json.error, /6 caracteres/);

  const ok = await srv.pedir('/api/auth/cambiar-password', { method: 'POST', token: t, body: { actual: 'temporal1', nueva: 'vendedor123' } });
  assert.equal(ok.json.ok, true, ok.texto);

  // Con la misma sesion ya puede trabajar.
  assert.equal((await srv.pedir('/api/productos', { token: t })).status, 200);
  assert.equal((await srv.pedir('/api/auth/me', { token: t })).json.user.resetPass, false);
});

test('cambiar mi contrasena cierra mis otras sesiones', async () => {
  const s1 = await srv.loginToken('ALMACEN1', 'almacen1');
  const s2 = await srv.loginToken('ALMACEN1', 'almacen1');
  const r = await srv.pedir('/api/auth/cambiar-password', { method: 'POST', token: s1, body: { actual: 'almacen1', nueva: 'almacen2' } });
  assert.equal(r.json.ok, true);
  assert.equal((await srv.pedir('/api/auth/me', { token: s1 })).status, 200);
  assert.equal((await srv.pedir('/api/auth/me', { token: s2 })).status, 401);
});

test('admin edita el perfil de un usuario y no puede quitarse su propio rol', async () => {
  const r = await srv.pedir('/api/usuarios/2', {
    method: 'PUT', token: admin,
    body: { dni: '10000002', firstname: 'Luis Alberto', lastname: 'Vendedor', type: 4, local: 3 },
  });
  assert.equal(r.json.ok, true, r.texto);
  const vend = await srv.loginToken('VEND01', 'vendedor123');
  const me = (await srv.pedir('/api/auth/me', { token: vend })).json.user;
  assert.equal(me.rol, 'local');
  assert.equal(me.localNombre, 'Solidaria Cayetano');
  assert.ok(me.permisos.includes('clientes.editar'), 'el encargado de local puede editar clientes');

  const propio = await srv.pedir('/api/usuarios/1', { method: 'PUT', token: admin, body: { dni: '10000001', firstname: 'Rosa', type: 2 } });
  assert.match(propio.json.error, /a ti mismo/);
  const propioReset = await srv.pedir('/api/usuarios/1/restablecer-password', { method: 'POST', token: admin, body: { password: 'otra123' } });
  assert.match(propioReset.json.error, /Cambiar mi contraseña/);
});
