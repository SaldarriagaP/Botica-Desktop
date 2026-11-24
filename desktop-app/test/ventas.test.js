// Ventas y caja: comprobantes, reglas SUNAT, IGV, medios de pago, cuadre de
// caja y permisos por rol.

const { usarBaseTemporal, levantarServidor } = require('./helpers');
usarBaseTemporal('ventas');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const caja = require('../src/caja');
const ventas = require('../src/ventas');
const catalogo = require('../src/catalogo');

let srv;
test.before(async () => { srv = await levantarServidor(); });
test.after(async () => { await srv.cerrar(); });

const vendedor = { id: 2, nombre: 'Luis Vendedor' };
const vender = (datos) => ventas.registrar({ usuario: vendedor.nombre, userId: vendedor.id, ...datos });
const CLIENTE_DNI = 2; // MARIA GONZALES ROJAS (semilla)
const CLIENTE_RUC = 3; // SOLUCIONES EN INGENIERIA T&J E.I.R.L. (semilla)

test.describe('desglose de IGV', () => {
  test('separa base gravada, IGV y operaciones exoneradas', () => {
    const r = ventas.desglosar([{ afectoIgv: true, subtotal: 11.8 }, { afectoIgv: false, subtotal: 5 }]);
    assert.deepEqual(r, { opGravada: 10, opExonerada: 5, igv: 1.8, total: 16.8 });
  });

  test('la serie sale de la sucursal (S19 -> B019 / F019)', () => {
    assert.equal(ventas.serieDe('boleta'), 'B019');
    assert.equal(ventas.serieDe('factura'), 'F019');
  });
});

test.describe('registro de ventas', () => {
  test('sin caja abierta no se puede vender', () => {
    assert.match(vender({ items: [{ productId: 101, cantidad: 1 }] }).error, /Abre la caja/);
  });

  test('abrir caja valida el monto y no permite dos turnos', () => {
    assert.equal(caja.abrir(vendedor, -5).ok, false);
    assert.equal(caja.abrir(vendedor, 'abc').ok, false);
    assert.equal(caja.abrir(vendedor, 100).ok, true);
    assert.match(caja.abrir(vendedor, 100).error, /Ya hay una caja abierta/);
  });

  test('boletas con correlativo consecutivo y desglose de IGV', () => {
    const a = vender({ items: [{ productId: 101, cantidad: 1 }] });
    const b = vender({ items: [{ productId: 104, cantidad: 2, modo: 'fraccion' }] });
    assert.equal(a.ok, true, a.error);
    assert.equal(a.comprobante, 'B019-00000001');
    assert.equal(b.comprobante, 'B019-00000002');
    const v = ventas.obtener(a.id);
    assert.equal(v.total, 25);
    assert.equal(v.op_gravada, 21.19);
    assert.equal(v.igv, 3.81);
    assert.equal(v.caja_id, caja.estado().id);
    assert.equal(v.items[0].nombre, 'PARACETAMOL 500MG CJA X 100 TAB');
  });

  test('efectivo calcula el vuelto y rechaza un pago menor al total', () => {
    const ok = vender({ items: [{ productId: 101, cantidad: 1 }], montoRecibido: 50 });
    assert.equal(ok.vuelto, 25);
    const mal = vender({ items: [{ productId: 101, cantidad: 1 }], montoRecibido: 20 });
    assert.match(mal.error, /menor que el total/);
  });

  test('factura exige cliente con RUC y usa su propia serie', () => {
    assert.match(vender({ tipoComprobante: 'factura', items: [{ productId: 102, cantidad: 1 }] }).error, /RUC/);
    assert.match(vender({ tipoComprobante: 'factura', clienteId: CLIENTE_DNI, items: [{ productId: 102, cantidad: 1 }] }).error, /RUC/);
    const f = vender({ tipoComprobante: 'factura', clienteId: CLIENTE_RUC, medioPago: 'transferencia', items: [{ productId: 102, cantidad: 1 }] });
    assert.equal(f.ok, true, f.error);
    assert.equal(f.comprobante, 'F019-00000001');
    const v = ventas.obtener(f.id);
    assert.equal(v.cliente_doc, '20607015083');
    assert.equal(v.medio_pago, 'transferencia');
  });

  test('boleta de S/ 700 o mas exige identificar al cliente', () => {
    const items = [{ productId: 101, cantidad: 12 }, { productId: 103, cantidad: 14 }]; // 300 + 420
    const antes = catalogo.obtener(101).stock;
    assert.match(vender({ items }).error, /identificar al cliente/);
    assert.equal(catalogo.obtener(101).stock, antes, 'un rechazo no descuenta stock');
    assert.equal(vender({ items: [{ productId: 101, cantidad: 1 }], clienteId: 1 }).ok, true, 'cliente varios sirve para montos bajos');
    const ok = vender({ items, clienteId: CLIENTE_DNI });
    assert.equal(ok.ok, true, ok.error);
  });

  test('cliente inexistente o inactivo se rechaza', () => {
    assert.match(vender({ clienteId: 9999, items: [{ productId: 101, cantidad: 1 }] }).error, /no existe/);
    db.prepare('UPDATE customers SET status = 0 WHERE id = ?').run(CLIENTE_DNI);
    assert.match(vender({ clienteId: CLIENTE_DNI, items: [{ productId: 101, cantidad: 1 }] }).error, /inactivo/);
    db.prepare('UPDATE customers SET status = 1 WHERE id = ?').run(CLIENTE_DNI);
  });

  test('medio de pago y comprobante invalidos se rechazan', () => {
    assert.match(vender({ medioPago: 'trueque', items: [{ productId: 101, cantidad: 1 }] }).error, /Medio de pago/);
    assert.match(vender({ tipoComprobante: 'nota', items: [{ productId: 101, cantidad: 1 }] }).error, /comprobante/);
  });
});

