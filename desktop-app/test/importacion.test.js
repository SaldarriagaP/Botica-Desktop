// Pruebas de la carga inicial desde el volcado MySQL del sistema web.

const { usarBaseTemporal } = require('./helpers');
usarBaseTemporal('importacion');

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const { leerFilas, importar } = require('../src/importacion');
const catalogo = require('../src/catalogo');
const clientes = require('../src/clientes');

// Local 3 (Solidaria Cayetano) pertenece a la zona 3.
const DUMP = `
-- volcado de prueba
INSERT INTO \`product_categories\` VALUES (1,'PRESERVATIVO','2022-03-31 16:14:52','2022-03-31 16:14:52'),(2,'ANTIBACTERIANO','x','x');
INSERT INTO \`product_brands\` VALUES (1,'DUREX','x','x'),(2,'MEDIFARMA','x','x');
INSERT INTO \`products\` VALUES (1,'DUREX SENSITIVO',1,1,'b',1,1,1,1,60.00,10,66.00,0.00,'x','x','DUREX','CJA X 3 UND','PRESERVATIVO',782850,0,0,0.000,0,0,0.00,'false',NULL,'0'),(2,'AMOXIL 500MG CJA X100 CAP \\'NF\\'',2,2,'b',1,0,1,100,40.00,0,70.00,0.90,'x','x','AMOXICILINA 500MG','CJA X100 CAP','CAPSULAS',2147483647,0,0,0.000,0,0,0.00,'false',NULL,'0');
INSERT INTO \`products\` VALUES (3,'PRODUCTO INACTIVO',9,NULL,'b',0,1,0,1,NULL,0,5.00,0.00,'x','x',NULL,NULL,NULL,0,0,0,0.000,0,0,0.00,'false',NULL,'0');
INSERT INTO \`pricezona\` VALUES (1,1,1,10,66.00,0.00,'x','x'),(2,1,3,10,68.00,0.00,'x','x'),(3,2,3,0,75.00,1.00,'x','x');
INSERT INTO \`fraccionventa\` VALUES (1,1,3,0.00,4.00,'x','x'),(2,2,3,35.00,2.00,'x','x'),(3,2,8,0.00,9.00,'x','x');
INSERT INTO \`customers\` VALUES (1,'ROLANDO PRUEBA','12345678',NULL,1,'x','x'),(2,'EMPRESA SAC','20607015083','AV. GRAU 1',2,'x','x'),(3,'','',NULL,3,'x','x');
`;

test('el lector de INSERTs maneja escapes, NULL y varios INSERT por tabla', () => {
  const productos = leerFilas(DUMP, 'products');
  assert.equal(productos.length, 3);
  assert.equal(productos[1][1], "AMOXIL 500MG CJA X100 CAP 'NF'");
  assert.equal(productos[2][3], null);
  assert.equal(productos[0][9], 60);
  assert.deepEqual(leerFilas("INSERT INTO `t` VALUES ('a''b','c\\\\d',-1.5);", 't'), [["a'b", 'c\\d', -1.5]]);
  assert.deepEqual(leerFilas(DUMP, 'no_existe'), []);
});

test('importa catalogo, precios de la zona, stock de la sucursal y clientes', () => {
  const r = importar(DUMP, { localId: 3 });
  assert.equal(r.sucursal, 'Solidaria Cayetano');
  assert.deepEqual(r.productos, { nuevos: 3, actualizados: 0, conPrecioDeZona: 2 });
  assert.equal(r.clientes.nuevos, 3);

  const idDe = (central) => db.prepare('SELECT id FROM products WHERE central_id = ?').get(central).id;

  const durex = db.prepare('SELECT * FROM products WHERE central_id = 1').get();
  assert.equal(durex.se_fracciona, 0, 'status_fraccion=1 en el web significa que NO se fracciona');
  assert.equal(durex.precio_unidad, 68, 'usa el precio de la zona 3, no el general');
  assert.equal(durex.codigo_barras, '782850');
  assert.equal(durex.sync_pendiente, 0);

  const amox = db.prepare('SELECT * FROM products WHERE central_id = 2').get();
  assert.equal(amox.se_fracciona, 1);
  assert.equal(amox.fraccion, 100);
  assert.equal(amox.precio_fraccion, 1);
  assert.equal(amox.codigo_barras, '', 'el 2147483647 del web (desborde) se descarta');

  const inactivo = db.prepare('SELECT p.status, p.status_igv, b.name AS marca FROM products p JOIN product_brands b ON b.id = p.brand WHERE p.central_id = 3').get();
  assert.deepEqual({ ...inactivo }, { status: 0, status_igv: 0, marca: 'SIN MARCA' });

  // Stock de la sucursal 3: 2 cajas x 100 + 35 sueltas = 235 (la fila del local 8 se ignora).
  const stockAmox = db.prepare('SELECT stock FROM product_stock WHERE product_id = ? AND local_id = 3').get(idDe(2)).stock;
  assert.equal(stockAmox, 235);
  const stockDurex = db.prepare('SELECT stock FROM product_stock WHERE product_id = ? AND local_id = 3').get(idDe(1)).stock;
  assert.equal(stockDurex, 4);

  const empresa = clientes.buscarPorDocumento('20607015083');
  assert.equal(empresa.tipo_documento, '6');
  assert.equal(empresa.type_name, 'empresa');
  assert.equal(clientes.buscarPorDocumento('12345678').tipo_documento_nombre, 'DNI');
});

