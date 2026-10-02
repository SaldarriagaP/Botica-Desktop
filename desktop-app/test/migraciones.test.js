// Pruebas del esquema SQLite y de la migracion desde el prototipo anterior.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { migrar, versionActual, VERSION_ESQUEMA } = require('../src/migrations');

function nuevaBase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

test('base nueva: crea el esquema completo en la ultima version', () => {
  const db = nuevaBase();
  const aplicadas = migrar(db, { localId: 19 });

  assert.equal(aplicadas.length, VERSION_ESQUEMA);
  assert.equal(versionActual(db), VERSION_ESQUEMA);

  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of ['user_types', 'locals', 'users', 'sessions', 'auth_log', 'customers', 'products', 'caja', 'sales']) {
    assert.ok(tablas.includes(t), `falta la tabla ${t}`);
  }
});

test('user_types y locals usan los mismos IDs que el sistema web', () => {
  const db = nuevaBase();
  migrar(db, { localId: 19 });

  const tipos = db.prepare('SELECT id, name FROM user_types ORDER BY id').all();
  assert.deepEqual(tipos.map((t) => [t.id, t.name]), [
    [1, 'administrador'], [2, 'vendedor'], [3, 'auditor'], [4, 'local'], [5, 'almacen'],
  ]);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM locals').get().n, 28);
  assert.equal(db.prepare('SELECT name FROM locals WHERE id = 3').get().name, 'Solidaria Cayetano');
  assert.equal(db.prepare('SELECT name FROM locals WHERE id = 19').get().name, 'PRUEBAS - SISTEMA');
});

test('migrar es idempotente: la segunda vez no aplica nada', () => {
  const db = nuevaBase();
  migrar(db, { localId: 19 });
  assert.deepEqual(migrar(db, { localId: 19 }), []);
});

test('users rechaza un tipo o sucursal inexistente (llaves foraneas)', () => {
  const db = nuevaBase();
  migrar(db, { localId: 19 });
  const ins = db.prepare("INSERT INTO users (type, username, firstname, local, password) VALUES (?, ?, 'X', ?, 'h')");
  assert.throws(() => ins.run(99, 'MALO1', 19), /FOREIGN KEY/);
  assert.throws(() => ins.run(2, 'MALO2', 999), /FOREIGN KEY/);
});

test('username es unico sin importar mayusculas', () => {
  const db = nuevaBase();
  migrar(db, { localId: 19 });
  const ins = db.prepare("INSERT INTO users (type, username, firstname, local, password) VALUES (2, ?, 'X', 19, 'h')");
  ins.run('VEND09');
  assert.throws(() => ins.run('vend09'), /UNIQUE/);
});

