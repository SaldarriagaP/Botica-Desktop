// Sincronizacion contra un servidor central simulado: una venta solo se da
// por subida cuando el central la acepta.

const { usarBaseTemporal } = require('./helpers');
usarBaseTemporal('sync');

const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { db } = require('../src/db');
const { seed } = require('../src/seedData');
seed(db);
const caja = require('../src/caja');
const ventas = require('../src/ventas');
const sync = require('../src/sync');

// Central simulado: su comportamiento se cambia en cada prueba.
let modo = 'ok';
const recibidas = [];
const central = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/productos') {
      return res.end(JSON.stringify([
        { id: 5001, precio: 61.5 }, // enlazado a Amoxicilina
        { id: 101, precio: 0.01 }, // id local de Paracetamol, pero sin enlace: no debe tocarse
        { id: 5002, precio: 'abc' }, // dato invalido
      ]));
    }
    if (modo === 'rechaza') { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, error: 'falla interna' })); }
    recibidas.push(JSON.parse(cuerpo));
    res.end(JSON.stringify({ ok: true }));
  });
});

test.before(async () => {
  await new Promise((r) => central.listen(0, '127.0.0.1', r));
  db.prepare('UPDATE products SET central_id = 5001 WHERE id = 102').run();
  caja.abrir({ id: 2, nombre: 'Luis Vendedor' }, 0);
  assert.equal(ventas.registrar({ usuario: 'Luis Vendedor', userId: 2, items: [{ productId: 101, cantidad: 1 }] }).ok, true);
});
test.after(() => new Promise((r) => central.close(r)));

const urlCentral = () => `http://127.0.0.1:${central.address().port}`;

test('sin conexion la venta queda pendiente con el motivo', async () => {
  config.centralUrl = 'http://127.0.0.1:1'; // puerto sin servidor
  const r = await sync.sincronizar();
  assert.equal(r.ok, false);
  assert.match(r.error, /Sin conexión/);
  assert.equal(sync.pendientes(), 1);
});

test('si el central rechaza la venta, NO se marca como sincronizada', async () => {
  config.centralUrl = urlCentral();
  modo = 'rechaza';
  const r = await sync.sincronizar();
  assert.equal(r.ok, false);
  assert.equal(r.ventasRechazadas, 1);
  assert.equal(sync.pendientes(), 1);
  const v = db.prepare('SELECT sync_intentos, sync_error FROM sales').get();
  assert.equal(v.sync_error, 'falla interna');
  assert.ok(v.sync_intentos >= 1);
  assert.equal(sync.estado().ultimoError, 'falla interna');
});

test('cuando el central acepta, la venta se sube con sus items y deja de estar pendiente', async () => {
  modo = 'ok';
  const r = await sync.sincronizar();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.ventasSubidas, 1);
  assert.equal(sync.pendientes(), 0);
  assert.equal(recibidas.length, 1);
  assert.equal(recibidas[0].comprobante, undefined);
  assert.equal(recibidas[0].serie, 'B019');
  assert.ok(Array.isArray(recibidas[0].items) && recibidas[0].items.length === 1);
  assert.ok(sync.estado().lastSyncAt);
});

test('los precios solo se aplican a productos enlazados por central_id', () => {
  assert.equal(db.prepare('SELECT precio_unidad FROM products WHERE id = 102').get().precio_unidad, 61.5);
  assert.equal(db.prepare('SELECT precio_unidad FROM products WHERE id = 101').get().precio_unidad, 25);
});

test('una segunda sincronizacion no reenvia ventas ya subidas', async () => {
  await sync.sincronizar();
  assert.equal(recibidas.length, 1);
});

test('la sincronizacion automatica sube sola las ventas pendientes al volver la conexion', async () => {
  // Venta hecha "sin internet".
  config.centralUrl = 'http://127.0.0.1:1';
  assert.equal(ventas.registrar({ usuario: 'Luis Vendedor', userId: 2, items: [{ productId: 101, cantidad: 1 }] }).ok, true);
  await sync.cicloAutomatico();
  assert.equal(sync.pendientes(), 1);
  assert.equal(sync.estado().conectado, false);

  // Vuelve la conexion: el siguiente ciclo la sube sin intervencion.
  config.centralUrl = urlCentral();
  await sync.cicloAutomatico();
  assert.equal(sync.pendientes(), 0);
  assert.equal(sync.estado().conectado, true);
  assert.equal(recibidas.length, 2);

  // Sin pendientes y con precios recientes no vuelve a llamar al central.
  await sync.cicloAutomatico();
  assert.equal(recibidas.length, 2);
});

test('el temporizador automatico se puede activar y detener', () => {
  assert.equal(sync.iniciarAutomatica(0), false);
  assert.equal(sync.iniciarAutomatica(60), true);
  assert.equal(sync.estado().automatica, true);
  sync.detenerAutomatica();
  assert.equal(sync.estado().automatica, false);
});