test.describe('cierre de caja con cuadre', () => {
  test('el efectivo esperado suma apertura + ventas en efectivo (no las de otros medios)', () => {
    const yape = vender({ medioPago: 'yape', items: [{ productId: 101, cantidad: 1 }] });
    assert.equal(yape.ok, true);
    const t = caja.estado();
    const efectivo = db.prepare("SELECT SUM(total) AS s FROM sales WHERE caja_id = ? AND medio_pago = 'efectivo'").get(t.id).s;
    assert.equal(t.efectivo_esperado, Math.round((100 + efectivo) * 100) / 100);
    assert.ok(t.resumen.porMedio.some((m) => m.medio_pago === 'yape' && m.total === 25));
  });

  test('si no cuadra exige una observacion, y luego guarda la diferencia', () => {
    const esperado = caja.estado().efectivo_esperado;
    const r = caja.cerrar(esperado - 2, { actor: vendedor });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DESCUADRE');
    assert.equal(r.diferencia, -2);
    assert.ok(caja.estado(), 'la caja sigue abierta');

    const ok = caja.cerrar(esperado - 2, { actor: vendedor, observacion: 'Faltante por vuelto mal entregado' });
    assert.equal(ok.ok, true);
    assert.equal(ok.diferencia, -2);
    assert.equal(caja.estado(), null);
    const h = caja.historial()[0];
    assert.equal(h.diferencia, -2);
    assert.match(h.observacion, /Faltante/);
  });
});

