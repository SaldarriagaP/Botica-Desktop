// Pruebas de integracion de la API local (HTTP real contra Express).

const { usarBaseTemporal, levantarServidor } = require('./helpers');
usarBaseTemporal('api');

const test = require('node:test');
const assert = require('node:assert/strict');

let srv;
test.before(async () => { srv = await levantarServidor(); });
test.after(async () => { await srv.cerrar(); });

test('la pantalla de login y los datos de la terminal son publicos', async () => {
  const html = await srv.pedir('/login.html');
  assert.equal(html.status, 200);
  assert.match(html.texto, /loginForm/);

  const t = await srv.pedir('/api/terminal');
  assert.equal(t.status, 200);
  assert.equal(t.json.local.name, 'PRUEBAS - SISTEMA');
});

test('sin token no se puede usar ningun modulo', async () => {
  for (const ruta of ['/api/productos', '/api/clientes', '/api/caja/estado', '/api/ventas', '/api/usuarios', '/api/auth/me']) {
    const r = await srv.pedir(ruta);
    assert.equal(r.status, 401, ruta);
    assert.equal(r.json.code, 'NO_AUTH');
  }
});

test('login correcto devuelve token y /auth/me identifica al usuario', async () => {
  const r = await srv.pedir('/api/auth/login', { method: 'POST', body: { username: 'ADMIN01', password: 'admin123' } });
  assert.equal(r.status, 200);
  const me = await srv.pedir('/api/auth/me', { token: r.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, 'ADMIN01');
  assert.equal(me.json.user.esAdmin, true);
});

test('login incorrecto responde 401 con mensaje generico', async () => {
  const r = await srv.pedir('/api/auth/login', { method: 'POST', body: { username: 'ADMIN01', password: 'x' } });
  assert.equal(r.status, 401);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, 'Usuario o contraseña incorrectos');
});

test('JSON mal formado responde 400 en JSON (sin stack)', async () => {
  const r = await srv.pedir('/api/auth/login', { method: 'POST', rawBody: '{malo' });
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
  assert.doesNotMatch(r.texto, /at .*\.js/);
});

test('VEND01 no accede a funciones de administrador', async () => {
  const token = await srv.loginToken('VEND01', 'vendedor123');
  assert.equal((await srv.pedir('/api/usuarios', { token })).status, 403);
  assert.equal((await srv.pedir('/api/user-types', { token })).status, 403);
  assert.equal((await srv.pedir('/api/productos', { token })).status, 200, 'si puede consultar el catalogo');
});

test('regresion: ya no se puede suplantar al admin enviando actorUsername', async () => {
  const token = await srv.loginToken('VEND01', 'vendedor123');
  const r = await srv.pedir('/api/productos', {
    method: 'POST',
    token,
    body: { actorUsername: 'ADMIN01', nombre: 'Hack', precio: 0, stock: 999 },
  });
  assert.equal(r.status, 403);
  const sinToken = await srv.pedir('/api/usuarios?actorUsername=ADMIN01');
  assert.equal(sinToken.status, 401);
});

test('ADMIN01 gestiona usuarios; el desactivado pierde la sesion al instante', async () => {
  const admin = await srv.loginToken('ADMIN01', 'admin123');

  const tipos = await srv.pedir('/api/user-types', { token: admin });
  assert.equal(tipos.json.length, 5);
  const locales = await srv.pedir('/api/locales', { token: admin });
  assert.ok(locales.json.every((l) => l.active === 1));

  const creado = await srv.pedir('/api/usuarios', {
    method: 'POST',
    token: admin,
    body: { username: 'CAJERO9', password: 'caja999', dni: '11223344', firstname: 'Carla', lastname: 'Caja', type: 2, local: 3 },
  });
  assert.equal(creado.json.ok, true);

  const tokenCajero = await srv.loginToken('CAJERO9', 'caja999');
  const me = await srv.pedir('/api/auth/me', { token: tokenCajero });
  assert.equal(me.json.user.localNombre, 'Solidaria Cayetano');

  const off = await srv.pedir(`/api/usuarios/${creado.json.id}/estado`, { method: 'POST', token: admin, body: { estado: 0 } });
  assert.equal(off.json.ok, true);
  assert.equal((await srv.pedir('/api/auth/me', { token: tokenCajero })).status, 401);
});

test('logout invalida el token en el servidor', async () => {
  const token = await srv.loginToken('VEND01', 'vendedor123');
  assert.equal((await srv.pedir('/api/auth/logout', { method: 'POST', token })).json.ok, true);
  assert.equal((await srv.pedir('/api/auth/me', { token })).status, 401);
});

test('la caja registra como responsable al usuario de la sesion, no al que diga el cliente', async () => {
  const token = await srv.loginToken('VEND01', 'vendedor123');
  const r = await srv.pedir('/api/caja/abrir', { method: 'POST', token, body: { monto: 50, usuario: 'Otro' } });
  assert.equal(r.json.ok, true);
  const estado = await srv.pedir('/api/caja/estado', { token });
  assert.equal(estado.json.usuario, 'Luis Vendedor');
  await srv.pedir('/api/caja/cerrar', { method: 'POST', token, body: { monto: 50 } });
});

test('la venta queda a nombre del usuario de la sesion', async () => {
  const token = await srv.loginToken('VEND01', 'vendedor123');
  await srv.pedir('/api/caja/abrir', { method: 'POST', token, body: { monto: 0 } });
  const v = await srv.pedir('/api/ventas', {
    method: 'POST',
    token,
    body: { items: [{ productId: 101, cantidad: 2 }], usuario: 'Suplantado' },
  });
  assert.equal(v.json.ok, true);
  const ventas = await srv.pedir('/api/ventas', { token });
  assert.equal(ventas.json[0].usuario, 'Luis Vendedor');
  await srv.pedir('/api/caja/cerrar', { method: 'POST', token, body: { monto: 0.7 } });
});

test('rutas /api desconocidas responden 404 JSON', async () => {
  const token = await srv.loginToken('VEND01', 'vendedor123');
  const r = await srv.pedir('/api/no-existe', { token });
  assert.equal(r.status, 404);
  assert.equal(r.json.ok, false);
});
