// Pruebas del modulo de catalogo y stock.

const { usarBaseTemporal } = require('./helpers');
usarBaseTemporal('catalogo');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const { seed } = require('../src/seedData');
const catalogo = require('../src/catalogo');
const caja = require('../src/caja');
const ventas = require('../src/ventas');

seed(db);
const actor = { id: 1 };

const marcaId = catalogo.marcas.crear('Laboratorios Prueba').id;
const categoriaId = catalogo.categorias.crear('Antigripal').id;

const base = {
  name: 'Panadol Antigripal Cja x 100 Tab',
  brand: marcaId,
  category: categoriaId,
  composicion: 'Paracetamol 500mg + Fenilefrina',
  presentacion: 'CJA X 100 TAB',
  forma_farm: 'Tabletas',
  codigo_barras: '7751234567890',
  se_fracciona: 1,
  fraccion: 100,
  precio_compra: 40,
  precio_unidad: 55,
  precio_fraccion: 0.6,
  stock_minimo: 150,
};

test.describe('stock en cajas y unidades sueltas', () => {
  test('describirStock', () => {
    assert.equal(catalogo.describirStock(103, 100).texto, '1 caja + 3 und');
    assert.equal(catalogo.describirStock(200, 100).texto, '2 cajas');
    assert.equal(catalogo.describirStock(7, 100).texto, '7 und');
    assert.equal(catalogo.describirStock(0, 100).texto, '0 und');
    assert.equal(catalogo.describirStock(12, 1).texto, '12 und');
    assert.equal(catalogo.describirStock(-5, 100).texto, '-5 und');
  });
});

test.describe('marcas y categorias', () => {
  test('nombres unicos sin importar mayusculas y normalizados', () => {
    assert.equal(catalogo.marcas.listar().find((m) => m.id === marcaId).name, 'LABORATORIOS PRUEBA');
    assert.match(catalogo.marcas.crear('laboratorios prueba').error, /Ya existe/);
    assert.match(catalogo.categorias.crear('x').error, /2 a 100/);
    assert.equal(catalogo.categorias.renombrar(categoriaId, 'Antigripales').ok, true);
    assert.match(catalogo.categorias.renombrar(categoriaId, 'analgesico').error, /Ya existe/);
  });
});