test.describe('punto de venta como en el web (ticket, tarjeta, multipago, cliente en caja)', () => {
  const item = [{ productId: 101, cantidad: 1 }]; // S/ 25.00
  test.before(() => {
    assert.equal(caja.abrir(vendedor, 50).ok, true);
    assert.equal(catalogo.ajustarStock(101, { tipo: 'entrada', cajas: 20, motivo: 'Ingreso para pruebas' }, vendedor).ok, true);
  });

  test('el ticket usa su serie T019 y no guarda datos del cliente', () => {
    const t = vender({ tipoComprobante: 'ticket', clienteId: CLIENTE_DNI, items: item });
    assert.equal(t.ok, true, t.error);
    assert.match(t.comprobante, /^T019-00000001$/);
    const v = ventas.obtener(t.id);
    assert.equal(v.cliente_id, null);
    assert.equal(v.cliente_nombre, '');
  });

  test('tarjeta guarda la referencia del voucher y no suma al efectivo', () => {
    const r = vender({ medioPago: 'tarjeta', referencia: ' OP-12345 ', items: item });
    assert.equal(r.ok, true, r.error);
    const v = ventas.obtener(r.id);
    assert.equal(v.referencia_pago, 'OP-12345');
    assert.equal(v.pago_tarjeta, 25);
    assert.equal(v.pago_efectivo, 0);
  });

  test('multipago reparte entre efectivo y tarjeta y valida el monto en efectivo', () => {
    assert.match(vender({ medioPago: 'multipago', items: item }).error, /multipago/);
    assert.match(vender({ medioPago: 'multipago', montoEfectivo: 25, items: item }).error, /menor que el total/);
    const r = vender({ medioPago: 'multipago', montoEfectivo: 10, items: item });
    assert.equal(r.ok, true, r.error);
    const v = ventas.obtener(r.id);
    assert.equal(v.pago_efectivo, 10);
    assert.equal(v.pago_tarjeta, 15);
  });

  test('el efectivo y la tarjeta esperados del turno suman cada via de pago', () => {
    const t = caja.estado();
    const s = db.prepare('SELECT SUM(pago_efectivo) AS e, SUM(pago_tarjeta) AS t FROM sales WHERE caja_id = ?').get(t.id);
    assert.equal(t.efectivo_esperado, Math.round((50 + s.e) * 100) / 100);
    assert.equal(t.resumen.tarjeta, 40); // tarjeta 25 + multipago 15
  });

  test('boleta con DNI nuevo escrito en caja registra al cliente', () => {
    assert.match(vender({ cliente: { documento: '47851236' }, items: item }).error, /nombre del cliente/);
    const r = vender({ cliente: { documento: '47851236', nombre: 'pedro  ruiz' }, puedeCrearCliente: true, items: item });
    assert.equal(r.ok, true, r.error);
    const v = ventas.obtener(r.id);
    assert.equal(v.cliente_nombre, 'PEDRO RUIZ');
    assert.ok(v.cliente_id, 'quedo vinculado al cliente creado');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customers WHERE code = '47851236'").get().n, 1);
    // La segunda vez lo encuentra por documento y no lo duplica.
    const otra = vender({ cliente: { documento: '47851236' }, puedeCrearCliente: true, items: item });
    assert.equal(otra.ok, true, otra.error);
    assert.equal(ventas.obtener(otra.id).cliente_id, v.cliente_id);
  });

  test('sin permiso de alta el cliente escrito queda solo en la venta', () => {
    const r = vender({ cliente: { documento: '48123459', nombre: 'ANA TORRES' }, items: item });
    assert.equal(r.ok, true, r.error);
    assert.equal(ventas.obtener(r.id).cliente_id, null);
    assert.equal(ventas.obtener(r.id).cliente_doc, '48123459');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customers WHERE code = '48123459'").get().n, 0);
  });

  test('factura con RUC escrito en caja exige razon social y RUC valido', () => {
    assert.match(vender({ tipoComprobante: 'factura', cliente: { documento: '47851236', nombre: 'X' }, items: item }).error, /RUC/);
    assert.match(vender({ tipoComprobante: 'factura', cliente: { documento: '20123456789' }, items: item }).error, /razón social/);
    assert.match(vender({ tipoComprobante: 'factura', cliente: { documento: '20123456788', nombre: 'ACME SAC' }, puedeCrearCliente: true, items: item }).error, /RUC/);
  });

  test('mis ventas filtra por vendedor y por horas', () => {
    const mias = ventas.listar({ userId: vendedor.id, horas: 24 });
    assert.ok(mias.length >= 6);
    assert.ok(mias.every((v) => v.user_id === vendedor.id));
    assert.equal(ventas.listar({ userId: 99999 }).length, 0);
  });

  test('el cierre declara tarjeta; si no cuadra exige observacion', () => {
    const t = caja.estado();
    const r = caja.cerrar(t.efectivo_esperado, { tarjeta: 30, actor: vendedor });
    assert.equal(r.code, 'DESCUADRE');
    assert.equal(r.diferenciaTarjeta, -10);
    assert.match(r.error, /tarjeta/);
    const ok = caja.cerrar(t.efectivo_esperado, { tarjeta: 40, actor: vendedor });
    assert.equal(ok.ok, true, ok.error);
    const detalle = caja.obtener(ok.id);
    assert.equal(detalle.tarjeta_declarada, 40);
    assert.equal(detalle.tarjeta_esperada, 40);
  });
});