test('reimportar no duplica: actualiza y deja en el kardex solo la diferencia de stock', () => {
  const cambiado = DUMP.replace('(2,2,3,35.00,2.00', '(2,2,3,10.00,2.00');
  const r = importar(cambiado, { localId: 3 });
  assert.deepEqual(r.productos, { nuevos: 0, actualizados: 3, conPrecioDeZona: 2 });
  assert.equal(r.clientes.nuevos, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE central_id IS NOT NULL').get().n, 3);

  const id = db.prepare('SELECT id FROM products WHERE central_id = 2').get().id;
  const movs = db.prepare("SELECT cantidad, saldo FROM kardex WHERE product_id = ? AND local_id = 3 ORDER BY id").all(id).map((m) => ({ ...m }));
  assert.deepEqual(movs, [{ cantidad: 235, saldo: 235 }, { cantidad: -25, saldo: 210 }]);
});

test('un cliente creado offline con el mismo documento se enlaza en vez de duplicarse', () => {
  const local = clientes.crear({ name: 'Juana Offline', tipoDocumento: '1', code: '44445555' });
  assert.equal(local.ok, true);
  const dump = "INSERT INTO `products` VALUES (1,'X',1,1,'b',1,1,1,1,1,0,1,0,'x','x','A','B','C',0,0,0,0,0,0,0,'false',NULL,'0');\n"
    + "INSERT INTO `customers` VALUES (500,'JUANA DEL WEB','44445555',NULL,1,'x','x');";
  importar(dump, { localId: 3 });
  const c = clientes.buscarPorDocumento('44445555');
  assert.equal(c.id, local.id);
  assert.equal(c.central_id, 500);
  assert.equal(c.name, 'JUANA DEL WEB');
});

test('marcas duplicadas en el web (solo difieren en espacios) se fusionan', () => {
  const dump = "INSERT INTO `product_brands` VALUES (262,'PHARMEX SAC','x','x'),(391,'PHARMEX   SAC','x','x');\n"
    + "INSERT INTO `products` VALUES (900,'P1',262,NULL,'b',1,1,1,1,1,0,1,0,'x','x','A','B','C',0,0,0,0,0,0,0,'false',NULL,'0'),"
    + "(901,'P2',391,NULL,'b',1,1,1,1,1,0,1,0,'x','x','A','B','C',0,0,0,0,0,0,0,'false',NULL,'0');";
  const r = importar(dump, { localId: 3 });
  assert.equal(r.marcas.fusionadas.length, 1);
  assert.match(r.marcas.fusionadas[0], /PHARMEX SAC/);
  const marcas = db.prepare('SELECT DISTINCT brand FROM products WHERE central_id IN (900, 901)').all();
  assert.equal(marcas.length, 1, 'ambos productos apuntan a la misma marca local');
  // Reimportar es estable.
  assert.equal(importar(dump, { localId: 3 }).marcas.fusionadas.length, 1);
});

test('si el archivo no trae productos no modifica nada', () => {
  const antes = db.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n;
  assert.throws(() => importar("INSERT INTO `product_categories` VALUES (99,'NUEVA','x','x');", { localId: 3 }), /products/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n, antes);
});

test('los productos importados funcionan en el catalogo de la terminal', () => {
  // La terminal de prueba esta configurada en el local 19; se consulta el 3 directo.
  const p = catalogo.listar({ q: 'amoxicilina' }).items[0];
  assert.equal(p.brand_name, 'MEDIFARMA');
  assert.equal(p.category_name, 'ANTIBACTERIANO');
});