test('base del prototipo anterior: migra usuarios sin perder datos ni contrasenas', () => {
  const db = nuevaBase();
  // Esquema tal como lo dejaba la version anterior (sin user_version).
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      nombre TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'vendedor', email TEXT NOT NULL DEFAULT '',
      estado INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE products (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, precio REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0, codigo_barras TEXT);
  `);
  const ins = db.prepare('INSERT INTO users (id, username, password_hash, nombre, rol, email, estado) VALUES (?,?,?,?,?,?,?)');
  ins.run(1, 'ADMIN01', bcrypt.hashSync('admin123', 4), 'Rosa Administradora', 'admin', 'rosa@botica.pe', 1);
  ins.run(7, 'VEND07', bcrypt.hashSync('clave777', 4), 'Pedro Inactivo', 'vendedor', '', 0);
  db.prepare("INSERT INTO products (id, nombre, precio, stock) VALUES (101, 'Paracetamol', 0.35, 23)").run();

  migrar(db, { localId: 19 });

  const admin = db.prepare('SELECT * FROM users WHERE id = 1').get();
  assert.equal(admin.type, 1);
  assert.equal(admin.firstname, 'Rosa Administradora');
  assert.equal(admin.email, 'rosa@botica.pe');
  assert.equal(admin.status, 1);
  assert.equal(admin.local, 19);
  assert.ok(bcrypt.compareSync('admin123', admin.password));

  const vend = db.prepare('SELECT * FROM users WHERE id = 7').get();
  assert.equal(vend.type, 2);
  assert.equal(vend.status, 0, 'el estado inactivo se conserva');

  // El stock existente pasa a product_stock de la sucursal, con su kardex inicial.
  const stock = db.prepare('SELECT stock FROM product_stock WHERE product_id = 101 AND local_id = 19').get();
  assert.equal(stock.stock, 23);
  const k = db.prepare('SELECT tipo, cantidad, saldo FROM kardex WHERE product_id = 101').get();
  assert.deepEqual({ ...k }, { tipo: 'inicial', cantidad: 23, saldo: 23 });

  const p = db.prepare('SELECT p.status, p.precio_unidad, p.fraccion, b.name AS marca FROM products p JOIN product_brands b ON b.id = p.brand WHERE p.id = 101').get();
  assert.deepEqual({ ...p }, { status: 1, precio_unidad: 0.35, fraccion: 1, marca: 'SIN MARCA' });
});

test('clientes y productos del prototipo pasan al esquema del web', () => {
  const vieja = nuevaBase();
  vieja.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, documento TEXT, telefono TEXT,
      tipo_documento TEXT NOT NULL DEFAULT 'DNI', direccion TEXT NOT NULL DEFAULT '', estado INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE products (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, precio REAL NOT NULL DEFAULT 0, stock REAL NOT NULL DEFAULT 0,
      codigo_barras TEXT, categoria TEXT NOT NULL DEFAULT '', marca TEXT NOT NULL DEFAULT '', estado INTEGER NOT NULL DEFAULT 1,
      stock_minimo REAL NOT NULL DEFAULT 0);
    INSERT INTO customers (id, nombre, documento, tipo_documento, direccion, estado) VALUES
      (5, 'Empresa SAC', '20607015083', 'RUC', 'Av. Grau 1', 1),
      (6, 'Juan Perez', '41234567', 'DNI', '', 0),
      (7, 'Sin Doc', NULL, 'SIN_DOCUMENTO', '', 1);
    INSERT INTO products VALUES (7, 'Ibuprofeno', 0.4, 10.6, '775', 'analgesico', 'Medifarma', 0, 5);
  `);
  migrar(vieja, { localId: 19 });

  const c = (id) => ({ ...vieja.prepare('SELECT name, tipo_documento, code, type, address, status FROM customers WHERE id = ?').get(id) });
  assert.deepEqual(c(5), { name: 'Empresa SAC', tipo_documento: '6', code: '20607015083', type: 2, address: 'Av. Grau 1', status: 1 });
  assert.deepEqual(c(6), { name: 'Juan Perez', tipo_documento: '1', code: '41234567', type: 1, address: '', status: 0 });
  assert.equal(c(7).tipo_documento, '0');
  assert.equal(c(7).code, '');

  const p = vieja.prepare(`SELECT p.status, c.name AS cat, b.name AS marca, s.stock, s.stock_minimo
    FROM products p JOIN product_brands b ON b.id = p.brand LEFT JOIN product_categories c ON c.id = p.category
    JOIN product_stock s ON s.product_id = p.id WHERE p.id = 7`).get();
  assert.deepEqual({ ...p }, { status: 0, cat: 'ANALGESICO', marca: 'MEDIFARMA', stock: 11, stock_minimo: 5 });
});

test('borrar un producto no deja stock huerfano (llaves foraneas tras el RENAME)', () => {
  const db = nuevaBase();
  migrar(db, { localId: 19 });
  const fk = db.prepare("SELECT \"table\" FROM pragma_foreign_key_list('product_stock')").all().map((r) => r.table);
  assert.deepEqual(fk.sort(), ['locals', 'products']);
  const fkKardex = db.prepare("SELECT \"table\" FROM pragma_foreign_key_list('kardex')").all().map((r) => r.table);
  assert.ok(fkKardex.includes('products'));
});

test('si la sucursal configurada no existe, los usuarios migrados quedan sin sucursal', () => {
  const db = nuevaBase();
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, nombre TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'vendedor')");
  db.prepare("INSERT INTO users VALUES (1, 'A', 'h', 'A', 'admin')").run();
  migrar(db, { localId: 9999 });
  assert.equal(db.prepare('SELECT local FROM users WHERE id = 1').get().local, null);
});