test.describe('permisos de caja, ventas y sincronizacion', () => {
  let admin;
  test.before(async () => {
    admin = await srv.loginToken('ADMIN01', 'admin123');
    for (const [username, type, dni] of [['AUDIT1', 3, '77665544'], ['ALMA1', 5, '77665533']]) {
      const r = await srv.pedir('/api/usuarios', {
        method: 'POST', token: admin,
        body: { username, password: 'clave123', dni, firstname: username, lastname: 'Prueba', type },
      });
      assert.equal(r.json.ok, true, r.texto);
    }
  });

  test('el auditor consulta ventas y turnos, pero no vende ni abre caja ni sincroniza', async () => {
    const t = await srv.loginToken('AUDIT1', 'clave123');
    assert.equal((await srv.pedir('/api/ventas', { token: t })).status, 200);
    assert.equal((await srv.pedir('/api/caja/historial', { token: t })).status, 200);
    assert.equal((await srv.pedir('/api/caja/abrir', { method: 'POST', token: t, body: { monto: 0 } })).status, 403);
    assert.equal((await srv.pedir('/api/ventas', { method: 'POST', token: t, body: { items: [] } })).status, 403);
    assert.equal((await srv.pedir('/api/sync', { method: 'POST', token: t })).status, 403);
  });

  test('almacen no opera caja ni ve ventas', async () => {
    const t = await srv.loginToken('ALMA1', 'clave123');
    assert.equal((await srv.pedir('/api/caja/abrir', { method: 'POST', token: t, body: { monto: 0 } })).status, 403);
    assert.equal((await srv.pedir('/api/ventas', { token: t })).status, 403);
  });

  test('por HTTP el precio lo pone el servidor, no la ventana', async () => {
    const t = await srv.loginToken('VEND01', 'vendedor123');
    assert.equal((await srv.pedir('/api/caja/abrir', { method: 'POST', token: t, body: { monto: 0 } })).json.ok, true);
    const r = await srv.pedir('/api/ventas', {
      method: 'POST', token: t,
      body: { items: [{ productId: 101, cantidad: 1, precio: 0.01 }], total: 0.01 },
    });
    assert.equal(r.json.ok, true, r.texto);
    assert.equal(r.json.total, 25);
    const detalle = await srv.pedir(`/api/ventas/${r.json.id}`, { token: t });
    assert.equal(detalle.json.venta.usuario, 'Luis Vendedor');
    await srv.pedir('/api/caja/cerrar', { method: 'POST', token: t, body: { monto: 25 } });
  });
});

test.describe('resumen de inicio', () => {
  test('el vendedor ve ventas de hoy, caja y stock bajo', async () => {
    const t = await srv.loginToken('VEND01', 'vendedor123');
    const r = (await srv.pedir('/api/resumen', { token: t })).json;
    assert.ok(r.ventasHoy.ventas > 0);
    assert.ok(r.ventasHoy.total > 0);
    assert.equal(typeof r.caja.abierta, 'boolean');
    assert.ok(r.catalogo.stockBajo >= 1, 'la loratadina esta bajo el minimo');
    assert.ok(Array.isArray(r.stockBajo));
    assert.equal(typeof r.sync.pendientes, 'number');
  });

  test('almacen no recibe datos de ventas', async () => {
    const t = await srv.loginToken('ALMA1', 'clave123');
    const r = (await srv.pedir('/api/resumen', { token: t })).json;
    assert.equal(r.ventasHoy, undefined);
    assert.equal(r.ultimasVentas, undefined);
    assert.ok(r.catalogo);
  });
});