test.describe('productos', () => {
  let id;

  test('crea un producto fraccionable con su stock en la sucursal', () => {
    const r = catalogo.crear(base, actor);
    assert.equal(r.ok, true, r.error);
    id = r.id;
    assert.equal(r.producto.name, 'PANADOL ANTIGRIPAL CJA X 100 TAB');
    assert.equal(r.producto.brand_name, 'LABORATORIOS PRUEBA');
    assert.equal(r.producto.fraccion, 100);
    assert.equal(r.producto.stock, 0);
    assert.equal(r.producto.stock_minimo, 150);
    assert.equal(r.producto.sync_pendiente, 1);
    assert.deepEqual(r.advertencias, []);
  });

  test('reglas de negocio al crear', () => {
    assert.match(catalogo.crear({ ...base, codigo_barras: '7751234567890' }).error, /ya lo usa/);
    assert.match(catalogo.crear({ ...base, codigo_barras: '', brand: 9999 }).error, /marca/);
    assert.match(catalogo.crear({ ...base, codigo_barras: '', category: 9999 }).error, /categoría/);
    assert.match(catalogo.crear({ ...base, codigo_barras: '', composicion: '' }).error, /composición/);
    assert.match(catalogo.crear({ ...base, codigo_barras: '', fraccion: 1 }).error, /entre 2 y 10000/);
    assert.match(catalogo.crear({ ...base, codigo_barras: '', fraccion: 2.5 }).error, /entre 2 y 10000/);
    assert.match(catalogo.crear({ ...base, codigo_barras: '', precio_unidad: -1 }).error, /precios/);
    // 100 sueltas a 0.50 = 50 < 55 de la caja: vender suelto saldria mas barato.
    assert.match(catalogo.crear({ ...base, codigo_barras: '', precio_fraccion: 0.5 }).error, /no puede ser menor/);
  });

  test('producto no fraccionable: fraccion 1 y sin precio por fraccion', () => {
    const r = catalogo.crear({ ...base, name: 'Jarabe X 120ml', codigo_barras: '', se_fracciona: 0, fraccion: 50, precio_fraccion: 9 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.producto.fraccion, 1);
    assert.equal(r.producto.precio_fraccion, 0);
  });

  test('advierte (sin bloquear) precio cero o venta por debajo del costo', () => {
    const r = catalogo.crear({ ...base, name: 'Sin precio', codigo_barras: '', precio_unidad: 30, precio_fraccion: 0.4 });
    assert.equal(r.ok, true, r.error);
    assert.match(r.advertencias.join(' '), /menor que el precio de compra/);
    const r2 = catalogo.crear({ ...base, name: 'Precio cero', codigo_barras: '', precio_unidad: 0, precio_fraccion: 0 });
    assert.match(r2.advertencias.join(' '), /no tiene precio/);
  });

  test('busqueda por palabras en nombre/composicion/marca y por codigo de barras', () => {
    assert.equal(catalogo.listar({ q: 'fenilefrina panadol' }).items[0].id, id);
    assert.equal(catalogo.listar({ q: 'laboratorios prueba antigripal' }).items.some((p) => p.id === id), true);
    assert.equal(catalogo.listar({ q: '7751234567890' }).items[0].id, id);
    // "%" es texto literal: solo encuentra productos que realmente lo contienen.
    assert.deepEqual(catalogo.listar({ q: '%' }).items.map((p) => p.id), [105]);
    assert.equal(catalogo.listar({ q: '_' }).total, 0);
  });

  test('filtros por categoria, marca y estado', () => {
    assert.ok(catalogo.listar({ categoria: categoriaId }).items.every((p) => p.category === categoriaId));
    assert.ok(catalogo.listar({ marca: marcaId }).total >= 1);
    catalogo.cambiarEstado(id, 0);
    assert.equal(catalogo.listar({ q: 'panadol', soloActivos: true }).total, 0);
    catalogo.cambiarEstado(id, 1);
  });
});

test.describe('ajustes de stock y kardex', () => {
  const panadol = () => catalogo.listar({ q: '7751234567890' }).items[0];

  test('entrada en cajas + sueltas queda en el kardex con usuario y motivo', () => {
    const r = catalogo.ajustarStock(panadol().id, { tipo: 'entrada', cajas: 2, sueltas: 30, motivo: 'Ingreso de guía 001-123' }, actor);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.stock, 230);
    assert.equal(r.stock_detalle.texto, '2 cajas + 30 und');

    const k = catalogo.kardex(panadol().id);
    assert.equal(k.items[0].tipo, 'ajuste_entrada');
    assert.equal(k.items[0].cantidad, 230);
    assert.equal(k.items[0].saldo, 230);
    assert.equal(k.items[0].usuario, 'Rosa Administradora');
  });

  test('salida no puede dejar el stock en negativo', () => {
    const r = catalogo.ajustarStock(panadol().id, { tipo: 'salida', cajas: 3, motivo: 'Vencimiento lote A' }, actor);
    assert.equal(r.ok, false);
    assert.match(r.error, /2 cajas \+ 30 und/);
    assert.equal(panadol().stock, 230, 'no se toco el stock');
  });

  test('validaciones del ajuste', () => {
    const idp = panadol().id;
    assert.match(catalogo.ajustarStock(idp, { tipo: 'entrada', cajas: 1, motivo: 'x' }).error, /motivo/);
    assert.match(catalogo.ajustarStock(idp, { tipo: 'otro', cajas: 1, motivo: 'motivo largo' }).error, /entrada o de salida/);
    assert.match(catalogo.ajustarStock(idp, { tipo: 'entrada', cajas: 0, motivo: 'motivo largo' }).error, /mayor que 0/);
    assert.match(catalogo.ajustarStock(idp, { tipo: 'entrada', cajas: 1.5, motivo: 'motivo largo' }).error, /enteros/);
  });

  test('no se puede cambiar la fraccion si hay stock', () => {
    const p = panadol();
    const r = catalogo.actualizar(p.id, { ...base, fraccion: 50, precio_fraccion: 1.2 });
    assert.match(r.error, /Ajusta el stock a 0/);
  });

  test('stock bajo el minimo se marca y se puede filtrar', () => {
    catalogo.ajustarStock(panadol().id, { tipo: 'salida', cajas: 1, motivo: 'Merma por rotura' }, actor);
    assert.equal(panadol().stock, 130);
    assert.equal(panadol().stock_bajo, true);
    assert.ok(catalogo.listar({ stock: 'bajo' }).items.some((p) => p.codigo_barras === '7751234567890'));
    assert.equal(catalogo.definirStockMinimo(panadol().id, 100).ok, true);
    assert.equal(panadol().stock_bajo, false);
    assert.equal(catalogo.definirStockMinimo(panadol().id, -1).ok, false);
  });

  test('el saldo del kardex siempre cuadra con el stock', () => {
    const p = panadol();
    const suma = db.prepare('SELECT SUM(cantidad) AS s FROM kardex WHERE product_id = ?').get(p.id).s;
    assert.equal(suma, p.stock);
  });
});

test.describe('ventas usan el stock del catalogo', () => {
  test.before(() => caja.abrir('Luis Vendedor', 0));

  test('vender 1 caja y 5 sueltas descuenta 105 fracciones y registra kardex', () => {
    const antes = catalogo.obtener(101).stock; // Paracetamol x 100
    const r = ventas.registrar({
      usuario: 'Luis Vendedor',
      userId: 2,
      items: [{ productId: 101, cantidad: 1, modo: 'unidad' }, { productId: 101, cantidad: 5, modo: 'fraccion' }],
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.total, 26.75); // 25 + 5 x 0.35
    assert.equal(catalogo.obtener(101).stock, antes - 105);
    const k = catalogo.kardex(101).items.filter((m) => m.referencia === `venta:${r.id}`);
    assert.equal(k.length, 2);
  });

  test('no vende por fraccion un producto que no se fracciona', () => {
    assert.match(ventas.registrar({ usuario: 'x', items: [{ productId: 105, cantidad: 1, modo: 'fraccion' }] }).error, /unidad suelta/);
  });

  test('stock insuficiente considera todas las lineas del mismo producto y no descuenta nada', () => {
    const antes = catalogo.obtener(104).stock; // Loratadina: 25 fracciones
    const r = ventas.registrar({
      usuario: 'x',
      items: [{ productId: 104, cantidad: 2, modo: 'unidad' }, { productId: 104, cantidad: 10, modo: 'fraccion' }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /Stock insuficiente/);
    assert.equal(catalogo.obtener(104).stock, antes);
  });

  test('cantidades no enteras se rechazan', () => {
    assert.match(ventas.registrar({ usuario: 'x', items: [{ productId: 101, cantidad: 0.5 }] }).error, /entero/);
  });
});
